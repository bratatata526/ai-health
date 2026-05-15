/**
 * Minimal “cloud” API server with per-user isolation.
 * - No external deps (Node built-ins only)
 * - JWT-like HMAC token (HS256)
 * - SQLite storage (better-sqlite3). Deploy this server to your own VM/container to become “cloud”.
 *
 * Endpoints:
 * - POST /auth/register  { email, password, name? }
 * - POST /auth/login     { email, password }
 * - PUT  /auth/password  { oldPassword, newPassword } (auth required)
 * - GET  /me
 * - PUT  /me             { name? }
 * - DELETE /me           (auth required, delete account + data)
 * - GET  /data           -> returns user snapshot + revision
 * - PUT  /data           { snapshot, baseRevision? } (replaces, conflict-protected)
 *   - If baseRevision is provided and doesn't match server revision, returns 409 with server snapshot.
 *   - Add query ?force=1 to overwrite regardless of revision.
 *
 * Env:
 * - CLOUD_PORT=4000
 * - CLOUD_JWT_SECRET=change_me
 * - CLOUD_DATA_DIR=./cloud-data   (kept for compatibility; DB uses CLOUD_DB_PATH)
 * - CLOUD_DB_PATH=./cloud-data/cloud.db
 */

const http = require('http');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.CLOUD_PORT || 4000);
const JWT_SECRET = process.env.CLOUD_JWT_SECRET || 'change_me_in_production';
const DATA_DIR = process.env.CLOUD_DATA_DIR || path.join(__dirname, 'cloud-data'); // compatibility

const {
  DB_PATH,
  getUserByEmail,
  getUserById,
  createUser,
  updateUserName,
  updateUserPassword,
  deleteUserById,
  getUserData,
  setUserData,
} = require('./cloud/db');

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function isValidEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function validatePassword(password) {
  const p = String(password || '');
  if (p.length < 6) return { ok: false, error: 'password too short (>=6)' };
  if (p.length > 64) return { ok: false, error: 'password too long (<=64)' };
  if (!/[A-Za-z0-9]/.test(p)) return { ok: false, error: 'password must include letters or digits' };
  return { ok: true };
}

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}

function signToken(payload, expiresInSec = 7 * 24 * 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSec };
  const p1 = b64urlJson(header);
  const p2 = b64urlJson(fullPayload);
  const data = `${p1}.${p2}`;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [p1, p2, sig] = parts;
  const data = `${p1}.${p2}`;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(p2.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && now > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  const derived = crypto.scryptSync(password, salt, 32);
  return derived.toString('hex');
}

function getAuthUser(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return verifyToken(m[1]);
}

// DB initializes itself. DATA_DIR is kept for backward compatibility only.

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      });
      return res.end();
    }

    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, port: PORT });
    }

    // Register
    if (req.method === 'POST' && url.pathname === '/auth/register') {
      const body = await readJsonBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const name = String(body.name || '').trim();
      if (!email || !password) return sendJson(res, 400, { error: 'email/password required' });
      if (!isValidEmail(email)) return sendJson(res, 400, { error: 'invalid email format' });
      const pw = validatePassword(password);
      if (!pw.ok) return sendJson(res, 400, { error: pw.error });

      if (getUserByEmail(email)) return sendJson(res, 409, { error: 'email already exists' });

      const id = crypto.randomUUID();
      const saltHex = crypto.randomBytes(16).toString('hex');
      const passHash = hashPassword(password, saltHex);
      const finalName = name || email.split('@')[0];
      createUser({
        id,
        email,
        name: finalName,
        passHash,
        passSalt: saltHex,
        createdAt: new Date().toISOString(),
      });

      const token = signToken({ sub: id, email });
      return sendJson(res, 200, { token, profile: { id, email, name: finalName } });
    }

    // Login
    if (req.method === 'POST' && url.pathname === '/auth/login') {
      const body = await readJsonBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!email || !password) return sendJson(res, 400, { error: 'email/password required' });
      if (!isValidEmail(email)) return sendJson(res, 400, { error: 'invalid email format' });
      const u = getUserByEmail(email);
      if (!u) return sendJson(res, 401, { error: 'invalid credentials' });
      const passHash = hashPassword(password, u.pass_salt);
      if (passHash !== u.pass_hash) return sendJson(res, 401, { error: 'invalid credentials' });
      const token = signToken({ sub: u.id, email });
      return sendJson(res, 200, { token, profile: { id: u.id, email: u.email, name: u.name } });
    }

    // Auth required below
    const user = getAuthUser(req);
    if (!user) return sendJson(res, 401, { error: 'unauthorized' });
    const userId = user.sub;
    // Ensure user exists
    const meUser = getUserById(userId);
    if (!meUser) return sendJson(res, 401, { error: 'unauthorized' });

    // Change password
    if (req.method === 'PUT' && url.pathname === '/auth/password') {
      const body = await readJsonBody(req);
      const oldPassword = String(body.oldPassword || '');
      const newPassword = String(body.newPassword || '');
      if (!oldPassword || !newPassword) return sendJson(res, 400, { error: 'oldPassword/newPassword required' });
      const pw = validatePassword(newPassword);
      if (!pw.ok) return sendJson(res, 400, { error: pw.error });

      const email = String(user.email || '').toLowerCase();
      const u = getUserByEmail(email);
      if (!u) return sendJson(res, 404, { error: 'user not found' });

      const oldHash = hashPassword(oldPassword, u.pass_salt);
      if (oldHash !== u.pass_hash) return sendJson(res, 401, { error: 'invalid credentials' });

      const saltHex = crypto.randomBytes(16).toString('hex');
      const passHash = hashPassword(newPassword, saltHex);
      updateUserPassword(u.id, passHash, saltHex);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/me') {
      const email = String(user.email || '').toLowerCase();
      const u = getUserByEmail(email);
      if (!u) return sendJson(res, 404, { error: 'user not found' });
      return sendJson(res, 200, { id: u.id, email: u.email, name: u.name });
    }

    if (req.method === 'PUT' && url.pathname === '/me') {
      const body = await readJsonBody(req);
      const email = String(user.email || '').toLowerCase();
      const u = getUserByEmail(email);
      if (!u) return sendJson(res, 404, { error: 'user not found' });
      const name = String(body.name || '').trim();
      if (name) updateUserName(u.id, name);
      const updated = getUserById(u.id);
      return sendJson(res, 200, { id: updated.id, email: updated.email, name: updated.name });
    }

    // Delete account
    if (req.method === 'DELETE' && url.pathname === '/me') {
      const email = String(user.email || '').toLowerCase();
      const u = getUserByEmail(email);
      if (!u) return sendJson(res, 404, { error: 'user not found' });
      deleteUserById(u.id);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/data') {
      const stored = getUserData(userId);
      return sendJson(res, 200, stored);
    }

    if (req.method === 'PUT' && url.pathname === '/data') {
      const body = await readJsonBody(req);
      const snapshot = body.snapshot || {};
      const force = url.searchParams.get('force') === '1';
      const stored = getUserData(userId);
      const incomingProfile = snapshot?.profile;

      const baseRevision = Number(body.baseRevision || 0) || null;
      if (!force && baseRevision && baseRevision !== stored.revision) {
        return sendJson(res, 409, {
          error: 'conflict',
          message: 'Server has newer data. Pull first or force overwrite.',
          server: stored,
        });
      }

      const next = {
        ...stored,
        profile: incomingProfile && typeof incomingProfile === 'object'
          ? { ...(stored.profile || {}), ...incomingProfile }
          : stored.profile,
        snapshot,
        updatedAt: new Date().toISOString(),
        revision: (stored.revision || 1) + 1,
      };
      setUserData({ userId, profile: next.profile, snapshot: next.snapshot, updatedAt: next.updatedAt, revision: next.revision });
      return sendJson(res, 200, { ok: true, updatedAt: next.updatedAt, revision: next.revision });
    }

    return sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    return sendJson(res, 500, { error: e.message || 'internal error' });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Cloud API listening on http://192.168.3.5:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
  console.log(`Compat data dir: ${DATA_DIR}`);
});



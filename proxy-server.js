/**
 * Simple local proxy to bypass browser CORS/Mixed-Content issues for Expo Web.
 *
 * Endpoints:
 * - GET  /health
 * - GET  /api/baidu/token?apiKey=...&secretKey=...
 * - POST /api/baidu/ocr  { apiKey, secretKey, imageBase64 }   (optional: ocrUrl)
 * - GET  /api/medicine/juhe?apiKey=...&drugname=...
 * - GET  /api/medicine/tianapi?key=...&word=...
 * - GET  /api/medicine/jisu?appkey=...&name=...
 * - GET  /api/medicine/wanwei?appcode=...&name=...
 * - POST /api/ai/siliconflow { apiKey, model, messages, max_tokens, temperature }
 *
 * Security note:
 * - For web, you can avoid sending keys from the browser by setting env vars:
 *   BAIDU_API_KEY, BAIDU_SECRET_KEY, JUHE_API_KEY, SILICONFLOW_API_KEY
 * - The proxy will use env keys if request does not provide them.
 *
 * Usage:
 *   node proxy-server.js
 *
 * Optional env:
 *   PORT=3001
 *   SILICONFLOW_API_KEY=... (for AI API)
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

function loadDotEnvIfExists() {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const s = String(line || '').trim();
      if (!s || s.startsWith('#')) return;
      const idx = s.indexOf('=');
      if (idx <= 0) return;
      const key = s.slice(0, idx).trim();
      const val = s.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] == null) process.env[key] = val;
    });
  } catch {
    // ignore .env parse errors
  }
}

loadDotEnvIfExists();

const PORT = Number(process.env.PORT || 3001);
const ENV_BAIDU_API_KEY = process.env.BAIDU_API_KEY;
const ENV_BAIDU_SECRET_KEY = process.env.BAIDU_SECRET_KEY;
const ENV_JUHE_API_KEY = process.env.JUHE_API_KEY;
const ENV_TIANAPI_KEY = process.env.TIANAPI_KEY;
const ENV_JISU_API_KEY = process.env.JISU_API_KEY;
const ENV_WANWEI_APP_CODE = process.env.WANWEI_APP_CODE;

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  });
  res.end(text);
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
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function requestUrl(targetUrl, options = {}) {
  const u = new URL(targetUrl);
  const lib = u.protocol === 'https:' ? https : http;
  const reqOptions = {
    method: options.method || 'GET',
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: `${u.pathname}${u.search}`,
    headers: options.headers || {},
  };

  return new Promise((resolve, reject) => {
    const r = lib.request(reqOptions, (resp) => {
      let data = '';
      resp.on('data', (chunk) => (data += chunk));
      resp.on('end', () => {
        resolve({
          statusCode: resp.statusCode || 0,
          headers: resp.headers,
          body: data,
        });
      });
    });
    r.on('error', reject);
    if (options.body) r.write(options.body);
    r.end();
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return sendText(res, 400, 'Bad Request');

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      return res.end();
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, port: PORT });
    }

    // Baidu token
    if (req.method === 'GET' && url.pathname === '/api/baidu/token') {
      const apiKey = url.searchParams.get('apiKey') || ENV_BAIDU_API_KEY;
      const secretKey = url.searchParams.get('secretKey') || ENV_BAIDU_SECRET_KEY;
      if (!apiKey || !secretKey) {
        return sendJson(res, 400, { error: 'Missing apiKey/secretKey' });
      }
      const tokenUrl =
        `https://aip.baidubce.com/oauth/2.0/token` +
        `?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}` +
        `&client_secret=${encodeURIComponent(secretKey)}`;

      const r = await requestUrl(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      // Baidu returns JSON even on errors
      let json;
      try {
        json = JSON.parse(r.body || '{}');
      } catch {
        json = { raw: r.body };
      }
      return sendJson(res, 200, json);
    }

    // Baidu OCR
    if (req.method === 'POST' && url.pathname === '/api/baidu/ocr') {
      const body = await readJsonBody(req);
      const apiKey = body.apiKey || ENV_BAIDU_API_KEY;
      const secretKey = body.secretKey || ENV_BAIDU_SECRET_KEY;
      const imageBase64 = body.imageBase64;
      const ocrUrl = body.ocrUrl || 'https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic';
      if (!apiKey || !secretKey || !imageBase64) {
        return sendJson(res, 400, { error: 'Missing apiKey/secretKey/imageBase64' });
      }

      // get token
      const tokenResp = await requestUrl(
        `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secretKey)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      );
      let tokenJson;
      try {
        tokenJson = JSON.parse(tokenResp.body || '{}');
      } catch {
        tokenJson = {};
      }
      if (!tokenJson.access_token) {
        return sendJson(res, 200, tokenJson);
      }

      const accessToken = tokenJson.access_token;
      const finalOcrUrl = `${ocrUrl}?access_token=${encodeURIComponent(accessToken)}`;
      const form = new URLSearchParams();
      form.append('image', imageBase64);

      const ocrResp = await requestUrl(finalOcrUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });

      let ocrJson;
      try {
        ocrJson = JSON.parse(ocrResp.body || '{}');
      } catch {
        ocrJson = { raw: ocrResp.body };
      }
      return sendJson(res, 200, ocrJson);
    }

    // Juhe medicine info
    if (req.method === 'GET' && url.pathname === '/api/medicine/juhe') {
      const apiKey = url.searchParams.get('apiKey') || ENV_JUHE_API_KEY;
      const drugname = url.searchParams.get('drugname');
      if (!apiKey || !drugname) {
        return sendJson(res, 400, { error: 'Missing apiKey/drugname' });
      }
      // Juhe may be http-only; server-side request avoids browser mixed-content restrictions.
      const juheUrl =
        `http://apis.juhe.cn/drug/query?key=${encodeURIComponent(apiKey)}&drugname=${encodeURIComponent(drugname)}`;
      const r = await requestUrl(juheUrl, { method: 'GET' });

      let json;
      try {
        json = JSON.parse(r.body || '{}');
      } catch {
        json = { raw: r.body };
      }
      return sendJson(res, 200, json);
    }

    // TianAPI medicine instructions
    if (req.method === 'GET' && url.pathname === '/api/medicine/tianapi') {
      const apiKey = url.searchParams.get('key') || ENV_TIANAPI_KEY;
      const word = url.searchParams.get('word');
      if (!apiKey || !word) {
        return sendJson(res, 400, { error: 'Missing key/word' });
      }
      const targetUrl = `https://apis.tianapi.com/yaopin/index?key=${encodeURIComponent(apiKey)}&word=${encodeURIComponent(word)}`;
      const r = await requestUrl(targetUrl, { method: 'GET' });
      let json;
      try {
        json = JSON.parse(r.body || '{}');
      } catch {
        json = { raw: r.body };
      }
      return sendJson(res, 200, json);
    }

    // Jisu medicine info
    if (req.method === 'GET' && url.pathname === '/api/medicine/jisu') {
      const apiKey = url.searchParams.get('appkey') || ENV_JISU_API_KEY;
      const name = url.searchParams.get('name');
      if (!apiKey || !name) {
        return sendJson(res, 400, { error: 'Missing appkey/name' });
      }
      const targetUrl = `https://api.jisuapi.com/drug/query?appkey=${encodeURIComponent(apiKey)}&name=${encodeURIComponent(name)}`;
      const r = await requestUrl(targetUrl, { method: 'GET' });
      let json;
      try {
        json = JSON.parse(r.body || '{}');
      } catch {
        json = { raw: r.body };
      }
      return sendJson(res, 200, json);
    }

    // Wanwei (Aliyun ShowAPI) medicine info
    if (req.method === 'GET' && url.pathname === '/api/medicine/wanwei') {
      const appCode = url.searchParams.get('appcode') || ENV_WANWEI_APP_CODE;
      const name = url.searchParams.get('name');
      if (!appCode || !name) {
        return sendJson(res, 400, { error: 'Missing appcode/name' });
      }
      const targetUrl = `https://ali-medicine.showapi.com/medicine?name=${encodeURIComponent(name)}`;
      const r = await requestUrl(targetUrl, {
        method: 'GET',
        headers: { Authorization: `APPCODE ${appCode}` },
      });
      let json;
      try {
        json = JSON.parse(r.body || '{}');
      } catch {
        json = { raw: r.body };
      }
      return sendJson(res, 200, json);
    }

    // AI API endpoints - 硅基流动 SiliconFlow
    const ENV_SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY;
    if (req.method === 'POST' && url.pathname === '/api/ai/siliconflow') {
      const body = await readJsonBody(req);
      const apiKey = body.apiKey || ENV_SILICONFLOW_API_KEY;
      if (!apiKey) {
        return sendJson(res, 400, { error: 'Missing SiliconFlow API key' });
      }
      const {
        model,
        messages,
        max_tokens,
        temperature,
        frequency_penalty,
        presence_penalty,
        top_p,
      } = body;
      const sfPayload = { model, messages, max_tokens, temperature };
      if (typeof frequency_penalty === 'number') sfPayload.frequency_penalty = frequency_penalty;
      if (typeof presence_penalty === 'number') sfPayload.presence_penalty = presence_penalty;
      if (typeof top_p === 'number') sfPayload.top_p = top_p;

      const targetUrl = 'https://api.siliconflow.cn/v1/chat/completions';
      const r = await requestUrl(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(sfPayload),
      });
      let json;
      try {
        json = JSON.parse(r.body || '{}');
      } catch {
        json = { raw: r.body };
      }
      return sendJson(res, r.statusCode || 200, json);
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    return sendJson(res, 500, { error: e.message || 'Internal error' });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Web proxy server listening on http://localhost:${PORT}`);
});



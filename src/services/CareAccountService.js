import { CLOUD_CONFIG } from '../config/cloud';
import { SecureStorage } from '../utils/secureStorage';
import { AuthService } from './AuthService';
import { DeviceService } from './DeviceService';

const STORAGE_KEY = '@care_linked_accounts';
const STORAGE_VERSION_CURRENT = 2;
const STORAGE_VERSION_LEGACY = 1;

/** @typedef {{ userId: string, email: string, name: string, token: string, addedAt: string, remark?: string }} CareLinkedAccount */

let latestAlerts = [];
let pollTimer = null;

async function fetchCloud(path, { method = 'GET', token, body } = {}) {
  const url = `${CLOUD_CONFIG.BASE_URL}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    throw new Error(
      `无法连接云端：${CLOUD_CONFIG.BASE_URL}。请确认已运行 npm run cloud 且终端能访问该地址`
    );
  }
}

function unwrapJsonString(value) {
  if (typeof value !== 'string') return value;
  const t = String(value).trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return value;
  try {
    const p = JSON.parse(t);
    return p;
  } catch {
    return value;
  }
}

function sanitizeRemark(remark) {
  const text = String(remark || '').trim();
  if (!text) return '';
  return text.slice(0, 32);
}

function pickHealthDataBlob(snapshotDataLayer) {
  const d = snapshotDataLayer || {};
  let raw =
    d['@health_data'] ??
    d.health_data ??
    d.healthData ??
    null;
  raw = unwrapJsonString(raw);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  return {};
}

function newMedicineLocalId() {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  const c = typeof g.crypto !== 'undefined' ? g.crypto : null;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `med_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const SNAP_FLAT_MERGE_KEYS = [
  '@medicines',
  '@health_data',
  '@devices',
  '@medicine_reminders',
  '@medicine_intake_logs',
  '@tongue_analysis_history',
];

/** 服务端 snapshot_json 通常为 { profile, data }；历史或异常数据中 @ 前缀键可能在 snapshot 顶层，需并入 data */
function extractSnapshotDataLayer(snapRoot) {
  const nested =
    snapRoot && typeof snapRoot === 'object' && snapRoot.data && typeof snapRoot.data === 'object'
      ? { ...snapRoot.data }
      : {};
  if (!snapRoot || typeof snapRoot !== 'object' || Array.isArray(snapRoot)) return nested;
  SNAP_FLAT_MERGE_KEYS.forEach((k) => {
    if (!(k in snapRoot)) return;
    const vTop = snapRoot[k];
    if (vTop === undefined || vTop === null) return;
    if (nested[k] === undefined || nested[k] === null) nested[k] = vTop;
  });
  Object.keys(snapRoot).forEach((k) => {
    if (!k.startsWith('@')) return;
    if (!(k in nested) || nested[k] == null) {
      nested[k] = snapRoot[k];
    }
  });
  return nested;
}

function normalizeSnapshotRoots(row) {
  const profileTop = row?.profile && typeof row.profile === 'object' ? row.profile : null;
  let snapRoot = row?.snapshot;

  /** GET /data 偶发或非标准载荷：快照字段铺在根上 */
  if (!snapRoot || typeof snapRoot !== 'object' || Array.isArray(snapRoot)) {
    const flatOnly = {};
    let any = false;
    if (row && typeof row === 'object') {
      SNAP_FLAT_MERGE_KEYS.forEach((k) => {
        if (!Object.prototype.hasOwnProperty.call(row, k)) return;
        flatOnly[k] = row[k];
        any = true;
      });
    }
    snapRoot = any ? flatOnly : {};
  }

  let profile =
    snapRoot && typeof snapRoot === 'object' && snapRoot.profile && typeof snapRoot.profile === 'object'
      ? snapRoot.profile
      : profileTop;

  let data = extractSnapshotDataLayer(snapRoot);

  return {
    snapshotRoot: { profile: profile || profileTop || null, data },
    revision: Number(row?.revision) || 1,
  };
}

/** @returns {CareLinkedAccount[]} */
function filterValidAccounts(arr) {
  return (Array.isArray(arr) ? arr : []).filter(
    (a) => a && typeof a.email === 'string' && typeof a.token === 'string' && typeof a.userId === 'string'
  );
}

function deriveAlertsFromData(account /** CareLinkedAccount */, data /** object */) {
  const meds = Array.isArray(data?.['@medicines']) ? data['@medicines'] : [];
  const medMap = new Map(meds.map((m) => [m?.id, m?.name]));

  const alerts = [];
  const label = account.remark || account.name || account.email;
  const now = Date.now();
  const missCutoff = now - 72 * 3600000;

  const logs = Array.isArray(data?.['@medicine_intake_logs']) ? data['@medicine_intake_logs'] : [];
  logs.forEach((log) => {
    if ((log.action || '').toLowerCase() !== 'missed') return;
    const t = log.at ? new Date(log.at).getTime() : NaN;
    if (!Number.isFinite(t) || t < missCutoff) return;
    const medName =
      log.medicineName || medMap.get(log.medicineId) || log.medicineId || '药品';
    const sched = log.scheduledAt ? new Date(log.scheduledAt).toLocaleString('zh-CN') : '';
    alerts.push({
      id: `${account.userId}-miss-${log.medicineId}-${log.scheduledAt || log.at}`,
      careUserId: account.userId,
      careName: label,
      type: 'medicine_miss',
      message: `「${label}」漏服记录：${medName}${sched ? `（计划 ${sched}）` : ''}`,
      at: log.at || log.scheduledAt || new Date().toISOString(),
      severity: 'warning',
    });
  });

  const health = DeviceService.normalizeHealthDataFromSnapshot(pickHealthDataBlob(data));
  const hrCutoff = now - 48 * 3600000;
  const hrList = Array.isArray(health.heartRate) ? health.heartRate : [];
  hrList.forEach((item) => {
    const t = item?.date ? new Date(item.date).getTime() : NaN;
    const v = Number(item?.value);
    if (!Number.isFinite(t) || t < hrCutoff || !Number.isFinite(v)) return;
    if (v >= 105) {
      alerts.push({
        id: `${account.userId}-hr-hi-${t}-${v}`,
        careUserId: account.userId,
        careName: label,
        type: 'heart_rate_high',
        message: `「${label}」心率偏高：${Math.round(v)} bpm（${new Date(item.date).toLocaleString('zh-CN')}）`,
        at: item.date,
        severity: 'warning',
      });
    } else if (v <= 52) {
      alerts.push({
        id: `${account.userId}-hr-lo-${t}-${v}`,
        careUserId: account.userId,
        careName: label,
        type: 'heart_rate_low',
        message: `「${label}」心率偏低：${Math.round(v)} bpm（${new Date(item.date).toLocaleString('zh-CN')}）`,
        at: item.date,
        severity: 'warning',
      });
    }
  });

  const bgList = Array.isArray(health.bloodGlucose) ? health.bloodGlucose : [];
  bgList.forEach((item) => {
    const t = item?.date ? new Date(item.date).getTime() : NaN;
    const v = Number(item?.value);
    if (!Number.isFinite(t) || t < hrCutoff || !Number.isFinite(v)) return;
    if (v >= 8.0) {
      alerts.push({
        id: `${account.userId}-bg-hi-${t}-${v}`,
        careUserId: account.userId,
        careName: label,
        type: 'blood_glucose_high',
        message: `「${label}」血糖偏高：${v.toFixed(1)} mmol/L（${new Date(item.date).toLocaleString('zh-CN')}）`,
        at: item.date,
        severity: 'warning',
      });
    } else if (v <= 3.9) {
      alerts.push({
        id: `${account.userId}-bg-lo-${t}-${v}`,
        careUserId: account.userId,
        careName: label,
        type: 'blood_glucose_low',
        message: `「${label}」血糖偏低：${v.toFixed(1)} mmol/L（${new Date(item.date).toLocaleString('zh-CN')}）`,
        at: item.date,
        severity: 'danger',
      });
    }
  });

  alerts.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const seen = new Set();
  return alerts.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}

function parseHHMM(text) {
  const m = String(text || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return null;
  }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function toISODate(dateLike) {
  const d = new Date(dateLike);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function addDays(dateLike, days) {
  const d = new Date(dateLike);
  d.setDate(d.getDate() + days);
  return d;
}

function makeDateAt(isoDate, hhmm) {
  const [y, m, d] = String(isoDate).split('-').map((x) => Number(x));
  const parsed = parseHHMM(hhmm) || '08:00';
  const [hh, mm] = parsed.split(':').map((x) => Number(x));
  const out = new Date();
  out.setFullYear(y, (m || 1) - 1, d || 1);
  out.setHours(hh, mm, 0, 0);
  return out;
}

function buildTimesFromConfig(reminderConfig = {}) {
  const mode = String(reminderConfig.mode || 'fixed_times');
  if (mode === 'prn') return [];
  if (mode === 'fixed_times') {
    const times = Array.isArray(reminderConfig.times) ? reminderConfig.times : [];
    return [...new Set(times.map(parseHHMM).filter(Boolean))].sort();
  }
  if (mode === 'times_per_day') {
    const n = Math.max(1, Math.min(12, Number(reminderConfig.timesPerDay || 2)));
    if (n === 1) return ['08:00'];
    const start = 8 * 60;
    const end = 20 * 60;
    const span = end - start;
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const t = start + Math.round((span * i) / (n - 1));
      const hh = String(Math.floor(t / 60)).padStart(2, '0');
      const mm = String(t % 60).padStart(2, '0');
      out.push(`${hh}:${mm}`);
    }
    return out;
  }
  if (mode === 'interval_hours') {
    const ih = Math.max(1, Math.min(24, Number(reminderConfig.intervalHours || 8)));
    const start = parseHHMM(reminderConfig.intervalStartTime) || '08:00';
    const [sh, sm] = start.split(':').map((x) => Number(x));
    const startMinutes = sh * 60 + sm;
    const out = [];
    for (let minute = startMinutes; minute < 24 * 60; minute += ih * 60) {
      const hh = String(Math.floor(minute / 60)).padStart(2, '0');
      const mm = String(minute % 60).padStart(2, '0');
      out.push(`${hh}:${mm}`);
    }
    return out;
  }
  return [];
}

function buildCareReminderRowsForMedicine(medicine) {
  const cfg = medicine?.reminderConfig || {};
  if (cfg.enabled === false || cfg.paused === true) return [];
  const mode = String(cfg.mode || 'fixed_times');
  if (mode === 'prn') return [];
  const times = buildTimesFromConfig(cfg);
  if (!times.length) return [];

  const now = new Date();
  const today = toISODate(now);
  const startDate = String(cfg.startDate || today);
  const horizonEnd = toISODate(addDays(today, 30));
  const endDate = cfg.endDate && String(cfg.endDate) < horizonEnd ? String(cfg.endDate) : horizonEnd;
  const effectiveStart = startDate > today ? startDate : today;
  const medicineId = medicine?.id || 'unknown_medicine';
  const out = [];

  for (let day = 0; ; day += 1) {
    const curDate = toISODate(addDays(effectiveStart, day));
    if (curDate > endDate) break;
    times.forEach((t) => {
      const dt = makeDateAt(curDate, t);
      out.push({
        id: `${medicineId}_${dt.toISOString().replace(/[:.]/g, '-')}`,
        medicineId,
        scheduledAt: dt.toISOString(),
        notificationId: null,
        status: 'scheduled',
        createdAt: new Date().toISOString(),
        snoozeCount: 0,
        mode,
        mealTag: cfg.mealTag || 'none',
        doseAmount: cfg.doseAmount ?? null,
        doseUnit: cfg.doseUnit ?? '',
      });
    });
  }
  return out;
}

function buildCareReminderSummary(reminderConfig = {}) {
  if (reminderConfig.enabled === false) return '未启用提醒';
  if (reminderConfig.paused === true) return '提醒已暂停';
  const mode = String(reminderConfig.mode || 'fixed_times');
  if (mode === 'prn') return '按需用药（无定时提醒）';
  const times = buildTimesFromConfig(reminderConfig);
  if (!times.length) return '未设置提醒时间';
  if (mode === 'times_per_day') return `每日 ${Number(reminderConfig.timesPerDay || 2)} 次（${times.join('、')}）`;
  if (mode === 'interval_hours') return `每隔 ${Number(reminderConfig.intervalHours || 8)} 小时（起始 ${parseHHMM(reminderConfig.intervalStartTime) || '08:00'}）`;
  return `定点提醒：${times.join('、')}`;
}

function normalizeMedicineName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）\[\]【】\-—_·,，。./\\]/g, '');
}

function findMedicineDupIndices(medicines, incomingMedicineName) {
  const target = normalizeMedicineName(incomingMedicineName);
  if (!target) return [];
  return (Array.isArray(medicines) ? medicines : [])
    .map((m, idx) => ({ m, idx }))
    .filter(({ m }) => normalizeMedicineName(m?.name) === target)
    .map(({ idx }) => idx);
}

export class CareAccountService {
  static getLatestAlerts() {
    return latestAlerts.slice();
  }

  static async _readPayloadFromStorage() {
    const raw = await SecureStorage.getItem(STORAGE_KEY);
    if (!raw || typeof raw !== 'object') return null;
    const accounts = filterValidAccounts(raw.accounts);
    if (raw.version === STORAGE_VERSION_CURRENT && typeof raw.ownerUserId === 'string' && raw.ownerUserId) {
      return { ownerUserId: raw.ownerUserId, accounts, legacy: false };
    }
    if (raw.version === STORAGE_VERSION_LEGACY && Array.isArray(raw.accounts)) {
      return { ownerUserId: null, accounts, legacy: true };
    }
    return null;
  }

  static async listCareAccounts() {
    const profile = await AuthService.getProfile();
    const ownerKey = profile?.id || profile?.email;
    if (!ownerKey) return [];

    const payload = await this._readPayloadFromStorage();
    if (!payload) return [];

    if (payload.legacy) {
      await SecureStorage.setItem(STORAGE_KEY, {
        version: STORAGE_VERSION_CURRENT,
        ownerUserId: ownerKey,
        accounts: payload.accounts,
      });
      return payload.accounts.map((a) => ({ ...a, remark: sanitizeRemark(a?.remark) || '' }));
    }

    if (payload.ownerUserId !== ownerKey) {
      return [];
    }

    return payload.accounts.map((a) => ({ ...a, remark: sanitizeRemark(a?.remark) || '' }));
  }

  /**
   * 按 userId 从本机关怀存储取令牌（不因当前登录与 ownerUserId 不一致而失败）。
   * Web 同浏览器双开/切换账号时 listCareAccounts 常为 []，但关怀令牌仍存在，此处保证报告可拉快照。
   * @returns {CareLinkedAccount | null}
   */
  static async resolveCareLinkedAccountByUserId(userId) {
    if (!userId || typeof userId !== 'string') return null;
    const payload = await this._readPayloadFromStorage();
    if (!payload?.accounts?.length) return null;
    return payload.accounts.find((a) => a.userId === userId) || null;
  }

  static async saveCareAccounts(accounts) {
    const profile = await AuthService.getProfile();
    const ownerKey = profile?.id || profile?.email;
    if (!ownerKey) {
      throw new Error('未登录，无法保存关怀账号');
    }
    await SecureStorage.setItem(STORAGE_KEY, {
      version: STORAGE_VERSION_CURRENT,
      ownerUserId: ownerKey,
      accounts: Array.isArray(accounts) ? accounts : [],
    });
  }

  /** 注销本机账号或手动清空时移除关怀绑定与缓存 */
  static async clearAllLinked() {
    await SecureStorage.removeItem(STORAGE_KEY, { silent: true });
    latestAlerts = [];
    this.stopPolling();
  }

  static async removeCareAccount(userId) {
    const list = await this.listCareAccounts();
    await this.saveCareAccounts(list.filter((a) => a.userId !== userId));
    await this.refreshCareAlerts();
  }

  static async setCareAccountRemark(userId, remark) {
    if (!userId) throw new Error('关怀账号无效');
    const text = sanitizeRemark(remark);
    const list = await this.listCareAccounts();
    if (!list.length) throw new Error('暂无关怀账号');
    let hit = false;
    const next = list.map((a) => {
      if (a.userId !== userId) return a;
      hit = true;
      return { ...a, remark: text };
    });
    if (!hit) throw new Error('未找到该关怀账号');
    await this.saveCareAccounts(next);
    await this.refreshCareAlerts();
    return true;
  }

  /**
   * 使用对方账号邮箱+密码登录云端，仅保存 Token（不长期保存密码）。
   * @returns {CareLinkedAccount}
   */
  static async addCareAccountWithLogin({ email, password }) {
    const me = await AuthService.getProfile();
    const emailNorm = String(email || '').trim().toLowerCase();
    if (!emailNorm || !password) throw new Error('请填写邮箱和密码');
    if (me?.email && emailNorm === String(me.email).trim().toLowerCase()) {
      throw new Error('不能将自己添加为关怀账号');
    }

    const { ok, status, data } = await fetchCloud('/auth/login', {
      method: 'POST',
      body: { email: emailNorm, password },
    });
    if (!ok || !data?.token || !data?.profile) {
      const msg = data?.error || (status === 401 ? '邮箱或密码错误' : `登录失败（${status}）`);
      throw new Error(msg);
    }

    const profile = data.profile;
    const entry = {
      userId: profile.id,
      email: profile.email,
      name: profile.name || profile.email,
      token: data.token,
      addedAt: new Date().toISOString(),
    };

    const existing = await this.listCareAccounts();
    if (existing.some((a) => a.userId === entry.userId)) {
      const merged = existing.map((a) =>
        a.userId === entry.userId ? { ...entry, remark: sanitizeRemark(a?.remark) || '' } : a
      );
      await this.saveCareAccounts(merged);
    } else {
      await this.saveCareAccounts([...existing, entry]);
    }
    await this.refreshCareAlerts();
    return entry;
  }

  static async fetchStoredUserData(token) {
    const { ok, status, data } = await fetchCloud('/data', { method: 'GET', token });
    if (status === 401) return { __unauthorized: true };
    if (!ok || !data) return null;
    return data;
  }

  static async refreshCareAlerts() {
    const accounts = await this.listCareAccounts();
    if (!accounts.length) {
      latestAlerts = [];
      return latestAlerts;
    }
    const out = [];
    const nextAccounts = [];
    for (const acc of accounts) {
      try {
        const row = await this.fetchStoredUserData(acc.token);
        if (row && row.__unauthorized) {
          continue;
        }
        if (!row) {
          nextAccounts.push(acc);
          continue;
        }
        const { snapshotRoot } = normalizeSnapshotRoots(row);
        out.push(...deriveAlertsFromData(acc, snapshotRoot.data || {}));
        nextAccounts.push(acc);
      } catch {
        nextAccounts.push(acc);
      }
    }
    await this.saveCareAccounts(nextAccounts);
    latestAlerts = out.slice(0, 80);
    return latestAlerts;
  }

  static startPolling(intervalMs = 90000) {
    this.stopPolling();
    this.refreshCareAlerts().catch(() => {});
    pollTimer = setInterval(() => {
      this.refreshCareAlerts().catch(() => {});
    }, intervalMs);
  }

  static stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  static async inspectCareMedicineConflict(careAccount, medicine) {
    const token = careAccount?.token;
    if (!token) throw new Error('关怀账号令牌无效');
    const row = await this.fetchStoredUserData(token);
    if (row && row.__unauthorized) throw new Error('关怀账号登录已失效，请在账号中移除后重新添加');
    if (!row) throw new Error('无法读取关怀账号云端数据（请确认网络与对方已同步）');
    const { snapshotRoot } = normalizeSnapshotRoots(row);
    const data = snapshotRoot.data || {};
    const medicines = Array.isArray(data['@medicines']) ? data['@medicines'] : [];
    const dupIndices = findMedicineDupIndices(medicines, medicine?.name);
    if (!dupIndices.length) return { exists: false };
    const first = medicines[dupIndices[0]] || {};
    return {
      exists: true,
      medicineId: first.id || null,
      medicineName: first.name || medicine?.name || '该药品',
      duplicateCount: dupIndices.length,
    };
  }

  /**
   * 将当前药品模板（不含本地图片 URI）写入对方云端快照，便于对方同步后生成提醒日程。
   * @param {CareLinkedAccount} careAccount
   * @param {object} medicine
   * @param {string} [caregiverEmail]
   * @param {{ reminderConfig?: object, overwriteExisting?: boolean }} [options]
   */
  static async mergeMedicineTemplateIntoCareCloud(careAccount, medicine, caregiverEmail = '', options = {}) {
    const token = careAccount?.token;
    if (!token) throw new Error('关怀账号令牌无效');

    const row = await this.fetchStoredUserData(token);
    if (row && row.__unauthorized) throw new Error('关怀账号登录已失效，请在账号中移除后重新添加');
    if (!row) throw new Error('无法读取关怀账号云端数据（请确认网络与对方已同步）');

    let { snapshotRoot, revision } = normalizeSnapshotRoots(row);
    const data = snapshotRoot.data || {};
    const medicines = Array.isArray(data['@medicines']) ? [...data['@medicines']] : [];
    const dupIndices = findMedicineDupIndices(medicines, medicine?.name);
    const hasDuplicate = dupIndices.length > 0;
    if (hasDuplicate && !options?.overwriteExisting) {
      const first = medicines[dupIndices[0]] || {};
      const err = new Error(`已对该药品下发过提醒：${first.name || medicine?.name || '该药品'}。请确认是否覆盖之前的提醒。`);
      err.code = 'CARE_MEDICINE_DUPLICATE';
      err.conflict = {
        medicineId: first.id || null,
        medicineName: first.name || medicine?.name || '该药品',
        duplicateCount: dupIndices.length,
      };
      throw err;
    }

    const newId = hasDuplicate ? (medicines[dupIndices[0]]?.id || newMedicineLocalId()) : newMedicineLocalId();
    const cloned = typeof medicine === 'object' && medicine ? { ...medicine } : {};
    delete cloned.image;
    delete cloned.images;
    cloned.id = newId;
    cloned.createdAt = new Date().toISOString();
    cloned.careTemplateFrom = String(caregiverEmail || '').trim() || 'caregiver';
    cloned.careTemplateAt = new Date().toISOString();
    if (options?.reminderConfig && typeof options.reminderConfig === 'object') {
      cloned.reminderConfig = { ...options.reminderConfig };
    }

    const remindersMap = { ...(data['@medicine_reminders'] && typeof data['@medicine_reminders'] === 'object' ? data['@medicine_reminders'] : {}) };
    // 下发时直接写入未来提醒行，保证对方同步后在药品页和 AI 助手都能马上拿到提醒上下文。
    remindersMap[newId] = buildCareReminderRowsForMedicine(cloned);
    // 若历史重复药品存在，清理重复条目的提醒行
    if (dupIndices.length > 1) {
      dupIndices.slice(1).forEach((idx) => {
        const mid = medicines[idx]?.id;
        if (mid && remindersMap[mid]) delete remindersMap[mid];
      });
    }

    let nextMedicines;
    if (hasDuplicate) {
      const primaryIdx = dupIndices[0];
      const base = medicines[primaryIdx] || {};
      const merged = {
        ...base,
        ...cloned,
        id: newId,
        createdAt: base.createdAt || cloned.createdAt,
        updatedAt: new Date().toISOString(),
      };
      nextMedicines = medicines
        .filter((_, idx) => !dupIndices.slice(1).includes(idx))
        .map((m, idx) => (idx === primaryIdx ? merged : m));
    } else {
      nextMedicines = [...medicines, cloned];
    }

    const nextData = {
      ...data,
      '@medicines': nextMedicines,
      '@medicine_reminders': remindersMap,
    };

    const nextSnapshot = {
      profile: snapshotRoot.profile || row.profile || null,
      data: nextData,
    };

    let put = await fetchCloud('/data', {
      method: 'PUT',
      token,
      body: { snapshot: nextSnapshot, baseRevision: revision },
    });

    if (!put.ok && put.status === 409 && put.data?.server) {
      const serverRow = put.data.server;
      const norm = normalizeSnapshotRoots(serverRow);
      const sData = { ...(norm.snapshotRoot.data || {}) };
      const sMedsRaw = Array.isArray(sData['@medicines']) ? [...sData['@medicines']] : [];
      const sDup = findMedicineDupIndices(sMedsRaw, medicine?.name);
      let sMeds = sMedsRaw;
      if (sDup.length > 0) {
        const base = sMedsRaw[sDup[0]] || {};
        const merged = {
          ...base,
          ...cloned,
          id: base.id || newId,
          createdAt: base.createdAt || cloned.createdAt,
          updatedAt: new Date().toISOString(),
        };
        sMeds = sMedsRaw
          .filter((_, idx) => !sDup.slice(1).includes(idx))
          .map((m, idx) => (idx === sDup[0] ? merged : m));
      } else {
        sMeds = [...sMedsRaw, cloned];
      }
      const sRem = {
        ...(sData['@medicine_reminders'] && typeof sData['@medicine_reminders'] === 'object'
          ? sData['@medicine_reminders']
          : {}),
      };
      const targetId = sDup.length > 0 ? (sMedsRaw[sDup[0]]?.id || newId) : newId;
      sRem[targetId] = buildCareReminderRowsForMedicine({ ...cloned, id: targetId });
      if (sDup.length > 1) {
        sDup.slice(1).forEach((idx) => {
          const mid = sMedsRaw[idx]?.id;
          if (mid && sRem[mid]) delete sRem[mid];
        });
      }
      const mergedSnapshot = {
        profile: norm.snapshotRoot.profile || serverRow.profile,
        data: { ...sData, '@medicines': sMeds, '@medicine_reminders': sRem },
      };
      put = await fetchCloud('/data', {
        method: 'PUT',
        token,
        body: { snapshot: mergedSnapshot, baseRevision: norm.revision },
      });
    }

    if (!put.ok) {
      throw new Error(put.data?.message || put.data?.error || '写入关怀账号云端失败');
    }

    await this.refreshCareAlerts();
    return {
      success: true,
      action: hasDuplicate ? 'updated' : 'created',
      medicineId: newId,
      medicineName: cloned.name || medicine?.name || '',
    };
  }

  /**
   * 拉取关怀账号云端快照并解析为报告所需字段（心率/血糖/睡眠、用药列表、舌诊历史、profile）。
   * @param {CareLinkedAccount} account
   * @returns {Promise<{ healthData: object, medicines: any[], tongueRows: any[], profile: object, snapshotData: object } | null>}
   */
  static async fetchCareRecipientDataset(account) {
    const tok = account?.token;
    if (!tok) return null;
    const row = await this.fetchStoredUserData(tok);
    if (!row || row.__unauthorized) return null;
    const { snapshotRoot } = normalizeSnapshotRoots(row);
    const data = snapshotRoot.data || {};
    const hd = DeviceService.normalizeHealthDataFromSnapshot(pickHealthDataBlob(data));
    const medicines = Array.isArray(data['@medicines']) ? data['@medicines'] : [];
    const tongueRows = Array.isArray(data['@tongue_analysis_history'])
      ? data['@tongue_analysis_history']
      : [];
    const profile =
      (snapshotRoot.profile && typeof snapshotRoot.profile === 'object' ? snapshotRoot.profile : null) ||
      (row.profile && typeof row.profile === 'object' ? row.profile : null) ||
      { name: account.name, email: account.email };
    return {
      healthData: hd,
      medicines,
      tongueRows,
      profile,
      snapshotData: data,
    };
  }

  /** 基于快照推导关怀动态（漏服、心率/血糖异常等） */
  static async fetchDerivedAlertsForAccount(account) {
    const ds = await this.fetchCareRecipientDataset(account);
    if (!ds) return [];
    return deriveAlertsFromData(account, ds.snapshotData);
  }

  /** 读取我对该关怀对象下发过的关怀用药记录（含提醒摘要）。 */
  static async fetchCareRecordsForAccount(account) {
    const ds = await this.fetchCareRecipientDataset(account);
    if (!ds) return [];
    const meds = Array.isArray(ds.snapshotData?.['@medicines']) ? ds.snapshotData['@medicines'] : [];
    return meds
      .filter((m) => m && typeof m === 'object' && m.careTemplateFrom)
      .map((m) => ({
        id: `${account.userId}_${m.id}`,
        medicineName: m.name || '未命名药品',
        dosage: m.dosage || '',
        frequency: m.frequency || '',
        reminderSummary: buildCareReminderSummary(m.reminderConfig || {}),
        careTemplateAt: m.careTemplateAt || m.createdAt || null,
        careTemplateFrom: m.careTemplateFrom || '',
      }))
      .sort((a, b) => new Date(b.careTemplateAt || 0).getTime() - new Date(a.careTemplateAt || 0).getTime());
  }
}

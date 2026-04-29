import * as XLSX from 'xlsx';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { DeviceService } from './DeviceService';
import { ExportService } from './ExportService';

const MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const PICK_TYPES = [
  MIME_XLSX,
  'application/vnd.ms-excel',
  'application/*',
];

/** @param {string} s */
function normHeader(s) {
  if (s == null) return '';
  return String(s).replace(/\s/g, '').toLowerCase();
}

/** @param {unknown} val */
function toTrimmedString(val) {
  if (val == null || val === '') return '';
  if (val instanceof Date) return val.toISOString();
  return String(val).trim();
}

/**
 * @param {unknown} val
 * @returns {Date | null}
 */
function parseExcelDate(val) {
  if (val instanceof Date && !isNaN(val.getTime())) return val;
  if (typeof val === 'number') {
    if (val > 25569 && val < 100000) {
      const utc = Math.round((val - 25569) * 86400 * 1000);
      const d = new Date(utc);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }
  const s = toTrimmedString(val);
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  return null;
}

/**
 * @param {Date} d
 * @param {unknown} timeVal
 */
function applyTimeColumn(d, timeVal) {
  const base = new Date(d);
  base.setMilliseconds(0);
  if (timeVal == null || timeVal === '') return base;

  if (timeVal instanceof Date) {
    base.setHours(
      timeVal.getHours(),
      timeVal.getMinutes(),
      timeVal.getSeconds(),
      0
    );
    return base;
  }

  if (typeof timeVal === 'number' && timeVal >= 0 && timeVal < 1) {
    const ms = Math.round(timeVal * 86400000);
    const midnight = new Date(base);
    midnight.setHours(0, 0, 0, 0);
    return new Date(midnight.getTime() + ms);
  }

  const s = toTrimmedString(timeVal);
  if (!s) return base;

  const m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) {
    base.setHours(
      Number(m[1]) || 0,
      Number(m[2]) || 0,
      Number(m[3]) || 0,
      0
    );
    return base;
  }

  const t = parseExcelDate(timeVal);
  if (t) {
    base.setHours(t.getHours(), t.getMinutes(), t.getSeconds(), 0);
    return base;
  }

  return base;
}

/** @param {unknown} val */
function parseGlucoseValue(val) {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const s = toTrimmedString(val).replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

/** @param {unknown} val */
function parseHours(val) {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const s = toTrimmedString(val).replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * @param {string[]} headerRow
 * @param {string[][]} aliases
 * @returns {number} -1 if missing
 */
function findCol(headerRow, aliases) {
  const normalized = headerRow.map((h) => normHeader(h));
  for (const group of aliases) {
    for (let i = 0; i < normalized.length; i++) {
      for (const a of group) {
        if (normalized[i] === normHeader(a)) return i;
        if (normHeader(a) && normalized[i].includes(normHeader(a))) return i;
      }
    }
  }
  return -1;
}

/**
 * @param {XLSX.WorkBook} wb
 * @param {'glucose' | 'sleep'} kind
 */
function pickSheetName(wb, kind) {
  const names = wb.SheetNames || [];
  if (kind === 'glucose') {
    const hit = names.find((n) => /血糖/.test(n));
    return hit || names[0];
  }
  const hit = names.find((n) => /睡眠/.test(n));
  return hit || names[0];
}

/**
 * @param {File} file
 */
async function workbookFromFile(file) {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: 'array', cellDates: true });
}

/**
 * @param {string} uri
 * @param {{ file?: File } | undefined} asset
 */
async function workbookFromUri(uri, asset) {
  if (Platform.OS === 'web' && asset?.file) {
    return workbookFromFile(asset.file);
  }
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return XLSX.read(b64, { type: 'base64', cellDates: true });
}

/**
 * Web：用原生 file 选择器代替 DocumentPicker。
 * Expo 文档说明浏览器端「取消」可能不按约定 resolve，会导致 await 永不结束、界面按钮一直处于 loading/disabled。
 * @returns {Promise<File | null>}
 */
function pickExcelFileWeb() {
  if (typeof document === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (file) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onWindowFocus);
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
      resolve(file);
    };

    const input = document.createElement('input');
    input.type = 'file';
    input.accept =
      '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
    input.style.display = 'none';

    const onWindowFocus = () => {
      setTimeout(() => {
        if (settled) return;
        if (!input.files || input.files.length === 0) {
          finish(null);
        }
      }, 800);
    };

    input.addEventListener('change', () => {
      const f = input.files && input.files[0] ? input.files[0] : null;
      finish(f);
    });

    input.addEventListener('cancel', () => {
      finish(null);
    });

    window.addEventListener('focus', onWindowFocus);
    document.body.appendChild(input);
    input.value = '';
    input.click();
  });
}

/** @returns {Promise<XLSX.WorkBook | null>} */
export async function pickAndReadWorkbook() {
  if (Platform.OS === 'web') {
    const file = await pickExcelFileWeb();
    if (!file) return null;
    return workbookFromFile(file);
  }

  const result = await DocumentPicker.getDocumentAsync({
    type: PICK_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  return workbookFromUri(asset.uri, asset);
}

/**
 * @param {XLSX.WorkBook} wb
 * @param {'glucose' | 'sleep'} kind
 */
export function parseWorkbook(wb, kind) {
  const sheetName = pickSheetName(wb, kind);
  if (!sheetName) {
    return { ok: false, errors: ['工作簿中没有工作表'], rows: [] };
  }
  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    return { ok: false, errors: ['无法读取工作表'], rows: [] };
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rows.length) {
    return { ok: false, errors: ['表格为空'], rows: [] };
  }

  const headerRow = rows[0].map((c) => toTrimmedString(c));

  if (kind === 'glucose') {
    const cDate = findCol(headerRow, [['日期', '测量日期', 'date']]);
    const cTime = findCol(headerRow, [['时间', 'time']]);
    const cVal = findCol(headerRow, [
      ['血糖值(mmol/l)', '血糖值', '血糖', 'mmol/l', 'glucose'],
    ]);

    if (cDate < 0 || cVal < 0) {
      return {
        ok: false,
        errors: ['表头需包含「日期」与「血糖值」列（可参考下载的模板）'],
        rows: [],
      };
    }

    const out = [];
    const errors = [];
    for (let i = 1; i < rows.length; i++) {
      const line = i + 1;
      const r = rows[i];
      if (!Array.isArray(r) || !r.some((x) => toTrimmedString(x) !== '')) {
        continue;
      }
      const dRaw = r[cDate];
      const tRaw = cTime >= 0 ? r[cTime] : '';
      const vRaw = r[cVal];

      const d0 = parseExcelDate(dRaw);
      if (!d0) {
        errors.push(`第 ${line} 行：日期无效`);
        continue;
      }
      const when = applyTimeColumn(d0, tRaw);
      const value = parseGlucoseValue(vRaw);
      if (!Number.isFinite(value) || value <= 0) {
        errors.push(`第 ${line} 行：血糖值无效`);
        continue;
      }
      out.push({ date: when.toISOString(), value });
    }

    if (out.length === 0 && errors.length === 0) {
      errors.push('没有可导入的数据行');
    }
    return { ok: out.length > 0, errors, rows: out };
  }

  const cDate = findCol(headerRow, [['日期', '睡眠日期', 'date']]);
  const cTotal = findCol(headerRow, [
    ['总睡眠(小时)', '总睡眠', '总时长(小时)', '总时长', '睡眠时长'],
  ]);
  const cDeep = findCol(headerRow, [['深睡(小时)', '深睡']]);
  const cLight = findCol(headerRow, [['浅睡(小时)', '浅睡']]);
  const cRem = findCol(headerRow, [['rem(小时)', 'rem']]);
  const cAwake = findCol(headerRow, [['清醒(小时)', '清醒']]);

  if (cDate < 0 || cTotal < 0) {
    return {
      ok: false,
      errors: ['表头需包含「日期」与「总睡眠(小时)」列（可参考下载的模板）'],
      rows: [],
    };
  }

  const out = [];
  const errors = [];
  for (let i = 1; i < rows.length; i++) {
    const line = i + 1;
    const r = rows[i];
    if (!Array.isArray(r) || !r.some((x) => toTrimmedString(x) !== '')) {
      continue;
    }
    const dRaw = r[cDate];
    const d0 = parseExcelDate(dRaw);
    if (!d0) {
      errors.push(`第 ${line} 行：日期无效`);
      continue;
    }
    const day = new Date(d0);
    day.setHours(12, 0, 0, 0);

    const total = parseHours(r[cTotal]);
    if (!Number.isFinite(total) || total <= 0) {
      errors.push(`第 ${line} 行：总睡眠时长无效`);
      continue;
    }

    const deep = cDeep >= 0 ? parseHours(r[cDeep]) : NaN;
    const light = cLight >= 0 ? parseHours(r[cLight]) : NaN;
    const rem = cRem >= 0 ? parseHours(r[cRem]) : NaN;
    const awake = cAwake >= 0 ? parseHours(r[cAwake]) : NaN;

    const entry = {
      date: day.toISOString(),
      totalHours: Math.round(total * 10) / 10,
    };
    if (Number.isFinite(deep)) entry.deepHours = Math.round(deep * 10) / 10;
    if (Number.isFinite(light)) entry.lightHours = Math.round(light * 10) / 10;
    if (Number.isFinite(rem)) entry.remHours = Math.round(rem * 10) / 10;
    if (Number.isFinite(awake))
      entry.awakeHours = Math.round(awake * 10) / 10;

    out.push(entry);
  }

  if (out.length === 0 && errors.length === 0) {
    errors.push('没有可导入的数据行');
  }
  return { ok: out.length > 0, errors, rows: out };
}

function glucoseTemplateWorkbook() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['日期', '时间', '血糖值(mmol/L)', '备注'],
    ['2025-04-29', '08:30', 5.4, '示例：可删除本行后填写'],
    ['2025-04-29', '12:10', 6.1, ''],
  ]);
  ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 28 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '血糖');
  return wb;
}

function sleepTemplateWorkbook() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['日期', '总睡眠(小时)', '深睡(小时)', '浅睡(小时)', 'REM(小时)', '清醒(小时)'],
    [
      '2025-04-28',
      7.2,
      1.9,
      3.4,
      1.3,
      0.6,
    ],
    [
      '2025-04-29',
      6.8,
      '',
      '',
      '',
      '',
    ],
  ]);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '睡眠');
  return wb;
}

function workbookToBase64(wb) {
  return XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
}

export async function downloadGlucoseTemplate() {
  const wb = glucoseTemplateWorkbook();
  const b64 = workbookToBase64(wb);
  const name = `血糖导入模板_${new Date().toISOString().split('T')[0]}.xlsx`;
  return ExportService.shareBase64File(b64, name, MIME_XLSX);
}

export async function downloadSleepTemplate() {
  const wb = sleepTemplateWorkbook();
  const b64 = workbookToBase64(wb);
  const name = `睡眠导入模板_${new Date().toISOString().split('T')[0]}.xlsx`;
  return ExportService.shareBase64File(b64, name, MIME_XLSX);
}

/**
 * @param {'glucose' | 'sleep'} kind
 * @returns {Promise<{ success: boolean; message: string; imported?: number }>}
 */
export async function importFromWorkbook(kind) {
  const wb = await pickAndReadWorkbook();
  if (!wb) {
    return { success: false, message: '已取消选择文件' };
  }
  const parsed = parseWorkbook(wb, kind);
  if (!parsed.ok) {
    const msg =
      parsed.errors.length > 0
        ? parsed.errors.slice(0, 5).join('\n') +
          (parsed.errors.length > 5 ? '\n…' : '')
        : '没有有效数据';
    return { success: false, message: msg };
  }

  if (kind === 'glucose') {
    await DeviceService.updateHealthData({
      heartRate: [],
      bloodGlucose: parsed.rows,
      sleep: [],
    });
    return {
      success: true,
      message: `已导入 ${parsed.rows.length} 条血糖记录`,
      imported: parsed.rows.length,
    };
  }

  await DeviceService.updateHealthData({
    heartRate: [],
    bloodGlucose: [],
    sleep: parsed.rows,
  });
  return {
    success: true,
    message: `已导入 ${parsed.rows.length} 条睡眠记录`,
    imported: parsed.rows.length,
  };
}

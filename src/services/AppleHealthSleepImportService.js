import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { DeviceService } from './DeviceService';

const SLEEP_ANALYSIS_TYPE = 'HKCategoryTypeIdentifierSleepAnalysis';

const XML_PICK_TYPES = [
  'application/xml',
  'text/xml',
  'application/x-xml',
  '*/*',
];

/** InBed 不计入 totalHours，此处直接忽略 */
const IN_BED = 'HKCategoryValueSleepAnalysisInBed';

function pickXmlFileWeb() {
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
    input.accept = '.xml,application/xml,text/xml';
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
    input.addEventListener('cancel', () => finish(null));

    window.addEventListener('focus', onWindowFocus);
    document.body.appendChild(input);
    input.value = '';
    input.click();
  });
}

async function readExportXmlText() {
  if (Platform.OS === 'web') {
    const file = await pickXmlFileWeb();
    if (!file) return null;
    return file.text();
  }

  const result = await DocumentPicker.getDocumentAsync({
    type: XML_PICK_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  return FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

/**
 * 从含 HKCategoryTypeIdentifierSleepAnalysis 的首行提取属性（Apple 导出中属性在同一样本的首行）。
 */
function parseSleepAnalysisLine(line) {
  if (!line.includes(SLEEP_ANALYSIS_TYPE)) return null;
  const startM = line.match(/startDate="([^"]+)"/);
  const endM = line.match(/endDate="([^"]+)"/);
  const valM = line.match(/value="([^"]+)"/);
  if (!startM || !endM || !valM) return null;
  return {
    startDate: startM[1],
    endDate: endM[1],
    value: valM[1],
  };
}

function segmentHours(startStr, endStr) {
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return 0;
  }
  const ms = end.getTime() - start.getTime();
  if (ms <= 0) return 0;
  return ms / 3600000;
}

/** 以 endDate 所在本地日历日为键（主睡眠与同日午睡合并为一条） */
function dayKeyFromEndLocal(endStr) {
  const end = new Date(endStr);
  if (!Number.isFinite(end.getTime())) return null;
  const y = end.getFullYear();
  const m = String(end.getMonth() + 1).padStart(2, '0');
  const d = String(end.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function noonLocalFromDayKey(dayKey) {
  const [ys, ms, ds] = dayKey.split('-').map(Number);
  if (!ys || !ms || !ds) return null;
  const local = new Date(ys, ms - 1, ds, 12, 0, 0, 0);
  if (!Number.isFinite(local.getTime())) return null;
  return local;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * 从 Apple 导出 XML 文本解析睡眠分段并聚合成 DeviceService 的 sleep 行。
 * totalHours = 深睡+核心/浅睡+REM+未分类睡眠；不含 InBed、不含清醒。
 * 未分类睡眠时长并入 lightHours 展示；午睡与同日夜间睡眠合并。
 */
export function parseAppleHealthSleepXml(xml) {
  const errors = [];
  if (!xml || typeof xml !== 'string') {
    return { ok: false, rows: [], errors: ['文件为空'], segmentCount: 0 };
  }

  if (!xml.includes('<HealthData') && !xml.includes(SLEEP_ANALYSIS_TYPE)) {
    return {
      ok: false,
      rows: [],
      errors: ['未识别为 Apple 健康导出（缺少 HealthData 或睡眠分析记录）'],
      segmentCount: 0,
    };
  }

  const re = /^[^\r\n]*HKCategoryTypeIdentifierSleepAnalysis[^\r\n]*$/gm;
  const segments = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    const parsed = parseSleepAnalysisLine(m[0]);
    if (parsed) segments.push(parsed);
  }

  if (segments.length === 0) {
    return {
      ok: false,
      rows: [],
      errors: ['未找到 HKCategoryTypeIdentifierSleepAnalysis 记录'],
      segmentCount: 0,
    };
  }

  /** @type {Map<string, { deep: number, light: number, rem: number, unspecified: number, awake: number }>} */
  const byDay = new Map();

  for (const seg of segments) {
    const h = segmentHours(seg.startDate, seg.endDate);
    if (h <= 0) continue;

    const dayKey = dayKeyFromEndLocal(seg.endDate);
    if (!dayKey) {
      errors.push(`无效 endDate: ${seg.endDate}`);
      continue;
    }

    let bucket = byDay.get(dayKey);
    if (!bucket) {
      bucket = { deep: 0, light: 0, rem: 0, unspecified: 0, awake: 0 };
      byDay.set(dayKey, bucket);
    }

    const v = seg.value;
    if (v === IN_BED) {
      continue;
    }
    if (v === 'HKCategoryValueSleepAnalysisAsleepDeep') {
      bucket.deep += h;
    } else if (v === 'HKCategoryValueSleepAnalysisAsleepREM') {
      bucket.rem += h;
    } else if (v === 'HKCategoryValueSleepAnalysisAsleepCore') {
      bucket.light += h;
    } else if (
      v === 'HKCategoryValueSleepAnalysisAsleepUnspecified' ||
      v === 'HKCategoryValueSleepAnalysisAsleep'
    ) {
      bucket.unspecified += h;
    } else if (v === 'HKCategoryValueSleepAnalysisAwake') {
      bucket.awake += h;
    } else {
      errors.push(`未知睡眠 value（已跳过）: ${v}`);
    }
  }

  const rows = [];
  for (const [dayKey, b] of byDay) {
    const totalAsleep = b.deep + b.light + b.rem + b.unspecified;
    if (totalAsleep <= 0) {
      continue;
    }

    const noon = noonLocalFromDayKey(dayKey);
    if (!noon) continue;

    const lightCombined = b.light + b.unspecified;
    rows.push({
      date: noon.toISOString(),
      totalHours: round1(totalAsleep),
      deepHours: round1(b.deep),
      lightHours: round1(lightCombined),
      remHours: round1(b.rem),
      awakeHours: round1(b.awake),
    });
  }

  rows.sort((a, b) => new Date(a.date) - new Date(b.date));

  return {
    ok: rows.length > 0,
    rows,
    errors,
    segmentCount: segments.length,
  };
}

/**
 * @returns {Promise<{ success: boolean; message: string; imported?: number }>}
 */
export async function importAppleHealthSleepFromExportXml() {
  const text = await readExportXmlText();
  if (text == null) {
    return { success: false, message: '已取消选择文件' };
  }

  const parsed = parseAppleHealthSleepXml(text);
  if (!parsed.ok) {
    const hint =
      parsed.errors.length > 0
        ? parsed.errors.slice(0, 3).join('；')
        : '没有可导入的睡眠数据';
    return {
      success: false,
      message:
        `${hint}\n` +
        '说明：totalHours 仅统计睡着时段（深睡/核心/REM/未分类），不含在床(InBed)。若导出仅有 InBed，则无法生成睡眠总时长。',
    };
  }

  await DeviceService.updateHealthData({
    heartRate: [],
    bloodGlucose: [],
    sleep: parsed.rows,
  });

  let msg = `已从 Apple 健康导出导入 ${parsed.rows.length} 天的合并睡眠（按结束日合并含午睡），共解析 ${parsed.segmentCount} 条睡眠分段。`;
  if (parsed.errors.length > 0) {
    msg += `\n警告（${Math.min(parsed.errors.length, 5)} 条）：${parsed.errors
      .slice(0, 5)
      .join('；')}`;
  }
  return { success: true, message: msg, imported: parsed.rows.length };
}

/**
 * 将心率/血糖/睡眠原始点汇总为短文，供 AI 解读。
 * 避免把大量 JSON.stringify(含 ISO 长串)塞进提示词 —— 易导致小模型复述乱码日期。
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

/** @param {Date} d */
function formatCnDateTime(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '时间无效';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** @param {Date} d */
function formatCnDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * @param {{ date?: string, value?: number }[]} entries
 * @param {string} valueLabel e.g. '次/分钟' or 'mmol/L'
 */
function summarizeNumericSeries(entries, valueLabel, name) {
  const items = (Array.isArray(entries) ? entries : [])
    .map((e) => {
      const v = Number(e?.value);
      const t = e?.date ? new Date(e.date) : null;
      if (!Number.isFinite(v) || !t || Number.isNaN(t.getTime())) return null;
      return { v, t, hour: t.getHours() };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);

  if (items.length === 0) {
    return `【${name}】暂无有效记录。\n`;
  }

  const values = items.map((x) => x.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = mean(values);
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  const first = items[0].t;
  const last = items[items.length - 1].t;
  const dayVals = items.filter((x) => x.hour >= 6 && x.hour < 22).map((x) => x.v);
  const nightVals = items.filter((x) => x.hour < 6 || x.hour >= 22).map((x) => x.v);

  let block = '';
  block += `【${name}】\n`;
  block += `- 有效记录条数：${items.length}\n`;
  block += `- 时间范围：${formatCnDateTime(first)} 至 ${formatCnDateTime(last)}\n`;
  block += `- 数值范围：最小 ${min} ${valueLabel}，最大 ${max} ${valueLabel}\n`;
  block += `- 平均值约 ${avg.toFixed(1)} ${valueLabel}，中位数约 ${median.toFixed(1)} ${valueLabel}\n`;

  if (dayVals.length >= 3 && nightVals.length >= 3) {
    block += `- 白昼时段(大致 06:00–22:00)平均约 ${mean(dayVals).toFixed(1)} ${valueLabel}；夜间时段平均约 ${mean(nightVals).toFixed(1)} ${valueLabel}\n`;
  }

  const recent = items.slice(-8);
  block += `- 最近若干条（供趋势参考，勿逐字编造其它日期）：\n`;
  recent.forEach((x) => {
    block += `  · ${formatCnDateTime(x.t)} → ${x.v} ${valueLabel}\n`;
  });

  if (name === '心率') {
    const minuteBuckets = new Map();
    items.forEach((x) => {
      const k = `${x.t.getFullYear()}-${x.t.getMonth()}-${x.t.getDate()}-${x.t.getHours()}-${x.t.getMinutes()}`;
      const curr = minuteBuckets.get(k) || { sum: 0, count: 0, ts: x.t.getTime() };
      curr.sum += x.v;
      curr.count += 1;
      minuteBuckets.set(k, curr);
    });
    const minuteVals = Array.from(minuteBuckets.values())
      .sort((a, b) => a.ts - b.ts)
      .map((b) => b.sum / b.count);
    if (minuteVals.length > 0) {
      const p95 = (() => {
        const sortedVals = [...minuteVals].sort((a, b) => a - b);
        const pos = (sortedVals.length - 1) * 0.95;
        const base = Math.floor(pos);
        const rest = pos - base;
        return sortedVals[base + 1] != null
          ? sortedVals[base] + rest * (sortedVals[base + 1] - sortedVals[base])
          : sortedVals[base];
      })();
      const nightVals = items
        .filter((x) => x.hour < 6 || x.hour >= 22)
        .map((x) => x.v);
      const dayVals2 = items
        .filter((x) => x.hour >= 6 && x.hour < 22)
        .map((x) => x.v);
      if (nightVals.length) {
        block += `- 静息时段(22:00-06:00)均值约 ${mean(nightVals).toFixed(1)} ${valueLabel}\n`;
      }
      if (dayVals2.length) {
        block += `- 活动时段(06:00-22:00)均值约 ${mean(dayVals2).toFixed(1)} ${valueLabel}\n`;
      }
      block += `- 分钟级统计：均值约 ${mean(minuteVals).toFixed(1)} ${valueLabel}，95分位约 ${p95.toFixed(1)} ${valueLabel}\n`;

      let highRun = 0;
      let lowRun = 0;
      let maxHighRun = 0;
      let maxLowRun = 0;
      minuteVals.forEach((v) => {
        if (v > 100) {
          highRun += 1;
          maxHighRun = Math.max(maxHighRun, highRun);
        } else {
          highRun = 0;
        }
        if (v < 60) {
          lowRun += 1;
          maxLowRun = Math.max(maxLowRun, lowRun);
        } else {
          lowRun = 0;
        }
      });
      block += `- 异常连续时长：偏高最长约 ${maxHighRun} 分钟，偏低最长约 ${maxLowRun} 分钟\n`;
    }
  }

  return `${block}\n`;
}

function summarizeSleep(sleepEntries) {
  const raw = Array.isArray(sleepEntries) ? sleepEntries : [];
  const nights = raw
    .map((s) => {
      const t = s?.date ? new Date(s.date) : null;
      const total = Number(s?.totalHours);
      if (!t || Number.isNaN(t.getTime()) || !Number.isFinite(total)) return null;
      return {
        date: t,
        totalHours: total,
        deepHours: Number(s.deepHours),
        lightHours: Number(s.lightHours),
        remHours: Number(s.remHours),
        awakeHours: Number(s.awakeHours),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);

  if (nights.length === 0) {
    return '【睡眠】暂无有效睡眠时长记录。\n';
  }

  const totals = nights.map((n) => n.totalHours);
  const deepOk = nights.filter((n) => Number.isFinite(n.deepHours));
  let block = '';
  block += `【睡眠】\n`;
  block += `- 有记录的夜晚数：${nights.length}（日期范围 ${formatCnDate(nights[0].date)} 至 ${formatCnDate(nights[nights.length - 1].date)}）\n`;
  block += `- 每晚总时长：最短约 ${Math.min(...totals).toFixed(1)} 小时，最长约 ${Math.max(...totals).toFixed(1)} 小时，平均约 ${mean(totals).toFixed(1)} 小时\n`;
  if (deepOk.length) {
    const deepRatio = deepOk.map((n) =>
      n.totalHours > 0 ? (n.deepHours / n.totalHours) * 100 : 0,
    );
    block += `- 深睡占总睡眠比例均值约 ${mean(deepRatio).toFixed(0)}%（仅供参考）\n`;
  }
  const lastFew = nights.slice(-5);
  block += `- 最近几晚概览：\n`;
  lastFew.forEach((n) => {
    block += `  · ${formatCnDate(n.date)}：总时长约 ${n.totalHours.toFixed(1)} h`;
    if (Number.isFinite(n.deepHours))
      block += `（深睡约 ${Number(n.deepHours).toFixed(1)} h）`;
    block += `\n`;
  });

  return `${block}\n`;
}

function summarizeMedicines(medicines) {
  const ms = Array.isArray(medicines) ? medicines : [];
  if (ms.length === 0) {
    return '【用药】当前未在应用中记录药品。\n';
  }
  let block = '【用药】（来自用户本地清单，仅供参考）\n';
  ms.slice(0, 30).forEach((m) => {
    const name = String(m?.name || '未命名').trim();
    const dosage = String(m?.dosage || '').trim() || '未填写';
    const freq = String(m?.frequency || '').trim() || '未填写';
    block += `- ${name}；剂量/用法信息：${dosage}；服药频次：${freq}\n`;
  });
  if (ms.length > 30) {
    block += `（另有 ${ms.length - 30} 条药品未逐项列出）\n`;
  }
  return `${block}\n`;
}

function summarizeTongueInsight(tongueInsight) {
  if (!tongueInsight || typeof tongueInsight !== 'object') {
    return '【舌诊】暂无可用舌诊结果。\n';
  }
  const {
    analyzedAt,
    features,
    constitution,
    conditioningAdvice,
    riskTips,
  } = tongueInsight;
  const lines = [];
  lines.push('【舌诊】（来自应用内舌相 AI 检测）');
  if (analyzedAt) {
    const d = new Date(analyzedAt);
    lines.push(`- 最近检测时间：${formatCnDateTime(d)}`);
  }
  if (features) {
    lines.push(
      `- 结构化特征：舌色 ${features.tongueColor || '未知'}；苔色 ${features.coatingColor || '未知'}；苔厚薄 ${features.thickness || '未知'}；腐腻 ${features.rotGreasy || '未知'}`
    );
  }
  if (constitution) {
    lines.push(`- 中医体质/证型倾向：${constitution}`);
  }
  if (conditioningAdvice) {
    lines.push(`- 舌诊调理建议：${conditioningAdvice}`);
  }
  if (riskTips) {
    lines.push(`- 舌诊风险提示：${riskTips}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 供「个性化健康建议」一节使用的纯文本上下文（已由应用侧预处理，请勿再混入原始 JSON 数组）。
 * @param {{ heartRate?: any[], bloodGlucose?: any[], sleep?: any[], medicines?: any[] }} raw
 */
export function buildHealthAdviceSummary(raw) {
  const heartRate = raw?.heartRate || [];
  const bloodGlucose = raw?.bloodGlucose || [];
  const sleep = raw?.sleep || [];
  const medicines = raw?.medicines || [];
  const tongueInsight = raw?.tongueInsight || null;

  const parts = [];
  parts.push('=== 数据摘要（应用已预先统计，请你仅基于摘要中的数字与日期表述进行分析，严禁编造不存在的字母串或错乱日期格式）===\n');
  parts.push(summarizeNumericSeries(heartRate, '次/分钟', '心率'));
  parts.push(summarizeNumericSeries(bloodGlucose, 'mmol/L', '血糖'));
  parts.push(summarizeSleep(sleep));
  parts.push(summarizeMedicines(medicines));
  parts.push(summarizeTongueInsight(tongueInsight));

  const hasAnything =
    (Array.isArray(heartRate) && heartRate.some((x) => Number.isFinite(Number(x?.value)))) ||
    (Array.isArray(bloodGlucose) && bloodGlucose.some((x) => Number.isFinite(Number(x?.value)))) ||
    (Array.isArray(sleep) &&
      sleep.some((x) => Number.isFinite(Number(x?.totalHours)))) ||
    medicines.length > 0 ||
    Boolean(tongueInsight);

  if (!hasAnything) {
    parts.push('【说明】摘要中几乎没有可用指标记录。请温和提示用户先连接设备或手动记录数据后再生成个性化建议。\n');
  }

  return parts.join('\n');
}

/**
 * 健康数据图表：按日 24 小时、按周每日均值
 */

const HOURS = 24;

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/**
 * 指定日历日：按小时 (0–23) 聚合均值，24 个数据点（日折线图）
 */
export function buildDayHourlyAverage(series, day) {
  const buckets = Array.from({ length: HOURS }, () => ({ sum: 0, count: 0 }));
  const dayStart = startOfDay(day);

  series.forEach((item) => {
    try {
      const d = new Date(item.date);
      if (!sameDay(d, dayStart)) return;
      const v = Number(item.value);
      if (!Number.isFinite(v)) return;
      const h = d.getHours();
      buckets[h].sum += v;
      buckets[h].count += 1;
    } catch {
      // ignore
    }
  });

  const data = buckets.map((b) =>
    b.count > 0 ? Math.round((b.sum / b.count) * 10) / 10 : 0
  );
  return { labels: Array(HOURS).fill(''), data };
}

/** 日折线图横坐标：每隔 6 小时显示「0时」「6时」… 其余为空减少拥挤 */
export function hourlyLineChartLabels() {
  return Array.from({ length: HOURS }, (_, i) => (i % 6 === 0 ? `${i}时` : ''));
}

/**
 * 最近若干日历日，每日均值（「周」视图）
 */
export function buildRollingDailyAverage(series, dayCount = 7) {
  const dailyMap = {};
  series.forEach((item) => {
    try {
      const d = new Date(item.date);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      if (!dailyMap[key]) {
        dailyMap[key] = {
          sum: 0,
          count: 0,
          month: d.getMonth() + 1,
          day: d.getDate(),
          ts: startOfDay(d).getTime(),
        };
      }
      const v = Number(item.value);
      if (!Number.isFinite(v)) return;
      dailyMap[key].sum += v;
      dailyMap[key].count += 1;
    } catch {
      // ignore
    }
  });

  const sorted = Object.entries(dailyMap)
    .sort((a, b) => a[1].ts - b[1].ts)
    .slice(-dayCount);

  return {
    labels: sorted.map(([, v]) => `${v.month}/${v.day}`),
    data: sorted.map(([, v]) =>
      v.count > 0 ? Math.round((v.sum / v.count) * 10) / 10 : 0
    ),
  };
}

export function hasNonZero(data) {
  return Array.isArray(data) && data.some((n) => Number(n) > 0);
}

/**
 * 根据有效样本计算「包络」Y 轴范围，避免全图挤在上方。
 * 心率等场景会忽略 0（无样本小时），以免把轴拉回到 0。
 */
export function paddedYRange(values, options = {}) {
  const {
    padRatio = 0.12,
    absoluteMinPad = 0,
    ignoreZeroForMin = false,
    hardMin = null,
    hardMax = null,
  } = options;
  const finite = values.filter((v) => Number.isFinite(v));
  const forMin = ignoreZeroForMin ? finite.filter((v) => v > 0) : finite;
  const forMax = finite;
  if (!forMin.length || !forMax.length) return { yMin: 0, yMax: 1 };
  let minV = Math.min(...forMin);
  let maxV = Math.max(...forMax);
  if (minV === maxV) {
    const bump = Math.max(Math.abs(minV) * 0.05, absoluteMinPad || 1);
    minV -= bump;
    maxV += bump;
  }
  const span = maxV - minV;
  const pad = Math.max(span * padRatio, absoluteMinPad);
  let yMin = minV - pad;
  let yMax = maxV + pad;
  if (hardMin != null) yMin = Math.max(yMin, hardMin);
  if (hardMax != null) yMax = Math.min(yMax, hardMax);
  if (yMax <= yMin) yMax = yMin + Math.max(absoluteMinPad, 1);
  return { yMin, yMax };
}

/**
 * react-native-chart-kit 用全 dataset 的 min/max 定标；增加两条透明常数序列把纵轴卡在 [yMin,yMax]。
 */
export function lineChartBoundedDatasets(lineValues, yMin, yMax) {
  const n = lineValues.length;
  const fill = (v) => Array.from({ length: n }, () => v);
  const ghost = {
    withDots: false,
    strokeWidth: 0,
    color: () => 'rgba(0,0,0,0)',
  };
  return [
    { data: lineValues },
    { ...ghost, data: fill(yMin) },
    { ...ghost, data: fill(yMax) },
  ];
}

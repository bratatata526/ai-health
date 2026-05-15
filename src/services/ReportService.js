import { DeviceService } from './DeviceService';
import { MedicineService } from './MedicineService';
import { AIService } from './AIService';
import { AuthService } from './AuthService';
import { SecureStorage } from '../utils/secureStorage';
import { computeBmi, normalizeBodyMetrics } from '../utils/bmi';

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function stdDeviation(values, avg = mean(values)) {
  if (!values.length) return 0;
  const variance = values.reduce((sum, n) => sum + (n - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] == null) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function resolveStatus(avg, low, high) {
  if (!Number.isFinite(avg)) return '未知';
  if (avg < low) return '偏低';
  if (avg > high) return '偏高';
  return '正常';
}

function buildTrendInsight(metricName, unit, values, normalLow, normalHigh, digits = 1) {
  const valid = (values || []).filter((v) => Number.isFinite(v) && v > 0);
  if (!valid.length) {
    return {
      metricName,
      unit,
      normalRange: `${normalLow}-${normalHigh} ${unit}`,
      status: '未知',
      summary: '有效数据不足，暂无法判断趋势。',
      sampleCount: 0,
      average: null,
      min: null,
      max: null,
      latest: null,
      std: null,
    };
  }
  const avg = mean(valid);
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const latest = valid[valid.length - 1];
  const std = stdDeviation(valid, avg);
  const status = resolveStatus(avg, normalLow, normalHigh);
  return {
    metricName,
    unit,
    normalRange: `${normalLow}-${normalHigh} ${unit}`,
    status,
    summary: `${metricName}均值${status}，波动标准差约 ${std.toFixed(digits)} ${unit}。`,
    sampleCount: valid.length,
    average: Number(avg.toFixed(digits)),
    min: Number(min.toFixed(digits)),
    max: Number(max.toFixed(digits)),
    latest: Number(latest.toFixed(digits)),
    std: Number(std.toFixed(digits)),
  };
}

function hourOfPoint(item) {
  const ts = new Date(item.date).getTime();
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).getHours();
}

function inferHeartRatePeriod(hour) {
  if (hour == null) return 'unknown';
  if (hour < 6 || hour >= 22) return 'rest';
  return 'active';
}

function summarizeHeartRateByPeriod(minuteSeries) {
  const restValues = [];
  const activeValues = [];
  (minuteSeries || []).forEach((item) => {
    const value = Number(item.value);
    if (!Number.isFinite(value) || value <= 0) return;
    const period = inferHeartRatePeriod(hourOfPoint(item));
    if (period === 'rest') restValues.push(value);
    if (period === 'active') activeValues.push(value);
  });
  const restAvg = restValues.length ? Number(mean(restValues).toFixed(1)) : null;
  const activeAvg = activeValues.length ? Number(mean(activeValues).toFixed(1)) : null;
  return {
    rest: {
      sampleCount: restValues.length,
      average: restAvg,
      status: resolveStatus(restAvg, 55, 85),
    },
    active: {
      sampleCount: activeValues.length,
      average: activeAvg,
      status: resolveStatus(activeAvg, 60, 100),
    },
  };
}

function buildHeartRateAbnormalSegments(minuteSeries) {
  const points = (minuteSeries || [])
    .map((item) => {
      const ts = new Date(item.date).getTime();
      const value = Number(item.value);
      if (!Number.isFinite(ts) || !Number.isFinite(value) || value <= 0) return null;
      return { ts, value, date: new Date(ts).toISOString() };
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts);

  const segments = [];
  let current = null;

  const closeCurrent = () => {
    if (!current || !current.points.length) return;
    const values = current.points.map((p) => p.value);
    const startTs = current.points[0].ts;
    const endTs = current.points[current.points.length - 1].ts;
    const durationMin = Math.max(1, Math.round((endTs - startTs) / 60000) + 1);
    if (durationMin >= 3) {
      segments.push({
        type: current.type,
        startAt: new Date(startTs).toISOString(),
        endAt: new Date(endTs).toISOString(),
        durationMin,
        average: Number(mean(values).toFixed(1)),
        min: Number(Math.min(...values).toFixed(1)),
        max: Number(Math.max(...values).toFixed(1)),
      });
    }
    current = null;
  };

  for (const point of points) {
    let type = null;
    if (point.value > 100) type = 'high';
    else if (point.value < 60) type = 'low';

    if (!type) {
      closeCurrent();
      continue;
    }

    if (!current) {
      current = { type, points: [point] };
      continue;
    }

    const prev = current.points[current.points.length - 1];
    const gapMin = (point.ts - prev.ts) / 60000;
    if (current.type === type && gapMin <= 2.5) {
      current.points.push(point);
    } else {
      closeCurrent();
      current = { type, points: [point] };
    }
  }
  closeCurrent();

  return segments
    .sort((a, b) => b.durationMin - a.durationMin)
    .slice(0, 3);
}

function buildBloodGlucoseDailyFindings(points, maxItems = 6) {
  const byDay = new Map();
  (points || []).forEach((item) => {
    const d = new Date(item.date);
    const value = Number(item.value);
    if (!Number.isFinite(d.getTime()) || !Number.isFinite(value)) return;
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const row = byDay.get(key) || { points: [], date: d };
    row.points.push({ d, value });
    byDay.set(key, row);
  });

  const findings = [];
  Array.from(byDay.values())
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .forEach((row) => {
      const values = row.points.map((p) => p.value);
      const avg = mean(values);
      const highPoint = row.points.reduce((acc, p) => (!acc || p.value > acc.value ? p : acc), null);
      const lowPoint = row.points.reduce((acc, p) => (!acc || p.value < acc.value ? p : acc), null);
      const dateLabel = `${row.date.getMonth() + 1}/${row.date.getDate()}`;

      if (highPoint && highPoint.value > 7.8) {
        const t = highPoint.d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        findings.push(`${dateLabel} ${t} 血糖偏高（${highPoint.value.toFixed(1)} mmol/L）`);
      }
      if (lowPoint && lowPoint.value < 3.9) {
        const t = lowPoint.d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        findings.push(`${dateLabel} ${t} 血糖偏低（${lowPoint.value.toFixed(1)} mmol/L）`);
      }
      if (avg > 6.5) {
        findings.push(`${dateLabel} 日均血糖偏高（${avg.toFixed(1)} mmol/L）`);
      }
    });

  return findings.slice(0, maxItems);
}

function buildSleepDailyFindings(sleepEntries, maxItems = 7) {
  const findings = [];
  (sleepEntries || [])
    .map((item) => {
      const date = new Date(item.date);
      const total = Number(item.totalHours != null ? item.totalHours : item.value);
      const deep = Number(item.deepHours);
      if (!Number.isFinite(date.getTime()) || !Number.isFinite(total)) return null;
      return { date, total, deep };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .forEach((row) => {
      const dateLabel = `${row.date.getMonth() + 1}/${row.date.getDate()}`;
      if (row.total < 7) {
        findings.push(`${dateLabel} 睡眠时长不足（${row.total.toFixed(1)} h）`);
      } else if (row.total > 9.5) {
        findings.push(`${dateLabel} 睡眠时长偏长（${row.total.toFixed(1)} h）`);
      }

      if (Number.isFinite(row.deep) && row.total > 0) {
        const deepRatio = (row.deep / row.total) * 100;
        if (deepRatio < 18) {
          findings.push(
            `${dateLabel} 深睡占比偏低（${deepRatio.toFixed(0)}%，深睡${row.deep.toFixed(1)}h）`
          );
        }
      }

    });

  return findings.slice(0, maxItems);
}

function extractMarkdownSection(markdown, headingCandidates) {
  const text = String(markdown || '');
  if (!text.trim()) return '';
  for (const heading of headingCandidates) {
    const pattern = new RegExp(
      `(?:^|\\n)#{0,3}\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n#{1,3}\\s|$)`,
      'i'
    );
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

export class ReportService {
  /** 从快照/历史数组解析最新成功舌诊（与 getLatestTongueAnalysis 逻辑一致，不读本地存储） */
  static parseTongueRowsToAnalysis(rows) {
    try {
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const latest = rows
        .filter((item) => item?.status === 'success' && item?.result)
        .sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))[0];
      if (!latest) return null;
      const features = latest.result?.features || {};
      const markdown = String(latest.result?.analysis_markdown || '');
      return {
        analyzedAt: latest.updated_at || latest.created_at || Date.now(),
        originalImage: latest.original_image_uri || null,
        segmentedImage: latest.result?.segmented_image || null,
        features: {
          tongueColor: features?.tongue_color?.label || '未知',
          coatingColor: features?.coating_color?.label || '未知',
          thickness: features?.tongue_thickness?.label || '未知',
          rotGreasy: features?.rot_greasy?.label || '未知',
        },
        constitution:
          extractMarkdownSection(markdown, ['可能的中医证型', '中医体质', '体质倾向']) || '',
        conditioningAdvice:
          extractMarkdownSection(markdown, ['调理建议', '调护建议', '生活建议']) || '',
        riskTips:
          extractMarkdownSection(markdown, ['风险提示', '注意事项', '就医提示']) || '',
        fullAnalysis: markdown,
      };
    } catch (e) {
      console.warn('解析舌诊快照失败:', e);
      return null;
    }
  }

  static async getLatestTongueAnalysis() {
    try {
      const rows = (await SecureStorage.getItem('@tongue_analysis_history')) || [];
      return this.parseTongueRowsToAnalysis(rows);
    } catch (e) {
      console.warn('读取舌诊报告数据失败:', e);
      return null;
    }
  }

  /**
   * 与 generateReport 相同的时间窗口起点：周=最近 7 天；月=最近一个自然月（与 setMonth(-1) 一致）
   * @param {'week'|'month'} type
   * @param {Date} [now]
   */
  static resolvePeriodStart(type = 'week', now = new Date()) {
    const startDate = new Date(now);
    if (type === 'week') {
      startDate.setDate(startDate.getDate() - 7);
    } else {
      startDate.setMonth(startDate.getMonth() - 1);
    }
    return startDate;
  }

  static async generateReport(type = 'week', useAI = false) {
    try {
      const healthData = await DeviceService.getHealthData();
      const medicines = await MedicineService.getAllMedicines();
      const profile = await AuthService.getProfile();
      const bodyMetrics = normalizeBodyMetrics({
        heightCm: profile?.heightCm,
        weightKg: profile?.weightKg,
      });
      const bmi = computeBmi(bodyMetrics.heightCm, bodyMetrics.weightKg)?.value ?? null;

      // 计算时间范围
      const now = new Date();
      const startDate = this.resolvePeriodStart(type, now);

      // 筛选时间范围内的数据
      const filteredHeartRate = healthData.heartRate.filter(
        (item) => new Date(item.date) >= startDate
      );
      const filteredBloodGlucose = healthData.bloodGlucose.filter(
        (item) => new Date(item.date) >= startDate
      );
      const filteredSleep = healthData.sleep.filter(
        (item) => new Date(item.date) >= startDate
      );

      // 计算平均值
      const avgHeartRate =
        filteredHeartRate.length > 0
          ? Math.round(
              filteredHeartRate.reduce((sum, item) => sum + item.value, 0) /
                filteredHeartRate.length
            )
          : 0;

      const avgBloodGlucose =
        filteredBloodGlucose.length > 0
          ? (
              filteredBloodGlucose.reduce((sum, item) => sum + parseFloat(item.value), 0) /
              filteredBloodGlucose.length
            ).toFixed(1)
          : 0;

      const avgSleep =
        filteredSleep.length > 0
          ? (
              filteredSleep.reduce(
                (sum, item) =>
                  sum +
                  parseFloat(
                    item.totalHours != null ? item.totalHours : item.value != null ? item.value : 0
                  ),
                0
              ) / filteredSleep.length
            ).toFixed(1)
          : 0;

      const sleepStages = {
        deep: this.avgSleepStageHours(filteredSleep, 'deepHours'),
        light: this.avgSleepStageHours(filteredSleep, 'lightHours'),
        rem: this.avgSleepStageHours(filteredSleep, 'remHours'),
        awake: this.avgSleepStageHours(filteredSleep, 'awakeHours'),
      };

      // 计算健康评分（0-100）
      const healthScore = this.calculateHealthScore({
        heartRate: avgHeartRate,
        bloodGlucose: parseFloat(avgBloodGlucose),
        sleep: parseFloat(avgSleep),
        medicineCount: medicines.length,
      });

      // 生成趋势数据
      const trends = this.generateTrendData(
        filteredHeartRate,
        filteredBloodGlucose,
        filteredSleep,
        type
      );
      const trendInsights = this.generateTrendInsights({
        trends,
        filteredHeartRate,
        filteredBloodGlucose,
        filteredSleep,
        minuteHeartRate: healthData.heartRateMinuteAvg || [],
        startDate,
      });
      const tongueAnalysis = await this.getLatestTongueAnalysis();

      // 生成健康建议（优先使用AI，失败则使用规则）
      let recommendations = [];
      let aiAnalysis = null;

      if (useAI) {
        try {
          aiAnalysis = await AIService.generateHealthAnalysis({
            avgHeartRate,
            avgBloodGlucose,
            avgSleep,
            healthScore,
            medicineCount: medicines.length,
          });
          // AI分析作为详细分析，规则建议作为快速建议
          recommendations = this.generateRecommendations({
            heartRate: avgHeartRate,
            bloodGlucose: parseFloat(avgBloodGlucose),
            sleep: parseFloat(avgSleep),
            medicineCount: medicines.length,
          });
        } catch (error) {
          console.warn('AI分析失败，使用规则建议:', error);
          recommendations = this.generateRecommendations({
            heartRate: avgHeartRate,
            bloodGlucose: parseFloat(avgBloodGlucose),
            sleep: parseFloat(avgSleep),
            medicineCount: medicines.length,
          });
        }
      } else {
        recommendations = this.generateRecommendations({
          heartRate: avgHeartRate,
          bloodGlucose: parseFloat(avgBloodGlucose),
          sleep: parseFloat(avgSleep),
          medicineCount: medicines.length,
        });
      }

      return {
        type,
        period: type === 'week' ? '最近一周' : '最近一月',
        heightCm: bodyMetrics.heightCm,
        weightKg: bodyMetrics.weightKg,
        bmi,
        avgHeartRate,
        avgBloodGlucose,
        avgSleep,
        sleepStages,
        healthScore,
        trends,
        trendInsights,
        tongueAnalysis,
        recommendations,
        aiAnalysis, // AI生成的详细分析
        medicineCount: medicines.length,
        generatedAt: now.toISOString(),
      };
    } catch (error) {
      console.error('生成报告失败:', error);
      throw error;
    }
  }

  /**
   * 基于关怀账号云端快照生成周/月报告（不读取本机 DeviceService / 本机舌诊存储）
   * @param {'week'|'month'} type
   * @param {{ healthData: object, medicines: any[], tongueRows: any[], profile: object }} bundle
   */
  static async generateReportFromCareSnapshot(type, bundle) {
    const healthData = bundle?.healthData && typeof bundle.healthData === 'object' ? bundle.healthData : {};
    const medicines = Array.isArray(bundle?.medicines) ? bundle.medicines : [];
    const tongueRows = Array.isArray(bundle?.tongueRows) ? bundle.tongueRows : [];
    const profile = bundle?.profile && typeof bundle.profile === 'object' ? bundle.profile : {};

    const heartRate = Array.isArray(healthData.heartRate) ? healthData.heartRate : [];
    const bloodGlucose = Array.isArray(healthData.bloodGlucose) ? healthData.bloodGlucose : [];
    const sleep = Array.isArray(healthData.sleep) ? healthData.sleep : [];
    const minuteHeartRate = Array.isArray(healthData.heartRateMinuteAvg)
      ? healthData.heartRateMinuteAvg
      : [];

    const now = new Date();
    const startDate = this.resolvePeriodStart(type, now);

    const wallFilter = (item) =>
      Number.isFinite(new Date(item.date).getTime()) && new Date(item.date) >= startDate;
    let filteredHeartRate = heartRate.filter(wallFilter);
    let filteredBloodGlucose = bloodGlucose.filter(wallFilter);
    let filteredSleep = sleep.filter(wallFilter);

    const anySeries =
      (heartRate && heartRate.length > 0) ||
      (bloodGlucose && bloodGlucose.length > 0) ||
      (sleep && sleep.length > 0);
    const hasWallHits =
      filteredHeartRate.length + filteredBloodGlucose.length + filteredSleep.length > 0;

    let chartEndAnchor = null;
    let minuteInsightStart = startDate;
    let careDataWindowNote = null;

    if (anySeries && !hasWallHits) {
      let latestTs = NaN;
      [heartRate, bloodGlucose, sleep].forEach((arr) => {
        (arr || []).forEach((item) => {
          const t = new Date(item.date).getTime();
          if (Number.isFinite(t)) latestTs = Number.isFinite(latestTs) ? Math.max(latestTs, t) : t;
        });
      });

      if (Number.isFinite(latestTs)) {
        const anchorEnd = new Date(latestTs);
        anchorEnd.setHours(23, 59, 59, 999);
        const days = type === 'week' ? 7 : 30;
        const relStart = new Date(latestTs);
        relStart.setHours(0, 0, 0, 0);
        relStart.setDate(relStart.getDate() - (days - 1));
        const relMs = relStart.getTime();
        const endMs = anchorEnd.getTime();

        const byWin = (arr) =>
          (arr || []).filter((item) => {
            const t = new Date(item.date).getTime();
            return Number.isFinite(t) && t >= relMs && t <= endMs;
          });

        filteredHeartRate = byWin(heartRate);
        filteredBloodGlucose = byWin(bloodGlucose);
        filteredSleep = byWin(sleep);

        if (
          filteredHeartRate.length + filteredBloodGlucose.length + filteredSleep.length ===
          0
        ) {
          filteredHeartRate = (heartRate || []).filter((item) =>
            Number.isFinite(new Date(item.date).getTime())
          );
          filteredBloodGlucose = (bloodGlucose || []).filter((item) =>
            Number.isFinite(new Date(item.date).getTime())
          );
          filteredSleep = (sleep || []).filter((item) =>
            Number.isFinite(new Date(item.date).getTime())
          );
        }

        chartEndAnchor = anchorEnd;
        minuteInsightStart = relStart;
        careDataWindowNote =
          type === 'week'
            ? '云端快照与「日历最近一周」无重叠：已按最近一次体征时间对齐展示近 7 日窗口（非自然周）。'
            : '云端快照与「日历最近一月」无重叠：已按最近一次体征时间对齐展示近 30 日窗口（非自然月）。';
      }
    }

    const avgHeartRate =
      filteredHeartRate.length > 0
        ? Math.round(
            filteredHeartRate.reduce((sum, item) => sum + item.value, 0) / filteredHeartRate.length
          )
        : 0;

    const avgBloodGlucose =
      filteredBloodGlucose.length > 0
        ? (
            filteredBloodGlucose.reduce((sum, item) => sum + parseFloat(item.value), 0) /
            filteredBloodGlucose.length
          ).toFixed(1)
        : 0;

    const avgSleep =
      filteredSleep.length > 0
        ? (
            filteredSleep.reduce(
              (sum, item) =>
                sum +
                parseFloat(
                  item.totalHours != null ? item.totalHours : item.value != null ? item.value : 0
                ),
              0
            ) / filteredSleep.length
          ).toFixed(1)
        : 0;

    const sleepStages = {
      deep: this.avgSleepStageHours(filteredSleep, 'deepHours'),
      light: this.avgSleepStageHours(filteredSleep, 'lightHours'),
      rem: this.avgSleepStageHours(filteredSleep, 'remHours'),
      awake: this.avgSleepStageHours(filteredSleep, 'awakeHours'),
    };

    const bodyMetrics = normalizeBodyMetrics({
      heightCm: profile?.heightCm,
      weightKg: profile?.weightKg,
    });
    const bmi = computeBmi(bodyMetrics.heightCm, bodyMetrics.weightKg)?.value ?? null;

    const healthScore = this.calculateHealthScore({
      heartRate: avgHeartRate,
      bloodGlucose: parseFloat(avgBloodGlucose),
      sleep: parseFloat(avgSleep),
      medicineCount: medicines.length,
    });

    const trends = this.generateTrendData(
      filteredHeartRate,
      filteredBloodGlucose,
      filteredSleep,
      type,
      chartEndAnchor && Number.isFinite(chartEndAnchor.getTime()) ? chartEndAnchor : null
    );
    const trendInsights = this.generateTrendInsights({
      trends,
      filteredHeartRate,
      filteredBloodGlucose,
      filteredSleep,
      minuteHeartRate,
      startDate,
      minuteSeriesStart: minuteInsightStart,
    });

    const tongueAnalysis = this.parseTongueRowsToAnalysis(tongueRows);

    let recommendations = this.generateRecommendations({
      heartRate: avgHeartRate,
      bloodGlucose: parseFloat(avgBloodGlucose),
      sleep: parseFloat(avgSleep),
      medicineCount: medicines.length,
    });
    if (careDataWindowNote) {
      recommendations = [careDataWindowNote, ...recommendations];
    }

    const careRecipientDisplay =
      String(profile?.name || '').trim() ||
      String(profile?.email || '').trim() ||
      '';

    return {
      type,
      period: type === 'week' ? '最近一周' : '最近一月',
      careMode: true,
      careRecipientDisplay,
      careDataWindowNote: careDataWindowNote || null,
      heightCm: bodyMetrics.heightCm,
      weightKg: bodyMetrics.weightKg,
      bmi,
      avgHeartRate,
      avgBloodGlucose,
      avgSleep,
      sleepStages,
      healthScore,
      trends,
      trendInsights,
      tongueAnalysis,
      recommendations,
      aiAnalysis: null,
      medicineCount: medicines.length,
      generatedAt: now.toISOString(),
    };
  }

  static calculateHealthScore(data) {
    let score = 100;

    // 心率评分（正常范围：60-100 bpm）
    if (data.heartRate < 60 || data.heartRate > 100) {
      score -= 20;
    } else if (data.heartRate < 70 || data.heartRate > 90) {
      score -= 10;
    }

    // 血糖评分（正常范围：3.9-6.1 mmol/L）
    if (data.bloodGlucose < 3.9 || data.bloodGlucose > 6.1) {
      score -= 20;
    } else if (data.bloodGlucose < 4.5 || data.bloodGlucose > 5.5) {
      score -= 10;
    }

    // 睡眠评分（正常范围：7-9小时）
    if (data.sleep < 6 || data.sleep > 10) {
      score -= 20;
    } else if (data.sleep < 7 || data.sleep > 9) {
      score -= 10;
    }

    // 服药依从性加分
    if (data.medicineCount > 0) {
      score += Math.min(data.medicineCount * 2, 10);
    }

    return Math.max(0, Math.min(100, score));
  }

  /** 仅对有有效分项数值的记录求平均（小时，保留一位小数）；无数据返回 null */
  static avgSleepStageHours(items, field) {
    const vals = items
      .map((item) => Number(item[field]))
      .filter((n) => Number.isFinite(n) && n >= 0);
    if (!vals.length) return null;
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  }

  static generateTrendData(heartRate, bloodGlucose, sleep, type, chartEndAnchor = null) {
    // 按日期分组数据
    const days = type === 'week' ? 7 : 30;
    const labels = [];
    const heartRateData = [];
    const bloodGlucoseData = [];
    const sleepData = [];
    const sleepDeepData = [];
    const sleepLightData = [];
    const sleepRemData = [];

    const endNorm =
      chartEndAnchor instanceof Date && Number.isFinite(chartEndAnchor.getTime())
        ? new Date(chartEndAnchor)
        : new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(endNorm);
      date.setDate(date.getDate() - i);
      const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
      labels.push(dateStr);

      // 计算当天的平均值
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      const dayHeartRate = heartRate.filter(
        (item) =>
          new Date(item.date) >= dayStart && new Date(item.date) <= dayEnd
      );
      const dayBloodGlucose = bloodGlucose.filter(
        (item) =>
          new Date(item.date) >= dayStart && new Date(item.date) <= dayEnd
      );
      const daySleepRows = sleep.filter(
        (item) =>
          new Date(item.date) >= dayStart && new Date(item.date) <= dayEnd
      );

      heartRateData.push(
        dayHeartRate.length > 0
          ? Math.round(
              dayHeartRate.reduce((sum, item) => sum + item.value, 0) /
                dayHeartRate.length
            )
          : 0
      );

      bloodGlucoseData.push(
        dayBloodGlucose.length > 0
          ? parseFloat(
              (
                dayBloodGlucose.reduce(
                  (sum, item) => sum + parseFloat(item.value),
                  0
                ) / dayBloodGlucose.length
              ).toFixed(1)
            )
          : 0
      );

      sleepData.push(
        daySleepRows.length
          ? parseFloat(
              (
                daySleepRows.reduce(
                  (sum, item) =>
                    sum +
                    Number(
                      item.totalHours != null ? item.totalHours : item.value != null ? item.value : 0
                    ),
                  0
                ) / daySleepRows.length
              ).toFixed(1)
            )
          : 0
      );
      sleepDeepData.push(
        daySleepRows.length
          ? parseFloat(
              (
                daySleepRows.reduce((sum, item) => sum + Number(item.deepHours || 0), 0) /
                daySleepRows.length
              ).toFixed(1)
            )
          : 0
      );
      sleepLightData.push(
        daySleepRows.length
          ? parseFloat(
              (
                daySleepRows.reduce((sum, item) => sum + Number(item.lightHours || 0), 0) /
                daySleepRows.length
              ).toFixed(1)
            )
          : 0
      );
      sleepRemData.push(
        daySleepRows.length
          ? parseFloat(
              (
                daySleepRows.reduce((sum, item) => sum + Number(item.remHours || 0), 0) /
                daySleepRows.length
              ).toFixed(1)
            )
          : 0
      );
    }

      return {
        labels,
        heartRate: {
          labels,
          datasets: [{ data: heartRateData }],
        },
        bloodGlucose: {
          labels,
          datasets: [{ data: bloodGlucoseData }],
        },
        sleep: {
          labels,
          datasets: [{ data: sleepData }],
        },
        sleepStages: {
          labels,
          deep: sleepDeepData,
          light: sleepLightData,
          rem: sleepRemData,
          total: sleepData,
        },
      };
  }

  static generateTrendInsights({
    trends,
    filteredHeartRate,
    filteredBloodGlucose,
    filteredSleep,
    minuteHeartRate,
    startDate,
    minuteSeriesStart,
  }) {
    const heartRateDay = trends?.heartRate?.datasets?.[0]?.data || [];
    const bloodGlucoseDay = trends?.bloodGlucose?.datasets?.[0]?.data || [];
    const sleepDay = trends?.sleep?.datasets?.[0]?.data || [];

    const heartRateInsight = buildTrendInsight('心率', 'bpm', heartRateDay, 60, 100, 1);
    const bloodGlucoseInsight = buildTrendInsight(
      '血糖',
      'mmol/L',
      bloodGlucoseDay,
      3.9,
      6.1,
      1
    );
    const sleepInsight = buildTrendInsight('睡眠', '小时', sleepDay, 7, 9, 1);

    const minuteFilterStart =
      minuteSeriesStart instanceof Date && Number.isFinite(minuteSeriesStart.getTime())
        ? minuteSeriesStart
        : startDate;

    const minuteSeries = (minuteHeartRate || []).filter((item) => {
      const ts = new Date(item.date).getTime();
      return Number.isFinite(ts) && ts >= minuteFilterStart.getTime();
    });
    const minuteValues = minuteSeries
      .map((item) => Number(item.value))
      .filter((v) => Number.isFinite(v) && v > 0);

    const minuteHeartRateInsight = minuteValues.length
      ? {
          sampleCount: minuteValues.length,
          average: Number(mean(minuteValues).toFixed(1)),
          min: Number(Math.min(...minuteValues).toFixed(1)),
          max: Number(Math.max(...minuteValues).toFixed(1)),
          p95: Number(quantile(minuteValues, 0.95).toFixed(1)),
          std: Number(stdDeviation(minuteValues).toFixed(1)),
        }
      : null;
    const periodSummary = summarizeHeartRateByPeriod(minuteSeries);
    const abnormalSegments = buildHeartRateAbnormalSegments(minuteSeries);

    return {
      heartRate: {
        ...heartRateInsight,
        rawPointCount: filteredHeartRate.length,
        minuteAverage: minuteHeartRateInsight,
        periodSummary,
        abnormalSegments,
        dailyFindings: [],
      },
      bloodGlucose: {
        ...bloodGlucoseInsight,
        rawPointCount: filteredBloodGlucose.length,
        dailyFindings: buildBloodGlucoseDailyFindings(filteredBloodGlucose),
      },
      sleep: {
        ...sleepInsight,
        rawPointCount: filteredSleep.length,
        dailyFindings: buildSleepDailyFindings(filteredSleep),
      },
    };
  }

  static generateRecommendations(data) {
    const recommendations = [];

    if (data.heartRate < 60) {
      recommendations.push('您的心率偏低，建议适当增加运动量');
    } else if (data.heartRate > 100) {
      recommendations.push('您的心率偏高，建议减少剧烈运动，注意休息');
    }

    if (data.bloodGlucose < 3.9) {
      recommendations.push('您的血糖偏低，建议适当补充糖分');
    } else if (data.bloodGlucose > 6.1) {
      recommendations.push('您的血糖偏高，建议控制饮食，减少糖分摄入');
    }

    if (data.sleep < 7) {
      recommendations.push('您的睡眠时间不足，建议保证每天7-9小时的睡眠');
    } else if (data.sleep > 9) {
      recommendations.push('您的睡眠时间较长，建议保持规律的作息');
    }

    if (data.medicineCount > 0) {
      recommendations.push('请按时服药，保持良好的服药习惯');
    }

    if (recommendations.length === 0) {
      recommendations.push('您的健康状况良好，请继续保持！');
      recommendations.push('建议定期进行健康检查');
    }

    return recommendations;
  }
}


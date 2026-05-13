import { AI_DISCLAIMER_ZH } from '../constants/aiDisclaimer';

function escapeHtml(s) {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatZhDate(isoOrDate) {
  try {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/**
 * @param {string} title
 * @param {string[]} labels
 * @param {number[]} values
 * @param {string} strokeColor
 * @param {string} unitLabel
 */
export function buildTrendLineSvg(title, labels, values, strokeColor, unitLabel = '') {
  const W = 520;
  const H = 210;
  const padL = 44;
  const padR = 16;
  const padT = 36;
  const padB = 40;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const nums = (values || []).map((v) => Number(v));
  const n = Math.max(nums.length, 1);
  let minY = Math.min(...nums);
  let maxY = Math.max(...nums);
  if (!Number.isFinite(minY)) minY = 0;
  if (!Number.isFinite(maxY)) maxY = 1;
  if (maxY === minY) {
    maxY = minY + 1e-6;
  }

  const pts = nums.map((v, i) => {
    const x =
      n <= 1 ? padL + chartW / 2 : padL + (i / (n - 1)) * chartW;
    const y = padT + chartH - ((v - minY) / (maxY - minY)) * chartH;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const polylinePoints = pts.join(' ');
  const circles = nums
    .map((v, i) => {
      const x =
        n <= 1 ? padL + chartW / 2 : padL + (i / (n - 1)) * chartW;
      const y = padT + chartH - ((v - minY) / (maxY - minY)) * chartH;
      return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3" fill="${strokeColor}" />`;
    })
    .join('');

  const labelIndices = [];
  const maxLabels = 8;
  if (n <= maxLabels) {
    for (let i = 0; i < n; i += 1) labelIndices.push(i);
  } else {
    labelIndices.push(0);
    const step = Math.ceil((n - 1) / (maxLabels - 1));
    for (let i = step; i < n - 1; i += step) labelIndices.push(i);
    labelIndices.push(n - 1);
  }

  const xLabels = [...new Set(labelIndices)]
    .sort((a, b) => a - b)
    .map((i) => {
      const x =
        n <= 1 ? padL + chartW / 2 : padL + (i / (n - 1)) * chartW;
      const lab = (labels && labels[i]) != null ? String(labels[i]) : '';
      return `<text x="${x.toFixed(2)}" y="${H - 10}" text-anchor="middle" font-size="9" fill="#555">${escapeHtml(lab)}</text>`;
    })
    .join('');

  const yMinStr = Number.isFinite(minY) ? minY.toFixed(1) : '';
  const yMaxStr = Number.isFinite(maxY) ? maxY.toFixed(1) : '';

  return `
  <div class="chart-block">
    <div class="chart-title">${escapeHtml(title)}${unitLabel ? ` (${escapeHtml(unitLabel)})` : ''}</div>
    <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect x="0" y="0" width="${W}" height="${H}" fill="#fafafa" stroke="#e0e0e0" stroke-width="1" rx="4" />
      <text x="12" y="22" font-size="11" fill="#333" font-weight="600">${escapeHtml(title)}</text>
      <line x1="${padL}" y1="${padT + chartH}" x2="${padL + chartW}" y2="${padT + chartH}" stroke="#ccc" stroke-width="1" />
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + chartH}" stroke="#ccc" stroke-width="1" />
      <text x="6" y="${padT + chartH / 2}" font-size="9" fill="#888" transform="rotate(-90 6 ${padT + chartH / 2})">${escapeHtml(yMaxStr)}</text>
      <text x="6" y="${padT + chartH - 2}" font-size="9" fill="#888" transform="rotate(-90 6 ${padT + chartH - 2})">${escapeHtml(yMinStr)}</text>
      <polyline fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${polylinePoints}" />
      ${circles}
      ${xLabels}
    </svg>
  </div>`;
}

function buildTrendInsightHtml(insight, unit, includeMinuteDetail = false, title = '趋势分析') {
  if (!insight) return '';
  const fmt = (v) => (v == null ? '暂无' : `${v}${unit ? ` ${unit}` : ''}`);
  const minuteLine =
    includeMinuteDetail && insight.minuteAverage
      ? `<li>分钟级心率统计（报告专用）：均值 ${escapeHtml(String(insight.minuteAverage.average))} bpm，最高 ${escapeHtml(String(insight.minuteAverage.max))} bpm，最低 ${escapeHtml(String(insight.minuteAverage.min))} bpm，P95 ${escapeHtml(String(insight.minuteAverage.p95))} bpm，标准差 ${escapeHtml(String(insight.minuteAverage.std))} bpm。</li>`
      : '';
  const periodLine =
    includeMinuteDetail && insight.periodSummary
      ? `<li>分时段结论：静息时段(22:00-06:00)均值 ${escapeHtml(String(insight.periodSummary.rest?.average ?? '暂无'))} bpm（${escapeHtml(String(insight.periodSummary.rest?.status || '未知'))}）；活动时段(06:00-22:00)均值 ${escapeHtml(String(insight.periodSummary.active?.average ?? '暂无'))} bpm（${escapeHtml(String(insight.periodSummary.active?.status || '未知'))}）。</li>`
      : '';
  const abnormalLine =
    includeMinuteDetail && Array.isArray(insight.abnormalSegments)
      ? insight.abnormalSegments.length
        ? `<li>异常连续时段：${insight.abnormalSegments
            .map((seg) => {
              const typeLabel = seg.type === 'high' ? '偏高' : '偏低';
              const start = new Date(seg.startAt).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              });
              const end = new Date(seg.endAt).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              });
              return `${typeLabel}${seg.durationMin}分钟(${start}-${end}, 均值${seg.average} bpm)`;
            })
            .join('；')}</li>`
        : '<li>异常连续时段：未发现连续 3 分钟以上异常区间。</li>'
      : '';
  const dailyLine =
    Array.isArray(insight.dailyFindings) && insight.dailyFindings.length > 0
      ? `<li>每日重点：${insight.dailyFindings.map((x) => escapeHtml(String(x))).join('；')}</li>`
      : '';
  return `
    <div class="trend-insight">
      <div class="trend-insight-title">${escapeHtml(title)}</div>
      <ul>
        <li>正常范围：${escapeHtml(insight.normalRange || '暂无')}</li>
        <li>均值判断：${escapeHtml(insight.status || '未知')}</li>
        <li>统计结果：平均 ${fmt(insight.average)} / 最高 ${fmt(insight.max)} / 最低 ${fmt(insight.min)}</li>
        <li>最近值：${fmt(insight.latest)}；样本量：${escapeHtml(String(insight.sampleCount ?? 0))}</li>
        <li>数据解读：${escapeHtml(insight.summary || '暂无解读')}</li>
        ${dailyLine}
        ${minuteLine}
        ${periodLine}
        ${abnormalLine}
      </ul>
    </div>
  `;
}

function formatAdviceParagraphsHtml(text) {
  const clean = String(text || '').trim();
  if (!clean) return '';
  const lines = clean
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const stripInline = (line) =>
    String(line || '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .trim();
  return lines
    .map((line) => {
      const heading = line.match(/^#{1,6}\s*(.+)$/);
      if (heading) {
        return `<div class="ai-heading">${escapeHtml(stripInline(heading[1]))}</div>`;
      }
      const bullet = line.match(/^[-*]\s+(.+)$/);
      if (bullet) {
        return `<div class="ai-bullet">• ${escapeHtml(stripInline(bullet[1]))}</div>`;
      }
      return `<p class="ai-paragraph">　　${escapeHtml(stripInline(line))}</p>`;
    })
    .join('');
}

function markdownInlineToHtml(raw) {
  const s = escapeHtml(String(raw || ''));
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function formatMarkdownBlockHtml(text) {
  const clean = String(text || '').trim();
  if (!clean) return '<p class="md-paragraph">暂无</p>';
  const lines = clean
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines
    .map((line) => {
      const heading = line.match(/^#{1,6}\s*(.+)$/);
      if (heading) {
        return `<div class="md-heading">${markdownInlineToHtml(heading[1])}</div>`;
      }
      const bullet = line.match(/^[-*]\s+(.+)$/);
      if (bullet) {
        return `<div class="md-bullet">• ${markdownInlineToHtml(bullet[1])}</div>`;
      }
      return `<p class="md-paragraph">${markdownInlineToHtml(line)}</p>`;
    })
    .join('');
}

/**
 * @param {{
 *   displayName: string,
 *   report: object,
 *   assistantAdvice: string,
 *   generatedAtDisplay?: string,
 * }} opts
 */
export function buildHealthReportPdfHtml(opts) {
  const {
    displayName,
    report,
    assistantAdvice,
    generatedAtDisplay,
    reportTitle,
  } = opts;

  const period =
    report.period ||
    (report.type === 'week' ? '最近一周' : '最近一月');
  const generated =
    generatedAtDisplay ||
    formatZhDate(report.generatedAt || new Date());

  const trends = report.trends || {};
  const hr = trends.heartRate?.datasets?.[0]?.data || [];
  const hrLabels = trends.heartRate?.labels || trends.labels || [];
  const bg = trends.bloodGlucose?.datasets?.[0]?.data || [];
  const bgLabels = trends.bloodGlucose?.labels || trends.labels || [];
  const sl = trends.sleep?.datasets?.[0]?.data || [];
  const slLabels = trends.sleep?.labels || trends.labels || [];

  const svgHr = buildTrendLineSvg(
    '心率趋势',
    hrLabels,
    hr,
    '#e74c3c',
    'bpm'
  );
  const svgBg = buildTrendLineSvg(
    '血糖趋势',
    bgLabels,
    bg,
    '#50c878',
    'mmol/L'
  );
  const svgSl = buildTrendLineSvg(
    '睡眠趋势',
    slLabels,
    sl,
    '#9b59b6',
    '小时'
  );
  const trendInsights = report.trendInsights || {};
  const tongue = report.tongueAnalysis || null;

  const ss = report.sleepStages || {};
  const fmtSleepStageHour = (v) =>
    v != null ? `${escapeHtml(String(v))} 小时` : '暂无数据';
  const fmtBodyMetric = (v, unit) =>
    v != null ? `${escapeHtml(String(v))} ${escapeHtml(unit)}` : '未填写';
  const fmtBmi = (v) => (v != null ? escapeHtml(String(v)) : '未填写');

  const aiDisclaimer = escapeHtml(AI_DISCLAIMER_ZH);

  const aiAnalysisHtml = report.aiAnalysis
    ? `<section class="section">
        <div class="block-head">
          <h2>AI 深度分析</h2>
          <p class="disclaimer">${aiDisclaimer}</p>
        </div>
        <div class="body-text">${escapeHtml(report.aiAnalysis).replace(/\n/g, '<br/>')}</div>
      </section>`
    : '';

  const adviceBlock =
    assistantAdvice && assistantAdvice.trim().length > 0
      ? `<section class="section">
          <div class="block-head">
            <h2>健康建议（AI 助手个性化建议）</h2>
            <p class="disclaimer">${aiDisclaimer}</p>
          </div>
          <div class="body-text">${formatAdviceParagraphsHtml(assistantAdvice)}</div>
        </section>`
      : `<section class="section">
          <div class="block-head">
            <h2>简要提示（规则引擎）</h2>
            <p class="muted">尚未在「AI 助手 › 建议」中生成个性化建议；以下为应用规则生成的简要提示。</p>
          </div>
          <ul class="rec-list">
            ${(report.recommendations || [])
              .map((rec) => `<li>${escapeHtml(rec)}</li>`)
              .join('')}
          </ul>
        </section>`;

  const tongueBlock = tongue
    ? `<section class="section">
        <div class="block-head">
          <h2>中医体质分析（舌相AI）</h2>
        </div>
        <p class="muted">最近舌诊时间：${escapeHtml(formatZhDate(tongue.analyzedAt)) || '未知'}</p>
        <div class="tongue-images">
          ${
            tongue.originalImage
              ? `<div class="tongue-image-card">
                   <div class="tongue-image-title">舌诊原图</div>
                   <img src="${escapeHtml(tongue.originalImage)}" alt="舌诊原图" />
                 </div>`
              : ''
          }
          ${
            tongue.segmentedImage
              ? `<div class="tongue-image-card">
                   <div class="tongue-image-title">舌头图像分析结果</div>
                   <img src="${escapeHtml(tongue.segmentedImage)}" alt="舌头图像分析结果" />
                 </div>`
              : ''
          }
        </div>
        <div class="trend-insight">
          <div class="trend-insight-title">舌象结构化特征</div>
          <ul>
            <li>舌色：${escapeHtml(String(tongue.features?.tongueColor || '未知'))}</li>
            <li>苔色：${escapeHtml(String(tongue.features?.coatingColor || '未知'))}</li>
            <li>厚薄：${escapeHtml(String(tongue.features?.thickness || '未知'))}</li>
            <li>腐腻：${escapeHtml(String(tongue.features?.rotGreasy || '未知'))}</li>
          </ul>
        </div>
        <div class="trend-insight">
          <div class="trend-insight-title">体质与调理结论</div>
          <div class="tongue-text-block">
            <div class="tongue-text-title">体质/证型倾向</div>
            ${formatMarkdownBlockHtml(tongue.constitution || '暂无明确结论')}
          </div>
          <div class="tongue-text-block">
            <div class="tongue-text-title">调理建议</div>
            ${formatMarkdownBlockHtml(tongue.conditioningAdvice || '暂无')}
          </div>
          <div class="tongue-text-block">
            <div class="tongue-text-title">风险提示</div>
            ${formatMarkdownBlockHtml(tongue.riskTips || '暂无')}
          </div>
        </div>
      </section>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(reportTitle || `健康报告-${generated}`)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC",
        "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      color: #222;
      font-size: 13px;
      line-height: 1.55;
      padding: 24px 28px 40px;
      margin: 0;
    }
    h1 {
      font-size: 20px;
      margin: 0 0 8px;
      color: #1a1a1a;
      page-break-after: avoid;
      break-after: avoid-page;
    }
    .meta {
      color: #666;
      margin-bottom: 20px;
      font-size: 12px;
      page-break-after: avoid;
      break-after: avoid-page;
    }
    /* 正文可跨页连续排版，不再整块 section 禁止分页 */
    .section { margin-bottom: 22px; }
    /* 标题、免责声明与紧随内容避免孤行（标题/声明单独落在页底） */
    .block-head {
      page-break-inside: avoid;
      break-inside: avoid-page;
    }
    h2 {
      font-size: 15px;
      border-bottom: 1px solid #ddd;
      padding-bottom: 6px;
      margin: 0 0 10px;
      color: #333;
      page-break-after: avoid;
      break-after: avoid-page;
    }
    .block-head h2 {
      margin-bottom: 8px;
    }
    .overview-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    .overview-table th, .overview-table td {
      border: 1px solid #e0e0e0;
      padding: 8px 10px;
      text-align: left;
    }
    .overview-table th { background: #f5f5f5; width: 28%; }
    .score-row { font-size: 18px; font-weight: 700; color: #2563eb; }
    .chart-block { margin: 12px 0; text-align: center; }
    .chart-title { font-size: 11px; color: #888; margin-bottom: 4px; display: none; }
    .trend-insight {
      margin: 6px 0 14px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 10px;
    }
    .trend-insight-title {
      font-size: 12px;
      font-weight: 600;
      color: #334155;
      margin-bottom: 4px;
    }
    .trend-insight ul {
      margin: 0;
      padding-left: 16px;
    }
    .trend-insight li {
      margin: 2px 0;
      color: #475569;
      font-size: 11px;
      line-height: 1.45;
    }
    .tongue-images {
      display: flex;
      gap: 10px;
      margin: 10px 0;
    }
    .tongue-image-card {
      flex: 1;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px;
      background: #f8fafc;
    }
    .tongue-image-title {
      font-size: 11px;
      color: #475569;
      margin-bottom: 6px;
    }
    .tongue-image-card img {
      width: 100%;
      max-height: 240px;
      object-fit: contain;
      display: block;
      background: #fff;
      border-radius: 4px;
    }
    .tongue-text-block {
      margin-top: 8px;
      padding: 6px 8px;
      border-radius: 6px;
      background: #ffffff;
      border: 1px dashed #cbd5e1;
    }
    .tongue-text-title {
      font-size: 12px;
      font-weight: 700;
      color: #334155;
      margin-bottom: 4px;
    }
    .md-heading {
      font-size: 13px;
      font-weight: 700;
      color: #1f2937;
      margin: 4px 0;
    }
    .md-bullet {
      font-size: 12px;
      line-height: 1.6;
      color: #374151;
      margin: 2px 0;
      padding-left: 2px;
    }
    .md-paragraph {
      font-size: 12px;
      line-height: 1.65;
      color: #374151;
      margin: 2px 0;
      text-indent: 2em;
    }
    .disclaimer {
      font-size: 11px;
      color: #b45309;
      background: #fffbeb;
      border: 1px solid #fcd34d;
      padding: 8px 10px;
      border-radius: 6px;
      margin: 0 0 10px;
      page-break-after: avoid;
      break-after: avoid-page;
    }
    .body-text {
      text-align: justify;
      white-space: normal;
      word-break: break-word;
      orphans: 3;
      widows: 3;
    }
    .ai-heading {
      font-size: 15px;
      font-weight: 700;
      color: #1f2937;
      margin: 10px 0 6px;
    }
    .ai-bullet {
      font-size: 13px;
      line-height: 1.65;
      color: #374151;
      margin: 2px 0;
      padding-left: 4px;
    }
    .ai-paragraph {
      margin: 0 0 8px;
      text-indent: 2em;
      line-height: 1.7;
    }
    .muted {
      color: #777;
      font-size: 12px;
      page-break-after: avoid;
      break-after: avoid-page;
    }
    .rec-list { margin: 8px 0 0; padding-left: 20px; }
    .rec-list li { margin-bottom: 6px; }
    .footer {
      margin-top: 28px;
      padding-top: 12px;
      border-top: 1px solid #eee;
      font-size: 11px;
      color: #888;
      page-break-inside: avoid;
      break-inside: avoid-page;
    }
  </style>
</head>
<body>
  <h1>健康报告 · ${escapeHtml(period)}</h1>
  <div class="meta">
    用户名：${escapeHtml(displayName)}<br/>
    报告生成时间：${escapeHtml(generated)}
  </div>

  <section class="section">
    <h2>健康评分</h2>
    <p class="score-row">${escapeHtml(String(report.healthScore))} / 100</p>
  </section>

  <section class="section">
    <h2>数据概览</h2>
    <table class="overview-table">
      <tr><th>身高</th><td>${fmtBodyMetric(report.heightCm, 'cm')}</td></tr>
      <tr><th>体重</th><td>${fmtBodyMetric(report.weightKg, 'kg')}</td></tr>
      <tr><th>BMI</th><td>${fmtBmi(report.bmi)}</td></tr>
      <tr><th>平均心率</th><td>${escapeHtml(String(report.avgHeartRate))} bpm</td></tr>
      <tr><th>平均血糖</th><td>${escapeHtml(String(report.avgBloodGlucose))} mmol/L</td></tr>
      <tr><th>平均睡眠</th><td>${escapeHtml(String(report.avgSleep))} 小时</td></tr>
      <tr><th>平均深睡</th><td>${fmtSleepStageHour(ss.deep)}</td></tr>
      <tr><th>平均浅睡</th><td>${fmtSleepStageHour(ss.light)}</td></tr>
      <tr><th>平均 REM</th><td>${fmtSleepStageHour(ss.rem)}</td></tr>
      <tr><th>平均清醒</th><td>${fmtSleepStageHour(ss.awake)}</td></tr>
      <tr><th>管理药品数</th><td>${escapeHtml(String(report.medicineCount ?? 0))}</td></tr>
    </table>
  </section>

  <section class="section">
    <h2>趋势折线图</h2>
    ${svgHr}
    ${buildTrendInsightHtml(trendInsights.heartRate, 'bpm', true, '心率分析')}
    ${svgBg}
    ${buildTrendInsightHtml(trendInsights.bloodGlucose, 'mmol/L', false, '血糖分析')}
    ${svgSl}
    ${buildTrendInsightHtml(trendInsights.sleep, '小时', false, '睡眠分析')}
  </section>
  ${tongueBlock}

  ${aiAnalysisHtml}
  ${adviceBlock}

  <div class="footer">
    本报告由应用根据您的本地健康数据汇总生成。涉及诊疗决策请以医疗机构意见为准。
  </div>
</body>
</html>`;
}

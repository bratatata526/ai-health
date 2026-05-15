/**
 * 清洗健康建议等长文模型输出：缓解小模型复读、标点刷屏、数字格式异常等问题。
 */

const TAB_NAV_LABELS = new Set(['首页', '药品', '设备', 'AI助手', '报告']);
const ALLOWED_ASCII_WORDS = new Set([
  'AI',
  'APP',
  'OCR',
  'bpm',
  'mmol',
  'mmol/L',
  'h',
  'kg',
  'ml',
]);

/**
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeHealthAdviceText(raw) {
  if (raw == null || typeof raw !== 'string') return '';
  let s = raw.trim();
  if (!s) return '';

  // 模型偶把「百分比」复述成 「2%%%」：压缩为单个 %
  s = s.replace(/％/g, '%');
  s = s.replace(/(\d+(?:\.\d+)?)\s*%+/g, '$1%');

  // 统一中文全角冒号，便于后续时间规范化（6：3 / 6：03）
  s = s.replace(/：/g, ':');
  // 规范时间写法：H:MM 或 H:M -> HH:MM
  s = s.replace(/\b(\d{1,2})\s*:\s*(\d{1,2})\b/g, (full, h, m) => {
    const hh = Number(h);
    const mm = Number(m);
    if (
      !Number.isFinite(hh) ||
      !Number.isFinite(mm) ||
      hh < 0 ||
      hh > 23 ||
      mm < 0 ||
      mm > 59
    ) {
      return full;
    }
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  });

  // 修复异常中文日期：例如「52年5月1日」这类疑似拼接错误，降级为「5月1日」
  s = s.replace(/(^|[^\d])(\d{1,3})年(\d{1,2})月(\d{1,2})日/g, (full, prefix, y, mo, d) => {
    const yy = Number(y);
    const mm = Number(mo);
    const dd = Number(d);
    if (
      Number.isFinite(yy) &&
      Number.isFinite(mm) &&
      Number.isFinite(dd) &&
      mm >= 1 &&
      mm <= 12 &&
      dd >= 1 &&
      dd <= 31 &&
      yy < 1900
    ) {
      return `${prefix}${mm}月${dd}日`;
    }
    return full;
  });
  // 重复「月月」常见于模型复读/串台，先折叠为单个「月」
  s = s.replace(/月{2,}/g, '月');
  // 形如「226年月15日」：年份明显异常且月份缺失，降级为「当前月15日」
  s = s.replace(/(^|[^\d])(\d{1,3})年\s*月\s*(\d{1,2})日/g, (full, prefix, y, d) => {
    const yy = Number(y);
    const dd = Number(d);
    const fallbackMonth = new Date().getMonth() + 1;
    if (
      Number.isFinite(yy) &&
      Number.isFinite(dd) &&
      yy < 1900 &&
      dd >= 1 &&
      dd <= 31
    ) {
      return `${prefix}${fallbackMonth}月${dd}日`;
    }
    return full;
  });

  // 「（52:55日）」「12:30日」等：非法「时:分+日」或不宜与「日」连用的时间串
  s = s.replace(/（\s*(\d{1,2}):(\d{2})\s*日\s*）/g, (_, h, mi) => {
    const hh = Number(h);
    const mm = Number(mi);
    if (
      Number.isFinite(hh) &&
      Number.isFinite(mm) &&
      hh >= 0 &&
      hh <= 23 &&
      mm >= 0 &&
      mm <= 59
    ) {
      return `（参考入眠时刻约 ${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}）`;
    }
    return '（最近一晚）';
  });
  s = s.replace(/(\d{1,3}):(\d{2})\s*日/g, (_, h, mi) => {
    const hh = Number(h);
    const mm = Number(mi);
    if (
      Number.isFinite(hh) &&
      Number.isFinite(mm) &&
      hh >= 0 &&
      hh <= 23 &&
      mm >= 0 &&
      mm <= 59
    ) {
      return `${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')} 当晚`;
    }
    return '最近一晚';
  });

  // 数字误写成 72..8 → 72.8
  s = s.replace(/(\d)\s*\.\.+\s*(\d+)/g, '$1.$2');

  // 模型偶发输出 Unicode 替换字符 �；结合常见中文上下文尽量修成自然表述
  s = s.replace(/平均�+(\d+(?:\.\d+)?\s*(?:小时|h|次\/分钟|mmol\/L)?)/gi, '平均约$1');
  s = s.replace(/约�+(\d+(?:\.\d+)?)/g, '约$1');
  s = s.replace(/�+/g, '');

  // 连成串的英文句点退化（常见于模型卡住）过长时收口
  s = s.replace(/\.{12,}/g, '……');

  // 中文逗号或顿号三连以上
  s = s.replace(/[，,、]{4,}/g, '，');
  // 连续双逗号/多逗号
  s = s.replace(/[，,]\s*[，,]+/g, '，');
  // 修复「，。」/「,。」等不自然标点衔接
  s = s.replace(/[，,]\s*[。\.]/g, '。');
  // 中文句号连写
  s = s.replace(/[。\.]{3,}/g, '。');
  // 中英文标点连续重复（保留省略号逻辑在后续）
  s = s.replace(/([，。！？；：,.!?;:、])\1{1,}/g, '$1');
  // 去掉 markdown 粗体符号，防止残留 *
  s = s.replace(/\*\*(.*?)\*\*/g, '$1');
  // 去掉 markdown 斜体符号（短文本包裹）
  s = s.replace(/\*([^\*\n]{1,60})\*/g, '$1');
  // 去掉孤立 *（非乘法场景）
  s = s.replace(/(^|\s)\*(?=\S)/g, '$1');
  // 去掉中文词后意外残留的单个 *
  s = s.replace(/([\u4e00-\u9fa5A-Za-z0-9])\*/g, '$1');

  // 去掉混入中文回答中的无关外文词（如 "verwenden"），保留常见医学单位词。
  s = s.replace(/\b([A-Za-z][A-Za-z\/]{2,})\b/g, (full, word, offset, input) => {
    if (ALLOWED_ASCII_WORDS.has(word)) return full;
    const prev = input[offset - 1] || '';
    const next = input[offset + full.length] || '';
    const nearChinese = /[\u4e00-\u9fa5]/.test(prev) || /[\u4e00-\u9fa5]/.test(next);
    if (nearChinese) return '';
    return full;
  });

  // 重复短语：如“变化变化”“建议建议”
  s = s.replace(/([\u4e00-\u9fa5]{2,6})(?:\1){1,}/g, '$1');

  // 清理常见句尾残缺连接词
  s = s.replace(/[，,]?\s*(同时|另外|并且|且)\s*$/g, '。');
  // 清理串台角色行与误注入续写词
  s = s.replace(/^\s*(user|assistant|system)\s*$/gim, '');
  s = s.replace(/^\s*继续\s*$/gim, '');

  // 「解析」等小词灾难性复读；极端情况整块截断前文
  s = stripRunawayJiexiBlock(s);

  let jiexiCount = (s.match(/解析/g) || []).length;
  if (jiexiCount > 12) {
    const cut = s.search(/(?:解析){5}/);
    if (cut >= 80) {
      s = `${s.slice(0, cut).trim()}…\n（上文已截断异常重复内容。建议在良好网络下重新生成。）`;
      jiexiCount = (s.match(/解析/g) || []).length;
    }
  }

  if (jiexiCount > 25) {
    const cutEarly = s.indexOf('解析解析解析');
    if (cutEarly >= 60) {
      s = `${s.slice(0, cutEarly).trim()}…`;
    }
  }

  // 短语循环垃圾（兜底）
  s = truncateCyclicGarbage(s);

  // 去掉酷似底部 Tab 的被误粘贴进来的行尾
  s = stripTrailingTabNavLines(s);
  // 删除模型串台残片、孤立编号、重复标题与重复行
  s = cleanupStructureNoise(s);

  // 首尾空白再清一次
  s = s.replace(/\n{4,}/g, '\n\n\n').trim();

  return s;
}

function cleanupStructureNoise(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  const headingLastIndex = new Map();
  let lastContent = '';

  const norm = (line) => line.replace(/\s+/g, '').toLowerCase();
  const headingKey = (line) => {
    const t = line.trim();
    if (!t) return '';
    const noPrefix = t.replace(/^#{1,6}\s*/, '');
    if (/^[\u4e00-\u9fa5A-Za-z]{2,20}(分析|建议|提示|总结|结论)$/.test(noPrefix)) return noPrefix;
    return '';
  };

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const t = rawLine.trim();
    const next = (lines[i + 1] || '').trim();
    const prevKept = (out[out.length - 1] || '').trim();

    // 清理对话角色串台（含引号/冒号变体）
    if (/^['"`‘’“”]?\s*(user|assistant|system)\s*[:：]?\s*['"`‘’“”]?$/i.test(t)) continue;
    // 清理孤立条目符号
    if (/^[-*•·]\s*$/.test(t)) continue;
    // 清理无语义单行编号（常见模型崩溃残片）
    if (/^\d{1,2}$/.test(t)) {
      if (!prevKept || !next || /^#{1,6}\s*/.test(next) || /^[\u4e00-\u9fa5A-Za-z]{2,20}(分析|建议|提示|总结|结论)$/.test(next)) {
        continue;
      }
    }

    const hk = headingKey(t);
    if (hk) {
      const lastIdx = headingLastIndex.get(hk);
      // 同一标题在极短间隔重复，跳过后续副本
      if (typeof lastIdx === 'number' && out.length - lastIdx <= 4) continue;
      headingLastIndex.set(hk, out.length);
    }

    // 邻近重复行去重
    const n = norm(t);
    if (n && n === norm(lastContent)) continue;

    out.push(rawLine.replace(/\s+$/g, ''));
    if (t) lastContent = t;
  }

  return out.join('\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

/**
 * 去掉末尾仅含底部导航文案的行（模型偶发复读界面文字）
 */
function stripTrailingTabNavLines(text) {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim();
    if (last === '' || TAB_NAV_LABELS.has(last)) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join('\n').trimEnd();
}

/** 整块「解析解析…」常见于模型尾部崩溃，整块删除并从首处截断前文 */
function stripRunawayJiexiBlock(text) {
  const m = /(?:解析){80,}/.exec(text);
  if (m && m.index > 120) {
    return text.slice(0, m.index).trimEnd();
  }
  return text.replace(/(?:解析){4,}/g, '').replace(/解析解析解析+/g, '');
}

/**
 * 检测「短语+短语+…」的循环垃圾（长度可变的解析循环等）
 */
function truncateCyclicGarbage(text) {
  if (text.length < 400) return text;
  for (let len = 120; len >= 16; len -= 4) {
    const frag = text.slice(-len);
    const half = Math.floor(len / 2);
    if (half < 12) continue;
    if (frag.slice(0, half) === frag.slice(half)) {
      const cut = text.length - len;
      if (cut > 160) return `${text.slice(0, cut).trim()}……`;
      break;
    }
  }
  return text;
}

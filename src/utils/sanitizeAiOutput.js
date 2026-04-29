/**
 * 清洗健康建议等长文模型输出：缓解小模型复读、标点刷屏、数字格式异常等问题。
 */

const TAB_NAV_LABELS = new Set(['首页', '药品', '设备', 'AI助手', '报告']);

/**
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeHealthAdviceText(raw) {
  if (raw == null || typeof raw !== 'string') return '';
  let s = raw.trim();
  if (!s) return '';

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

  // 首尾空白再清一次
  s = s.replace(/\n{4,}/g, '\n\n\n').trim();

  return s;
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

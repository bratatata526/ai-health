/**
 * Web：不打进 NotoSansSC 的静态 .ttf，避免部分环境下 bundler/runner 报错导致整张页面白屏。
 * 正文/标题字形走 theme 里的 CSS font-family 栈（微软雅黑等为系统字）。
 */
export const optionalAppFonts = {};

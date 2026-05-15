import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@personalized_advice_cache';

/**
 * 按报告周期分别缓存「个性化健康建议」：周 / 月 各一份，供报告页与 PDF 导出复用。
 */
export class PersonalizedAdviceCache {
  /** @param {'week'|'month'} [scope] */
  static async get(scope = 'week') {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.version === 2 && parsed?.byScope?.[scope]) {
        const entry = parsed.byScope[scope];
        if (entry && typeof entry.text === 'string') return entry;
      }
      // v1：单条缓存 → 仅迁移到「周」侧，月报需重新生成
      if (parsed && typeof parsed.text === 'string' && !parsed.version) {
        const text = parsed.text.trim();
        const updatedAt = Number(parsed.updatedAt) || Date.now();
        if (text) {
          await AsyncStorage.setItem(
            KEY,
            JSON.stringify({
              version: 2,
              byScope: {
                week: { text, updatedAt },
              },
            })
          );
          if (scope === 'week') return { text, updatedAt };
        }
        return null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * @param {string} text
   * @param {'week'|'month'} [scope]
   */
  static async set(text, scope = 'week') {
    let byScope = {};
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const o = raw ? JSON.parse(raw) : null;
      if (o?.version === 2 && o.byScope && typeof o.byScope === 'object') {
        byScope = { ...o.byScope };
      }
    } catch {
      byScope = {};
    }
    byScope[scope] = { text: text || '', updatedAt: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify({ version: 2, byScope }));
  }

  static async clear() {
    await AsyncStorage.removeItem(KEY);
  }
}

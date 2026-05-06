import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@personalized_advice_cache';

/**
 * 缓存 AI 助手「建议」页生成的个性化建议，供报告页展示与 PDF 导出复用。
 */
export class PersonalizedAdviceCache {
  static async get() {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.text === 'string') return parsed;
      return null;
    } catch {
      return null;
    }
  }

  /** @param {string} text */
  static async set(text) {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ text: text || '', updatedAt: Date.now() })
    );
  }

  static async clear() {
    await AsyncStorage.removeItem(KEY);
  }
}

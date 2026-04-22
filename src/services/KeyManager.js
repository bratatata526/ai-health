import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CryptoJS from 'crypto-js';

/** SecureStore 键名只能包含字母数字和 . - _，不能含 @ */
const ENCRYPTION_KEY_SECURE = 'ai_health.encryption_key_v1';
/** AsyncStorage 备份键（可与 SecureStore 同名逻辑区分） */
const ENCRYPTION_KEY_ASYNC = 'ai_health_encryption_key_async_v1';
/** 旧版误用的键名（含 @，SecureStore 非法；可能落在 AsyncStorage） */
const ENCRYPTION_KEY_LEGACY_ASYNC = '@encryption_key';

const KEY_LENGTH = 32;

/**
 * 密钥管理服务
 * 负责生成、存储和管理加密密钥
 */
export class KeyManager {
  /**
   * 生成随机加密密钥（AES-256，32 字节 → 64 字符 hex）
   * 需在入口最先执行：import 'react-native-get-random-values'（见 App.js）
   */
  static async generateKeyAsync() {
    const randomBytes = CryptoJS.lib.WordArray.random(KEY_LENGTH);
    return randomBytes.toString(CryptoJS.enc.Hex);
  }

  /**
   * 获取或创建加密密钥
   * 优先使用安全存储，如果不可用则使用 AsyncStorage
   */
  static async getOrCreateKey() {
    try {
      let key = null;

      if (Platform.OS !== 'web') {
        try {
          key = await SecureStore.getItemAsync(ENCRYPTION_KEY_SECURE);
        } catch (error) {
          console.log('SecureStore 读取密钥跳过:', error?.message || error);
        }
      }

      if (!key) {
        key = await AsyncStorage.getItem(ENCRYPTION_KEY_ASYNC);
      }

      if (!key) {
        const legacy = await AsyncStorage.getItem(ENCRYPTION_KEY_LEGACY_ASYNC);
        if (legacy) {
          key = legacy;
          await this.saveKey(key);
          await AsyncStorage.removeItem(ENCRYPTION_KEY_LEGACY_ASYNC);
        }
      }

      if (!key) {
        key = await this.generateKeyAsync();
        await this.saveKey(key);
      }

      return key;
    } catch (error) {
      console.error('获取加密密钥失败:', error);
      return await this.generateKeyAsync();
    }
  }

  /**
   * 保存加密密钥
   */
  static async saveKey(key) {
    if (!key) throw new Error('加密密钥为空');

    if (Platform.OS !== 'web') {
      try {
        await SecureStore.setItemAsync(ENCRYPTION_KEY_SECURE, key);
      } catch (error) {
        console.log('SecureStore 保存失败，仅使用 AsyncStorage:', error?.message || error);
      }
    }

    await AsyncStorage.setItem(ENCRYPTION_KEY_ASYNC, key);
  }

  /**
   * 删除加密密钥（用于重置）
   */
  static async deleteKey() {
    try {
      if (Platform.OS !== 'web') {
        try {
          await SecureStore.deleteItemAsync(ENCRYPTION_KEY_SECURE);
        } catch (error) {
          console.log('SecureStore 删除失败:', error?.message || error);
        }
      }
      await AsyncStorage.multiRemove([
        ENCRYPTION_KEY_ASYNC,
        ENCRYPTION_KEY_LEGACY_ASYNC,
      ]);
    } catch (error) {
      console.error('删除加密密钥失败:', error);
    }
  }

  /**
   * 检查密钥是否存在
   */
  static async hasKey() {
    try {
      if (Platform.OS !== 'web') {
        try {
          const k = await SecureStore.getItemAsync(ENCRYPTION_KEY_SECURE);
          if (k) return true;
        } catch {
          // ignore
        }
      }
      const a = await AsyncStorage.getItem(ENCRYPTION_KEY_ASYNC);
      if (a) return true;
      const legacy = await AsyncStorage.getItem(ENCRYPTION_KEY_LEGACY_ASYNC);
      return legacy !== null;
    } catch (error) {
      return false;
    }
  }
}

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CryptoJS from 'crypto-js';

/** SecureStore 仅允许 [A-Za-z0-9._-]，不能使用 @ 前缀 */
const ENCRYPTION_KEY_STORAGE = 'aihealth_user_aes_key_v1';
/** 旧版曾用，仅从 AsyncStorage 迁移读取 */
const ENCRYPTION_KEY_LEGACY = '@encryption_key';
const KEY_LENGTH = 32; // AES-256需要32字节（256位）密钥

/**
 * 密钥管理服务
 * 负责生成、存储和管理加密密钥
 */
export class KeyManager {
  /**
   * 生成随机加密密钥
   */
  static generateKey() {
    // 生成32字节的随机密钥（256位）
    const randomBytes = CryptoJS.lib.WordArray.random(KEY_LENGTH);
    return randomBytes.toString(CryptoJS.enc.Hex);
  }

  /**
   * 获取或创建加密密钥
   * 优先使用安全存储，如果不可用则使用AsyncStorage
   */
  static async getOrCreateKey() {
    try {
      let key = null;

      // 尝试从安全存储获取
      if (Platform.OS !== 'web') {
        try {
          key = await SecureStore.getItemAsync(ENCRYPTION_KEY_STORAGE);
        } catch (error) {
          console.log('SecureStore不可用，使用AsyncStorage:', error);
        }
      }

      // 如果安全存储不可用或没有密钥，尝试从 AsyncStorage 获取
      if (!key) {
        key = await AsyncStorage.getItem(ENCRYPTION_KEY_STORAGE);
      }
      if (!key) {
        const legacy = await AsyncStorage.getItem(ENCRYPTION_KEY_LEGACY);
        if (legacy) {
          key = legacy;
          await AsyncStorage.setItem(ENCRYPTION_KEY_STORAGE, key);
        }
      }

      // 如果仍然没有密钥，生成新密钥并保存
      if (!key) {
        key = this.generateKey();
        await this.saveKey(key);
      }

      return key;
    } catch (error) {
      console.error('获取加密密钥失败:', error);
      // 如果所有方法都失败，生成临时密钥（不持久化）
      return this.generateKey();
    }
  }

  /**
   * 保存加密密钥
   */
  static async saveKey(key) {
    try {
      // 优先使用安全存储
      if (Platform.OS !== 'web') {
        try {
          await SecureStore.setItemAsync(ENCRYPTION_KEY_STORAGE, key);
          return;
        } catch (error) {
          console.log('SecureStore保存失败，使用AsyncStorage:', error);
        }
      }

      await AsyncStorage.setItem(ENCRYPTION_KEY_STORAGE, key);
    } catch (error) {
      console.error('保存加密密钥失败:', error);
      throw error;
    }
  }

  /**
   * 删除加密密钥（用于重置）
   */
  static async deleteKey() {
    try {
      if (Platform.OS !== 'web') {
        try {
          await SecureStore.deleteItemAsync(ENCRYPTION_KEY_STORAGE);
        } catch (error) {
          console.log('SecureStore删除失败:', error);
        }
      }
      await AsyncStorage.multiRemove([ENCRYPTION_KEY_STORAGE, ENCRYPTION_KEY_LEGACY]);
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
          const k = await SecureStore.getItemAsync(ENCRYPTION_KEY_STORAGE);
          if (k) return true;
        } catch (error) {
          // 忽略错误，继续检查AsyncStorage
        }
      }
      if (await AsyncStorage.getItem(ENCRYPTION_KEY_STORAGE)) return true;
      return (await AsyncStorage.getItem(ENCRYPTION_KEY_LEGACY)) !== null;
    } catch (error) {
      return false;
    }
  }
}


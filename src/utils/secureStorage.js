import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { EncryptionService } from '../services/EncryptionService';

/**
 * 轻量变更通知（用于自动云同步等场景）
 * 只通知 key/action，不携带 value（避免大对象复制与敏感数据泄漏）
 */
const _listeners = new Set();
function _notifyChange(evt) {
  for (const fn of _listeners) {
    try {
      fn?.(evt);
    } catch (e) {
      // 避免监听者异常影响主流程
      console.warn('SecureStorage listener error:', e);
    }
  }
}

/**
 * 敏感数据存储键列表
 * 这些键对应的数据会被加密存储
 */
const SENSITIVE_KEYS = [
  '@medicines',           // 药品信息
  '@health_data',         // 健康数据
  '@devices',             // 设备信息
  '@baidu_ocr_token',     // OCR Token（虽然不是健康数据，但也应该加密）
  '@medicine_reminders',  // 用药提醒计划与状态
  '@medicine_intake_logs', // 服药打卡/漏服记录
  '@auth_token',           // 云端登录token
  '@user_profile',         // 用户资料
  '@cloud_sync_meta'       // 云同步元数据（revision/updatedAt）
];

/**
 * 判断是否为敏感数据键
 */
function isSensitiveKey(key) {
  return SENSITIVE_KEYS.some(sensitiveKey => key.startsWith(sensitiveKey));
}

/**
 * 安全存储服务
 * 对敏感数据进行加密存储，非敏感数据正常存储
 */
export const SecureStorage = {
  /**
   * 订阅存储变更
   * @param {(evt:{action:'set'|'remove'|'clear', key?:string}) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    _listeners.add(listener);
    return () => _listeners.delete(listener);
  },

  /**
   * 获取存储项
   * 如果是敏感数据，会自动解密
   */
  async getItem(key) {
    try {
      const value = await AsyncStorage.getItem(key);
      
      if (!value) {
        return null;
      }

      // 如果是敏感数据，尝试解密
      if (isSensitiveKey(key)) {
        try {
          // 先尝试解析JSON（可能是未加密的旧数据）
          try {
            const parsed = JSON.parse(value);
            // 如果解析成功且是对象，说明可能是未加密的旧数据
            // 为了兼容性，先返回旧数据，下次保存时会自动加密
            return parsed;
          } catch {
            // 不是JSON，可能是加密数据，尝试解密
            const decrypted = await EncryptionService.decrypt(value);
            if (decrypted == null || decrypted === '') {
              throw new Error('decrypt_unavailable');
            }
            return JSON.parse(decrypted);
          }
        } catch (error) {
          // 解密失败或密文用旧密钥加密，尝试当明文 JSON（兼容未加密老数据）
          if (__DEV__ && !String(error?.message || '').includes('decrypt_unavailable')) {
            console.warn(`敏感数据读失败，尝试直接解析: ${key}`);
          }
          try {
            return JSON.parse(value);
          } catch {
            // 密文/损坏数据无法当 JSON 解析，勿返回原字符串（会导致调用方把字符串当对象用）
            if (isSensitiveKey(key)) {
              return null;
            }
            return value;
          }
        }
      }

      // 非敏感数据，直接解析JSON
      return JSON.parse(value);
    } catch (error) {
      console.error('读取存储失败:', error);
      return null;
    }
  },

  /**
   * 设置存储项
   * 如果是敏感数据，会自动加密
   */
  async setItem(key, value, options = {}) {
    try {
      let stringValue;

      // 如果是敏感数据，先加密再存储
      if (isSensitiveKey(key)) {
        try {
          // 将对象转换为JSON字符串
          const jsonString = JSON.stringify(value);
          // 加密后存储
          stringValue = await EncryptionService.encrypt(jsonString);
        } catch (error) {
          console.error('加密存储失败:', error);
          // 如果加密失败，降级为普通存储（不推荐，但保证功能可用）
          stringValue = JSON.stringify(value);
        }
      } else {
        // 非敏感数据，直接序列化
        stringValue = JSON.stringify(value);
      }

      await AsyncStorage.setItem(key, stringValue);
      if (!options?.silent) _notifyChange({ action: 'set', key });
      return true;
    } catch (error) {
      console.error('保存存储失败:', error);
      return false;
    }
  },

  /**
   * 删除存储项
   */
  async removeItem(key, options = {}) {
    try {
      await AsyncStorage.removeItem(key);
      if (!options?.silent) _notifyChange({ action: 'remove', key });
      return true;
    } catch (error) {
      console.error('删除存储失败:', error);
      return false;
    }
  },

  /**
   * 清空所有存储
   */
  async clear(options = {}) {
    try {
      await AsyncStorage.clear();
      if (!options?.silent) _notifyChange({ action: 'clear' });
      return true;
    } catch (error) {
      console.error('清空存储失败:', error);
      return false;
    }
  },

  /**
   * 获取所有键
   */
  async getAllKeys() {
    try {
      return await AsyncStorage.getAllKeys();
    } catch (error) {
      console.error('获取所有键失败:', error);
      return [];
    }
  },

  /**
   * 批量获取多个键的值
   */
  async multiGet(keys) {
    try {
      const items = await AsyncStorage.multiGet(keys);
      const result = {};

      for (const [key, value] of items) {
        if (value) {
          try {
            // 如果是敏感数据，尝试解密
            if (isSensitiveKey(key)) {
              try {
                const decrypted = await EncryptionService.decrypt(value);
                if (decrypted != null && decrypted !== '') {
                  result[key] = JSON.parse(decrypted);
                } else {
                  try {
                    result[key] = JSON.parse(value);
                  } catch {
                    /* 密文无法当 JSON */
                  }
                }
              } catch {
                try {
                  result[key] = JSON.parse(value);
                } catch {
                  /* 跳过损坏项 */
                }
              }
            } else {
              result[key] = JSON.parse(value);
            }
          } catch {
            result[key] = value;
          }
        }
      }

      return result;
    } catch (error) {
      console.error('批量获取存储失败:', error);
      return {};
    }
  },
};


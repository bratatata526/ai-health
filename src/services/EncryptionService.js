import CryptoJS from 'crypto-js';
import { KeyManager } from './KeyManager';

/**
 * 加密服务
 * 使用AES-256算法对敏感数据进行加密/解密
 */
export class EncryptionService {
  /**
   * 加密数据
   * @param {string} data - 要加密的数据（JSON字符串）
   * @returns {Promise<string>} 加密后的数据（base64编码）
   */
  static async encrypt(data) {
    try {
      if (!data) {
        return data;
      }

      // 获取加密密钥
      const key = await KeyManager.getOrCreateKey();

      // 使用AES-256-CBC模式加密
      const encrypted = CryptoJS.AES.encrypt(data, key, {
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      });

      // 返回base64编码的加密数据
      return encrypted.toString();
    } catch (error) {
      console.error('加密失败:', error);
      throw new Error('数据加密失败');
    }
  }

  /**
   * 解密数据
   * @param {string} encryptedData - 加密的数据（base64编码）
   * @returns {Promise<string>} 解密后的原始数据（JSON字符串）
   */
  static async decrypt(encryptedData) {
    if (encryptedData == null || encryptedData === '') {
      return encryptedData;
    }
    if (typeof encryptedData !== 'string' || encryptedData.length < 20) {
      return encryptedData;
    }

    try {
      const key = await KeyManager.getOrCreateKey();
      const decrypted = CryptoJS.AES.decrypt(encryptedData, key, {
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      });

      let decryptedString;
      try {
        decryptedString = decrypted.toString(CryptoJS.enc.Utf8);
      } catch {
        // 密钥与密文不匹配或密文损坏时，解密结果常无法转为合法 UTF-8（Malformed UTF-8 data）
        return null;
      }

      if (!decryptedString || !decryptedString.trim()) {
        return null;
      }

      return decryptedString;
    } catch (error) {
      const msg = String(error?.message ?? error);
      if (msg.includes('Malformed UTF-8') || msg.includes('UTF-8')) {
        return null;
      }
      return null;
    }
  }

  /**
   * 加密对象（自动序列化为JSON）
   * @param {any} obj - 要加密的对象
   * @returns {Promise<string>} 加密后的数据
   */
  static async encryptObject(obj) {
    try {
      const jsonString = JSON.stringify(obj);
      return await this.encrypt(jsonString);
    } catch (error) {
      console.error('加密对象失败:', error);
      throw error;
    }
  }

  /**
   * 解密对象（自动反序列化JSON）
   * @param {string} encryptedData - 加密的数据
   * @returns {Promise<any>} 解密后的对象
   */
  static async decryptObject(encryptedData) {
    const decryptedString = await this.decrypt(encryptedData);
    if (decryptedString == null) {
      return null;
    }
    try {
      return JSON.parse(decryptedString);
    } catch (parseError) {
      return decryptedString;
    }
  }

  /**
   * 检查数据是否已加密
   * @param {string} data - 要检查的数据
   * @returns {boolean} 是否为加密数据
   */
  static isEncrypted(data) {
    if (!data || typeof data !== 'string') {
      return false;
    }
    // 加密数据通常是base64格式，长度较长且符合base64特征
    // 简单检查：长度大于20且只包含base64字符
    const base64Pattern = /^[A-Za-z0-9+/=]+$/;
    return data.length > 20 && base64Pattern.test(data);
  }
}


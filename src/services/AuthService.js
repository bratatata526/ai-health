import { CLOUD_CONFIG } from '../config/cloud';
import { PersonalizedAdviceCache } from './PersonalizedAdviceCache';
import { SecureStorage } from '../utils/secureStorage';

const AUTH_TOKEN_KEY = '@auth_token';
const USER_PROFILE_KEY = '@user_profile';

async function httpJson(path, { method = 'GET', token, body } = {}) {
  const url = `${CLOUD_CONFIG.BASE_URL}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // Web 常见：TypeError: Failed to fetch（云端服务未启动/地址不通/CORS）
    throw new Error(
      `无法连接云端服务：${CLOUD_CONFIG.BASE_URL}。请先启动云端：npm run cloud（并确保已安装依赖/端口可用）`
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export class AuthService {
  static async getToken() {
    return await SecureStorage.getItem(AUTH_TOKEN_KEY);
  }

  static async getProfile() {
    return await SecureStorage.getItem(USER_PROFILE_KEY);
  }

  static async mergeProfile(partialProfile = {}) {
    const currentProfile = (await this.getProfile()) || {};
    const nextProfile = {
      ...currentProfile,
      ...(partialProfile && typeof partialProfile === 'object' ? partialProfile : {}),
    };
    await SecureStorage.setItem(USER_PROFILE_KEY, nextProfile);
    return nextProfile;
  }

  static async isLoggedIn() {
    const token = await this.getToken();
    return Boolean(token);
  }

  static async register({ email, password, name }) {
    const result = await httpJson('/auth/register', {
      method: 'POST',
      body: { email, password, name },
    });
    await SecureStorage.setItem(AUTH_TOKEN_KEY, result.token);
    await SecureStorage.setItem(USER_PROFILE_KEY, result.profile);
    
    // 注册后清空本地业务数据（新用户应该从空白开始）
    await this.clearLocalData();
    
    return result.profile;
  }

  static async login({ email, password }) {
    const result = await httpJson('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    await SecureStorage.setItem(AUTH_TOKEN_KEY, result.token);
    await SecureStorage.setItem(USER_PROFILE_KEY, result.profile);
    
    // 登录后清空本地数据，然后从云端同步（确保用户数据隔离）
    await this.clearLocalData();
    
    return result.profile;
  }

  static async refreshProfile() {
    const token = await this.getToken();
    if (!token) throw new Error('未登录');
    const me = await httpJson('/me', { method: 'GET', token });
    await SecureStorage.setItem(USER_PROFILE_KEY, me);
    return me;
  }

  static async logout() {
    await SecureStorage.removeItem(AUTH_TOKEN_KEY);
    await SecureStorage.removeItem(USER_PROFILE_KEY);
    
    // 退出登录时清除所有本地业务数据（安全性 + 隐私保护）
    await this.clearLocalData();
  }

  // 清除所有本地业务数据（不包括 token 和 profile）
  static async clearLocalData() {
    const keysToRemove = [
      '@medicines',
      '@health_data',
      '@devices',
      '@medicine_reminders',
      '@medicine_intake_logs',
      '@tongue_analysis_history',
      '@ai_cache',
      '@cloud_meta',
    ];
    for (const key of keysToRemove) {
      await SecureStorage.removeItem(key, { silent: true });
    }
    await PersonalizedAdviceCache.clear();
  }

  static async changePassword({ oldPassword, newPassword }) {
    const token = await this.getToken();
    if (!token) throw new Error('未登录');
    await httpJson('/auth/password', {
      method: 'PUT',
      token,
      body: { oldPassword, newPassword },
    });
    return true;
  }

  static async deleteAccount() {
    const token = await this.getToken();
    if (!token) throw new Error('未登录');
    await httpJson('/me', { method: 'DELETE', token });
    await this.logout();
    return true;
  }
}



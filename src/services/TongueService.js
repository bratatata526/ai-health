import { Platform } from 'react-native';
import { TONGUE_API_CONFIG } from '../config/tongueApi';

const API_PREFIX = '/api/model';

function buildUrl(path) {
  return `${TONGUE_API_CONFIG.BASE_URL}${API_PREFIX}${path}`;
}

function formatHttpError(status, message) {
  if (status === 401 || status === 403) {
    return `舌诊服务鉴权失败（HTTP ${status}）：${message || '请检查服务端鉴权配置'}`;
  }
  if (status >= 500) {
    return `舌诊服务异常（HTTP ${status}）：${message || '请稍后重试'}`;
  }
  return message || `请求失败（HTTP ${status}）`;
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function request(path, { method = 'GET', body, timeoutMs = 30000 } = {}) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(buildUrl(path), {
      method,
      body,
      signal: controller?.signal,
    });
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      throw new Error(formatHttpError(response.status, payload?.message || payload?.error));
    }
    if (payload?.code !== 0) {
      throw new Error(payload?.message || '舌诊接口返回失败');
    }
    return payload.data;
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('Aborted')) {
      throw new Error('舌诊请求超时，请检查网络或稍后重试');
    }
    if (
      message.includes('Network request failed') ||
      message.includes('Failed to fetch') ||
      message.includes('Load failed')
    ) {
      throw new Error(`无法连接舌诊服务：${TONGUE_API_CONFIG.BASE_URL}`);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function toWebBlob(asset) {
  if (asset?.file) return asset.file;
  const response = await fetch(asset.uri);
  const blob = await response.blob();
  return blob;
}

function normalizeAsset(asset) {
  if (!asset?.uri) throw new Error('请选择舌象图片');
  return {
    uri: asset.uri,
    type: asset.mimeType || 'image/jpeg',
    name: asset.fileName || `tongue-${Date.now()}.jpg`,
    file: asset.file || null,
  };
}

export class TongueService {
  static async createTask(asset, userInput = '') {
    const normalized = normalizeAsset(asset);
    const formData = new FormData();

    if (Platform.OS === 'web') {
      const fileBlob = await toWebBlob(normalized);
      formData.append('file_data', fileBlob, normalized.name);
    } else {
      formData.append('file_data', {
        uri: normalized.uri,
        name: normalized.name,
        type: normalized.type,
      });
    }

    formData.append('user_input', userInput || '');
    return await request('/analyze', {
      method: 'POST',
      body: formData,
      timeoutMs: 60000,
    });
  }

  static async getTask(taskId) {
    if (!taskId) throw new Error('缺少任务ID');
    return await request(`/tasks/${taskId}`);
  }

  static async listTasks(limit = 20) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
    return await request(`/tasks?limit=${safeLimit}`);
  }

  static async deleteTask(taskId) {
    if (!taskId) throw new Error('缺少任务ID');
    return await request(`/tasks/${taskId}`, { method: 'DELETE' });
  }
}


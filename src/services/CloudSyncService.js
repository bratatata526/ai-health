import { SecureStorage } from '../utils/secureStorage';
import { AuthService } from './AuthService';
import { CLOUD_CONFIG } from '../config/cloud';

const CLOUD_META_KEY = '@cloud_sync_meta'; // { revision, updatedAt }

// 本项目目前的“用户数据快照”包含这些 key
const SNAPSHOT_KEYS = [
  '@medicines',
  '@health_data',
  '@devices',
  '@medicine_reminders',
  '@medicine_intake_logs',
  '@tongue_analysis_history',
];

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
    throw new Error(`无法连接云端服务：${CLOUD_CONFIG.BASE_URL}。请先启动 npm run cloud`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export class CloudSyncService {
  static async getCloudMeta() {
    return (await SecureStorage.getItem(CLOUD_META_KEY)) || null;
  }

  static async setCloudMeta(meta) {
    await SecureStorage.setItem(CLOUD_META_KEY, meta);
  }

  // 仅获取云端 revision/updatedAt 并写入本地 meta（不会覆盖本地数据）
  static async refreshCloudMeta() {
    const token = await AuthService.getToken();
    if (!token) throw new Error('未登录');
    const remote = await httpJson('/data', { method: 'GET', token });
    const meta = { revision: remote?.revision || null, updatedAt: remote?.updatedAt || null };
    await this.setCloudMeta(meta);
    return meta;
  }

  static async buildLocalSnapshot() {
    const snapshot = {};
    for (const key of SNAPSHOT_KEYS) {
      snapshot[key] = (await SecureStorage.getItem(key)) ?? null;
    }
    return snapshot;
  }

  static async applySnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    for (const key of SNAPSHOT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
        // 从云端下载应用到本地时，避免触发“自动上传”回写
        await SecureStorage.setItem(key, snapshot[key], { silent: true });
      }
    }
  }

  // 上传：把本地数据作为“当前用户”的云端快照（覆盖云端）
  static async syncUp() {
    const token = await AuthService.getToken();
    if (!token) throw new Error('未登录');
    const profile = await AuthService.getProfile();
    const snapshot = await this.buildLocalSnapshot();

    const meta = await this.getCloudMeta();
    const baseRevision = meta?.revision || null;

    const resp = await httpJson('/data', {
      method: 'PUT',
      token,
      body: { snapshot: { profile, data: snapshot }, baseRevision },
    });
    if (resp?.revision) {
      await this.setCloudMeta({ revision: resp.revision, updatedAt: resp.updatedAt || null });
    }
    return true;
  }

  // 强制上传：忽略冲突直接覆盖云端
  static async forceSyncUp() {
    const token = await AuthService.getToken();
    if (!token) throw new Error('未登录');
    const profile = await AuthService.getProfile();
    const snapshot = await this.buildLocalSnapshot();
    const resp = await httpJson('/data?force=1', {
      method: 'PUT',
      token,
      body: { snapshot: { profile, data: snapshot } },
    });
    if (resp?.revision) {
      await this.setCloudMeta({ revision: resp.revision, updatedAt: resp.updatedAt || null });
    }
    return true;
  }

  // 下载：把云端快照拉回本地（覆盖本地）
  static async syncDown() {
    const token = await AuthService.getToken();
    if (!token) throw new Error('未登录');
    const remote = await httpJson('/data', { method: 'GET', token });
    const remoteTopProfile = remote?.profile;
    const remoteSnapshotProfile = remote?.snapshot?.profile;
    const remoteProfile = (
      (remoteTopProfile && typeof remoteTopProfile === 'object')
      || (remoteSnapshotProfile && typeof remoteSnapshotProfile === 'object')
    )
      ? {
          ...(remoteTopProfile && typeof remoteTopProfile === 'object' ? remoteTopProfile : {}),
          ...(remoteSnapshotProfile && typeof remoteSnapshotProfile === 'object' ? remoteSnapshotProfile : {}),
        }
      : null;
    const remoteData = remote?.snapshot?.data || null;
    // 下载覆盖本地时，避免触发“自动上传”回写
    if (remoteProfile) await SecureStorage.setItem('@user_profile', remoteProfile, { silent: true });
    if (remoteData) await this.applySnapshot(remoteData);
    if (remote?.revision) {
      await this.setCloudMeta({ revision: remote.revision, updatedAt: remote.updatedAt || null });
    }
    return true;
  }
}



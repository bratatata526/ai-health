import { AppState } from 'react-native';
import { SecureStorage } from '../utils/secureStorage';
import { AuthService } from './AuthService';
import { CloudSyncService } from './CloudSyncService';

const WATCHED_PREFIXES = [
  '@medicines',
  '@health_data',
  '@devices',
  '@medicine_reminders',
  '@medicine_intake_logs',
  '@tongue_analysis_history',
  '@user_profile',
];

function isWatchedKey(key) {
  if (!key) return false;
  return WATCHED_PREFIXES.some((p) => String(key).startsWith(p));
}

const DEBOUNCE_MS = 2500;

/**
 * 自动云同步（自动上传）
 * - 当本地关键数据变更时触发
 * - 防抖合并多次写入
 * - 同一时刻只会有一个 syncUp 在飞行中
 * - 遇到 conflict 时会自动暂停（需要用户手动下载或强制覆盖后再恢复）
 */
export class AutoCloudSyncService {
  static _started = false;
  static _unsubscribeStorage = null;
  static _appStateSub = null;
  static _timer = null;

  static _dirty = false;
  static _inFlight = null;
  static _pending = false;
  static _blockedByConflict = false;

  static start() {
    if (this._started) return;
    this._started = true;

    this._unsubscribeStorage = SecureStorage.subscribe((evt) => {
      if (!evt) return;
      if (evt.action === 'clear') {
        this.markDirty();
        return;
      }
      if (evt.key && isWatchedKey(evt.key)) {
        this.markDirty();
      }
    });

    // 前台激活时，如果有脏数据，立刻尝试同步一次
    this._appStateSub = AppState.addEventListener?.('change', (state) => {
      if (state === 'active' && this._dirty) {
        this.schedule(true);
      }
    });
  }

  static stop() {
    this._started = false;
    try {
      this._unsubscribeStorage?.();
    } catch {
      // ignore
    }
    this._unsubscribeStorage = null;

    try {
      this._appStateSub?.remove?.();
    } catch {
      // ignore
    }
    this._appStateSub = null;

    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }

  static markDirty() {
    this._dirty = true;
    this.schedule(false);
  }

  static clearConflictBlock() {
    this._blockedByConflict = false;
  }

  static markSynced() {
    this._dirty = false;
    this._blockedByConflict = false;
  }

  static schedule(immediate = false) {
    if (this._blockedByConflict) return;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this.flush().catch(() => {});
    }, immediate ? 0 : DEBOUNCE_MS);
  }

  static async flush() {
    if (this._blockedByConflict) return false;
    if (!this._dirty) return false;

    const token = await AuthService.getToken();
    if (!token) return false;

    if (this._inFlight) {
      this._pending = true;
      return false;
    }

    this._inFlight = (async () => {
      try {
        await CloudSyncService.syncUp();
        this._dirty = false;
        return true;
      } catch (e) {
        const msg = String(e?.message || '');
        if (msg.includes('conflict')) {
          // 自动同步遇到冲突：暂停，避免不断重试/覆盖
          this._blockedByConflict = true;
          console.warn('Auto cloud sync blocked by conflict. Please sync down or force upload manually.');
        } else if (
          msg.includes('unauthorized') ||
          msg.includes('未登录') ||
          msg.includes('401')
        ) {
          // Token 失效或未授权：不刷屏，用户重新登录即可
        } else {
          console.warn('Auto cloud sync failed:', msg || e);
        }
        return false;
      } finally {
        this._inFlight = null;
        if (this._pending) {
          this._pending = false;
          if (this._dirty && !this._blockedByConflict) {
            this.schedule(true);
          }
        }
      }
    })();

    return await this._inFlight;
  }
}


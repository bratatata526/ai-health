/**
 * 实时心率异常提示（基于蓝牙心率流）
 * - 默认按「静息」常见参考区间告警，非医疗诊断
 * - 同类告警有冷却时间，避免每秒刷屏
 */

const listeners = new Set();

export function subscribeHeartRateAlerts(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitAlert(payload) {
  for (const fn of listeners) {
    try {
      fn(payload);
    } catch (e) {
      console.warn('心率告警订阅回调失败:', e);
    }
  }
}

export class HeartRateAlertMonitor {
  constructor() {
    /** 低于此值视为偏低（静息常见参考下限附近，非个体化医疗标准） */
    this.lowBpm = 50;
    /** 高于此值视为偏高 */
    this.highBpm = 120;
    /** 同类告警最小间隔（毫秒） */
    this.cooldownMs = 90_000;
    this._lastLowAt = 0;
    this._lastHighAt = 0;
  }

  reset() {
    this._lastLowAt = 0;
    this._lastHighAt = 0;
  }

  /**
   * @param {number} bpm
   * @returns {{ type: 'low'|'high', bpm: number, title: string, body: string, bubbleText: string } | null}
   */
  checkAndNotify(bpm) {
    const n = Number(bpm);
    if (!Number.isFinite(n) || n < 30 || n > 220) return null;

    const now = Date.now();
    let result = null;

    if (n < this.lowBpm) {
      if (now - this._lastLowAt >= this.cooldownMs) {
        this._lastLowAt = now;
        result = {
          type: 'low',
          bpm: n,
          title: '心率偏低',
          body:
            `当前心率约 ${Math.round(n)} 次/分，低于当前监测下限（${this.lowBpm} bpm）。\n` +
            '若感到头晕、胸闷或明显不适，请停止活动并休息；症状持续或加重请及时就医。',
          bubbleText:
            `当心率偏低：约 ${Math.round(n)} bpm\n` +
            `已低于监测阈值 ${this.lowBpm}。请休息观察，不适就医。\n（仅为健康提醒，不能代替诊疗）`,
        };
      }
    } else if (n > this.highBpm) {
      if (now - this._lastHighAt >= this.cooldownMs) {
        this._lastHighAt = now;
        result = {
          type: 'high',
          bpm: n,
          title: '心率偏高',
          body:
            `当前心率约 ${Math.round(n)} 次/分，高于当前监测上限（${this.highBpm} bpm）。\n` +
            '请安静休息、缓慢深呼吸；若胸痛、呼吸困难或心率持续不降，请及时就医。',
          bubbleText:
            `当心率偏高：约 ${Math.round(n)} bpm\n` +
            `已超过监测阈值 ${this.highBpm}。请放松休息，必要时就医。\n（仅为健康提醒，不能代替诊疗）`,
        };
      }
    }

    if (result) emitAlert(result);
    return result;
  }
}

export const heartRateAlertMonitor = new HeartRateAlertMonitor();

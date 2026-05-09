import { SecureStorage } from '../utils/secureStorage';

const DEVICES_KEY = '@devices';
const HEALTH_DATA_KEY = '@health_data';

function normalizeHeartRatePoint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const value = Number(raw.value);
  const ts = raw.date ? new Date(raw.date).getTime() : NaN;
  if (!Number.isFinite(value) || !Number.isFinite(ts)) return null;
  return { date: new Date(ts).toISOString(), value };
}

function buildMinuteAverageSeries(heartRateSeries) {
  const minuteBuckets = new Map();
  (heartRateSeries || []).forEach((item) => {
    const point = normalizeHeartRatePoint(item);
    if (!point) return;
    const d = new Date(point.date);
    d.setSeconds(0, 0);
    const minuteIso = d.toISOString();
    const existing = minuteBuckets.get(minuteIso) || { sum: 0, count: 0 };
    existing.sum += point.value;
    existing.count += 1;
    minuteBuckets.set(minuteIso, existing);
  });
  return Array.from(minuteBuckets.entries())
    .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
    .map(([date, bucket]) => ({
      date,
      value: Math.round((bucket.sum / bucket.count) * 10) / 10,
      sampleCount: bucket.count,
    }));
}

function migrateSleepEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const date = raw.date;
  if (!date) return null;
  let total = raw.totalHours != null ? Number(raw.totalHours) : NaN;
  if (!Number.isFinite(total)) total = Number(raw.value);
  if (!Number.isFinite(total)) total = 0;

  let deep = raw.deepHours != null ? Number(raw.deepHours) : NaN;
  let light = raw.lightHours != null ? Number(raw.lightHours) : NaN;
  let rem = raw.remHours != null ? Number(raw.remHours) : NaN;
  let awake = raw.awakeHours != null ? Number(raw.awakeHours) : NaN;

  if (!Number.isFinite(deep)) {
    deep = Math.round(total * 0.26 * 10) / 10;
    light = Math.round(total * 0.48 * 10) / 10;
    rem = Math.round(total * 0.18 * 10) / 10;
    awake = Math.round((total - deep - light - rem) * 10) / 10;
    if (awake < 0) awake = 0;
  } else {
    if (!Number.isFinite(light)) light = Math.max(0, total - deep - (rem || 0) - (awake || 0));
    if (!Number.isFinite(rem)) rem = Math.max(0, total - deep - light - (awake || 0));
    if (!Number.isFinite(awake)) awake = Math.max(0, total - deep - light - rem);
  }

  return {
    date,
    totalHours: Math.round(total * 10) / 10,
    deepHours: Math.round(deep * 10) / 10,
    lightHours: Math.round(light * 10) / 10,
    remHours: Math.round(rem * 10) / 10,
    awakeHours: Math.round(awake * 10) / 10,
  };
}

function migrateHealthPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { heartRate: [], heartRateMinuteAvg: [], bloodGlucose: [], sleep: [] };
  }
  const heartRate = Array.isArray(data.heartRate) ? data.heartRate : [];
  const heartRateMinuteAvg =
    Array.isArray(data.heartRateMinuteAvg) && data.heartRateMinuteAvg.length > 0
      ? data.heartRateMinuteAvg
      : buildMinuteAverageSeries(heartRate);
  const bloodGlucose = Array.isArray(data.bloodGlucose) ? data.bloodGlucose : [];
  const sleepRaw = Array.isArray(data.sleep) ? data.sleep : [];
  const sleep = sleepRaw.map(migrateSleepEntry).filter(Boolean);
  return { heartRate, heartRateMinuteAvg, bloodGlucose, sleep };
}

/**
 * 心率/血糖点序列：同一时刻（毫秒时间戳）只保留一条，后写入覆盖先写入；并合并历史中已存在的重复项。
 */
function mergePointSeriesByInstant(existing, incoming) {
  const map = new Map();
  const keyFor = (dateField) => {
    const t = new Date(dateField).getTime();
    if (Number.isFinite(t)) return `t:${t}`;
    return `raw:${String(dateField)}`;
  };
  const put = (item) => {
    if (!item || item.date == null) return;
    map.set(keyFor(item.date), item);
  };
  (existing || []).forEach(put);
  (incoming || []).forEach(put);
  return Array.from(map.values()).sort((a, b) => {
    const ta = new Date(a.date).getTime();
    const tb = new Date(b.date).getTime();
    if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
    return 0;
  });
}

export class DeviceService {
  static async getConnectedDevices() {
    try {
      const data = await SecureStorage.getItem(DEVICES_KEY);
      return data || [];
    } catch (error) {
      console.error('获取设备列表失败:', error);
      return [];
    }
  }

  static async addDevice(device) {
    try {
      const devices = await this.getConnectedDevices();
      devices.push(device);
      await SecureStorage.setItem(DEVICES_KEY, devices);
      return device;
    } catch (error) {
      console.error('添加设备失败:', error);
      throw error;
    }
  }

  static async addOrReplaceDevice(device) {
    try {
      const devices = await this.getConnectedDevices();
      const index = devices.findIndex((d) => d.id === device.id);
      if (index >= 0) {
        devices[index] = { ...devices[index], ...device };
      } else {
        devices.push(device);
      }
      await SecureStorage.setItem(DEVICES_KEY, devices);
      return device;
    } catch (error) {
      console.error('保存设备失败:', error);
      throw error;
    }
  }

  static async removeDevice(deviceId) {
    try {
      const devices = await this.getConnectedDevices();
      const filtered = devices.filter((d) => d.id !== deviceId);
      await SecureStorage.setItem(DEVICES_KEY, filtered);
    } catch (error) {
      console.error('移除设备失败:', error);
      throw error;
    }
  }

  static async getHealthData() {
    try {
      const data = await SecureStorage.getItem(HEALTH_DATA_KEY);
      if (data && typeof data === 'object' && !Array.isArray(data)
          && Array.isArray(data.heartRate)) {
        return migrateHealthPayload(data);
      }

      // 数据格式异常或不存在，生成模拟数据
      return this.generateMockData();
    } catch (error) {
      console.error('获取健康数据失败:', error);
      return this.generateMockData();
    }
  }

  static async updateHealthData(newData) {
    try {
      const existingData = migrateHealthPayload(await this.getHealthDataForStorage());

      existingData.heartRate = mergePointSeriesByInstant(
        existingData.heartRate,
        newData.heartRate
      );
      existingData.bloodGlucose = mergePointSeriesByInstant(
        existingData.bloodGlucose,
        newData.bloodGlucose
      );

      const incomingSleep = (newData.sleep || []).map(migrateSleepEntry).filter(Boolean);
      incomingSleep.forEach((s) => {
        const key = new Date(s.date).toDateString();
        const idx = existingData.sleep.findIndex(
          (x) => new Date(x.date).toDateString() === key
        );
        if (idx >= 0) {
          existingData.sleep[idx] = { ...existingData.sleep[idx], ...s };
        } else {
          existingData.sleep.push(s);
        }
      });

      // 只保留最近30天的数据
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      existingData.heartRate = existingData.heartRate.filter(
        (item) => new Date(item.date) >= thirtyDaysAgo
      );
      existingData.heartRateMinuteAvg = buildMinuteAverageSeries(existingData.heartRate).filter(
        (item) => new Date(item.date) >= thirtyDaysAgo
      );
      existingData.bloodGlucose = existingData.bloodGlucose.filter(
        (item) => new Date(item.date) >= thirtyDaysAgo
      );
      existingData.sleep = existingData.sleep.filter(
        (item) => new Date(item.date) >= thirtyDaysAgo
      );

      await SecureStorage.setItem(HEALTH_DATA_KEY, existingData);
      return migrateHealthPayload(existingData);
    } catch (error) {
      console.error('更新健康数据失败:', error);
      throw error;
    }
  }

  /** 读取存储中的原始数据（不返回未持久化的模拟数据） */
  static async getHealthDataForStorage() {
    try {
      const data = await SecureStorage.getItem(HEALTH_DATA_KEY);
      if (data && typeof data === 'object' && !Array.isArray(data)
          && Array.isArray(data.heartRate)) {
        return data;
      }
      return { heartRate: [], heartRateMinuteAvg: [], bloodGlucose: [], sleep: [] };
    } catch (error) {
      console.error('读取健康存储失败:', error);
      return { heartRate: [], heartRateMinuteAvg: [], bloodGlucose: [], sleep: [] };
    }
  }

  static generateMockData() {
    return this.generateDetailedMockData(30);
  }

  static generateDetailedMockData(days = 30) {
    const data = {
      heartRate: [],
      heartRateMinuteAvg: [],
      bloodGlucose: [],
      sleep: [],
    };

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      // 心率：每小时 2~6 条，制造更细趋势与异常样本
      for (let h = 0; h < 24; h++) {
        const n = 2 + Math.floor(Math.random() * 5);
        for (let k = 0; k < n; k++) {
          const t = new Date(date);
          t.setHours(h, Math.floor(Math.random() * 58), Math.floor(Math.random() * 59), 0);
          const dayShift = ((days - i) % 9) - 4;
          const base = 68 + (h / 24) * 7 + dayShift * 0.7 + (Math.random() * 14 - 4);
          let value = Math.max(48, Math.min(145, Math.round(base)));
          if (i % 8 === 0 && h >= 20 && h <= 22) value = Math.min(145, value + 18); // 偏高晚间
          if (i % 11 === 0 && h >= 2 && h <= 4) value = Math.max(45, value - 14); // 偏低夜间
          data.heartRate.push({
            date: t.toISOString(),
            value,
          });
        }
      }

      // 血糖：重点覆盖空腹、三餐后、睡前，便于日报分析
      [7, 10, 13, 16, 20, 22].forEach((h) => {
        const t = new Date(date);
        t.setHours(h, 5 + Math.floor(Math.random() * 35), 0, 0);
        let v = 4.6 + Math.sin((h / 24) * Math.PI) * 0.55 + Math.random() * 1.9 + (h >= 17 ? 0.4 : 0);
        if (i % 6 === 0 && h >= 20) v += 1.8; // 某些晚间偏高
        if (i % 10 === 0 && h === 7) v -= 1.1; // 某些清晨偏低
        data.bloodGlucose.push({
          date: t.toISOString(),
          value: Math.round(Math.min(11.2, Math.max(3.2, v)) * 10) / 10,
        });
      });

      // 睡眠：每晚一条，包含偶发不足和质量下降
      let total = Math.round((6.8 + Math.random() * 1.8) * 10) / 10;
      if (i % 7 === 0) total = Math.max(4.8, total - 1.6); // 睡眠不足日
      if (i % 13 === 0) total = Math.min(10.5, total + 1.2); // 睡眠过长日
      const deepRatio = i % 5 === 0 ? 0.16 + Math.random() * 0.04 : 0.21 + Math.random() * 0.08;
      const deep = Math.round(total * deepRatio * 10) / 10;
      const rem = Math.round(total * (0.15 + Math.random() * 0.07) * 10) / 10;
      const awake = Math.round((i % 9 === 0 ? 1.1 : 0.35 + Math.random() * 0.45) * 10) / 10;
      const light = Math.round((total - deep - rem - awake) * 10) / 10;
      data.sleep.push({
        date: date.toISOString(),
        totalHours: total,
        deepHours: deep,
        lightHours: Math.max(0, light),
        remHours: rem,
        awakeHours: awake,
      });
    }

    return migrateHealthPayload(data);
  }

  static async seedDetailedMockData(days = 30) {
    const payload = this.generateDetailedMockData(days);
    await SecureStorage.setItem(HEALTH_DATA_KEY, payload);
    return payload;
  }

  // 模拟实时数据更新
  static async syncDeviceData(deviceId) {
    try {
      const now = new Date();
      const newData = {
        heartRate: [],
        bloodGlucose: [],
        sleep: [],
      };

      // 根据设备类型生成相应数据
      const devices = await this.getConnectedDevices();
      const device = devices.find((d) => d.id === deviceId);

      if (!device) return;

      if (device.type === 'bracelet') {
        // 手环数据：心率、睡眠
        newData.heartRate.push({
          date: now.toISOString(),
          value: Math.floor(Math.random() * 30) + 65,
        });

        // 如果是晚上，更新睡眠数据
        if (now.getHours() >= 22 || now.getHours() < 6) {
          const today = new Date(now);
          today.setHours(0, 0, 0, 0);
          const total = Math.round((6.2 + Math.random() * 1.6) * 10) / 10;
          const deep = Math.round(total * 0.25 * 10) / 10;
          const rem = Math.round(total * 0.18 * 10) / 10;
          const awake = 0.4;
          const light = Math.round((total - deep - rem - awake) * 10) / 10;
          newData.sleep.push({
            date: today.toISOString(),
            totalHours: total,
            deepHours: deep,
            lightHours: Math.max(0, light),
            remHours: rem,
            awakeHours: awake,
          });
        }
      } else if (device.type === 'glucometer') {
        // 血糖仪数据
        newData.bloodGlucose.push({
          date: now.toISOString(),
          value: Math.round((Math.random() * 2 + 4) * 10) / 10,
        });
      }

      return await this.updateHealthData(newData);
    } catch (error) {
      console.error('同步设备数据失败:', error);
      throw error;
    }
  }
}


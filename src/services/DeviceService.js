import { SecureStorage } from '../utils/secureStorage';

const DEVICES_KEY = '@devices';
const HEALTH_DATA_KEY = '@health_data';

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
    return { heartRate: [], bloodGlucose: [], sleep: [] };
  }
  const heartRate = Array.isArray(data.heartRate) ? data.heartRate : [];
  const bloodGlucose = Array.isArray(data.bloodGlucose) ? data.bloodGlucose : [];
  const sleepRaw = Array.isArray(data.sleep) ? data.sleep : [];
  const sleep = sleepRaw.map(migrateSleepEntry).filter(Boolean);
  return { heartRate, bloodGlucose, sleep };
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

      existingData.heartRate.push(...(newData.heartRate || []));
      existingData.bloodGlucose.push(...(newData.bloodGlucose || []));

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
      return { heartRate: [], bloodGlucose: [], sleep: [] };
    } catch (error) {
      console.error('读取健康存储失败:', error);
      return { heartRate: [], bloodGlucose: [], sleep: [] };
    }
  }

  static generateMockData() {
    const data = {
      heartRate: [],
      bloodGlucose: [],
      sleep: [],
    };

    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      // 心率：每小时 1～3 条，便于 24 根细柱展示全天
      for (let h = 0; h < 24; h++) {
        const n = 1 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) {
          const t = new Date(date);
          t.setHours(h, Math.floor(Math.random() * 58), Math.floor(Math.random() * 59), 0);
          const base = 66 + (h / 24) * 8 + (Math.random() * 16 - 5);
          data.heartRate.push({
            date: t.toISOString(),
            value: Math.max(48, Math.min(135, Math.round(base))),
          });
        }
      }

      // 血糖：每小时约一条（略随机跳过若干小时更真实）
      for (let h = 0; h < 24; h++) {
        if (Math.random() < 0.12) continue;
        const t = new Date(date);
        t.setHours(h, 5 + Math.floor(Math.random() * 45), 0, 0);
        const v = 4.3 + Math.sin((h / 24) * Math.PI) * 0.6 + Math.random() * 2.2 + (h >= 17 ? 0.35 : 0);
        data.bloodGlucose.push({
          date: t.toISOString(),
          value: Math.round(Math.min(9.5, Math.max(3.5, v)) * 10) / 10,
        });
      }

      // 睡眠：每晚一条，含深睡/浅睡/REM/清醒
      const total = Math.round((6.2 + Math.random() * 1.6) * 10) / 10;
      const deep = Math.round(total * (0.22 + Math.random() * 0.08) * 10) / 10;
      const rem = Math.round(total * (0.16 + Math.random() * 0.06) * 10) / 10;
      const awake = Math.round((0.3 + Math.random() * 0.5) * 10) / 10;
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


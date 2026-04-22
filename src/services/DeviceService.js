import { SecureStorage } from '../utils/secureStorage';

const DEVICES_KEY = '@devices';
const HEALTH_DATA_KEY = '@health_data';

export class DeviceService {
  static async getConnectedDevices() {
    try {
      const data = await SecureStorage.getItem(DEVICES_KEY);
      return Array.isArray(data) ? data : [];
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

  static _normalizeHealthData(data) {
    if (
      data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      Array.isArray(data.heartRate) &&
      Array.isArray(data.bloodGlucose) &&
      Array.isArray(data.sleep)
    ) {
      return data;
    }
    return null;
  }

  static async getHealthData() {
    try {
      const data = await SecureStorage.getItem(HEALTH_DATA_KEY);
      const normalized = this._normalizeHealthData(data);
      if (normalized) {
        return normalized;
      }

      // 如果没有数据，生成模拟数据
      return this.generateMockData();
    } catch (error) {
      console.error('获取健康数据失败:', error);
      return this.generateMockData();
    }
  }

  static async updateHealthData(newData) {
    try {
      const existingData = await this.getHealthData();
      
      // 合并新数据
      existingData.heartRate.push(...(newData.heartRate || []));
      existingData.bloodGlucose.push(...(newData.bloodGlucose || []));
      existingData.sleep.push(...(newData.sleep || []));
      
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
      return existingData;
    } catch (error) {
      console.error('更新健康数据失败:', error);
      throw error;
    }
  }

  static generateMockData() {
    const data = {
      heartRate: [],
      bloodGlucose: [],
      sleep: [],
    };

    // 生成最近7天的模拟数据
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      
      // 心率数据（每分钟3-5次）
      for (let j = 0; j < 5; j++) {
        const time = new Date(date);
        time.setHours(8 + j * 3, Math.floor(Math.random() * 60), 0);
        data.heartRate.push({
          date: time.toISOString(),
          value: Math.floor(Math.random() * 30) + 65, // 65-95 bpm
        });
      }

      // 血糖数据（每天2-3次）
      for (let j = 0; j < 3; j++) {
        const time = new Date(date);
        time.setHours(7 + j * 6, Math.floor(Math.random() * 60), 0);
        data.bloodGlucose.push({
          date: time.toISOString(),
          value: (Math.random() * 2 + 4).toFixed(1), // 4.0-6.0 mmol/L
        });
      }

      // 睡眠数据（每天1次）
      data.sleep.push({
        date: date.toISOString(),
        value: (Math.random() * 2 + 6).toFixed(1), // 6.0-8.0 小时
      });
    }

    return data;
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
          newData.sleep.push({
            date: today.toISOString(),
            value: (Math.random() * 2 + 6).toFixed(1),
          });
        }
      } else if (device.type === 'glucometer') {
        // 血糖仪数据
        newData.bloodGlucose.push({
          date: now.toISOString(),
          value: (Math.random() * 2 + 4).toFixed(1),
        });
      }

      return await this.updateHealthData(newData);
    } catch (error) {
      console.error('同步设备数据失败:', error);
      throw error;
    }
  }
}


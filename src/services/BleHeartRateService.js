import { Platform } from 'react-native';
import { decode as base64Decode } from 'base-64';

const HEART_RATE_SERVICE_UUID = '0000180D-0000-1000-8000-00805F9B34FB';
const HEART_RATE_MEASUREMENT_UUID = '00002A37-0000-1000-8000-00805F9B34FB';

function _bleErrorText(error) {
  return String(error?.message ?? error?.reason ?? error ?? '');
}

/** 断开连接、取消订阅时常见，不必当错误打日志 */
function _isBenignMonitorError(error) {
  const t = _bleErrorText(error).toLowerCase();
  return (
    t.includes('cancelled') ||
    t.includes('canceled') ||
    t.includes('disconnected') ||
    t.includes('connection closed')
  );
}

class BleHeartRateService {
  constructor() {
    this.manager = null;
    /** 已确认当前环境无原生 BLE（避免反复 require / 抛错） */
    this._bleUnavailable = false;
    this.scanTimer = null;
    this.connectedDevice = null;
    this.heartRateSubscription = null;
    /** 主动 teardown 时监控回调仍会收到 cancel，用于降噪日志 */
    this._endingHeartRateMonitor = false;
  }

  /**
   * 延迟到首次使用再 new BleManager：避免 DeviceScreen 导入时 NativeModules 未就绪；
   * 同时 Expo Go 无 BlePlx 时根本不会加载 react-native-ble-plx。
   */
  _ensureManager() {
    if (Platform.OS === 'web') return false;
    if (this.manager) return true;
    if (this._bleUnavailable) return false;

    const { NativeModules } = require('react-native');
    const ble = NativeModules.BlePlx;
    if (!ble || typeof ble.createClient !== 'function') {
      this._bleUnavailable = true;
      console.warn(
        '[BleHeartRateService] 原生蓝牙模块不可用（常见于 Expo Go）。请使用 expo run:android / run:ios 构建含 BLE 的客户端。'
      );
      return false;
    }

    try {
      const { BleManager } = require('react-native-ble-plx');
      this.manager = new BleManager();
      return true;
    } catch (e) {
      console.warn('[BleHeartRateService] 初始化 BleManager 失败:', e?.message || e);
      this._bleUnavailable = true;
      this.manager = null;
      return false;
    }
  }

  async requestPermissions() {
    if (Platform.OS !== 'android') return true;
    const { PermissionsAndroid } = require('react-native');

    const sdkInt = Platform.Version || 0;
    if (sdkInt >= 31) {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      return Object.values(result).every(
        (status) => status === PermissionsAndroid.RESULTS.GRANTED
      );
    }

    const fineLocation = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );
    return fineLocation === PermissionsAndroid.RESULTS.GRANTED;
  }

  _nativeBleUnavailableMessage() {
    if (Platform.OS === 'web') return 'Web 环境不支持蓝牙';
    return '当前客户端未包含蓝牙原生模块（例如使用 Expo Go 时）。请使用 npx expo run:android 或 npx expo run:ios 安装含手环功能的版本。';
  }

  scanHeartRateDevices(onDeviceFound, onError, timeoutMs = 12000) {
    if (!this._ensureManager()) {
      if (onError) onError(new Error(this._nativeBleUnavailableMessage()));
      return;
    }
    this.stopScan();

    const discovered = new Set();
    this.manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        if (onError) onError(error);
        return;
      }

      if (!device) return;
      if (!device.name && !device.localName) return;
      if (discovered.has(device.id)) return;

      discovered.add(device.id);
      if (onDeviceFound) {
        onDeviceFound({
          id: device.id,
          name: device.name || device.localName || '未知设备',
          rssi: device.rssi ?? -100,
        });
      }
    });

    this.scanTimer = setTimeout(() => {
      this.stopScan();
    }, timeoutMs);
  }

  stopScan() {
    if (!this.manager) return;
    this.manager.stopDeviceScan();
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
  }

  parseHeartRate(base64Value) {
    const bytes = Array.from(base64Decode(base64Value)).map((c) =>
      c.charCodeAt(0)
    );
    if (bytes.length < 2) return null;

    const flags = bytes[0];
    const isUint16 = (flags & 0x01) === 0x01;
    if (isUint16) {
      if (bytes.length < 3) return null;
      return bytes[1] + (bytes[2] << 8);
    }
    return bytes[1];
  }

  async connectAndMonitorHeartRate(deviceId, onHeartRate) {
    if (!this._ensureManager()) {
      throw new Error(this._nativeBleUnavailableMessage());
    }
    this.stopScan();
    await this.disconnectCurrentDevice();

    const device = await this.manager.connectToDevice(deviceId, {
      timeout: 15000,
    });
    this.connectedDevice = device;

    await device.discoverAllServicesAndCharacteristics();

    this.heartRateSubscription = device.monitorCharacteristicForService(
      HEART_RATE_SERVICE_UUID,
      HEART_RATE_MEASUREMENT_UUID,
      (error, characteristic) => {
        if (error) {
          if (this._endingHeartRateMonitor || _isBenignMonitorError(error)) {
            return;
          }
          console.warn('监听心率异常:', _bleErrorText(error) || error);
          return;
        }

        const value = characteristic?.value;
        if (!value) return;
        const bpm = this.parseHeartRate(value);
        if (!bpm) return;
        if (onHeartRate) onHeartRate(bpm);
      }
    );

    return {
      id: device.id,
      name: device.name || device.localName || '心率设备',
      connected: true,
      type: 'bracelet',
      battery: 100,
    };
  }

  async disconnectCurrentDevice() {
    this._endingHeartRateMonitor = true;
    try {
      if (this.heartRateSubscription) {
        try {
          this.heartRateSubscription.remove();
        } finally {
          this.heartRateSubscription = null;
        }
      }

      if (this.connectedDevice) {
        const device = this.connectedDevice;
        this.connectedDevice = null;
        try {
          if (this.manager) {
            await this.manager.cancelDeviceConnection(device.id);
          }
        } catch {
          // ignore disconnect error
        }
      }
    } finally {
      setTimeout(() => {
        this._endingHeartRateMonitor = false;
      }, 300);
    }
  }

  async destroy() {
    this.stopScan();
    await this.disconnectCurrentDevice();
    if (this.manager) {
      this.manager.destroy();
    }
  }
}

export const bleHeartRateService = new BleHeartRateService();

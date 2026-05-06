const HEART_RATE_SERVICE_UUID = 'heart_rate';
const HEART_RATE_MEASUREMENT_UUID = 'heart_rate_measurement';
const BATTERY_SERVICE_UUID = 'battery_service';
const BATTERY_LEVEL_CHARACTERISTIC_UUID = 'battery_level';
const MIN_REALISTIC_BPM = 30;
const MAX_REALISTIC_BPM = 240;

class BleHeartRateServiceWeb {
  constructor() {
    this.connectedDevice = null;
    this.heartRateCharacteristic = null;
    this.heartRateListener = null;
    this.lastBpm = null;
  }

  _isSupported() {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.bluetooth &&
      typeof navigator.bluetooth.requestDevice === 'function'
    );
  }

  _unsupportedMessage() {
    return '当前浏览器不支持 Web Bluetooth。请使用 Chrome/Edge 并通过 HTTPS 或 localhost 打开应用。';
  }

  _isAbortError(error) {
    return String(error?.name || '').toLowerCase() === 'notfounderror';
  }

  async requestPermissions() {
    return this._isSupported();
  }

  async scanHeartRateDevices(onDeviceFound, onError) {
    if (!this._isSupported()) {
      if (onError) onError(new Error(this._unsupportedMessage()));
      return;
    }

    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [HEART_RATE_SERVICE_UUID] }],
        optionalServices: [HEART_RATE_SERVICE_UUID, BATTERY_SERVICE_UUID],
      });
      if (!device) return;
      if (onDeviceFound) {
        onDeviceFound({
          id: device.id,
          name: device.name || '心率设备',
          rssi: '--',
          _webDevice: device,
        });
      }
    } catch (error) {
      if (this._isAbortError(error)) return;
      if (onError) onError(error);
    }
  }

  stopScan() {
    // Web Bluetooth 的设备选择器由浏览器管理，无法像原生 BLE 一样主动停止扫描。
  }

  _pickBestBpm(candidates = []) {
    const cleaned = candidates
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x) && x > 0)
      .map((x) => Math.round(x));
    if (!cleaned.length) return null;

    const realistic = cleaned.filter(
      (x) => x >= MIN_REALISTIC_BPM && x <= MAX_REALISTIC_BPM
    );
    if (realistic.length === 1) return realistic[0];
    if (realistic.length > 1) {
      if (Number.isFinite(this.lastBpm)) {
        return realistic.reduce((best, cur) =>
          Math.abs(cur - this.lastBpm) < Math.abs(best - this.lastBpm) ? cur : best
        );
      }
      return realistic[0];
    }

    // 部分厂商会出现倍数缩放异常，兜底尝试 /2。
    const halved = cleaned
      .filter((x) => x > MAX_REALISTIC_BPM && x % 2 === 0)
      .map((x) => x / 2)
      .filter((x) => x >= MIN_REALISTIC_BPM && x <= MAX_REALISTIC_BPM);
    if (halved.length > 0) return Math.round(halved[0]);

    return null;
  }

  _parseHeartRate(dataView) {
    if (!dataView || typeof dataView.getUint8 !== 'function') return null;
    if (dataView.byteLength < 2) return null;
    const flags = dataView.getUint8(0);
    const isUint16 = (flags & 0x01) === 0x01;

    const bpm8 = dataView.getUint8(1);
    if (isUint16 && dataView.byteLength >= 3) {
      const bpm16LE = dataView.getUint16(1, true);
      const bpm16BE = dataView.getUint16(1, false);
      return this._pickBestBpm([bpm16LE, bpm8, bpm16BE]);
    }
    return this._pickBestBpm([bpm8]);
  }

  async _readBatteryLevel(server) {
    try {
      const batteryService = await server.getPrimaryService(BATTERY_SERVICE_UUID);
      const batteryCharacteristic = await batteryService.getCharacteristic(
        BATTERY_LEVEL_CHARACTERISTIC_UUID
      );
      const value = await batteryCharacteristic.readValue();
      const level = value?.getUint8?.(0);
      if (!Number.isFinite(level)) return null;
      if (level < 0 || level > 100) return null;
      return Math.round(level);
    } catch {
      return null;
    }
  }

  async connectAndMonitorHeartRate(deviceOrId, onHeartRate) {
    if (!this._isSupported()) {
      throw new Error(this._unsupportedMessage());
    }

    const webDevice =
      deviceOrId && typeof deviceOrId === 'object' && deviceOrId.gatt
        ? deviceOrId
        : null;
    if (!webDevice) {
      throw new Error('Web 端请先扫描并从浏览器弹窗中选择设备');
    }

    await this.disconnectCurrentDevice();

    const server = await webDevice.gatt.connect();
    const batteryLevel = await this._readBatteryLevel(server);
    const service = await server.getPrimaryService(HEART_RATE_SERVICE_UUID);
    const characteristic = await service.getCharacteristic(
      HEART_RATE_MEASUREMENT_UUID
    );

    const handler = (event) => {
      const dv = event?.target?.value;
      const bpm = this._parseHeartRate(dv);
      if (Number.isFinite(bpm)) {
        this.lastBpm = bpm;
        if (onHeartRate) onHeartRate(bpm);
      }
    };

    characteristic.addEventListener('characteristicvaluechanged', handler);
    await characteristic.startNotifications();

    this.connectedDevice = webDevice;
    this.heartRateCharacteristic = characteristic;
    this.heartRateListener = handler;

    return {
      id: webDevice.id,
      name: webDevice.name || '心率设备',
      connected: true,
      type: 'bracelet',
      battery: batteryLevel,
    };
  }

  async disconnectCurrentDevice() {
    try {
      if (this.heartRateCharacteristic && this.heartRateListener) {
        try {
          this.heartRateCharacteristic.removeEventListener(
            'characteristicvaluechanged',
            this.heartRateListener
          );
          await this.heartRateCharacteristic.stopNotifications();
        } catch {
          // ignore
        }
      }
      if (this.connectedDevice?.gatt?.connected) {
        this.connectedDevice.gatt.disconnect();
      }
    } finally {
      this.connectedDevice = null;
      this.heartRateCharacteristic = null;
      this.heartRateListener = null;
      this.lastBpm = null;
    }
  }

  async destroy() {
    await this.disconnectCurrentDevice();
  }
}

export const bleHeartRateService = new BleHeartRateServiceWeb();

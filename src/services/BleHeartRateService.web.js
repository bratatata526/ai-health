class BleHeartRateServiceWeb {
  async requestPermissions() {
    return false;
  }

  scanHeartRateDevices(onDeviceFound, onError) {
    if (onError) {
      onError(new Error('Web 环境不支持蓝牙扫描'));
    }
  }

  stopScan() {}

  async connectAndMonitorHeartRate() {
    throw new Error('Web 环境不支持蓝牙连接');
  }

  async disconnectCurrentDevice() {}

  async destroy() {}
}

export const bleHeartRateService = new BleHeartRateServiceWeb();

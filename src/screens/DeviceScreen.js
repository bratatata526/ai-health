import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Dimensions,
  Platform,
  ActivityIndicator,
} from 'react-native';
import {
  Card,
  Title,
  Paragraph,
  Button,
  Text,
  ProgressBar,
  Chip,
} from 'react-native-paper';
import { LineChart } from 'react-native-chart-kit';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { DeviceService } from '../services/DeviceService';
import { ExportService } from '../services/ExportService';
import { Alert } from 'react-native';
import { bleHeartRateService } from '../services/BleHeartRateService';

const { width } = Dimensions.get('window');

export default function DeviceScreen() {
  const [devices, setDevices] = useState([]);
  const [nearbyDevices, setNearbyDevices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [connectingDeviceId, setConnectingDeviceId] = useState(null);
  const [liveHeartRate, setLiveHeartRate] = useState(null);
  const [healthData, setHealthData] = useState({
    heartRate: [],
    bloodGlucose: [],
    sleep: [],
  });
  const [refreshing, setRefreshing] = useState(false);
  const [todayStats, setTodayStats] = useState({
    heartRate: 0,
    bloodGlucose: 0,
    sleep: 0,
  });

  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    loadData();
    return () => {
      try {
        bleHeartRateService.stopScan();
        bleHeartRateService.disconnectCurrentDevice();
      } catch (e) {
        // web 端蓝牙服务不可用，忽略清理错误
      }
    };
  }, []);

  /** 校验健康数据结构，防止异常数据导致渲染崩溃 */
  const normalizeHealthData = (data) => {
    const empty = { heartRate: [], bloodGlucose: [], sleep: [] };
    if (!data || typeof data !== 'object' || Array.isArray(data)) return empty;
    return {
      heartRate: Array.isArray(data.heartRate) ? data.heartRate : [],
      bloodGlucose: Array.isArray(data.bloodGlucose) ? data.bloodGlucose : [],
      sleep: Array.isArray(data.sleep) ? data.sleep : [],
    };
  };

  const loadData = async () => {
    try {
      setLoadError(null);
      const deviceData = await DeviceService.getConnectedDevices();
      const rawData = await DeviceService.getHealthData();
      const data = normalizeHealthData(rawData);

      setDevices(Array.isArray(deviceData) ? deviceData : []);
      setHealthData(data);

      // 计算今日统计数据
      const today = new Date().toDateString();
      const todayData = data.heartRate.filter(
        (item) => {
          try { return new Date(item.date).toDateString() === today; } catch { return false; }
        }
      );

      if (todayData.length > 0) {
        const avgHeartRate = todayData.reduce((sum, item) => sum + Number(item.value || 0), 0) / todayData.length;
        const latestGlucose = data.bloodGlucose[data.bloodGlucose.length - 1]?.value || 0;
        const latestSleep = data.sleep[data.sleep.length - 1]?.value || 0;

        setTodayStats({
          heartRate: Math.round(avgHeartRate),
          bloodGlucose: latestGlucose,
          sleep: latestSleep,
        });
      }
    } catch (error) {
      console.error('加载设备数据失败:', error);
      setLoadError('数据加载失败，请下拉刷新重试');
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const connectDevice = async (deviceType) => {
    // 模拟设备连接
    const newDevice = {
      id: Date.now().toString(),
      type: deviceType,
      name: deviceType === 'bracelet' ? '智能手环' : '血糖仪',
      connected: true,
      battery: Math.floor(Math.random() * 30) + 70,
    };
    
    await DeviceService.addDevice(newDevice);
    loadData();
  };

  const startScan = async () => {
    try {
      if (Platform.OS === 'web') {
        Alert.alert('提示', '蓝牙连接仅支持安卓/iOS手机端，请使用开发版App测试');
        return;
      }
      const granted = await bleHeartRateService.requestPermissions();
      if (!granted) {
        Alert.alert('权限不足', '请允许蓝牙权限后再扫描设备');
        return;
      }

      setNearbyDevices([]);
      setScanning(true);

      bleHeartRateService.scanHeartRateDevices(
        (device) => {
          setNearbyDevices((prev) => {
            if (prev.some((item) => item.id === device.id)) return prev;
            return [...prev, device];
          });
        },
        (error) => {
          console.error('扫描设备失败:', error);
          Alert.alert('扫描失败', '蓝牙扫描异常，请确认手环已开启并靠近手机');
          setScanning(false);
        },
        12000
      );

      setTimeout(() => setScanning(false), 12500);
    } catch (error) {
      console.error('启动扫描失败:', error);
      setScanning(false);
      Alert.alert('扫描失败', '无法启动蓝牙扫描');
    }
  };

  const stopScan = () => {
    bleHeartRateService.stopScan();
    setScanning(false);
  };

  const connectHeartRateDevice = async (device) => {
    try {
      setConnectingDeviceId(device.id);
      const connectedDevice = await bleHeartRateService.connectAndMonitorHeartRate(
        device.id,
        async (bpm) => {
          setLiveHeartRate(bpm);
          await DeviceService.updateHealthData({
            heartRate: [{ date: new Date().toISOString(), value: bpm }],
            bloodGlucose: [],
            sleep: [],
          });
          await loadData();
        }
      );

      await DeviceService.addOrReplaceDevice({
        ...connectedDevice,
        name: device.name || connectedDevice.name,
      });
      await loadData();
      Alert.alert('连接成功', `已连接 ${device.name}，正在接收实时心率`);
    } catch (error) {
      console.error('连接手环失败:', error);
      Alert.alert(
        '连接失败',
        '请确认设备支持标准BLE心率服务(0x180D)，并且没有被其他App占用'
      );
    } finally {
      setConnectingDeviceId(null);
    }
  };

  const disconnectHeartRateDevice = async (deviceId) => {
    try {
      await bleHeartRateService.disconnectCurrentDevice();
      await DeviceService.removeDevice(deviceId);
      setLiveHeartRate(null);
      await loadData();
    } catch (error) {
      console.error('断开连接失败:', error);
      Alert.alert('操作失败', '断开设备失败，请重试');
    }
  };

  const chartConfig = {
    backgroundColor: theme.colors.surface,
    backgroundGradientFrom: theme.colors.surface,
    backgroundGradientTo: theme.colors.surface,
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(74, 144, 226, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(44, 62, 80, ${opacity})`,
    style: {
      borderRadius: 16,
    },
  };

  const prepareChartData = (data, label) => {
    // 按天聚合：同一天的多条记录取平均值
    const dailyMap = {};
    data.forEach((item) => {
      const d = new Date(item.date);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      if (!dailyMap[key]) {
        dailyMap[key] = { sum: 0, count: 0, month: d.getMonth() + 1, day: d.getDate() };
      }
      dailyMap[key].sum += Number(item.value);
      dailyMap[key].count += 1;
    });

    // 按日期排序后取最近 7 天
    const sortedDays = Object.keys(dailyMap).sort((a, b) => {
      const [ay, am, ad] = a.split('-').map(Number);
      const [by, bm, bd] = b.split('-').map(Number);
      return new Date(ay, am - 1, ad) - new Date(by, bm - 1, bd);
    }).slice(-7);

    return {
      labels: sortedDays.map((key) => `${dailyMap[key].month}/${dailyMap[key].day}`),
      datasets: [
        {
          data: sortedDays.map((key) => {
            const avg = dailyMap[key].sum / dailyMap[key].count;
            return Math.round(avg * 10) / 10;
          }),
        },
      ],
    };
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.content}>
        {/* 加载失败提示 */}
        {loadError && (
          <Card style={[styles.card, { backgroundColor: '#FFF3E0' }]}>
            <Card.Content>
              <Text style={{ color: '#E65100', textAlign: 'center' }}>{loadError}</Text>
            </Card.Content>
          </Card>
        )}

        {/* 今日统计 */}
        <Card style={styles.statsCard}>
          <Card.Content>
            <Title style={styles.sectionTitle}>今日数据</Title>
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Ionicons name="heart" size={32} color={theme.colors.error} />
                <Text style={styles.statValue}>{liveHeartRate || todayStats.heartRate}</Text>
                <Text style={styles.statLabel}>心率 (bpm)</Text>
              </View>
              <View style={styles.statItem}>
                <Ionicons name="water" size={32} color={theme.colors.secondary} />
                <Text style={styles.statValue}>{todayStats.bloodGlucose}</Text>
                <Text style={styles.statLabel}>血糖 (mmol/L)</Text>
              </View>
              <View style={styles.statItem}>
                <Ionicons name="moon" size={32} color={theme.colors.accent} />
                <Text style={styles.statValue}>{todayStats.sleep}</Text>
                <Text style={styles.statLabel}>睡眠 (小时)</Text>
              </View>
            </View>
          </Card.Content>
        </Card>

        {/* 设备连接 */}
        <Card style={styles.card}>
          <Card.Content>
            <Title style={styles.sectionTitle}>已连接设备</Title>
            <View style={styles.deviceButtons}>
              <Button
                mode="outlined"
                icon="watch"
                onPress={startScan}
                style={styles.deviceButton}
                loading={scanning}
                disabled={scanning}
              >
                {scanning ? '扫描中...' : '扫描手环'}
              </Button>
              <Button
                mode="outlined"
                icon="pulse"
                onPress={() => connectDevice('glucometer')}
                style={styles.deviceButton}
              >
                连接血糖仪
              </Button>
            </View>
            {devices.length === 0 ? (
              <View style={styles.emptyDevices}>
                <Paragraph style={styles.emptyText}>暂无连接设备</Paragraph>
              </View>
            ) : (
              devices.map((device) => (
                <View key={device.id} style={styles.deviceItem}>
                  <View style={styles.deviceInfo}>
                    <Ionicons
                      name={device.type === 'bracelet' ? 'watch' : 'pulse'}
                      size={24}
                      color={theme.colors.primary}
                    />
                    <View style={styles.deviceDetails}>
                      <Text style={styles.deviceName}>{device.name}</Text>
                      <Text style={styles.deviceStatus}>
                        {device.connected ? '已连接' : '未连接'}
                      </Text>
                    </View>
                  </View>
                  <Chip
                    icon="battery-charging"
                    style={styles.batteryChip}
                  >
                    {device.battery}%
                  </Chip>
                  {device.type === 'bracelet' && (
                    <Button
                      mode="text"
                      onPress={() => disconnectHeartRateDevice(device.id)}
                    >
                      断开
                    </Button>
                  )}
                </View>
              ))
            )}

            {nearbyDevices.length > 0 && (
              <View style={styles.nearbySection}>
                <Text style={styles.nearbyTitle}>可连接手环</Text>
                {nearbyDevices.map((device) => (
                  <View key={device.id} style={styles.nearbyDeviceItem}>
                    <View style={styles.nearbyDeviceInfo}>
                      <Text style={styles.deviceName}>{device.name}</Text>
                      <Text style={styles.deviceStatus}>信号: {device.rssi} dBm</Text>
                    </View>
                    <Button
                      mode="contained"
                      compact
                      onPress={() => connectHeartRateDevice(device)}
                      disabled={!!connectingDeviceId}
                      loading={connectingDeviceId === device.id}
                    >
                      连接
                    </Button>
                  </View>
                ))}
              </View>
            )}

            {scanning && (
              <View style={styles.scanHint}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text style={styles.scanHintText}>请保持手环亮屏并靠近手机</Text>
                <Button mode="text" compact onPress={stopScan}>
                  停止扫描
                </Button>
              </View>
            )}
          </Card.Content>
        </Card>

        {/* 心率图表 */}
        {healthData.heartRate.length > 0 && (() => {
          try {
            const chartData = prepareChartData(healthData.heartRate, '心率');
            if (!chartData || !chartData.datasets?.[0]?.data?.length) return null;
            return (
              <Card style={styles.card}>
                <Card.Content>
                  <Title style={styles.sectionTitle}>心率趋势</Title>
                  <LineChart
                    data={chartData}
                    width={Math.max(width - 64, 200)}
                    height={220}
                    chartConfig={chartConfig}
                    bezier
                    style={styles.chart}
                  />
                </Card.Content>
              </Card>
            );
          } catch (e) {
            console.warn('心率图表渲染失败:', e);
            return null;
          }
        })()}

        {/* 血糖图表 */}
        {healthData.bloodGlucose.length > 0 && (() => {
          try {
            const chartData = prepareChartData(healthData.bloodGlucose, '血糖');
            if (!chartData || !chartData.datasets?.[0]?.data?.length) return null;
            return (
              <Card style={styles.card}>
                <Card.Content>
                  <Title style={styles.sectionTitle}>血糖趋势</Title>
                  <LineChart
                    data={chartData}
                    width={Math.max(width - 64, 200)}
                    height={220}
                    chartConfig={chartConfig}
                    bezier
                    style={styles.chart}
                  />
                </Card.Content>
              </Card>
            );
          } catch (e) {
            console.warn('血糖图表渲染失败:', e);
            return null;
          }
        })()}

        {/* 睡眠图表 */}
        {healthData.sleep.length > 0 && (() => {
          try {
            const chartData = prepareChartData(healthData.sleep, '睡眠');
            if (!chartData || !chartData.datasets?.[0]?.data?.length) return null;
            return (
              <Card style={styles.card}>
                <Card.Content>
                  <Title style={styles.sectionTitle}>睡眠时长</Title>
                  <LineChart
                    data={chartData}
                    width={Math.max(width - 64, 200)}
                    height={220}
                    chartConfig={chartConfig}
                    bezier
                    style={styles.chart}
                  />
                </Card.Content>
              </Card>
            );
          } catch (e) {
            console.warn('睡眠图表渲染失败:', e);
            return null;
          }
        })()}

        {/* 导出数据按钮 */}
        <Card style={styles.card}>
          <Card.Content>
            <Button
              mode="contained"
              icon="download"
              onPress={async () => {
                try {
                  const result = await ExportService.exportHealthData('csv');
                  if (result.success) {
                    Alert.alert('成功', result.message || '健康数据已导出');
                  }
                } catch (error) {
                  Alert.alert('错误', '导出数据失败，请重试');
                  console.error('导出数据失败:', error);
                }
              }}
              style={styles.exportButton}
            >
              导出健康数据 (CSV)
            </Button>
          </Card.Content>
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.md,
  },
  statsCard: {
    marginBottom: theme.spacing.md,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: theme.shadow.color,
        shadowOpacity: 1,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 2 },
      web: {
        shadowColor: theme.shadow.color,
        shadowOpacity: 1,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      },
    }),
  },
  card: {
    marginBottom: theme.spacing.md,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: theme.shadow.color,
        shadowOpacity: 1,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 2 },
      web: {
        shadowColor: theme.shadow.color,
        shadowOpacity: 1,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      },
    }),
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: theme.spacing.md,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: theme.spacing.md,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginTop: theme.spacing.xs,
  },
  statLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
  },
  emptyDevices: {
    alignItems: 'center',
    paddingVertical: theme.spacing.lg,
  },
  emptyText: {
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
  },
  deviceButtons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  deviceButton: {
    flex: 1,
  },
  deviceItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.outlineVariant,
  },
  deviceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  deviceDetails: {
    marginLeft: theme.spacing.sm,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  deviceStatus: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  batteryChip: {
    backgroundColor: theme.colors.surfaceVariant,
  },
  nearbySection: {
    marginTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.outlineVariant,
    paddingTop: theme.spacing.sm,
  },
  nearbyTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: theme.spacing.sm,
    color: theme.colors.text,
  },
  nearbyDeviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.xs,
  },
  nearbyDeviceInfo: {
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  scanHint: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  scanHintText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  chart: {
    marginVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
  },
  exportButton: {
    borderRadius: theme.borderRadius.md,
  },
});


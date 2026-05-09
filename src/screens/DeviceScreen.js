import React, { useState, useEffect, Fragment } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Dimensions,
  Platform,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import {
  Card,
  Title,
  Paragraph,
  Button,
  Text,
  SegmentedButtons,
  Snackbar,
} from 'react-native-paper';
import { LineChart, BarChart } from 'react-native-chart-kit';
import Svg, { Line } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { theme, textStyles } from '../theme';
import { DeviceService } from '../services/DeviceService';
import { ExportService } from '../services/ExportService';
import {
  downloadGlucoseTemplate,
  downloadSleepTemplate,
  importFromWorkbook,
} from '../services/HealthExcelService';
import { importAppleHealthSleepFromExportXml } from '../services/AppleHealthSleepImportService';
import { Alert } from 'react-native';
import { bleHeartRateService } from '../services/BleHeartRateService';
import { heartRateAlertMonitor } from '../services/HeartRateAlertService';
import {
  buildDayHourlyAverage,
  buildRollingDailyAverage,
  hasNonZero,
  hourlyLineChartLabels,
  paddedYRange,
  lineChartBoundedDatasets,
} from '../utils/healthCharts';

const { width } = Dimensions.get('window');

/** 周柱图透明点击层：由 X 估算柱索引（与 chart-kit BarChart 布局一致） */
function barIndexFromTouch(locationX, nBars, chartWidth, paddingRight, barPercentage) {
  if (nBars <= 0) return -1;
  if (
    !Number.isFinite(locationX) ||
    !Number.isFinite(chartWidth) ||
    !Number.isFinite(paddingRight) ||
    !Number.isFinite(barPercentage)
  ) {
    return -1;
  }
  const inner = chartWidth - paddingRight;
  if (inner <= 0) return -1;
  const barW = 32 * barPercentage;
  const raw = ((locationX - paddingRight - barW / 2) * nBars) / inner;
  const i = Math.round(raw);
  if (!Number.isFinite(i)) return -1;
  return Math.max(0, Math.min(nBars - 1, i));
}

/** RN Web 等环境下 locationX 可能缺失，尝试 offsetX */
function getPressLocationX(event) {
  const ne = event?.nativeEvent;
  if (!ne) return NaN;
  if (typeof ne.locationX === 'number' && Number.isFinite(ne.locationX)) {
    return ne.locationX;
  }
  if (typeof ne.offsetX === 'number' && Number.isFinite(ne.offsetX)) {
    return ne.offsetX;
  }
  return NaN;
}

/** 睡眠图背景网格：与 react-native-chart-kit 相同 strokeDasharray，刻度与柱高共用 trackH 比例 */
function SleepDashedGrid({ height, bottomInset, stroke, nDays }) {
  const [w, setW] = useState(0);
  return (
    <View
      pointerEvents="none"
      style={[styles.sleepGridPlane, { height, bottom: bottomInset }]}
      onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}
    >
      {w > 0 ? (
        <Svg width={w} height={height} style={StyleSheet.absoluteFillObject}>
          {[0, 1, 2, 3, 4].map((i) => {
            const y = height - (height * i) / 4;
            return (
              <Line
                key={`h${i}`}
                x1={0}
                y1={y}
                x2={w}
                y2={y}
                stroke={stroke}
                strokeWidth={1}
                strokeDasharray="5, 10"
              />
            );
          })}
          {nDays > 1
            ? Array.from({ length: nDays - 1 }, (_, idx) => {
                const vi = idx + 1;
                const x = (w * vi) / nDays;
                return (
                  <Line
                    key={`v${vi}`}
                    x1={x}
                    y1={0}
                    x2={x}
                    y2={height}
                    stroke={stroke}
                    strokeWidth={1}
                    strokeDasharray="5, 10"
                  />
                );
              })
            : null}
        </Svg>
      ) : null}
    </View>
  );
}

export default function DeviceScreen() {
  const [devices, setDevices] = useState([]);
  const [discoveredBracelets, setDiscoveredBracelets] = useState([]);
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
  /** 心率 / 血糖图表：日 = 当日每 3 小时均值；周 = 近 7 天每日均值 */
  const [hrRange, setHrRange] = useState('day');
  const [glucoseRange, setGlucoseRange] = useState('day');
  const [chartSnackbar, setChartSnackbar] = useState({ visible: false, message: '' });
  /** 模板下载 / Excel 导入进行中 */
  const [excelBusy, setExcelBusy] = useState(null);

  useEffect(() => {
    loadData();
    return () => {
      try {
        heartRateAlertMonitor.reset();
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

      // 今日统计：分项计算；心率用全局最近一条，血糖为今日最后一条，睡眠为日历日落在今天的记录
      const today = new Date().toDateString();

      let heartStat = 0;
      if (data.heartRate.length > 0) {
        const latestHr = [...data.heartRate].reduce((best, item) => {
          try {
            const t = new Date(item.date).getTime();
            const bt = new Date(best.date).getTime();
            if (!Number.isFinite(t)) return best;
            if (!Number.isFinite(bt)) return item;
            return t > bt ? item : best;
          } catch {
            return best;
          }
        });
        heartStat = Math.round(Number(latestHr.value || 0));
      }

      let glucoseStat = 0;
      const todayGlucose = data.bloodGlucose.filter((item) => {
        try {
          return new Date(item.date).toDateString() === today;
        } catch {
          return false;
        }
      });
      if (todayGlucose.length > 0) {
        const lastG = [...todayGlucose].sort(
          (a, b) => new Date(a.date) - new Date(b.date)
        )[todayGlucose.length - 1];
        glucoseStat = Number(lastG.value || 0);
      }

      let sleepStat = 0;
      const todaySleepRows = data.sleep.filter((item) => {
        try {
          return new Date(item.date).toDateString() === today;
        } catch {
          return false;
        }
      });
      if (todaySleepRows.length > 0) {
        const s = [...todaySleepRows].sort(
          (a, b) => new Date(a.date) - new Date(b.date)
        )[todaySleepRows.length - 1];
        const totalVal =
          s.totalHours != null ? s.totalHours : s.value != null ? s.value : 0;
        sleepStat =
          typeof totalVal === 'number'
            ? totalVal
            : parseFloat(String(totalVal)) || 0;
      }

      setTodayStats({
        heartRate: heartStat,
        bloodGlucose: glucoseStat,
        sleep: sleepStat,
      });
    } catch (error) {
      console.error('加载设备数据失败:', error);
      setLoadError('数据加载失败，请下拉刷新重试');
    }
  };

  /** 蓝牙与开发自测共用：更新 UI、触发告警、写入趋势 */
  const applyLiveHeartRate = async (bpm) => {
    try {
      setLiveHeartRate(bpm);
      const hrAlert = heartRateAlertMonitor.checkAndNotify(bpm);
      if (hrAlert) {
        Alert.alert(hrAlert.title, hrAlert.body);
      }
      await DeviceService.updateHealthData({
        heartRate: [{ date: new Date().toISOString(), value: bpm }],
        bloodGlucose: [],
        sleep: [],
      });
      await loadData();
    } catch (error) {
      console.error('应用实时心率失败:', error);
      Alert.alert('错误', error?.message || '处理心率数据失败');
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

  const mergeDeviceList = () => {
    const merged = new Map();

    discoveredBracelets.forEach((item) => {
      if (!item?.id) return;
      merged.set(item.id, {
        id: item.id,
        type: 'bracelet',
        name: item.name || '心率设备',
        connected: false,
        battery: item.battery ?? null,
        _webDevice: item._webDevice,
      });
    });

    devices.forEach((item) => {
      if (!item?.id) return;
      const existing = merged.get(item.id) || {};
      merged.set(item.id, {
        ...existing,
        ...item,
        _webDevice: existing._webDevice || item._webDevice,
      });
    });

    return Array.from(merged.values());
  };

  const shownDevices = mergeDeviceList();

  const startScan = async () => {
    try {
      const granted = await bleHeartRateService.requestPermissions();
      if (!granted) {
        Alert.alert(
          '无法使用蓝牙',
          Platform.OS === 'web'
            ? '当前浏览器不支持 Web Bluetooth。请使用 Chrome/Edge 并通过 HTTPS 或 localhost 打开应用。'
            : '请允许蓝牙权限后再扫描设备'
        );
        return;
      }

      setScanning(true);

      if (Platform.OS === 'web') {
        await bleHeartRateService.scanHeartRateDevices(
          (device) => {
            setDiscoveredBracelets((prev) => {
              const idx = prev.findIndex((item) => item.id === device.id);
              const normalized = {
                id: device.id,
                name: device.name,
                type: 'bracelet',
                connected: false,
                battery: device.battery ?? null,
                _webDevice: device._webDevice,
              };
              if (idx < 0) return [...prev, normalized];
              const next = [...prev];
              next[idx] = { ...next[idx], ...normalized };
              return next;
            });
            setScanning(false);
          },
          (error) => {
            console.error('扫描设备失败:', error);
            Alert.alert('扫描失败', error?.message || '浏览器蓝牙扫描异常');
            setScanning(false);
          }
        );
        setScanning(false);
        return;
      }

      bleHeartRateService.scanHeartRateDevices(
        (device) => {
          setDiscoveredBracelets((prev) => {
            const idx = prev.findIndex((item) => item.id === device.id);
            const normalized = {
              id: device.id,
              name: device.name,
              type: 'bracelet',
              connected: false,
              battery: device.battery ?? null,
              rssi: device.rssi,
              _webDevice: device._webDevice,
            };
            if (idx < 0) return [...prev, normalized];
            const next = [...prev];
            next[idx] = { ...next[idx], ...normalized };
            return next;
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
        device._webDevice || device.id,
        (bpm) => {
          applyLiveHeartRate(bpm);
        }
      );

      await DeviceService.addOrReplaceDevice({
        ...connectedDevice,
        name: device.name || connectedDevice.name,
      });
      setDiscoveredBracelets((prev) =>
        prev.map((item) =>
          item.id === device.id
            ? {
                ...item,
                connected: true,
                battery: connectedDevice.battery ?? item.battery ?? null,
                _webDevice: item._webDevice || device._webDevice,
              }
            : item
        )
      );
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
      heartRateAlertMonitor.reset();
      await bleHeartRateService.disconnectCurrentDevice();
      await DeviceService.removeDevice(deviceId);
      setDiscoveredBracelets((prev) =>
        prev.map((item) =>
          item.id === deviceId ? { ...item, connected: false } : item
        )
      );
      setLiveHeartRate(null);
      await loadData();
    } catch (error) {
      console.error('断开连接失败:', error);
      Alert.alert('操作失败', '断开设备失败，请重试');
    }
  };

  /** 模拟血糖仪：无 BLE，仅从本地列表移除 */
  const disconnectGlucometerDevice = async (deviceId) => {
    try {
      await DeviceService.removeDevice(deviceId);
      await loadData();
    } catch (error) {
      console.error('断开血糖仪失败:', error);
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
    propsForLabels: {
      fontSize: 10,
    },
  };

  const chartConfigGlucose = {
    ...chartConfig,
    decimalPlaces: 1,
    color: (opacity = 1) => `rgba(46, 125, 50, ${opacity})`,
  };

  /** 周视图柱形（约 7 根，略宽柱更协调） */
  const chartConfigWeekBarHr = {
    ...chartConfig,
    barPercentage: 0.52,
  };
  const chartConfigWeekBarGlucose = {
    ...chartConfigGlucose,
    barPercentage: 0.52,
  };

  const chartWidth = Math.max(width - 64, 200);

  const showChartMessage = (message) => {
    setChartSnackbar({ visible: true, message });
  };

  const runExcelTask = async (busyKey, fn) => {
    try {
      setExcelBusy(busyKey);
      const result = await fn();
      if (result?.success) {
        Alert.alert('成功', result.message || '操作已完成');
        if (
          busyKey === 'import-glucose' ||
          busyKey === 'import-sleep' ||
          busyKey === 'import-apple-sleep'
        ) {
          await loadData();
        }
      } else if (result?.message) {
        Alert.alert(
          busyKey.startsWith('import') ? '提示' : '未完成',
          result.message
        );
      }
    } catch (error) {
      console.error('Excel 操作失败:', error);
      Alert.alert('错误', error?.message || '操作失败，请重试');
    } finally {
      setExcelBusy(null);
    }
  };

  return (
    <Fragment>
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
              <Text style={styles.loadErrorText}>{loadError}</Text>
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
                <Text style={styles.statValue}>
                  {typeof todayStats.sleep === 'number'
                    ? todayStats.sleep.toFixed(1)
                    : todayStats.sleep}
                </Text>
                <Text style={styles.statLabel}>睡眠 (小时)</Text>
              </View>
            </View>
            {liveHeartRate != null && (
              <Text style={styles.hrMonitorHint}>
                异常提示：&lt;{heartRateAlertMonitor.lowBpm} 或 &gt;{heartRateAlertMonitor.highBpm} bpm（静息参考，
                约 {Math.round(heartRateAlertMonitor.cooldownMs / 1000)}s 内同类仅提醒一次）
              </Text>
            )}
            <Button
              mode="text"
              icon="database-plus"
              onPress={async () => {
                try {
                  await DeviceService.seedDetailedMockData(30);
                  await loadData();
                  Alert.alert('已填充模拟数据', '已生成近30天心率/血糖/睡眠模拟数据，可立即查看趋势分析效果。');
                } catch (e) {
                  Alert.alert('操作失败', e?.message || '填充模拟数据失败');
                }
              }}
            >
              填充30天模拟数据（用于预览报告）
            </Button>
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
            {shownDevices.length === 0 ? (
              <View style={styles.emptyDevices}>
                <Paragraph style={styles.emptyText}>暂无连接设备</Paragraph>
              </View>
            ) : (
              shownDevices.map((device) => (
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
                  {device.type === 'bracelet' && (
                    <Button
                      mode={device.connected ? 'text' : 'contained'}
                      compact={!device.connected}
                      onPress={() =>
                        device.connected
                          ? disconnectHeartRateDevice(device.id)
                          : connectHeartRateDevice(device)
                      }
                      disabled={!!connectingDeviceId}
                      loading={connectingDeviceId === device.id}
                    >
                      {device.connected ? '断开' : '连接'}
                    </Button>
                  )}
                  {device.type === 'glucometer' && (
                    <Button
                      mode="text"
                      onPress={() => disconnectGlucometerDevice(device.id)}
                    >
                      断开
                    </Button>
                  )}
                </View>
              ))
            )}

            {scanning && (
              <View style={styles.scanHint}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text style={styles.scanHintText}>
                  {Platform.OS === 'web'
                    ? '请在浏览器蓝牙弹窗中选择手环'
                    : '请保持手环亮屏并靠近手机'}
                </Text>
                <Button mode="text" compact onPress={stopScan}>
                  停止扫描
                </Button>
              </View>
            )}
          </Card.Content>
        </Card>

        {/* 心率：日折线（每小时均） / 周柱形（日均） */}
        {healthData.heartRate.length > 0 && (() => {
          try {
            const dayHr = buildDayHourlyAverage(healthData.heartRate, new Date());
            const weekHr = buildRollingDailyAverage(healthData.heartRate, 7);
            const useDay = hrRange === 'day';
            const values = useDay ? dayHr.data : weekHr.data;
            const labels = useDay ? hourlyLineChartLabels() : weekHr.labels;
            if (!hasNonZero(values)) return null;
            const hrPad = paddedYRange(values.filter((v) => Number(v) > 0), {
              absoluteMinPad: 2,
              padRatio: 0.1,
              hardMin: 40,
            });
            const lineDisplay = useDay
              ? values.map((v) => (Number(v) > 0 ? Number(v) : hrPad.yMin))
              : values;
            const chartData = useDay
              ? {
                  labels,
                  datasets: lineChartBoundedDatasets(lineDisplay, hrPad.yMin, hrPad.yMax),
                }
              : { labels, datasets: [{ data: values }] };
            return (
              <Card style={styles.card}>
                <Card.Content>
                  <Title style={styles.sectionTitle}>心率趋势</Title>
                  <Paragraph style={styles.chartHint}>
                    日视图：折线为当日 0–23 点每小时平均心率。周视图：柱高为近 7 个日历日日均心率 (bpm)。点击数据点或柱子查看数值。
                  </Paragraph>
                  <SegmentedButtons
                    value={hrRange}
                    onValueChange={setHrRange}
                    buttons={[
                      { value: 'day', label: '日心率', labelStyle: styles.segmentLabel },
                      { value: 'week', label: '周心率', labelStyle: styles.segmentLabel },
                    ]}
                    style={styles.segmented}
                  />
                  {useDay ? (
                    <LineChart
                      data={chartData}
                      width={chartWidth}
                      height={220}
                      chartConfig={chartConfig}
                      bezier
                      fromZero={false}
                      withShadow={false}
                      segments={4}
                      style={styles.chart}
                      onDataPointClick={({ index, value }) => {
                        const v = Number(value);
                        const raw = dayHr.data[index];
                        const msg =
                          Number(raw) > 0
                            ? `${index}时 平均心率 ${Math.round(v)} bpm`
                            : `${index}时 暂无采样`;
                        showChartMessage(msg);
                      }}
                    />
                  ) : (
                    <View style={styles.barChartTouchWrap}>
                      <BarChart
                        data={chartData}
                        width={chartWidth}
                        height={220}
                        chartConfig={chartConfigWeekBarHr}
                        style={[styles.chart, styles.barChartWithPad, styles.barChartNoOuterMargin]}
                        fromZero={false}
                        showValuesOnTopOfBars={false}
                        showBarTops
                        yAxisSuffix=""
                        segments={4}
                      />
                      <Pressable
                        style={styles.barChartTouchOverlay}
                        accessibilityLabel="查看心率柱形数值"
                        onPress={(e) => {
                          const idx = barIndexFromTouch(
                            getPressLocationX(e),
                            values.length,
                            chartWidth,
                            64,
                            chartConfigWeekBarHr.barPercentage ?? 0.52
                          );
                          if (idx < 0 || idx >= values.length) return;
                          const label = weekHr.labels[idx];
                          const v = values[idx];
                          if (label == null || !Number.isFinite(Number(v))) return;
                          showChartMessage(
                            `${label} 日均心率 ${Math.round(Number(v))} bpm`
                          );
                        }}
                      />
                    </View>
                  )}
                </Card.Content>
              </Card>
            );
          } catch (e) {
            console.warn('心率图表渲染失败:', e);
            return null;
          }
        })()}

        {/* 血糖：日折线 / 周柱形 */}
        {healthData.bloodGlucose.length > 0 && (() => {
          try {
            const dayG = buildDayHourlyAverage(healthData.bloodGlucose, new Date());
            const weekG = buildRollingDailyAverage(healthData.bloodGlucose, 7);
            const useDay = glucoseRange === 'day';
            const values = useDay ? dayG.data : weekG.data;
            const labels = useDay ? hourlyLineChartLabels() : weekG.labels;
            if (!hasNonZero(values)) return null;
            const gPad = paddedYRange(values.filter((v) => Number(v) > 0), {
              absoluteMinPad: 0.15,
              padRatio: 0.12,
            });
            const lineDisplay = useDay
              ? values.map((v) => (Number(v) > 0 ? Number(v) : gPad.yMin))
              : values;
            const chartData = useDay
              ? {
                  labels,
                  datasets: lineChartBoundedDatasets(lineDisplay, gPad.yMin, gPad.yMax),
                }
              : { labels, datasets: [{ data: values }] };
            return (
              <Card style={styles.card}>
                <Card.Content>
                  <Title style={styles.sectionTitle}>血糖变化</Title>
                  <Paragraph style={styles.chartHint}>
                    日视图(必须包含当日数据)：折线为当日每小时平均血糖 (mmol/L)。周视图：柱高为近 7 天日均。点击数据点或柱子查看数值。
                  </Paragraph>
                  <SegmentedButtons
                    value={glucoseRange}
                    onValueChange={setGlucoseRange}
                    buttons={[
                      { value: 'day', label: '日血糖', labelStyle: styles.segmentLabel },
                      { value: 'week', label: '周血糖', labelStyle: styles.segmentLabel },
                    ]}
                    style={styles.segmented}
                  />
                  {useDay ? (
                    <LineChart
                      data={chartData}
                      width={chartWidth}
                      height={220}
                      chartConfig={chartConfigGlucose}
                      bezier
                      fromZero={false}
                      withShadow={false}
                      segments={4}
                      style={styles.chart}
                      onDataPointClick={({ index, value }) => {
                        const raw = dayG.data[index];
                        const v = Number(raw);
                        const msg =
                          v > 0
                            ? `${index}时 平均血糖 ${v.toFixed(1)} mmol/L`
                            : `${index}时 暂无采样`;
                        showChartMessage(msg);
                      }}
                    />
                  ) : (
                    <View style={styles.barChartTouchWrap}>
                      <BarChart
                        data={chartData}
                        width={chartWidth}
                        height={220}
                        chartConfig={chartConfigWeekBarGlucose}
                        style={[styles.chart, styles.barChartWithPad, styles.barChartNoOuterMargin]}
                        fromZero={false}
                        showValuesOnTopOfBars={false}
                        showBarTops
                        yAxisSuffix=""
                        segments={4}
                      />
                      <Pressable
                        style={styles.barChartTouchOverlay}
                        accessibilityLabel="查看血糖柱形数值"
                        onPress={(e) => {
                          const idx = barIndexFromTouch(
                            getPressLocationX(e),
                            values.length,
                            chartWidth,
                            64,
                            chartConfigWeekBarGlucose.barPercentage ?? 0.52
                          );
                          if (idx < 0 || idx >= values.length) return;
                          const label = weekG.labels[idx];
                          const v = values[idx];
                          if (label == null || !Number.isFinite(Number(v))) return;
                          showChartMessage(
                            `${label} 日均血糖 ${Number(v).toFixed(1)} mmol/L`
                          );
                        }}
                      />
                    </View>
                  )}
                </Card.Content>
              </Card>
            );
          } catch (e) {
            console.warn('血糖图表渲染失败:', e);
            return null;
          }
        })()}

        {/* 睡眠：近 7 晚堆叠细柱（总高 = 总睡眠；自下而上：深睡→REM→浅睡→清醒） */}
        {healthData.sleep.length > 0 && (() => {
          try {
            const sortedSleep = [...(healthData.sleep || [])]
              .filter(Boolean)
              .sort((a, b) => new Date(a.date) - new Date(b.date))
              .slice(-7)
              .filter(
                (s) =>
                  Number(s.totalHours != null ? s.totalHours : s.value || 0) > 0
              );
            if (!sortedSleep.length) return null;
            const totalVals = sortedSleep.map((s) =>
              Number(s.totalHours != null ? s.totalHours : s.value || 0)
            );
            const maxCap = Math.max(8, ...totalVals, 0.1);
            const trackH = 128;
            const barW = 12;
            const sleepYTicks = [maxCap, (maxCap * 3) / 4, maxCap / 2, maxCap / 4, 0];

            return (
              <Card style={styles.card}>
                <Card.Content>
                  <Title style={styles.sectionTitle}>睡眠</Title>
                  <Paragraph style={styles.chartHint}>
                    每根细柱高度表示当晚总睡眠；柱内自下而上为：深睡、REM、浅睡、清醒。点击彩色分段可查看阶段与时长。背景网格为虚线，与心率/血糖图一致。
                  </Paragraph>
                  <View style={styles.sleepChartWithAxis}>
                    <View style={[styles.sleepYAxisWrap, { paddingBottom: 34 }]}>
                      <Text style={styles.sleepYAxisCaption}>时长</Text>
                      <View style={[styles.sleepYAxisTicks, { height: trackH }]}>
                        {sleepYTicks.map((v, k) => {
                          const yFromBottom = (trackH * (4 - k)) / 4;
                          const label =
                            v <= 0 ? '0' : Number(v).toFixed(1).replace(/\.0$/, '');
                          const labelBottom =
                            yFromBottom <= 0 ? 0 : yFromBottom - 5;
                          return (
                            <Text
                              key={k}
                              style={[
                                styles.sleepYAxisLabel,
                                { bottom: labelBottom },
                              ]}
                            >
                              {label}
                            </Text>
                          );
                        })}
                      </View>
                      <Text style={styles.sleepYAxisUnit}>(h)</Text>
                    </View>
                    <View style={styles.sleepBarsFlex}>
                      <View style={[styles.sleepStackRow, styles.sleepStackRowGrid]}>
                        <SleepDashedGrid
                          height={trackH}
                          bottomInset={34}
                          stroke={chartConfig.color(0.2)}
                          nDays={sortedSleep.length}
                        />
                        {sortedSleep.map((s) => {
                          const total = Number(
                            s.totalHours != null ? s.totalHours : s.value || 0
                          );
                          const deep = Math.max(0, Number(s.deepHours ?? 0));
                          const rem = Math.max(0, Number(s.remHours ?? 0));
                          const light = Math.max(0, Number(s.lightHours ?? 0));
                          const awake = Math.max(0, Number(s.awakeHours ?? 0));
                          const scale = trackH / maxCap;
                          const H = Math.max(6, total * scale);
                          const hAwake = Math.max(0, awake * scale);
                          const hLight = Math.max(0, light * scale);
                          const hRem = Math.max(0, rem * scale);
                          const hDeep = Math.max(0, deep * scale);
                          const d = new Date(s.date);
                          const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
                          return (
                            <View key={s.date} style={styles.sleepStackCell}>
                              <View style={[styles.sleepStackTrack, { height: trackH }]}>
                                <View
                                  style={[
                                    styles.sleepStackBarInner,
                                    { height: H, width: barW },
                                  ]}
                                >
                                  <View
                                    style={{
                                      height: H,
                                      width: barW,
                                      flexDirection: 'column-reverse',
                                      borderRadius: 5,
                                      overflow: 'hidden',
                                    }}
                                  >
                                    {hDeep > 0.25 ? (
                                      <Pressable
                                        accessibilityRole="button"
                                        onPress={() =>
                                          showChartMessage(
                                            `深睡 ${deep.toFixed(1)} 小时 · ${dateStr}`
                                          )
                                        }
                                        style={{ height: hDeep, backgroundColor: '#1e3a8a' }}
                                      />
                                    ) : null}
                                    {hRem > 0.25 ? (
                                      <Pressable
                                        accessibilityRole="button"
                                        onPress={() =>
                                          showChartMessage(
                                            `REM ${rem.toFixed(1)} 小时 · ${dateStr}`
                                          )
                                        }
                                        style={{ height: hRem, backgroundColor: '#6366f1' }}
                                      />
                                    ) : null}
                                    {hLight > 0.25 ? (
                                      <Pressable
                                        accessibilityRole="button"
                                        onPress={() =>
                                          showChartMessage(
                                            `浅睡 ${light.toFixed(1)} 小时 · ${dateStr}`
                                          )
                                        }
                                        style={{ height: hLight, backgroundColor: '#93c5fd' }}
                                      />
                                    ) : null}
                                    {hAwake > 0.25 ? (
                                      <Pressable
                                        accessibilityRole="button"
                                        onPress={() =>
                                          showChartMessage(
                                            `清醒 ${awake.toFixed(1)} 小时 · ${dateStr}`
                                          )
                                        }
                                        style={{ height: hAwake, backgroundColor: '#94a3b8' }}
                                      />
                                    ) : null}
                                  </View>
                                </View>
                              </View>
                              <Text style={styles.sleepStackDayLabel}>{dateStr}</Text>
                              <Text style={styles.sleepStackHoursHint}>{total}h</Text>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                  <View style={styles.sleepLegendRow}>
                    <View style={styles.sleepLegendItem}>
                      <View style={[styles.sleepLegendDot, { backgroundColor: '#1e3a8a' }]} />
                      <Text style={styles.sleepLegendText}>深睡</Text>
                    </View>
                    <View style={styles.sleepLegendItem}>
                      <View style={[styles.sleepLegendDot, { backgroundColor: '#6366f1' }]} />
                      <Text style={styles.sleepLegendText}>REM</Text>
                    </View>
                    <View style={styles.sleepLegendItem}>
                      <View style={[styles.sleepLegendDot, { backgroundColor: '#93c5fd' }]} />
                      <Text style={styles.sleepLegendText}>浅睡</Text>
                    </View>
                    <View style={styles.sleepLegendItem}>
                      <View style={[styles.sleepLegendDot, { backgroundColor: '#94a3b8' }]} />
                      <Text style={styles.sleepLegendText}>清醒</Text>
                    </View>
                  </View>
                </Card.Content>
              </Card>
            );
          } catch (e) {
            console.warn('睡眠区块渲染失败:', e);
            return null;
          }
        })()}

        {/* Excel：模板与分项导入 */}
        <Card style={styles.card}>
          <Card.Content>
            <Title style={styles.sectionTitle}>血糖 / 睡眠 Excel 导入</Title>
            <Paragraph style={styles.chartHint}>
              先下载对应模板（.xlsx），按首行表头填写数据；血糖与睡眠需分开选择文件导入。日期支持「2025-04-29」或
              Excel 日期格式；时间列可填 08:30。睡眠表仅需「日期」与「总睡眠(小时)」，其余列可留空（将按比例估算）。
            </Paragraph>
            <Paragraph style={[styles.chartHint, styles.appleImportHint]}>
              Apple 健康：在 iPhone
              导出中的「导出.xml」可选择导入睡眠分析（HKCategoryTypeIdentifierSleepAnalysis）。总睡眠不含「在床」时段；深睡/核心/REM/未分类计入总时长，午睡与当天夜间睡眠按结束日合并为一条。
            </Paragraph>
            <View style={styles.deviceButtons}>
              <Button
                mode="outlined"
                icon="file-excel"
                onPress={() =>
                  runExcelTask('tpl-glucose', () => downloadGlucoseTemplate())
                }
                style={styles.deviceButton}
                disabled={!!excelBusy}
                loading={excelBusy === 'tpl-glucose'}
              >
                下载血糖模板
              </Button>
              <Button
                mode="outlined"
                icon="file-excel"
                onPress={() =>
                  runExcelTask('tpl-sleep', () => downloadSleepTemplate())
                }
                style={styles.deviceButton}
                disabled={!!excelBusy}
                loading={excelBusy === 'tpl-sleep'}
              >
                下载睡眠模板
              </Button>
            </View>
            <View style={[styles.deviceButtons, styles.importExcelRow]}>
              <Button
                mode="contained"
                icon="upload"
                onPress={() =>
                  runExcelTask('import-glucose', () =>
                    importFromWorkbook('glucose')
                  )
                }
                style={styles.deviceButton}
                disabled={!!excelBusy}
                loading={excelBusy === 'import-glucose'}
                buttonColor={theme.colors.secondary}
              >
                导入血糖
              </Button>
              <Button
                mode="contained"
                icon="upload"
                onPress={() =>
                  runExcelTask('import-sleep', () =>
                    importFromWorkbook('sleep')
                  )
                }
                style={styles.deviceButton}
                disabled={!!excelBusy}
                loading={excelBusy === 'import-sleep'}
                buttonColor={theme.colors.accent}
              >
                导入睡眠
              </Button>
            </View>
            <View style={[styles.deviceButtons, styles.importExcelRow]}>
              <Button
                mode="outlined"
                icon="file-document-outline"
                onPress={() =>
                  runExcelTask('import-apple-sleep', () =>
                    importAppleHealthSleepFromExportXml()
                  )
                }
                style={[styles.deviceButton, styles.appleXmlFullWidth]}
                disabled={!!excelBusy}
                loading={excelBusy === 'import-apple-sleep'}
              >
                导入 Apple 健康睡眠
              </Button>
            </View>
          </Card.Content>
        </Card>

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
    <Snackbar
      visible={chartSnackbar.visible}
      onDismiss={() => setChartSnackbar((x) => ({ ...x, visible: false }))}
      duration={2600}
      style={styles.chartSnackbar}
    >
      {chartSnackbar.message}
    </Snackbar>
    </Fragment>
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
  loadErrorText: {
    ...textStyles.body,
    color: '#E65100',
    textAlign: 'center',
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
    ...textStyles.title,
    fontSize: 18,
    marginBottom: theme.spacing.md,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
    marginTop: theme.spacing.md,
  },
  statItem: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  statValue: {
    ...textStyles.emphasis,
    fontSize: 24,
    color: theme.colors.text,
    marginTop: theme.spacing.xs,
  },
  statLabel: {
    ...textStyles.body,
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
  },
  hrMonitorHint: {
    ...textStyles.body,
    fontSize: 10,
    color: theme.colors.textSecondary,
    marginTop: 10,
    textAlign: 'center',
    width: '100%',
    paddingHorizontal: 6,
    lineHeight: 14,
  },
  emptyDevices: {
    alignItems: 'center',
    paddingVertical: theme.spacing.lg,
  },
  emptyText: {
    ...textStyles.body,
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
    ...textStyles.emphasis,
    fontSize: 16,
    color: theme.colors.text,
  },
  deviceStatus: {
    ...textStyles.body,
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  nearbySection: {
    marginTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.outlineVariant,
    paddingTop: theme.spacing.sm,
  },
  nearbyTitle: {
    ...textStyles.title,
    fontSize: 14,
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
    ...textStyles.body,
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  chart: {
    marginVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
  },
  barChartWithPad: {
    paddingRight: 64,
    paddingTop: 16,
  },
  barChartNoOuterMargin: {
    marginVertical: 0,
  },
  barChartTouchWrap: {
    position: 'relative',
    height: 220,
    alignSelf: 'center',
    marginVertical: theme.spacing.sm,
  },
  barChartTouchOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  chartSnackbar: {
    marginHorizontal: 16,
    marginBottom: 24,
  },
  sleepChartWithAxis: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  sleepYAxisWrap: {
    width: 40,
    alignItems: 'flex-end',
    paddingRight: 4,
  },
  sleepYAxisCaption: {
    ...textStyles.body,
    fontSize: 10,
    color: theme.colors.textSecondary,
    marginBottom: 4,
  },
  sleepYAxisTicks: {
    position: 'relative',
    width: '100%',
  },
  sleepYAxisLabel: {
    ...textStyles.body,
    position: 'absolute',
    right: 0,
    fontSize: 10,
    lineHeight: 10,
    color: theme.colors.textSecondary,
    textAlign: 'right',
  },
  sleepYAxisUnit: {
    ...textStyles.body,
    fontSize: 9,
    color: theme.colors.textSecondary,
    marginTop: 4,
  },
  sleepBarsFlex: {
    flex: 1,
  },
  segmented: {
    marginBottom: theme.spacing.sm,
  },
  segmentLabel: {
    ...textStyles.semi,
    fontSize: 13,
  },
  chartHint: {
    ...textStyles.body,
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.sm,
    lineHeight: 18,
  },
  sleepStackRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    marginTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    minHeight: 150,
    position: 'relative',
  },
  sleepStackRowGrid: {
    paddingBottom: 34,
  },
  sleepGridPlane: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 0,
  },
  sleepStackCell: {
    flex: 1,
    alignItems: 'center',
    maxWidth: 56,
    zIndex: 1,
  },
  sleepStackTrack: {
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginBottom: 4,
  },
  sleepStackBarInner: {
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sleepStackDayLabel: {
    ...textStyles.body,
    fontSize: 10,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  sleepStackHoursHint: {
    ...textStyles.body,
    fontSize: 9,
    color: theme.colors.textSecondary,
    marginTop: 1,
  },
  sleepLegendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginTop: theme.spacing.md,
  },
  sleepLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sleepLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  sleepLegendText: {
    ...textStyles.body,
    fontSize: 11,
    color: theme.colors.textSecondary,
  },
  exportButton: {
    borderRadius: theme.borderRadius.md,
  },
  importExcelRow: {
    marginTop: theme.spacing.sm,
  },
  appleImportHint: {
    marginTop: theme.spacing.xs,
  },
  appleXmlFullWidth: {
    flex: 1,
    minWidth: '100%',
  },
});


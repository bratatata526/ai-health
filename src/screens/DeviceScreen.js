import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Dimensions,
  Platform,
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

const { width } = Dimensions.get('window');

export default function DeviceScreen() {
  const [devices, setDevices] = useState([]);
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

  useEffect(() => {
    loadData();
    // 模拟实时数据更新
    const interval = setInterval(() => {
      loadData();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    const deviceData = await DeviceService.getConnectedDevices();
    const data = await DeviceService.getHealthData();
    
    setDevices(deviceData);
    setHealthData(data);
    
    // 计算今日统计数据
    const today = new Date().toDateString();
    const todayData = data.heartRate.filter(
      (item) => new Date(item.date).toDateString() === today
    );
    
    if (todayData.length > 0) {
      const avgHeartRate = todayData.reduce((sum, item) => sum + item.value, 0) / todayData.length;
      const latestGlucose = data.bloodGlucose[data.bloodGlucose.length - 1]?.value || 0;
      const latestSleep = data.sleep[data.sleep.length - 1]?.value || 0;
      
      setTodayStats({
        heartRate: Math.round(avgHeartRate),
        bloodGlucose: latestGlucose,
        sleep: latestSleep,
      });
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
    // 按天聚合数据，计算每天的平均值
    const dailyMap = {};
    data.forEach((item) => {
      const date = new Date(item.date);
      const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
      if (!dailyMap[key]) {
        dailyMap[key] = { sum: 0, count: 0, date };
      }
      dailyMap[key].sum += parseFloat(item.value);
      dailyMap[key].count += 1;
    });

    // 按日期排序，取最近7天
    const sortedDays = Object.values(dailyMap)
      .sort((a, b) => a.date - b.date)
      .slice(-7);

    return {
      labels: sortedDays.map(
        (d) => `${d.date.getMonth() + 1}/${d.date.getDate()}`
      ),
      datasets: [
        {
          data: sortedDays.map((d) =>
            parseFloat((d.sum / d.count).toFixed(1))
          ),
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
        {/* 今日统计 */}
        <Card style={styles.statsCard}>
          <Card.Content>
            <Title style={styles.sectionTitle}>今日数据</Title>
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Ionicons name="heart" size={32} color={theme.colors.error} />
                <Text style={styles.statValue}>{todayStats.heartRate}</Text>
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
            {devices.length === 0 ? (
              <View style={styles.emptyDevices}>
                <Paragraph style={styles.emptyText}>暂无连接设备</Paragraph>
                <View style={styles.deviceButtons}>
                  <Button
                    mode="outlined"
                    icon="watch"
                    onPress={() => connectDevice('bracelet')}
                    style={styles.deviceButton}
                  >
                    连接手环
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
                </View>
              ))
            )}
          </Card.Content>
        </Card>

        {/* 心率图表 */}
        {healthData.heartRate.length > 0 && (
          <Card style={styles.card}>
            <Card.Content>
              <Title style={styles.sectionTitle}>心率趋势</Title>
              <LineChart
                data={prepareChartData(healthData.heartRate, '心率')}
                width={width - 64}
                height={220}
                chartConfig={chartConfig}
                bezier
                style={styles.chart}
              />
            </Card.Content>
          </Card>
        )}

        {/* 血糖图表 */}
        {healthData.bloodGlucose.length > 0 && (
          <Card style={styles.card}>
            <Card.Content>
              <Title style={styles.sectionTitle}>血糖趋势</Title>
              <LineChart
                data={prepareChartData(healthData.bloodGlucose, '血糖')}
                width={width - 64}
                height={220}
                chartConfig={chartConfig}
                bezier
                style={styles.chart}
              />
            </Card.Content>
          </Card>
        )}

        {/* 睡眠图表 */}
        {healthData.sleep.length > 0 && (
          <Card style={styles.card}>
            <Card.Content>
              <Title style={styles.sectionTitle}>睡眠时长</Title>
              <LineChart
                data={prepareChartData(healthData.sleep, '睡眠')}
                width={width - 64}
                height={220}
                chartConfig={chartConfig}
                bezier
                style={styles.chart}
              />
            </Card.Content>
          </Card>
        )}

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
  chart: {
    marginVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
  },
  exportButton: {
    borderRadius: theme.borderRadius.md,
  },
});


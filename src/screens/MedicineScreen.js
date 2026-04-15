import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  Image,
  TouchableOpacity,
  Platform,
} from 'react-native';
import {
  Card,
  Title,
  Paragraph,
  Button,
  Text,
  FAB,
  Chip,
  Dialog,
  Portal,
  TextInput,
  ActivityIndicator,
  SegmentedButtons,
  ProgressBar,
  Switch,
  Divider,
} from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import ClockIcon from '../components/ClockIcon';
import DatePicker from '../components/DatePicker';
import AIGeneratedIcon from '../components/AIGeneratedIcon';
import { theme } from '../theme';
import { MedicineService } from '../services/MedicineService';
import { ExportService } from '../services/ExportService';
import { validateMedicineName, validateTimesText, validateDateRange } from '../utils/validation';

export default function MedicineScreen() {
  const [medicines, setMedicines] = useState([]);
  const [todayRemindersByMedicine, setTodayRemindersByMedicine] = useState({}); // { [medicineId]: Reminder[] }
  const [dialogVisible, setDialogVisible] = useState(false);
  const [sourceDialogVisible, setSourceDialogVisible] = useState(false);
  const [selectedImages, setSelectedImages] = useState([]);
  const [recognizing, setRecognizing] = useState(false);
  const [editingMedicine, setEditingMedicine] = useState(null); // 正在编辑的药品
  const [medicineDetails, setMedicineDetails] = useState(null); // 药品详细信息（来自数据库）
  const [detailsDialogVisible, setDetailsDialogVisible] = useState(false); // 详情对话框
  const [selectedImageForOCR, setSelectedImageForOCR] = useState(null); // 选择用于OCR识别的图片
  const [recognitionResult, setRecognitionResult] = useState(null); // 识别结果
  const [errorDialogVisible, setErrorDialogVisible] = useState(false); // 错误对话框
  const [errorMessage, setErrorMessage] = useState(''); // 错误信息

  // 手动录入兜底
  const [manualEntryMode, setManualEntryMode] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualDosage, setManualDosage] = useState('');
  const [manualFrequency, setManualFrequency] = useState('');

  // 提醒设置与统计
  const [reminderSettingsVisible, setReminderSettingsVisible] = useState(false);
  const [statsVisible, setStatsVisible] = useState(false);
  const [activeMedicineForSettings, setActiveMedicineForSettings] = useState(null);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderPaused, setReminderPaused] = useState(false);
  const [reminderTimesText, setReminderTimesText] = useState('08:00,20:00');
  // 开始日期默认为今天（必填）
  const getTodayDate = () => new Date().toISOString().split('T')[0];
  const [therapyStartDate, setTherapyStartDate] = useState(getTodayDate());
  const [therapyEndDate, setTherapyEndDate] = useState('');
  const [statsData, setStatsData] = useState(null);

  // 新：结构化用药/提醒规则
  const [reminderMode, setReminderMode] = useState('fixed_times'); // fixed_times | times_per_day | interval_hours | prn
  const [timesPerDay, setTimesPerDay] = useState('2');
  const [intervalHours, setIntervalHours] = useState('8');
  const [intervalStartTime, setIntervalStartTime] = useState('08:00');
  const [mealTag, setMealTag] = useState('none'); // none | before_meal | after_meal | bedtime
  const [doseAmount, setDoseAmount] = useState('1');
  const [doseUnit, setDoseUnit] = useState('片');

  // 新：库存/到期/复购
  const [stockDialogVisible, setStockDialogVisible] = useState(false);
  const [stockEnabled, setStockEnabled] = useState(true);
  const [stockCurrent, setStockCurrent] = useState('');
  const [stockUnit, setStockUnit] = useState('片');
  const [stockThreshold, setStockThreshold] = useState('');
  const [expiryDate, setExpiryDate] = useState(''); // YYYY-MM-DD
  const [expiryRemindDays, setExpiryRemindDays] = useState('7');
  const [activeMedicineForStock, setActiveMedicineForStock] = useState(null);

  // 新：历史时间轴
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyText, setHistoryText] = useState('');
  const [activeMedicineForHistory, setActiveMedicineForHistory] = useState(null);
  const [historyStartDate, setHistoryStartDate] = useState(''); // 历史记录的起始日期

  // 新：漏服补服指导
  const [guidanceVisible, setGuidanceVisible] = useState(false);
  const [guidanceText, setGuidanceText] = useState('');

  useEffect(() => {
    loadMedicines();
    requestPermissions();
  }, []);

  const medicinesById = useMemo(() => {
    return new Map(medicines.map((m) => [m.id, m]));
  }, [medicines]);

  const formatTime = (iso) => {
    try {
      const d = new Date(iso);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    } catch {
      return '';
    }
  };

  const getDisplayDose = (medicine) => {
    const cfg = medicine?.reminderConfig || {};
    if (cfg.doseAmount && cfg.doseUnit) return `每次${cfg.doseAmount}${cfg.doseUnit}`;
    return medicine?.dosage || '每次1片';
  };

  const getDisplayFrequency = (medicine) => {
    const cfg = medicine?.reminderConfig || {};
    const mode = cfg.mode || (Array.isArray(cfg.times) && cfg.times.length ? 'fixed_times' : null);
    const meal =
      cfg.mealTag === 'before_meal'
        ? '饭前'
        : cfg.mealTag === 'after_meal'
        ? '饭后'
        : cfg.mealTag === 'bedtime'
        ? '睡前'
            : '';
    let base = '';
    if (mode === 'prn') base = '按需';
    else if (mode === 'interval_hours') base = `每隔${cfg.intervalHours || 8}小时`;
    else if (mode === 'times_per_day') base = `每日${cfg.timesPerDay || 2}次`;
    else if (Array.isArray(cfg.times) && cfg.times.length) base = `定点: ${cfg.times.join(',')}`;
    else base = medicine?.frequency || '每日2次';
    return meal ? `${base}（${meal}）` : base;
  };

  // 根据提醒模式返回对应的图标
  const getReminderIcon = (medicine) => {
    const cfg = medicine?.reminderConfig || {};
    const mode = cfg.mode || (Array.isArray(cfg.times) && cfg.times.length ? 'fixed_times' : null);
    
    if (mode === 'fixed_times') {
      return <ClockIcon size={18} color={theme.colors.primary} />;
    } else if (mode === 'interval_hours') {
      return <Ionicons name="timer-outline" size={18} color={theme.colors.primary} />;
    } else if (mode === 'times_per_day') {
      return <Ionicons name="repeat-outline" size={18} color={theme.colors.primary} />;
    } else if (mode === 'prn') {
      return <Ionicons name="hand-right-outline" size={18} color={theme.colors.primary} />;
    }
    return <Ionicons name="time-outline" size={18} color={theme.colors.primary} />;
  };

  const requestPermissions = async () => {
    try {
      // Web平台不需要请求这些权限
      if (Platform.OS === 'web') {
        return;
      }
      
      const { status: cameraStatus } = await ImagePicker.requestCameraPermissionsAsync();
      const { status: notificationStatus } = await Notifications.requestPermissionsAsync();
      
      if (cameraStatus !== 'granted' || notificationStatus !== 'granted') {
        Alert.alert('权限提示', '需要相机和通知权限才能使用完整功能');
      }
    } catch (error) {
      console.log('权限请求失败:', error);
      // Web平台上忽略权限错误
    }
  };

  const loadMedicines = async () => {
    const data = await MedicineService.getAllMedicines();
    setMedicines(data);
    // 同步加载“今日提醒”
    try {
      const pairs = await Promise.all(
        data.map(async (m) => [m.id, await MedicineService.getTodayReminders(m.id)])
      );
      setTodayRemindersByMedicine(Object.fromEntries(pairs));
    } catch (e) {
      console.warn('加载今日提醒失败:', e);
    }
  };

  const refreshTodayReminders = async () => {
    try {
      const pairs = await Promise.all(
        medicines.map(async (m) => [m.id, await MedicineService.getTodayReminders(m.id)])
      );
      setTodayRemindersByMedicine(Object.fromEntries(pairs));
    } catch (e) {
      console.warn('刷新今日提醒失败:', e);
    }
  };

  const markTaken = async (medicineId, reminderId) => {
    try {
      await MedicineService.markReminderTaken({ medicineId, reminderId });
      await refreshTodayReminders();
    } catch (e) {
      Alert.alert('错误', e.message || '打卡失败，请重试');
    }
  };

  const snooze10m = async (medicineId, reminderId) => {
    try {
      await MedicineService.snoozeReminderMinutes({ medicineId, reminderId, minutes: 10 });
      await refreshTodayReminders();
    } catch (e) {
      Alert.alert('错误', e.message || '稍后提醒失败，请重试');
    }
  };

  const snoozePick = (medicineId, reminderId) => {
    Alert.alert(
      '稍后提醒',
      '选择推迟时间：',
      [
        { text: '取消', style: 'cancel' },
        { text: '5分钟', onPress: () => MedicineService.snoozeReminderMinutes({ medicineId, reminderId, minutes: 5 }).then(refreshTodayReminders) },
        { text: '15分钟', onPress: () => MedicineService.snoozeReminderMinutes({ medicineId, reminderId, minutes: 15 }).then(refreshTodayReminders) },
        { text: '30分钟', onPress: () => MedicineService.snoozeReminderMinutes({ medicineId, reminderId, minutes: 30 }).then(refreshTodayReminders) },
      ]
    );
  };

  const openReminderSettings = (medicine) => {
    setActiveMedicineForSettings(medicine);
    const cfg = medicine.reminderConfig || {};
    setReminderEnabled(cfg.enabled !== false);
    setReminderPaused(cfg.paused === true);
    setReminderMode(cfg.mode || (Array.isArray(cfg.times) && cfg.times.length ? 'fixed_times' : 'fixed_times'));
    setReminderTimesText(Array.isArray(cfg.times) && cfg.times.length ? cfg.times.join(',') : '08:00,20:00');
    setTimesPerDay(String(cfg.timesPerDay || '2'));
    setIntervalHours(String(cfg.intervalHours || '8'));
    setIntervalStartTime(String(cfg.intervalStartTime || '08:00'));
    setMealTag(String(cfg.mealTag || 'none'));
    setDoseAmount(String(cfg.doseAmount || (medicine.dosage?.match(/([0-9]+(?:\.[0-9]+)?)/)?.[1] || '1')));
    setDoseUnit(String(cfg.doseUnit || (medicine.dosage?.match(/([^\d\s/]+)\s*$/)?.[1] || '片')));
    // 开始日期必填，如果没有则默认为今天
    const today = new Date().toISOString().split('T')[0];
    setTherapyStartDate(cfg.startDate || today);
    setTherapyEndDate(cfg.endDate || '');
    setReminderSettingsVisible(true);
  };

  const saveReminderSettings = async () => {
    if (!activeMedicineForSettings) return;
    const dr = validateDateRange(therapyStartDate, therapyEndDate);
    if (!dr.ok) {
      Alert.alert('提示', dr.message);
      return;
    }
    try {
      const patch = {
        enabled: reminderEnabled,
        paused: reminderPaused,
        mode: reminderMode,
        mealTag,
        doseAmount: Number(doseAmount),
        doseUnit: String(doseUnit || '').trim(),
        startDate: therapyStartDate || undefined,
        endDate: therapyEndDate || undefined,
      };

      if (reminderMode === 'fixed_times') {
        const vt = validateTimesText(reminderTimesText);
        if (!vt.ok) {
          Alert.alert('提示', vt.message);
          return;
        }
        patch.times = vt.times;
      } else if (reminderMode === 'times_per_day') {
        patch.timesPerDay = Number(timesPerDay || 2);
        patch.times = undefined;
      } else if (reminderMode === 'interval_hours') {
        // 基础校验交给 service.validateReminderConfigPatch，这里只做空值提示
        if (!intervalHours || Number(intervalHours) <= 0) {
          Alert.alert('提示', '请填写间隔小时（1-24）');
          return;
        }
        if (!intervalStartTime) {
          Alert.alert('提示', '请填写起始时间（HH:MM）');
          return;
        }
        patch.intervalHours = Number(intervalHours);
        patch.intervalStartTime = intervalStartTime;
        patch.times = undefined;
      } else if (reminderMode === 'prn') {
        // 按需：不生成提醒，仅保留配置用于展示/统计
        patch.times = undefined;
      }

      await MedicineService.updateReminderConfig(activeMedicineForSettings.id, {
        ...patch,
      });
      setReminderSettingsVisible(false);
      await loadMedicines();
      Alert.alert('成功', '提醒设置已更新');
    } catch (e) {
      Alert.alert('失败', e.message || '保存提醒设置失败');
    }
  };

  const openStockDialog = (medicine) => {
    setActiveMedicineForStock(medicine);
    const s = medicine.stock || {};
    setStockEnabled(s.enabled !== false);
    setStockCurrent(s.current != null ? String(s.current) : '');
    setStockUnit(String(s.unit || '片'));
    setStockThreshold(s.threshold != null ? String(s.threshold) : '');
    setExpiryDate(String(s.expiryDate || ''));
    setExpiryRemindDays(String(s.expiryRemindDays ?? 7));
    setStockDialogVisible(true);
  };

  const saveStockConfig = async () => {
    if (!activeMedicineForStock) return;
    try {
      await MedicineService.updateStockConfig(activeMedicineForStock.id, {
        enabled: stockEnabled,
        current: stockCurrent === '' ? undefined : Number(stockCurrent),
        unit: stockUnit,
        threshold: stockThreshold === '' ? undefined : Number(stockThreshold),
        expiryDate: expiryDate || undefined,
        expiryRemindDays: expiryRemindDays ? Number(expiryRemindDays) : 7,
      });
      setStockDialogVisible(false);
      await loadMedicines();
      Alert.alert('成功', '库存/到期设置已更新');
    } catch (e) {
      Alert.alert('失败', e.message || '保存失败');
    }
  };

  // 用于存储历史记录的数组（用于渲染时间轴）
  const [historyItems, setHistoryItems] = useState([]);

  // 根据状态返回图标和颜色
  const getStatusConfig = (status) => {
    switch (status) {
      case 'taken':
        return {
          icon: 'checkmark-circle',
          color: theme.colors.success || '#4CAF50',
          bgColor: '#E8F5E9',
          label: '已服',
        };
      case 'missed':
        return {
          icon: 'close-circle',
          color: theme.colors.error,
          bgColor: '#FFEBEE',
          label: '漏服',
        };
      case 'snoozed':
        return {
          icon: 'time',
          color: theme.colors.warning || '#FF9800',
          bgColor: '#FFF3E0',
          label: '稍后',
        };
      case 'paused':
        return {
          icon: 'pause-circle',
          color: theme.colors.textSecondary,
          bgColor: '#F5F5F5',
          label: '暂停',
        };
      default:
        return {
          icon: 'radio-button-off',
          color: theme.colors.primary,
          bgColor: '#E3F2FD',
          label: '待服',
        };
    }
  };

  const loadHistoryData = async (medicine, startDateStr) => {
    try {
      const days = 7; // 固定显示7天
      const reminders = await MedicineService.getRemindersForMedicine(medicine.id);
      const logs = await MedicineService.getIntakeLogs(medicine.id);
      
      // 安全解析日期字符串（避免时区问题）
      const parseLocalDate = (dateStr) => {
        if (!dateStr) return null;
        const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (match) {
          const year = parseInt(match[1], 10);
          const month = parseInt(match[2], 10) - 1; // 月份从0开始
          const day = parseInt(match[3], 10);
          return new Date(year, month, day);
        }
        return null;
      };
      
      // 确定起始日期
      let startDate;
      if (startDateStr) {
        startDate = parseLocalDate(startDateStr);
        if (!startDate) {
          // 如果解析失败，使用默认值
          const now = new Date();
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          startDate.setDate(startDate.getDate() - (days - 1));
        }
      } else {
        // 如果没有指定起始日期，默认显示最近7天
        const now = new Date();
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startDate.setDate(startDate.getDate() - (days - 1));
      }
      startDate.setHours(0, 0, 0, 0);
      
      // 计算结束日期（起始日期后7天）
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + days - 1);
      endDate.setHours(23, 59, 59, 999);
      
      const items = reminders
        .filter((r) => {
          if (!r || !r.scheduledAt) return false;
          try {
            const scheduledDate = new Date(r.scheduledAt);
            if (isNaN(scheduledDate.getTime())) return false;
            // 只比较日期部分，忽略时间，确保同一天的所有提醒都能显示
            const scheduledDateOnly = new Date(
              scheduledDate.getFullYear(), 
              scheduledDate.getMonth(), 
              scheduledDate.getDate()
            );
            const startDateOnly = new Date(
              startDate.getFullYear(), 
              startDate.getMonth(), 
              startDate.getDate()
            );
            const endDateOnly = new Date(
              endDate.getFullYear(), 
              endDate.getMonth(), 
              endDate.getDate()
            );
            // 使用时间戳比较，更可靠
            const scheduledTime = scheduledDateOnly.getTime();
            const startTime = startDateOnly.getTime();
            const endTime = endDateOnly.getTime();
            return scheduledTime >= startTime && scheduledTime <= endTime;
          } catch (e) {
            console.warn('过滤提醒记录时出错:', e, r);
            return false;
          }
        })
        .sort((a, b) => {
          try {
            const dateA = new Date(a.scheduledAt);
            const dateB = new Date(b.scheduledAt);
            return dateA - dateB;
          } catch (e) {
            return 0;
          }
        }); // 最早的在前（从上到下按时间顺序）
      
      console.log('过滤后的记录数:', items.length);
      
      // 转换为结构化数据
      const structuredItems = items.map((r) => {
        const t = new Date(r.scheduledAt);
        return {
          date: t.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
          time: t.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          status: r.status,
          fullDate: t,
        };
      });
      
      setHistoryItems(structuredItems);
      
      // 保留原有的文本格式作为备用
      const lines = [];
      const startDateFormatted = startDate.toLocaleDateString('zh-CN');
      const endDateFormatted = endDate.toLocaleDateString('zh-CN');
      lines.push(`${startDateFormatted} 至 ${endDateFormatted} 时间轴（${medicine.name}）`);
      lines.push('—');
      for (const r of items) {
        const t = new Date(r.scheduledAt);
        const date = t.toLocaleDateString('zh-CN');
        const time = t.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const status =
          r.status === 'taken'
            ? '已服'
            : r.status === 'missed'
              ? '漏服'
              : r.status === 'snoozed'
                ? '稍后'
                : r.status === 'paused'
                  ? '暂停'
                  : '待服';
        lines.push(`${date} ${time}  -  ${status}`);
      }
      lines.push('—');
      lines.push(`打卡/动作记录（最近 ${Math.min(50, logs.length)} 条）`);
      const recentLogs = logs
        .slice()
        .sort((a, b) => new Date(a.at) - new Date(b.at))
        .slice(-50);
      for (const l of recentLogs) {
        const at = l.at ? new Date(l.at).toLocaleString('zh-CN') : '';
        lines.push(`${at}  -  ${l.action}（来源:${l.source || ''}）`);
      }
      setHistoryText(lines.join('\n'));
    } catch (e) {
      setHistoryText(`加载失败：${e?.message || '未知错误'}`);
    }
  };

  const openHistory = async (medicine) => {
    setActiveMedicineForHistory(medicine);
    // 初始化起始日期
    const therapyStartDate = medicine?.reminderConfig?.startDate;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const defaultStartDate = new Date(now);
    defaultStartDate.setDate(defaultStartDate.getDate() - 6); // 最近7天的起始日期
    const defaultStartDateStr = defaultStartDate.toISOString().split('T')[0];
    
    // 确定初始起始日期：
    // 1. 如果疗程开始日期存在，且不晚于今天，优先使用疗程开始日期
    // 2. 如果疗程开始日期晚于默认起始日期，使用默认起始日期（最近7天）
    // 3. 否则使用疗程开始日期
    let initialStartDate = defaultStartDateStr;
    if (therapyStartDate) {
      const therapyStart = new Date(therapyStartDate);
      const todayDate = new Date(today);
      if (therapyStart <= todayDate) {
        // 疗程开始日期不晚于今天，可以使用
        if (therapyStart <= defaultStartDate) {
          // 疗程开始日期早于或等于默认起始日期，使用疗程开始日期
          initialStartDate = therapyStartDate;
        }
        // 否则使用默认起始日期（最近7天）
      }
    }
    
    setHistoryStartDate(initialStartDate);
    setHistoryVisible(true);
    await loadHistoryData(medicine, initialStartDate);
  };

  const showMakeupGuidance = (medicineId, reminder) => {
    const med = medicinesById.get(medicineId);
    const scheduledAt = reminder?.scheduledAt ? new Date(reminder.scheduledAt) : null;
    const now = new Date();
    let msg = '补服指导（通用建议）：\n';
    msg += '1) 如果离下一次服药时间很近：通常建议跳过漏服剂量，按原计划继续。\n';
    msg += '2) 如果刚错过不久：通常建议尽快补服。\n';
    msg += '3) 不要自行加倍剂量。\n';
    msg += '4) 若有特殊说明或慢病用药：请以医嘱/说明书为准，必要时咨询医生/药师。\n';
    if (med?.reminderConfig?.mealTag) {
      const tag = med.reminderConfig.mealTag;
      msg += `\n提示：本药设置为 ${tag === 'before_meal' ? '饭前' : tag === 'after_meal' ? '饭后' : tag === 'bedtime' ? '睡前' : '不限'}。\n`;
    }
    if (scheduledAt) {
      const diffMin = Math.round((now.getTime() - scheduledAt.getTime()) / 60000);
      msg += `\n本次提醒时间：${scheduledAt.toLocaleString('zh-CN')}（已过去约 ${diffMin} 分钟）`;
    }
    setGuidanceText(msg);
    setGuidanceVisible(true);
  };

  const openStats = async (medicine) => {
    setActiveMedicineForSettings(medicine);
    setStatsVisible(true);
    try {
      // 固定显示最近7天的统计
      const data = await MedicineService.getAdherenceStats(medicine.id, 7);
      setStatsData(data);
    } catch (e) {
      setStatsData(null);
      Alert.alert('失败', e.message || '加载统计失败');
    }
  };

  // 提醒设置表单主体（用于 Web/移动端不同滚动容器复用）
  const reminderSettingsForm = (
    <>
      <View style={styles.switchRow}>
        <Text>启用提醒</Text>
        <Switch
          value={reminderEnabled && !reminderPaused}
          onValueChange={(value) => {
            if (value) {
              // 开启：启用且不暂停
              setReminderEnabled(true);
              setReminderPaused(false);
            } else {
              // 关闭：暂停提醒（保持启用状态，只是暂停）
              setReminderPaused(true);
            }
          }}
        />
      </View>

      <SegmentedButtons
        value={reminderMode}
        onValueChange={setReminderMode}
        buttons={[
          { value: 'fixed_times', label: '定点' },
          { value: 'times_per_day', label: '每日N次' },
          { value: 'interval_hours', label: '间隔' },
          { value: 'prn', label: '按需' },
        ]}
        style={{ marginBottom: theme.spacing.md }}
      />

      {reminderMode === 'fixed_times' && (
        <TextInput
          label="每天提醒时间点（逗号分隔，如 08:00,14:00,20:00）"
          value={reminderTimesText}
          onChangeText={setReminderTimesText}
          mode="outlined"
          style={styles.input}
        />
      )}
      {reminderMode === 'times_per_day' && (
        <TextInput
          label="每日次数（1-12）"
          value={timesPerDay}
          onChangeText={setTimesPerDay}
          mode="outlined"
          keyboardType="numeric"
          style={styles.input}
        />
      )}
      {reminderMode === 'interval_hours' && (
        <>
          <TextInput
            label="间隔小时（1-24）"
            value={intervalHours}
            onChangeText={setIntervalHours}
            mode="outlined"
            keyboardType="numeric"
            style={styles.input}
          />
          <TextInput
            label="起始时间（HH:MM）"
            value={intervalStartTime}
            onChangeText={setIntervalStartTime}
            mode="outlined"
            style={styles.input}
          />
        </>
      )}
      {reminderMode === 'prn' && (
        <Paragraph style={styles.hintText}>
          按需用药：不会生成系统提醒，但会保留用药方案信息用于展示和历史统计。
        </Paragraph>
      )}

      <SegmentedButtons
        value={mealTag}
        onValueChange={setMealTag}
        buttons={[
          { value: 'none', label: '不限' },
          { value: 'before_meal', label: '饭前' },
          { value: 'after_meal', label: '饭后' },
          { value: 'bedtime', label: '睡前' },
        ]}
        style={{ marginBottom: theme.spacing.md }}
      />

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <TextInput
          label="每次用量"
          value={doseAmount}
          onChangeText={setDoseAmount}
          mode="outlined"
          keyboardType="numeric"
          style={[styles.input, { flex: 1 }]}
        />
        <TextInput
          label="单位（片/粒/ml…）"
          value={doseUnit}
          onChangeText={setDoseUnit}
          mode="outlined"
          style={[styles.input, { flex: 1 }]}
        />
      </View>

      <DatePicker
        label="疗程开始日期"
        value={therapyStartDate}
        onChange={setTherapyStartDate}
        required={true}
        style={styles.input}
        minimumDate={undefined}
        maximumDate={therapyEndDate || undefined}
      />
      <DatePicker
        label="疗程结束日期（可选）"
        value={therapyEndDate}
        onChange={setTherapyEndDate}
        required={false}
        style={styles.input}
        minimumDate={therapyStartDate || undefined}
      />
      <Paragraph style={styles.hintText}>
        提示：保存后会重建未来提醒（最多生成未来30天或到疗程结束日）。Web 端系统通知能力受限，但应用内提醒/打卡仍可用。
      </Paragraph>
    </>
  );

  const showImageSourceDialog = () => {
    setSourceDialogVisible(true);
  };

  const selectFromCamera = async () => {
    setSourceDialogVisible(false);
    try {
      // 请求相机权限
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('权限提示', '需要相机权限才能拍摄照片');
          return;
        }
      }

      const remainingSlots = 9 - selectedImages.length;
      if (remainingSlots <= 0) {
        Alert.alert('提示', '最多只能上传9张图片');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 1,
        allowsMultipleSelection: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const newImages = [...selectedImages, ...result.assets.map(asset => asset.uri)];
        if (newImages.length > 9) {
          Alert.alert('提示', '最多只能上传9张图片，已自动选择前9张');
          setSelectedImages(newImages.slice(0, 9));
        } else {
          setSelectedImages(newImages);
        }
        
        // 上传照片后，不自动识别，等待用户点击OCR识别按钮
        setDialogVisible(true);
      }
    } catch (error) {
      Alert.alert('错误', '拍摄失败，请重试');
      console.error('相机错误:', error);
    }
  };

  const selectFromGallery = async () => {
    setSourceDialogVisible(false);
    try {
      // 请求相册权限
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('权限提示', '需要相册权限才能选择图片');
          return;
        }
      }

      const remainingSlots = 9 - selectedImages.length;
      if (remainingSlots <= 0) {
        Alert.alert('提示', '最多只能上传9张图片');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false, // 多选时不支持编辑
        quality: 1,
        allowsMultipleSelection: true,
        selectionLimit: remainingSlots,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const newImages = [...selectedImages, ...result.assets.map(asset => asset.uri)];
        if (newImages.length > 9) {
          Alert.alert('提示', '最多只能上传9张图片，已自动选择前9张');
          setSelectedImages(newImages.slice(0, 9));
        } else {
          setSelectedImages(newImages);
        }
        
        // 上传照片后，不自动识别，等待用户点击OCR识别按钮
        setDialogVisible(true);
      }
    } catch (error) {
      Alert.alert('错误', '选择图片失败，请重试');
      console.error('相册错误:', error);
    }
  };

  // OCR识别函数 - 手动触发
  const performOCRRecognition = async () => {
    console.log('开始识别，selectedImages:', selectedImages);
    
    if (selectedImages.length === 0) {
      setErrorMessage('请先上传药品照片');
      setErrorDialogVisible(true);
      return;
    }

    // 使用第一张图片进行识别
    const imageToRecognize = selectedImages[0];
    console.log('准备识别图片:', imageToRecognize);
    setSelectedImageForOCR(imageToRecognize);
    setRecognizing(true);

    try {
      console.log('调用 MedicineService.recognizeMedicine...');
      const recognizedData = await MedicineService.recognizeMedicine(imageToRecognize);
      console.log('识别结果:', recognizedData);
      
      // 保存识别结果
      setRecognitionResult(recognizedData);
      
      // 如果查询到详细的药品信息，保存起来
      if (recognizedData.hasDetails) {
        setMedicineDetails(recognizedData);
        console.log('查询到详细药品信息:', recognizedData);
        // 识别成功，直接显示详情对话框
        setRecognizing(false);
        setDetailsDialogVisible(true);
      } else if (recognizedData.name) {
        // 识别到药品名称但没有详细信息
        setMedicineDetails(recognizedData);
        console.log('识别到药品名称，但无详细信息:', recognizedData);
        setRecognizing(false);
        // 直接显示详情对话框，即使没有详细信息也显示识别结果
        setDetailsDialogVisible(true);
      } else {
        // 未识别到药品名称
        setRecognizing(false);
        setErrorMessage('未能识别出药品信息，请确保图片清晰且包含药品名称');
        setErrorDialogVisible(true);
        setManualEntryMode(false);
      }
    } catch (error) {
      console.error('OCR识别错误:', error);
      setRecognizing(false);
      setErrorMessage(error.message || '无法识别图片，请检查网络连接后重试');
      setErrorDialogVisible(true);
      setManualEntryMode(false);
    }
  };

  const saveMedicine = async () => {
    const canUseRecognition = recognitionResult && recognitionResult.name;
    const canUseManual = manualEntryMode && manualName;
    if (!canUseRecognition && !canUseManual) {
      Alert.alert('提示', '请先识别药品信息，或选择手动录入');
      return;
    }

    if (selectedImages.length === 0) {
      Alert.alert('提示', '请至少上传一张图片');
      return;
    }

    try {
      const medicineName = canUseRecognition ? recognitionResult.name : manualName;
      const dosage = canUseRecognition
        ? (recognitionResult.dosage || '每次1片')
        : (manualDosage || '每次1片');
      const frequency = canUseRecognition
        ? (recognitionResult.frequency || '每日2次')
        : (manualFrequency || '每日2次');

      if (editingMedicine) {
        // 更新现有药品
        const updatedMedicine = {
          name: medicineName,
          dosage,
          frequency,
          images: selectedImages,
          image: selectedImages[0],
        };
        await MedicineService.updateMedicine(editingMedicine.id, updatedMedicine);
        Alert.alert('成功', '药品信息已更新，提醒已重新设置');
      } else {
        // 添加新药品
        if (!canUseRecognition) {
          const vn = validateMedicineName(medicineName);
          if (!vn.ok) throw new Error(vn.message);
        }
        const medicine = {
          id: Date.now().toString(),
          name: medicineName,
          dosage,
          frequency,
          images: selectedImages,
          image: selectedImages[0],
          createdAt: new Date().toISOString(),
          reminderConfig: {
            enabled: true,
            paused: false,
            times: ['08:00', '20:00'],
          },
        };
        await MedicineService.saveMedicine(medicine);
        await MedicineService.scheduleReminders(medicine);
        Alert.alert('成功', '药品已添加，提醒已设置');
      }
      
      setDialogVisible(false);
      setSourceDialogVisible(false);
      setSelectedImages([]);
      setRecognitionResult(null);
      setMedicineDetails(null);
      setEditingMedicine(null);
      setManualEntryMode(false);
      setManualName('');
      setManualDosage('');
      setManualFrequency('');
      
      loadMedicines();
    } catch (error) {
      Alert.alert('错误', error.message || '操作失败，请重试');
    }
  };

  const editMedicine = (medicine) => {
    setEditingMedicine(medicine);
    setSelectedImages(medicine.images || (medicine.image ? [medicine.image] : []));
    // 设置识别结果为现有药品信息
    setRecognitionResult({
      name: medicine.name || '',
      dosage: medicine.dosage || '',
      frequency: medicine.frequency || '',
    });
    setDialogVisible(true);
  };

  const removeImage = (index) => {
    const newImages = selectedImages.filter((_, i) => i !== index);
    setSelectedImages(newImages);
  };

  const deleteMedicine = async (id) => {
    Alert.alert(
      '确认删除',
      '确定要删除这个药品吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            await MedicineService.deleteMedicine(id);
            await MedicineService.cancelReminders(id);
            loadMedicines();
          },
        },
      ]
    );
  };

  const exportMedicines = async () => {
    try {
      const result = await ExportService.exportMedicines('csv');
      if (result.success) {
        Alert.alert('成功', result.message || '药品信息已导出');
      }
    } catch (error) {
      Alert.alert('错误', '导出失败，请重试');
      console.error('导出药品信息失败:', error);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView}>
        {medicines.length > 0 && (
          <Card style={styles.exportCard}>
            <Card.Content>
              <Button
                mode="outlined"
                icon="download"
                onPress={exportMedicines}
                style={styles.exportButton}
              >
                导出药品信息 (CSV)
              </Button>
            </Card.Content>
          </Card>
        )}
        {medicines.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="medical-outline" size={64} color={theme.colors.textSecondary} />
            <Title style={styles.emptyTitle}>暂无药品</Title>
            <Paragraph style={styles.emptyText}>
              点击右下角按钮拍摄药盒，智能识别药品信息
            </Paragraph>
          </View>
        ) : (
          medicines.map((medicine) => {
            const images = medicine.images || (medicine.image ? [medicine.image] : []);
            return (
              <Card key={medicine.id} style={styles.medicineCard}>
                {images.length > 0 && (
                  <ScrollView 
                    horizontal 
                    pagingEnabled 
                    showsHorizontalScrollIndicator={false}
                    style={styles.imageScrollView}
                  >
                    {images.map((img, idx) => (
                      <Image 
                        key={idx} 
                        source={{ uri: img }} 
                        style={styles.medicineImage} 
                      />
                    ))}
                  </ScrollView>
                )}
                <Card.Content>
                  <View style={styles.medicineHeader}>
                    <Title style={styles.medicineName}>{medicine.name}</Title>
                    <View style={styles.medicineActions}>
                      <TouchableOpacity 
                        onPress={() => editMedicine(medicine)}
                        style={styles.actionButton}
                      >
                        <Ionicons name="create-outline" size={24} color={theme.colors.primary} />
                      </TouchableOpacity>
                      <TouchableOpacity 
                        onPress={() => deleteMedicine(medicine.id)}
                        style={styles.actionButton}
                      >
                        <Ionicons name="trash-outline" size={24} color={theme.colors.error} />
                      </TouchableOpacity>
                    </View>
                  </View>
                  {images.length > 1 && (
                    <Chip icon="images" style={styles.chip}>
                      {images.length} 张图片
                    </Chip>
                  )}
                  <View style={styles.medicineInfo}>
                    <Chip icon="flask" style={styles.chip}>
                      {getDisplayDose(medicine)}
                    </Chip>
                    <View style={styles.chipWithCustomIcon}>
                      {getReminderIcon(medicine)}
                      <Text style={styles.chipText}>{getDisplayFrequency(medicine)}</Text>
                    </View>
                  </View>

                  {/* 今日提醒（闭环打卡） */}
                  <View style={styles.remindersContainer}>
                    <Text style={styles.remindersTitle}>今日提醒</Text>
                    {(todayRemindersByMedicine[medicine.id] || []).length === 0 ? (
                      <Text style={styles.remindersEmpty}>今日暂无提醒</Text>
                    ) : (
                      (todayRemindersByMedicine[medicine.id] || []).map((r) => (
                        <View key={r.id} style={styles.reminderRow}>
                          <Text style={styles.reminderTime}>{formatTime(r.scheduledAt)}</Text>
                          <Chip
                            style={styles.reminderStatusChip}
                            icon={
                              r.status === 'taken'
                                ? 'check'
                                : r.status === 'missed'
                                  ? 'close'
                                  : r.status === 'snoozed'
                                    ? 'clock'
                                    : 'bell'
                            }
                          >
                            {r.status === 'taken'
                              ? '已服'
                              : r.status === 'missed'
                                ? '漏服'
                                : r.status === 'snoozed'
                                  ? '稍后'
                                  : '待服'}
                          </Chip>

                          {r.status === 'missed' && (
                            <Button
                              mode="text"
                              compact
                              onPress={() => showMakeupGuidance(medicine.id, r)}
                              style={styles.reminderActionButton}
                            >
                              补服指导
                            </Button>
                          )}

                          {(r.status === 'scheduled' || r.status === 'snoozed') && (
                            <View style={styles.reminderActions}>
                              <Button
                                mode="outlined"
                                compact
                                onPress={() => markTaken(medicine.id, r.id)}
                                style={styles.reminderActionButton}
                              >
                                已服
                              </Button>
                              <Button
                                mode="outlined"
                                compact
                                disabled={Platform.OS === 'web'}
                                onPress={() => snoozePick(medicine.id, r.id)}
                                style={styles.reminderActionButton}
                              >
                                稍后...
                              </Button>
                            </View>
                          )}
                        </View>
                      ))
                    )}
                  </View>

                  <View style={styles.reminderFooterActions}>
                    <Button mode="text" onPress={() => openReminderSettings(medicine)}>
                      提醒设置
                    </Button>
                    <Button mode="text" onPress={() => openStats(medicine)}>
                      统计
                    </Button>
                    <Button mode="text" onPress={() => openHistory(medicine)}>
                      历史
                    </Button>
                    <Button mode="text" onPress={() => openStockDialog(medicine)}>
                      库存
                    </Button>
                  </View>
                  <Paragraph style={styles.medicineDate}>
                    添加时间: {new Date(medicine.createdAt).toLocaleDateString('zh-CN')}
                  </Paragraph>
                </Card.Content>
              </Card>
            );
          })
        )}
      </ScrollView>

      <FAB
        icon="camera"
        style={styles.fab}
        onPress={showImageSourceDialog}
        label="拍摄药盒"
      />

      <Portal>
        {/* 确认药品信息对话框 */}
        <Dialog 
          visible={dialogVisible} 
          onDismiss={() => {
            setDialogVisible(false);
            setSelectedImages([]);
            setEditingMedicine(null);
            setMedicineDetails(null);
            setSelectedImageForOCR(null);
            setRecognizing(false);
            setRecognitionResult(null);
            setManualEntryMode(false);
            setManualName('');
            setManualDosage('');
            setManualFrequency('');
          }}
        >
          <Dialog.Title>{editingMedicine ? '编辑药品信息' : '确认药品信息'}</Dialog.Title>
          <Dialog.Content>
            {recognizing && (
              <View style={styles.recognizingContainer}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text style={styles.recognizingText}>正在识别药品信息...</Text>
              </View>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.previewScrollView}>
              {selectedImages.map((uri, index) => (
                <View key={index} style={styles.previewImageContainer}>
                  <Image source={{ uri }} style={styles.previewImage} />
                  <TouchableOpacity
                    style={styles.removeImageButton}
                    onPress={() => removeImage(index)}
                  >
                    <Ionicons name="close-circle" size={24} color={theme.colors.error} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
            {selectedImages.length < 9 && (
              <Button
                mode="outlined"
                icon="plus"
                onPress={showImageSourceDialog}
                style={styles.addMoreButton}
              >
                添加更多图片 ({selectedImages.length}/9)
              </Button>
            )}
            
            {/* OCR识别按钮 */}
            {selectedImages.length > 0 && (
              <Button
                mode="contained"
                icon={recognizing ? undefined : "barcode-scan"}
                onPress={() => {
                  console.log('识别按钮被点击，recognizing:', recognizing);
                  if (!recognizing) {
                    performOCRRecognition();
                  }
                }}
                style={styles.ocrButton}
                disabled={recognizing}
                loading={recognizing}
              >
                {recognizing ? '正在识别...' : '识别药品'}
              </Button>
            )}

            {/* 识别失败/无结果时可切换为手动录入 */}
            {selectedImages.length > 0 && !recognizing && !manualEntryMode && !(recognitionResult && recognitionResult.name) && (
              <Button
                mode="outlined"
                icon="pencil"
                onPress={() => {
                  setManualEntryMode(true);
                  // 预填默认值
                  setManualDosage('每次1片');
                  setManualFrequency('每日2次');
                }}
                style={styles.manualEntryButton}
              >
                手动录入
              </Button>
            )}

            {/* 显示识别结果 */}
            {recognitionResult && recognitionResult.name && (
              <View style={styles.recognitionResultContainer}>
                <Text style={styles.recognitionResultTitle}>识别结果：</Text>
                <Text style={styles.recognitionResultText}>药品名称：{recognitionResult.name}</Text>
                {recognitionResult.dosage && (
                  <Text style={styles.recognitionResultText}>服用剂量：{recognitionResult.dosage}</Text>
                )}
                {recognitionResult.frequency && (
                  <Text style={styles.recognitionResultText}>服用频率：{recognitionResult.frequency}</Text>
                )}
              </View>
            )}

            {/* 手动录入表单（兜底） */}
            {manualEntryMode && (
              <View style={styles.manualFormContainer}>
                <Text style={styles.manualFormTitle}>手动录入药品信息</Text>
                <TextInput
                  label="药品名称"
                  value={manualName}
                  onChangeText={setManualName}
                  mode="outlined"
                  style={styles.input}
                />
                <TextInput
                  label="服用剂量（可选）"
                  value={manualDosage}
                  onChangeText={setManualDosage}
                  mode="outlined"
                  style={styles.input}
                />
                <TextInput
                  label="服用频率（可选）"
                  value={manualFrequency}
                  onChangeText={setManualFrequency}
                  mode="outlined"
                  style={styles.input}
                />
                <Button
                  mode="text"
                  onPress={() => {
                    setManualEntryMode(false);
                    setManualName('');
                    setManualDosage('');
                    setManualFrequency('');
                  }}
                >
                  取消手动录入
                </Button>
              </View>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button 
              onPress={() => {
                setDialogVisible(false);
                setSelectedImages([]);
                setEditingMedicine(null);
                setMedicineDetails(null);
                setRecognitionResult(null);
                setManualEntryMode(false);
                setManualName('');
                setManualDosage('');
                setManualFrequency('');
              }}
            >
              取消
            </Button>
            <Button 
              onPress={saveMedicine} 
              mode="contained"
              disabled={!((recognitionResult && recognitionResult.name) || (manualEntryMode && manualName))}
            >
              {editingMedicine ? '更新' : '保存'}
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* 选择图片来源对话框（需在编辑对话框之后渲染，确保显示在最顶层） */}
        <Dialog visible={sourceDialogVisible} onDismiss={() => setSourceDialogVisible(false)}>
          <Dialog.Title>选择图片来源</Dialog.Title>
          <Dialog.Content>
            <Paragraph style={styles.dialogText}>
              当前已选择 {selectedImages.length}/9 张图片
            </Paragraph>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setSourceDialogVisible(false)}>取消</Button>
            {Platform.OS !== 'web' && (
              <Button onPress={selectFromCamera} icon="camera" mode="contained">
                相机拍摄
              </Button>
            )}
            <Button onPress={selectFromGallery} icon="image" mode="contained">
              相册选择
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* 错误提示对话框 */}
        <Dialog
          visible={errorDialogVisible}
          onDismiss={() => setErrorDialogVisible(false)}
        >
          <Dialog.Title>提示</Dialog.Title>
          <Dialog.Content>
            <Paragraph>{errorMessage}</Paragraph>
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              onPress={() => {
                setErrorDialogVisible(false);
                // 在识别失败时，允许用户直接进入手动录入
                setManualEntryMode(true);
                setManualDosage('每次1片');
                setManualFrequency('每日2次');
              }}
            >
              手动录入
            </Button>
            <Button onPress={() => setErrorDialogVisible(false)}>关闭</Button>
          </Dialog.Actions>
        </Dialog>

        {/* 药品详情对话框 */}
        <Dialog
          visible={detailsDialogVisible}
          onDismiss={() => setDetailsDialogVisible(false)}
        >
          <Dialog.Title>药品详细信息</Dialog.Title>
          <Dialog.Content>
            <ScrollView style={styles.detailsScrollView}>
              {medicineDetails && (
                <>
                  {/* 顶部摘要区（更像说明书） */}
                  <View style={styles.detailsHeader}>
                    <View style={styles.detailsHeaderTopRow}>
                      <Text style={styles.detailsTitleText} numberOfLines={2}>
                        {medicineDetails.name || '（未识别到药品名称）'}
                      </Text>
                      <View style={styles.detailsChipsRow}>
                        <Chip
                          compact
                          style={[
                            styles.sourceChip,
                            medicineDetails.aiGenerated ? styles.sourceChipAI : styles.sourceChipDb,
                          ]}
                          textStyle={styles.sourceChipText}
                          icon={
                            medicineDetails.aiGenerated
                              ? ({ size, color }) => <AIGeneratedIcon size={size} color={color} />
                              : 'file-document-outline'
                          }
                        >
                          {medicineDetails.aiGenerated ? 'AI生成' : '说明书'}
                        </Chip>
                      </View>
                    </View>

                    {(medicineDetails.dosage || medicineDetails.frequency) && (
                      <View style={styles.detailsMetaRow}>
                        {medicineDetails.dosage ? (
                          <Text style={styles.detailsMetaText}>剂量：{medicineDetails.dosage}</Text>
                        ) : null}
                        {medicineDetails.frequency ? (
                          <Text style={styles.detailsMetaText}>频次：{medicineDetails.frequency}</Text>
                        ) : null}
                      </View>
                    )}

                    {medicineDetails.aiGenerated ? (
                      <View style={styles.aiNoteBox}>
                        <Text style={styles.aiNoteText}>
                          说明：以下内容由 AI 根据药品名称/包装文字生成，仅供参考；请以说明书/医嘱为准。
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <Divider style={styles.detailsDivider} />

                  {/* 说明书字段分组显示 */}
                  {(medicineDetails.indication || medicineDetails.usage) && (
                    <>
                      <Text style={styles.sectionTitle}>用途与用法</Text>
                      {medicineDetails.indication ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>适应症 / 用于治疗</Text>
                          <Text style={styles.detailValue}>{medicineDetails.indication}</Text>
                        </View>
                      ) : null}
                      {medicineDetails.usage ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>用法用量</Text>
                          <Text style={styles.detailValue}>{medicineDetails.usage}</Text>
                        </View>
                      ) : null}
                    </>
                  )}

                  {(medicineDetails.contraindication || medicineDetails.precautions) && (
                    <>
                      <Text style={styles.sectionTitle}>风险提示</Text>
                      {medicineDetails.contraindication ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>禁忌</Text>
                          <Text style={styles.detailValue}>{medicineDetails.contraindication}</Text>
                        </View>
                      ) : null}
                      {medicineDetails.precautions ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>注意事项</Text>
                          <Text style={styles.detailValue}>{medicineDetails.precautions}</Text>
                        </View>
                      ) : null}
                    </>
                  )}

                  {(medicineDetails.sideEffects || medicineDetails.interactions || medicineDetails.storage) && (
                    <>
                      <Text style={styles.sectionTitle}>其它信息</Text>
                      {medicineDetails.sideEffects ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>不良反应</Text>
                          <Text style={styles.detailValue}>{medicineDetails.sideEffects}</Text>
                        </View>
                      ) : null}
                      {medicineDetails.interactions ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>药物相互作用</Text>
                          <Text style={styles.detailValue}>{medicineDetails.interactions}</Text>
                        </View>
                      ) : null}
                      {medicineDetails.storage ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>贮藏</Text>
                          <Text style={styles.detailValue}>{medicineDetails.storage}</Text>
                        </View>
                      ) : null}
                    </>
                  )}

                  {(medicineDetails.specification ||
                    medicineDetails.manufacturer ||
                    medicineDetails.approvalNumber ||
                    medicineDetails.description) && (
                    <>
                      <Text style={styles.sectionTitle}>说明书与包装信息</Text>
                      {medicineDetails.specification ? (
                        <View style={styles.detailInlineRow}>
                          <Text style={styles.detailInlineLabel}>规格</Text>
                          <Text style={styles.detailInlineValue}>{medicineDetails.specification}</Text>
                        </View>
                      ) : null}
                      {medicineDetails.manufacturer ? (
                        <View style={styles.detailInlineRow}>
                          <Text style={styles.detailInlineLabel}>生产厂家</Text>
                          <Text style={styles.detailInlineValue}>{medicineDetails.manufacturer}</Text>
                        </View>
                      ) : null}
                      {medicineDetails.approvalNumber ? (
                        <View style={styles.detailInlineRow}>
                          <Text style={styles.detailInlineLabel}>批准文号</Text>
                          <Text style={styles.detailInlineValue}>{medicineDetails.approvalNumber}</Text>
                        </View>
                      ) : null}
                      {medicineDetails.description ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>说明书（原文/摘要）</Text>
                          <Text style={[styles.detailValue, styles.detailValueLong]}>
                            {medicineDetails.description}
                          </Text>
                        </View>
                      ) : null}
                    </>
                  )}
                </>
              )}
            </ScrollView>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDetailsDialogVisible(false)}>关闭</Button>
            {recognitionResult && recognitionResult.name && (
              <Button 
                onPress={() => {
                  setDetailsDialogVisible(false);
                  // 关闭详情对话框后，主对话框仍然打开，可以保存
                }} 
                mode="contained"
              >
                确定
              </Button>
            )}
          </Dialog.Actions>
        </Dialog>

        {/* 提醒设置对话框 */}
        <Dialog 
          visible={reminderSettingsVisible} 
          onDismiss={() => setReminderSettingsVisible(false)}
          style={Platform.OS === 'web' ? { 
            maxWidth: '90vw', 
            maxHeight: '90vh',
            alignSelf: 'center',
            margin: 'auto'
          } : {}}
        >
          <Dialog.Title>提醒设置</Dialog.Title>
          <Dialog.Content
            style={
              Platform.OS === 'web'
                ? { maxHeight: '70vh', overflow: 'auto', paddingRight: 12 }
                : {}
            }
          >
            {Platform.OS === 'web' ? (
              <View>
                {reminderSettingsForm}
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 500 }} showsVerticalScrollIndicator={false}>
                {reminderSettingsForm}
              </ScrollView>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setReminderSettingsVisible(false)}>取消</Button>
            <Button mode="contained" onPress={saveReminderSettings}>保存</Button>
          </Dialog.Actions>
        </Dialog>

        {/* 依从性统计对话框 */}
        <Dialog 
          visible={statsVisible} 
          onDismiss={() => setStatsVisible(false)}
          style={Platform.OS === 'web' ? { 
            alignSelf: 'center',
            margin: 'auto'
          } : {}}
        >
          <Dialog.Title>服药依从性统计（最近7天）</Dialog.Title>
          <Dialog.Content>
            {statsData ? (
              <View style={styles.statsContainer}>
                <View style={styles.statsRow}>
                  <View style={styles.statCard}>
                    <Ionicons name="calendar-outline" size={24} color={theme.colors.primary} />
                    <Text style={styles.statLabel}>计划次数</Text>
                    <Text style={styles.statValue}>{statsData.scheduled}</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Ionicons name="checkmark-circle-outline" size={24} color={theme.colors.success} />
                    <Text style={styles.statLabel}>已服</Text>
                    <Text style={[styles.statValue, { color: theme.colors.success }]}>{statsData.taken}</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Ionicons name="close-circle-outline" size={24} color={theme.colors.error} />
                    <Text style={styles.statLabel}>漏服</Text>
                    <Text style={[styles.statValue, { color: theme.colors.error }]}>{statsData.missed}</Text>
                  </View>
                </View>
                <View style={styles.adherenceCard}>
                  <View style={styles.adherenceHeader}>
                    <Ionicons name="trending-up-outline" size={20} color={theme.colors.primary} />
                    <Text style={styles.adherenceLabel}>已服率</Text>
                  </View>
                  <Text style={styles.adherenceValue}>{Math.round(statsData.adherenceRate * 100)}%</Text>
                  <ProgressBar
                    progress={statsData.adherenceRate}
                    color={statsData.adherenceRate >= 0.8 ? theme.colors.success : statsData.adherenceRate >= 0.6 ? theme.colors.warning : theme.colors.error}
                    style={{ marginTop: theme.spacing.sm, height: 8, borderRadius: 4 }}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.emptyStatsContainer}>
                <Ionicons name="stats-chart-outline" size={48} color={theme.colors.textSecondary} />
                <Paragraph style={{ marginTop: theme.spacing.md, textAlign: 'center' }}>暂无数据</Paragraph>
              </View>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              mode="outlined"
              icon="download"
              onPress={async () => {
                try {
                  const result = await ExportService.exportIntakeLogs('csv');
                  if (result.success) Alert.alert('成功', result.message || '服药记录已导出');
                } catch (e) {
                  Alert.alert('失败', e.message || '导出失败');
                }
              }}
            >
              导出服药记录
            </Button>
            <Button onPress={() => setStatsVisible(false)}>关闭</Button>
          </Dialog.Actions>
        </Dialog>

        {/* 库存/到期设置对话框 */}
        <Dialog visible={stockDialogVisible} onDismiss={() => setStockDialogVisible(false)}>
          <Dialog.Title>库存 / 到期 / 复购</Dialog.Title>
          <Dialog.Content>
            <View style={styles.switchRow}>
              <Text>启用库存提示</Text>
              <Switch value={stockEnabled} onValueChange={setStockEnabled} />
            </View>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <TextInput
                label="当前库存"
                value={stockCurrent}
                onChangeText={setStockCurrent}
                mode="outlined"
                keyboardType="numeric"
                style={[styles.input, { flex: 1 }]}
              />
              <TextInput
                label="单位"
                value={stockUnit}
                onChangeText={setStockUnit}
                mode="outlined"
                style={[styles.input, { flex: 1 }]}
              />
            </View>
            <TextInput
              label="低库存阈值（≤则提醒）"
              value={stockThreshold}
              onChangeText={setStockThreshold}
              mode="outlined"
              keyboardType="numeric"
              style={styles.input}
            />
            <TextInput
              label="到期日期（YYYY-MM-DD，可空）"
              value={expiryDate}
              onChangeText={setExpiryDate}
              mode="outlined"
              style={styles.input}
            />
            <TextInput
              label="提前提醒天数（默认7）"
              value={expiryRemindDays}
              onChangeText={setExpiryRemindDays}
              mode="outlined"
              keyboardType="numeric"
              style={styles.input}
            />
            <Paragraph style={styles.hintText}>
              提示：移动端会尝试安排“到期/低库存”系统通知（Web 端仅展示提示）。
            </Paragraph>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setStockDialogVisible(false)}>取消</Button>
            <Button mode="contained" onPress={saveStockConfig}>保存</Button>
          </Dialog.Actions>
        </Dialog>

        {/* 历史时间轴对话框 */}
        <Dialog 
          visible={historyVisible} 
          onDismiss={() => {
            setHistoryVisible(false);
            setHistoryStartDate('');
          }}
          style={Platform.OS === 'web' ? { 
            maxWidth: '90vw',
            width: '800px',
            alignSelf: 'center',
            margin: 'auto'
          } : {}}
        >
          <Dialog.Title>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="calendar-outline" size={22} color={theme.colors.primary} style={{ marginRight: 8 }} />
              用药历史时间轴
            </View>
          </Dialog.Title>
          <Dialog.Content>
            {activeMedicineForHistory && (
              <View style={styles.historyHeader}>
                <Text style={styles.historyMedicineName}>{activeMedicineForHistory.name}</Text>
                <Text style={styles.historySubtitle}>选择起始日期，查看之后 7 天的用药记录</Text>
              </View>
            )}
            {activeMedicineForHistory && (
              <View style={styles.historyDatePickerContainer}>
                <DatePicker
                  label="起始日期"
                  value={historyStartDate}
                  onChange={async (date) => {
                    setHistoryStartDate(date);
                    await loadHistoryData(activeMedicineForHistory, date);
                  }}
                  required={true}
                  style={styles.historyDatePicker}
                  minimumDate={activeMedicineForHistory?.reminderConfig?.startDate || undefined}
                  maximumDate={new Date().toISOString().split('T')[0]}
                />
              </View>
            )}
            <ScrollView style={{ maxHeight: 400 }}>
              {historyItems.length === 0 ? (
                <View style={styles.historyEmpty}>
                  <Ionicons name="calendar-outline" size={48} color={theme.colors.textSecondary} />
                  <Text style={styles.historyEmptyText}>暂无用药记录</Text>
                </View>
              ) : (
                <View style={styles.timeline}>
                  {historyItems.map((item, index) => {
                    const config = getStatusConfig(item.status);
                    const isLast = index === historyItems.length - 1;
                    return (
                      <View key={index} style={styles.timelineItem}>
                        {/* 时间轴线条 */}
                        {!isLast && <View style={styles.timelineLine} />}
                        
                        {/* 状态图标 */}
                        <View style={[styles.timelineIcon, { backgroundColor: config.bgColor }]}>
                          <Ionicons name={config.icon} size={20} color={config.color} />
                        </View>
                        
                        {/* 记录卡片 */}
                        <View style={[styles.timelineCard, isLast && styles.timelineCardLast]}>
                          <View style={styles.timelineCardHeader}>
                            <View style={styles.timelineTime}>
                              <Ionicons name="time-outline" size={14} color={theme.colors.textSecondary} />
                              <Text style={styles.timelineTimeText}>
                                {item.date} {item.time}
                              </Text>
                            </View>
                            <Chip
                              icon={() => <Ionicons name={config.icon} size={14} color={config.color} />}
                              style={[styles.statusChip, { backgroundColor: config.bgColor }]}
                              textStyle={{ color: config.color, fontSize: 12 }}
                            >
                              {config.label}
                            </Chip>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => {
              setHistoryVisible(false);
              setHistoryStartDate('');
            }}>关闭</Button>
          </Dialog.Actions>
        </Dialog>

        {/* 漏服补服指导对话框 */}
        <Dialog visible={guidanceVisible} onDismiss={() => setGuidanceVisible(false)}>
          <Dialog.Title>漏服补服指导</Dialog.Title>
          <Dialog.Content>
            <ScrollView style={{ maxHeight: 360 }}>
              <Text style={{ fontSize: 14, lineHeight: 22, color: theme.colors.text }}>
                {guidanceText || '暂无'}
              </Text>
            </ScrollView>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setGuidanceVisible(false)}>关闭</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollView: {
    flex: 1,
    padding: theme.spacing.md,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.xl * 2,
  },
  emptyTitle: {
    marginTop: theme.spacing.md,
    color: theme.colors.text,
  },
  emptyText: {
    textAlign: 'center',
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  medicineCard: {
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
  imageScrollView: {
    maxHeight: 200,
  },
  medicineImage: {
    width: 400,
    height: 200,
    resizeMode: 'cover',
  },
  medicineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: theme.spacing.sm,
  },
  medicineName: {
    fontSize: 20,
    fontWeight: '800',
    flex: 1,
  },
  medicineActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  actionButton: {
    padding: theme.spacing.xs,
  },
  medicineInfo: {
    flexDirection: 'row',
    marginTop: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  chip: {
    marginRight: theme.spacing.xs,
  },
  chipWithCustomIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceVariant,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    gap: 6,
  },
  chipText: {
    fontSize: 14,
    color: theme.colors.text,
  },
  medicineDate: {
    marginTop: theme.spacing.sm,
    color: theme.colors.textSecondary,
    fontSize: 12,
  },
  remindersContainer: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceVariant,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
  },
  remindersTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.colors.primary,
    marginBottom: theme.spacing.xs,
  },
  remindersEmpty: {
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  reminderTime: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.colors.text,
    minWidth: 54,
  },
  reminderStatusChip: {
    backgroundColor: theme.colors.surface,
  },
  reminderActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    marginLeft: 'auto',
  },
  reminderActionButton: {
    borderRadius: theme.borderRadius.sm,
  },
  reminderFooterActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  hintText: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    marginTop: theme.spacing.sm,
  },
  fab: {
    position: 'absolute',
    margin: theme.spacing.md,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.primary,
  },
  previewScrollView: {
    marginBottom: theme.spacing.md,
  },
  previewImageContainer: {
    position: 'relative',
    marginRight: theme.spacing.sm,
  },
  previewImage: {
    width: 200,
    height: 200,
    borderRadius: theme.borderRadius.sm,
  },
  recognizingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  recognizingText: {
    marginLeft: theme.spacing.sm,
    color: theme.colors.primary,
    fontSize: 14,
  },
  exportCard: {
    marginBottom: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
  },
  exportButton: {
    borderRadius: theme.borderRadius.md,
  },
  removeImageButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
  },
  addMoreButton: {
    marginBottom: theme.spacing.md,
  },
  ocrButton: {
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.primary,
  },
  manualEntryButton: {
    marginBottom: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
  },
  manualFormContainer: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
  },
  manualFormTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.colors.primary,
    marginBottom: theme.spacing.sm,
  },
  dialogText: {
    marginBottom: theme.spacing.sm,
  },
  input: {
    marginBottom: theme.spacing.sm,
  },
  detailsButton: {
    marginTop: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
  },
  detailsScrollView: {
    maxHeight: 400,
  },
  detailsHeader: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    marginBottom: theme.spacing.md,
  },
  detailsHeaderTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  detailsTitleText: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: theme.colors.text,
    lineHeight: 24,
  },
  detailsChipsRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    alignItems: 'center',
  },
  sourceChip: {
    height: 28,
  },
  sourceChipDb: {
    backgroundColor: theme.colors.surfaceVariant,
  },
  sourceChipAI: {
    backgroundColor: 'rgba(124, 58, 237, 0.14)',
  },
  sourceChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  detailsMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  detailsMetaText: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  aiNoteBox: {
    marginTop: theme.spacing.sm,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceVariant,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
  },
  aiNoteText: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  detailsDivider: {
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.colors.primary,
    marginBottom: theme.spacing.sm,
  },
  detailBlock: {
    marginBottom: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
  },
  detailInlineRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  detailInlineLabel: {
    width: 76,
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  detailInlineValue: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  detailItem: {
    marginBottom: theme.spacing.md,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.colors.primary,
    marginBottom: theme.spacing.xs,
  },
  detailValue: {
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 20,
  },
  detailValueLong: {
    lineHeight: 22,
  },
  recognitionResultContainer: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.sm,
  },
  recognitionResultTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.primary,
    marginBottom: theme.spacing.sm,
  },
  recognitionResultText: {
    fontSize: 14,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
    lineHeight: 20,
  },
  // 历史时间轴样式
  historyHeader: {
    marginBottom: theme.spacing.md,
  },
  historyMedicineName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: theme.spacing.xxs,
  },
  historySubtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
  },
  historyDatePickerContainer: {
    marginBottom: theme.spacing.md,
  },
  historyDatePicker: {
    marginBottom: theme.spacing.sm,
  },
  historyEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.xl * 2,
  },
  historyEmptyText: {
    marginTop: theme.spacing.md,
    color: theme.colors.textSecondary,
    fontSize: 14,
  },
  timeline: {
    paddingLeft: theme.spacing.sm,
  },
  statsContainer: {
    gap: theme.spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceVariant,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
  },
  statLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.xxs,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  adherenceCard: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
  },
  adherenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  adherenceLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
  },
  adherenceValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: theme.colors.primary,
    marginBottom: theme.spacing.xs,
  },
  emptyStatsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.xl,
  },
  timelineItem: {
    position: 'relative',
    paddingLeft: 40,
    paddingBottom: theme.spacing.md,
    minHeight: 72, // 固定每个时间轴项的最小高度（图标36 + 卡片56 - 重叠部分）
  },
  timelineLine: {
    position: 'absolute',
    left: 17,
    top: 36,
    bottom: 0,
    width: 2,
    backgroundColor: theme.colors.outlineVariant,
  },
  timelineIcon: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.colors.surface,
  },
  timelineCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    minHeight: 56, // 确保所有卡片高度一致
  },
  timelineCardLast: {
    marginBottom: 0,
  },
  timelineCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 24, // 确保内容行高度一致
    gap: theme.spacing.sm, // 时间和状态之间的间距
  },
  timelineTime: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1, // 占据剩余空间
    flexShrink: 1, // 允许适当收缩以容纳 Chip
  },
  timelineTimeText: {
    fontSize: 14,
    color: theme.colors.text,
    fontWeight: '600',
    lineHeight: 20, // 固定行高
    flexShrink: 0, // 防止文字被压缩
  },
  statusChip: {
    height: 26,
    minWidth: 60, // 确保所有状态 Chip 宽度基本一致
    flexShrink: 0, // 防止 Chip 被压缩
  },
});


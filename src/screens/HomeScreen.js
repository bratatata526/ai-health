import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Platform, TouchableOpacity, useWindowDimensions, Image, Alert } from 'react-native';
import { Text, Button, Portal, Dialog, Chip, Divider } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { theme, textStyles } from '../theme';
import { CloudSyncService } from '../services/CloudSyncService';
import { AuthService } from '../services/AuthService';
import { AccountCloudModal } from '../components/AccountCloudModal';
import AIGeneratedIcon from '../components/AIGeneratedIcon';
import { MedicineService } from '../services/MedicineService';
import { DeviceService } from '../services/DeviceService';
import { CareAccountService } from '../services/CareAccountService';
import { computeBmi } from '../utils/bmi';

const formatSyncTime = (isoString) => {
  if (!isoString) return '未同步';
  try {
    const date = new Date(isoString);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${month}-${day} ${hours}:${minutes}`;
  } catch {
    return '未同步';
  }
};

const parseHHMM = (text) => {
  const m = String(text || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

const formatTime = (iso) => {
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return '--:--';
  }
};

const resolveReminderMode = (medicine) => {
  const cfg = medicine?.reminderConfig || {};
  const raw = cfg.mode || (Array.isArray(cfg.times) && cfg.times.length ? 'fixed_times' : null);
  if (raw === 'prn') return 'fixed_times';
  return raw || 'fixed_times';
};

const hasEnabledReminder = (medicine) => {
  const cfg = medicine?.reminderConfig || {};
  if (cfg.enabled === false || cfg.paused === true) return false;
  const mode = resolveReminderMode(medicine);
  if (mode === 'interval_hours') return Number(cfg.intervalHours || 0) > 0;
  if (mode === 'times_per_day') return Number(cfg.timesPerDay || 0) > 0;
  return Array.isArray(cfg.times) && cfg.times.length > 0;
};

const formatHalfHourCountdown = (minutes) => {
  const rounded = Math.ceil(Math.max(0, minutes) / 30) * 30;
  if (rounded <= 0) return '即将提醒';
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h > 0 && m > 0) return `距下次约 ${h} 小时 ${m} 分钟`;
  if (h > 0) return `距下次约 ${h} 小时`;
  return `距下次约 ${m} 分钟`;
};

const getIntervalNextText = (medicine, nowSeed) => {
  const cfg = medicine?.reminderConfig || {};
  const intervalHours = Math.max(1, Number(cfg.intervalHours || 8));
  const startText = parseHHMM(cfg.intervalStartTime) || '08:00';
  const [startH, startM] = startText.split(':').map((x) => Number(x));
  const now = new Date(nowSeed);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  let nextMinutes = startH * 60 + startM;
  if (nowMinutes >= nextMinutes) {
    const step = Math.floor((nowMinutes - nextMinutes) / (intervalHours * 60)) + 1;
    nextMinutes += step * intervalHours * 60;
  }
  return formatHalfHourCountdown(nextMinutes - nowMinutes);
};

const nearestByNow = (rows, nowMs) => {
  if (!rows.length) return null;
  return rows.reduce((best, row) => {
    const cur = Math.abs(new Date(row.scheduledAt).getTime() - nowMs);
    const prev = Math.abs(new Date(best.scheduledAt).getTime() - nowMs);
    return cur < prev ? row : best;
  }, rows[0]);
};

const buildMyAbnormalRows = (healthData) => {
  const now = Date.now();
  const cutoff = now - 48 * 3600 * 1000;
  const rows = [];
  const hr = Array.isArray(healthData?.heartRate) ? healthData.heartRate : [];
  const bg = Array.isArray(healthData?.bloodGlucose) ? healthData.bloodGlucose : [];
  hr.forEach((item) => {
    const t = item?.date ? new Date(item.date).getTime() : NaN;
    const v = Number(item?.value);
    if (!Number.isFinite(t) || t < cutoff || !Number.isFinite(v)) return;
    if (v >= 105) {
      rows.push({ id: `hr_hi_${t}_${v}`, at: item.date, text: `心率偏高 ${Math.round(v)} bpm` });
    } else if (v <= 52) {
      rows.push({ id: `hr_lo_${t}_${v}`, at: item.date, text: `心率偏低 ${Math.round(v)} bpm` });
    }
  });
  bg.forEach((item) => {
    const t = item?.date ? new Date(item.date).getTime() : NaN;
    const v = Number(item?.value);
    if (!Number.isFinite(t) || t < cutoff || !Number.isFinite(v)) return;
    if (v >= 8.0) {
      rows.push({ id: `bg_hi_${t}_${v}`, at: item.date, text: `血糖偏高 ${v.toFixed(1)} mmol/L` });
    } else if (v <= 3.9) {
      rows.push({ id: `bg_lo_${t}_${v}`, at: item.date, text: `血糖偏低 ${v.toFixed(1)} mmol/L` });
    }
  });
  return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 8);
};

const buildCareRows = async () => {
  const list = await CareAccountService.listCareAccounts();
  if (!Array.isArray(list) || list.length === 0) return [];
  const out = [];
  for (const acc of list) {
    try {
      const accountLabel = acc?.remark || acc?.name || acc?.email || '关怀账号';
      const ds = await CareAccountService.fetchCareRecipientDataset(acc);
      if (!ds?.snapshotData) continue;
      const meds = Array.isArray(ds.snapshotData['@medicines']) ? ds.snapshotData['@medicines'] : [];
      const medMap = new Map(meds.map((m) => [m?.id, m?.name || '药品']));
      const logs = Array.isArray(ds.snapshotData['@medicine_intake_logs']) ? ds.snapshotData['@medicine_intake_logs'] : [];
      logs
        .filter((l) => ['taken', 'missed'].includes(String(l?.action || '').toLowerCase()))
        .slice(-12)
        .forEach((log) => {
          const action = String(log.action || '').toLowerCase();
          const name = log.medicineName || medMap.get(log.medicineId) || '药品';
          out.push({
            id: `${acc.userId}_${log.id || log.at}_${action}`,
            at: log.at || log.scheduledAt || new Date().toISOString(),
            text: `${name}${action === 'taken' ? ' 已服用' : ' 漏服'}`,
            type: 'medication',
            accountLabel,
          });
        });
      const alerts = await CareAccountService.fetchDerivedAlertsForAccount(acc);
      (alerts || [])
        .filter((al) => {
          const t = String(al?.type || '');
          return (
            t === 'heart_rate_high' ||
            t === 'heart_rate_low' ||
            t === 'blood_glucose_high' ||
            t === 'blood_glucose_low'
          );
        })
        .slice(0, 8)
        .forEach((al) => {
        out.push({
          id: `${acc.userId}_alert_${al.id}`,
          at: al.at || new Date().toISOString(),
          text: al.message || `${accountLabel} 异常动态`,
          type: 'abnormal',
          accountLabel,
        });
        });
    } catch {
      // ignore 单个关怀账号失败
    }
  }
  return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 18);
};

export default function HomeScreen({ navigation }) {
  const { width, height } = useWindowDimensions();
  const isWide = width >= 1120;
  const [reminderTick, setReminderTick] = useState(Date.now());
  const [accountDialogVisible, setAccountDialogVisible] = useState(false);
  const [accountInfo, setAccountInfo] = useState({ profile: null, cloudMeta: null });
  const [detailsDialogVisible, setDetailsDialogVisible] = useState(false);
  const [detailsMedicine, setDetailsMedicine] = useState(null);
  const [medicines, setMedicines] = useState([]);
  const [todayRemindersByMedicine, setTodayRemindersByMedicine] = useState({});
  const [intakeLogs, setIntakeLogs] = useState([]);
  const [myAbnormalRows, setMyAbnormalRows] = useState([]);
  const [careRows, setCareRows] = useState([]);
  const [myRecordTab, setMyRecordTab] = useState('medication');
  const [careRecordTab, setCareRecordTab] = useState('medication');

  useEffect(() => {
    const timer = setInterval(() => setReminderTick(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const loadAccountBundle = useCallback(async () => {
    try {
      const profile = await AuthService.getProfile();
      let cloudMeta = await CloudSyncService.getCloudMeta();
      if (!cloudMeta?.updatedAt) {
        try {
          cloudMeta = await CloudSyncService.refreshCloudMeta();
        } catch {
          // ignore
        }
      }
      setAccountInfo({ profile, cloudMeta });
    } catch {
      setAccountInfo({ profile: null, cloudMeta: null });
    }
  }, []);

  const loadHomeData = useCallback(async () => {
    await loadAccountBundle();
    try {
      await MedicineService.fillMissingReminderSchedules();
    } catch {
      // ignore
    }
    const allMeds = await MedicineService.getAllMedicines();
    const reminderPairs = await Promise.all(
      allMeds.map(async (m) => [m.id, await MedicineService.getTodayReminders(m.id)])
    );
    const logs = await MedicineService.getIntakeLogs();
    const healthData = await DeviceService.getHealthData();
    const careTimeline = await buildCareRows();
    setMedicines(Array.isArray(allMeds) ? allMeds : []);
    setTodayRemindersByMedicine(Object.fromEntries(reminderPairs));
    setIntakeLogs(Array.isArray(logs) ? logs : []);
    setMyAbnormalRows(buildMyAbnormalRows(healthData));
    setCareRows(careTimeline);
  }, [loadAccountBundle]);

  useFocusEffect(
    useCallback(() => {
      loadHomeData().catch(() => {});
    }, [loadHomeData])
  );

  const openAccountDialog = async () => {
    await loadAccountBundle();
    setAccountDialogVisible(true);
  };

  const features = [
    { key: 'med', icon: 'medical', color: theme.colors.primary, title: '药品', nav: '药品' },
    { key: 'dev', icon: 'watch', color: theme.colors.secondary, title: '设备', nav: '设备' },
    { key: 'rpt', icon: 'document-text', color: theme.colors.accent, title: '报告', nav: '报告' },
    { key: 'tong', icon: 'leaf', color: '#16A34A', title: '舌诊', nav: '舌诊' },
    ...(Platform.OS === 'android' ? [] : [{ key: 'care', icon: 'people', color: '#EF4444', title: '关怀', nav: '关怀' }]),
  ];

  const medicineMap = useMemo(() => new Map(medicines.map((m) => [m.id, m])), [medicines]);

  const myTakenRows = useMemo(() => {
    return intakeLogs
      .filter((l) => String(l?.action || '').toLowerCase() === 'taken')
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 10)
      .map((l) => ({
        id: l.id,
        at: l.at,
        text: `${medicineMap.get(l.medicineId)?.name || l.medicineName || '药品'} 已服用`,
        extra: String(l?.contextNote || '').trim(),
      }));
  }, [intakeLogs, medicineMap]);

  const careMedicationRows = useMemo(
    () => (careRows || []).filter((r) => String(r?.type || '') === 'medication'),
    [careRows]
  );
  const careAbnormalRows = useMemo(
    () => (careRows || []).filter((r) => String(r?.type || '') === 'abnormal'),
    [careRows]
  );

  const reminderItems = useMemo(() => {
    const now = Date.now();
    return medicines
      .filter(hasEnabledReminder)
      .map((m) => {
        const mode = resolveReminderMode(m);
        const todayRows = Array.isArray(todayRemindersByMedicine[m.id]) ? todayRemindersByMedicine[m.id] : [];
        const untaken = todayRows.filter((r) => r.status !== 'taken');
        const nearest = nearestByNow(untaken.length ? untaken : todayRows, now);
        const total = todayRows.length || Math.max(0, Number(m?.reminderConfig?.timesPerDay || 0));
        const remain = untaken.length;
        return {
          medicine: m,
          mode,
          todayRows,
          nearest,
          displayText:
            mode === 'interval_hours'
              ? getIntervalNextText(m, reminderTick)
              : mode === 'times_per_day'
                ? `今日还需服用 ${remain} 次（共 ${total} 次）`
                : nearest
                  ? `最近定点：${formatTime(nearest.scheduledAt)}`
                  : '今日暂无提醒',
          actionLabel: mode === 'times_per_day' ? '服用1次' : mode === 'interval_hours' ? '服用' : '已服用',
        };
      });
  }, [medicines, todayRemindersByMedicine, reminderTick]);

  const handleTakeAction = async (item) => {
    const m = item?.medicine;
    if (!m?.id) return;
    const mode = item.mode;
    const rows = Array.isArray(item.todayRows) ? item.todayRows : [];
    const nowMs = Date.now();
    const pending = rows.filter((r) => r.status !== 'taken');
    const target =
      mode === 'times_per_day'
        ? (pending[0] || null)
        : mode === 'interval_hours'
          ? null
          : nearestByNow(pending.length ? pending : rows, nowMs);

    const buildContextNote = () => {
      if (mode === 'times_per_day') {
        const remain = Math.max(0, rows.filter((r) => r.status !== 'taken' && r.id !== target?.id).length);
        return `今日还需服用 ${remain} 次`;
      }
      if (mode === 'interval_hours') {
        const ih = Math.max(1, Number(m?.reminderConfig?.intervalHours || 8));
        const next = new Date(Date.now() + ih * 3600 * 1000);
        const hh = String(next.getHours()).padStart(2, '0');
        const mm = String(next.getMinutes()).padStart(2, '0');
        return `下次建议服用时间 ${hh}:${mm}`;
      }
      const remainTimes = rows
        .filter((r) => r.status !== 'taken' && r.id !== target?.id)
        .map((r) => formatTime(r.scheduledAt));
      return remainTimes.length ? `今日还需在 ${remainTimes.join('、')} 服用` : '今日定点已完成';
    };

    const doTake = async () => {
      const contextNote = buildContextNote();
      try {
        if (mode === 'interval_hours') {
          await MedicineService.recordIntervalDoseNow({
            medicineId: m.id,
            source: 'home',
            contextNote,
          });
        } else if (target?.id) {
          await MedicineService.markReminderTaken({
            medicineId: m.id,
            reminderId: target.id,
            source: 'home',
            contextNote,
          });
        } else {
          const nowIso = new Date().toISOString();
          await MedicineService.appendIntakeLog({
            medicineId: m.id,
            reminderId: `manual_${m.id}_${nowIso}`,
            medicineName: m.name || '',
            action: 'taken',
            at: nowIso,
            scheduledAt: nowIso,
            source: 'home',
            contextNote,
          });
        }
        await loadHomeData();
      } catch (e) {
        console.warn('首页服药打卡失败:', e?.message || e);
      }
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (window.confirm(`确认已服用「${m.name || '该药品'}」吗？`)) {
        await doTake();
      }
      return;
    }
    Alert.alert('确认服用', `确认已服用「${m.name || '该药品'}」吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '是', onPress: () => { doTake().catch(() => {}); } },
    ]);
  };

  const openMedicineInfo = (medicine) => {
    setDetailsMedicine(medicine || null);
    setDetailsDialogVisible(true);
  };

  const accountName = accountInfo?.profile?.name || '未登录用户';
  const accountEmail = accountInfo?.profile?.email || '暂无邮箱信息';
  const accountSync = formatSyncTime(accountInfo?.cloudMeta?.updatedAt);
  const heightCm = accountInfo?.profile?.heightCm;
  const weightKg = accountInfo?.profile?.weightKg;
  const bmiValue = computeBmi(heightCm, weightKg)?.value ?? null;

  const rightPanelHeight = useMemo(() => {
    if (!isWide) return null;
    return Math.max(560, Math.min(820, Math.floor(height - 150)));
  }, [height, isWide]);
  const myRecordPanelHeight = useMemo(() => {
    if (!rightPanelHeight) return null;
    return Math.floor(rightPanelHeight * 0.62);
  }, [rightPanelHeight]);
  const careRecordPanelHeight = useMemo(() => {
    if (!rightPanelHeight || !myRecordPanelHeight) return null;
    return rightPanelHeight - myRecordPanelHeight - theme.spacing.md;
  }, [myRecordPanelHeight, rightPanelHeight]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.content}>
        <View style={[styles.mainArea, isWide ? styles.mainAreaWide : null]}>
          <View
            style={[
              styles.leftColumn,
              isWide ? styles.leftColumnWide : null,
              isWide && rightPanelHeight ? { minHeight: rightPanelHeight } : null,
            ]}
          >
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>我的账号信息</Text>
              <TouchableOpacity onPress={openAccountDialog} style={styles.accountEditBtn}>
                <Ionicons name="person-circle-outline" size={20} color={theme.colors.primary} />
                <Text style={styles.accountEditText}>修改</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.accountName}>{accountName}</Text>
            <Text style={styles.accountMeta}>{accountEmail}</Text>
            <Text style={styles.accountMeta}>最近云同步：{accountSync}</Text>
            {Platform.OS === 'android' ? (
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.careEntryBtn}
                onPress={() => navigation.navigate('关怀')}
              >
                <View style={styles.careEntryIconWrap}>
                  <Ionicons name="heart" size={16} color={theme.colors.primary} />
                </View>
                <Text style={styles.careEntryText}>关怀账号</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
            <View style={styles.metricRow}>
              <View style={styles.metricChip}>
                <Text style={styles.metricLabel}>身高</Text>
                <Text style={styles.metricValue}>{heightCm ? `${heightCm} cm` : '--'}</Text>
              </View>
              <View style={styles.metricChip}>
                <Text style={styles.metricLabel}>体重</Text>
                <Text style={styles.metricValue}>{weightKg ? `${weightKg} kg` : '--'}</Text>
              </View>
              <View style={styles.metricChip}>
                <Text style={styles.metricLabel}>BMI</Text>
                <Text style={styles.metricValue}>{bmiValue ?? '--'}</Text>
              </View>
            </View>
          </View>

          <View style={[styles.card, styles.featureCard]}>
            <Text style={styles.cardTitle}>功能总览</Text>
            {isWide ? (
              <View style={[styles.featureRow, styles.featureRowWide]}>
                {features.map((f) => (
                  <TouchableOpacity
                    key={f.key}
                    activeOpacity={0.75}
                    onPress={() => navigation.navigate(f.nav)}
                    style={[styles.featureItem, styles.featureItemWide]}
                  >
                    <View style={[styles.featureIconWrap, { backgroundColor: `${f.color}1A` }]}>
                      <Ionicons name={f.icon} size={26} color={f.color} />
                    </View>
                    <Text style={styles.featureTitle}>{f.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.featureRow}>
                {features.map((f) => (
                  <TouchableOpacity
                    key={f.key}
                    activeOpacity={0.75}
                    onPress={() => navigation.navigate(f.nav)}
                    style={styles.featureItem}
                  >
                    <View style={[styles.featureIconWrap, { backgroundColor: `${f.color}1A` }]}>
                      <Ionicons name={f.icon} size={26} color={f.color} />
                    </View>
                    <Text style={styles.featureTitle}>{f.title}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>

          <View style={[styles.card, isWide ? styles.reminderMainCardWide : null]}>
            <Text style={styles.cardTitle}>药物提醒信息</Text>
            <ScrollView
              style={isWide ? styles.reminderListScroll : null}
              contentContainerStyle={styles.reminderListContent}
              showsVerticalScrollIndicator={isWide}
            >
              {reminderItems.length === 0 ? (
                <Text style={styles.emptyText}>暂无已启用提醒的药物</Text>
              ) : (
                reminderItems.map((item) => {
                  const med = item.medicine;
                  const imageUri = Array.isArray(med.images) && med.images.length ? med.images[0] : med.image;
                  return (
                    <View key={med.id} style={styles.reminderCard}>
                      <View style={styles.reminderLeft}>
                        <TouchableOpacity activeOpacity={0.8} onPress={() => openMedicineInfo(med)}>
                          {imageUri ? (
                            <Image source={{ uri: imageUri }} style={styles.medicineImage} />
                          ) : (
                            <View style={styles.imagePlaceholder}>
                              <Ionicons name="medkit-outline" size={20} color={theme.colors.textSecondary} />
                            </View>
                          )}
                        </TouchableOpacity>
                        <Text style={styles.medicineName} numberOfLines={1}>{med.name || '未命名药品'}</Text>
                      </View>
                      <View style={styles.reminderRight}>
                        <Text style={styles.reminderInfoText}>{item.displayText}</Text>
                        <Button
                          mode="contained"
                          compact
                          style={styles.takeBtn}
                          onPress={() => handleTakeAction(item)}
                        >
                          {item.actionLabel}
                        </Button>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>
          </View>

          <View
            style={[
              styles.rightColumn,
              isWide ? styles.rightColumnWide : null,
              isWide && rightPanelHeight ? { height: rightPanelHeight } : null,
            ]}
          >
            <View style={[styles.card, isWide && myRecordPanelHeight ? { height: myRecordPanelHeight } : null]}>
              <Text style={styles.cardTitle}>我的记录</Text>
              <ScrollView
                style={isWide ? styles.fixedPanelScroll : null}
                contentContainerStyle={styles.fixedPanelContent}
                showsVerticalScrollIndicator={isWide}
              >
                <View style={styles.tabRow}>
                  <Button
                    compact
                    mode={myRecordTab === 'medication' ? 'contained' : 'outlined'}
                    onPress={() => setMyRecordTab('medication')}
                  >
                    药物服用
                  </Button>
                  <Button
                    compact
                    mode={myRecordTab === 'abnormal' ? 'contained' : 'outlined'}
                    onPress={() => setMyRecordTab('abnormal')}
                  >
                    异常状态
                  </Button>
                </View>
                {myRecordTab === 'medication' ? (
                  myTakenRows.length === 0 ? (
                    <Text style={styles.emptyText}>暂无服药记录</Text>
                  ) : (
                    myTakenRows.map((row) => (
                      <View key={row.id} style={styles.recordRow}>
                        <Text style={styles.recordText}>{row.text}</Text>
                        {row.extra ? <Text style={styles.recordExtra}>{row.extra}</Text> : null}
                        <Text style={styles.recordTime}>{formatSyncTime(row.at)}</Text>
                      </View>
                    ))
                  )
                ) : (
                  myAbnormalRows.length === 0 ? (
                    <Text style={styles.emptyText}>近 48 小时暂无心率/血糖异常</Text>
                  ) : (
                    myAbnormalRows.map((row) => (
                      <View key={row.id} style={styles.recordRow}>
                        <Text style={styles.recordText}>{row.text}</Text>
                        <Text style={styles.recordTime}>{formatSyncTime(row.at)}</Text>
                      </View>
                    ))
                  )
                )}
              </ScrollView>
            </View>

            <View style={[styles.card, isWide && careRecordPanelHeight ? { height: careRecordPanelHeight } : null]}>
              <Text style={styles.cardTitle}>关怀记录</Text>
              <ScrollView
                style={isWide ? styles.fixedPanelScroll : null}
                contentContainerStyle={styles.fixedPanelContent}
                showsVerticalScrollIndicator={isWide}
              >
                <View style={styles.tabRow}>
                  <Button
                    compact
                    mode={careRecordTab === 'medication' ? 'contained' : 'outlined'}
                    onPress={() => setCareRecordTab('medication')}
                  >
                    药物服用
                  </Button>
                  <Button
                    compact
                    mode={careRecordTab === 'abnormal' ? 'contained' : 'outlined'}
                    onPress={() => setCareRecordTab('abnormal')}
                  >
                    异常状态
                  </Button>
                </View>
                {(careRecordTab === 'medication' ? careMedicationRows : careAbnormalRows).length === 0 ? (
                  <Text style={styles.emptyText}>
                    {careRecordTab === 'medication' ? '暂无关怀账号药物服用记录' : '暂无关怀账号异常状态记录'}
                  </Text>
                ) : (
                  (careRecordTab === 'medication' ? careMedicationRows : careAbnormalRows).map((row) => (
                    <View key={row.id} style={styles.recordRow}>
                      <Text style={styles.recordSource}>账号：{row.accountLabel || '关怀账号'}</Text>
                      <Text style={styles.recordText}>{row.text}</Text>
                      <Text style={styles.recordTime}>{formatSyncTime(row.at)}</Text>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          </View>
        </View>
      </View>

      <AccountCloudModal
        visible={accountDialogVisible}
        onDismiss={() => setAccountDialogVisible(false)}
        profile={accountInfo.profile}
        cloudMeta={accountInfo.cloudMeta}
        onProfileUpdated={(nextProfile) => {
          setAccountInfo((prev) => ({ ...prev, profile: nextProfile }));
        }}
      />
      <Portal>
        <Dialog
          visible={detailsDialogVisible}
          onDismiss={() => setDetailsDialogVisible(false)}
          style={styles.detailsDialog}
        >
          <Dialog.Title style={styles.detailsTitle}>药品信息</Dialog.Title>
          <Dialog.Content>
            <ScrollView style={styles.detailsScrollView}>
              {detailsMedicine && (
                <>
                  <View style={styles.detailsHeader}>
                    <View style={styles.detailsHeaderTopRow}>
                      <Text style={styles.detailsTitleText} numberOfLines={2}>
                        {detailsMedicine.name || '（未识别到药品名称）'}
                      </Text>
                      <View style={styles.detailsChipsRow}>
                        <Chip
                          compact
                          style={[
                            styles.sourceChip,
                            detailsMedicine.aiGenerated ? styles.sourceChipAI : styles.sourceChipDb,
                          ]}
                          textStyle={styles.sourceChipText}
                          icon={
                            detailsMedicine.aiGenerated
                              ? ({ size, color }) => <AIGeneratedIcon size={size} color={color} />
                              : 'file-document-outline'
                          }
                        >
                          {detailsMedicine.aiGenerated ? 'AI生成' : '说明书'}
                        </Chip>
                      </View>
                    </View>

                    {(detailsMedicine.dosage || detailsMedicine.frequency) && (
                      <View style={styles.detailsMetaRow}>
                        {detailsMedicine.dosage ? (
                          <Text style={styles.detailsMetaText}>剂量：{detailsMedicine.dosage}</Text>
                        ) : null}
                        {detailsMedicine.frequency ? (
                          <Text style={styles.detailsMetaText}>频次：{detailsMedicine.frequency}</Text>
                        ) : null}
                      </View>
                    )}

                    {detailsMedicine.aiGenerated ? (
                      <View style={styles.aiNoteBox}>
                        <Text style={styles.aiNoteText}>
                          说明：以下内容由 AI 根据药品名称/包装文字生成，仅供参考；请以说明书/医嘱为准。
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <Divider style={styles.detailsDivider} />

                  {(detailsMedicine.indication ||
                    detailsMedicine.indications ||
                    detailsMedicine.mainFunctions ||
                    detailsMedicine.usage) && (
                    <>
                      <Text style={styles.sectionTitle}>用途与用法</Text>
                      {(detailsMedicine.indication || detailsMedicine.indications || detailsMedicine.mainFunctions) ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>适应症 / 用于治疗</Text>
                          <Text style={styles.detailValue}>
                            {detailsMedicine.indication || detailsMedicine.indications || detailsMedicine.mainFunctions}
                          </Text>
                        </View>
                      ) : null}
                      {detailsMedicine.usage ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>用法用量</Text>
                          <Text style={styles.detailValue}>{detailsMedicine.usage}</Text>
                        </View>
                      ) : null}
                    </>
                  )}

                  {(detailsMedicine.contraindication ||
                    detailsMedicine.contraindications ||
                    detailsMedicine.precautions) && (
                    <>
                      <Text style={styles.sectionTitle}>风险提示</Text>
                      {(detailsMedicine.contraindication || detailsMedicine.contraindications) ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>禁忌</Text>
                          <Text style={styles.detailValue}>
                            {detailsMedicine.contraindication || detailsMedicine.contraindications}
                          </Text>
                        </View>
                      ) : null}
                      {detailsMedicine.precautions ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>注意事项</Text>
                          <Text style={styles.detailValue}>{detailsMedicine.precautions}</Text>
                        </View>
                      ) : null}
                    </>
                  )}

                  {(detailsMedicine.sideEffects ||
                    detailsMedicine.adverseReactions ||
                    detailsMedicine.interactions ||
                    detailsMedicine.storage) && (
                    <>
                      <Text style={styles.sectionTitle}>其它信息</Text>
                      {(detailsMedicine.sideEffects || detailsMedicine.adverseReactions) ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>不良反应</Text>
                          <Text style={styles.detailValue}>
                            {detailsMedicine.sideEffects || detailsMedicine.adverseReactions}
                          </Text>
                        </View>
                      ) : null}
                      {detailsMedicine.interactions ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>药物相互作用</Text>
                          <Text style={styles.detailValue}>{detailsMedicine.interactions}</Text>
                        </View>
                      ) : null}
                      {detailsMedicine.storage ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>贮藏</Text>
                          <Text style={styles.detailValue}>{detailsMedicine.storage}</Text>
                        </View>
                      ) : null}
                    </>
                  )}

                  {(detailsMedicine.specification ||
                    detailsMedicine.manufacturer ||
                    detailsMedicine.approvalNumber ||
                    detailsMedicine.description) && (
                    <>
                      <Text style={styles.sectionTitle}>说明书与包装信息</Text>
                      {detailsMedicine.specification ? (
                        <View style={styles.detailInlineRow}>
                          <Text style={styles.detailInlineLabel}>规格</Text>
                          <Text style={styles.detailInlineValue}>{detailsMedicine.specification}</Text>
                        </View>
                      ) : null}
                      {detailsMedicine.manufacturer ? (
                        <View style={styles.detailInlineRow}>
                          <Text style={styles.detailInlineLabel}>生产厂家</Text>
                          <Text style={styles.detailInlineValue}>{detailsMedicine.manufacturer}</Text>
                        </View>
                      ) : null}
                      {detailsMedicine.approvalNumber ? (
                        <View style={styles.detailInlineRow}>
                          <Text style={styles.detailInlineLabel}>批准文号</Text>
                          <Text style={styles.detailInlineValue}>{detailsMedicine.approvalNumber}</Text>
                        </View>
                      ) : null}
                      {detailsMedicine.description ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>说明书（原文/摘要）</Text>
                          <Text style={[styles.detailValue, styles.detailValueLong]}>
                            {detailsMedicine.description}
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
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollContent: {
    paddingBottom: theme.spacing.xl,
  },
  content: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    maxWidth: 1400,
    width: '100%',
    alignSelf: 'center',
    gap: theme.spacing.md,
  },
  mainArea: {
    gap: theme.spacing.md,
  },
  mainAreaWide: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  leftColumn: {
    gap: theme.spacing.md,
  },
  leftColumnWide: {
    flex: 1.4,
  },
  rightColumn: {
    gap: theme.spacing.md,
  },
  rightColumnWide: {
    flex: 1,
    justifyContent: 'space-between',
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    padding: theme.spacing.md,
    ...Platform.select({
      ios: {
        shadowColor: theme.shadow.color,
        shadowOpacity: 0.8,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
      },
      android: { elevation: 1 },
      web: {
        shadowColor: theme.shadow.color,
        shadowOpacity: 0.8,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
      },
    }),
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    ...textStyles.semi,
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  accountEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  accountEditText: {
    ...textStyles.body,
    color: theme.colors.primary,
    fontSize: 13,
  },
  accountName: {
    ...textStyles.title,
    fontSize: 18,
    color: theme.colors.text,
    marginTop: 4,
  },
  accountMeta: {
    ...textStyles.body,
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  careEntryBtn: {
    marginTop: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    backgroundColor: theme.colors.surfaceVariant,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  careEntryIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(74, 144, 226, 0.12)',
  },
  careEntryText: {
    ...textStyles.semi,
    flex: 1,
    fontSize: 13,
    color: theme.colors.text,
  },
  metricRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  metricChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceVariant,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  metricLabel: {
    ...textStyles.body,
    fontSize: 11,
    color: theme.colors.textSecondary,
  },
  metricValue: {
    ...textStyles.semi,
    fontSize: 13,
    color: theme.colors.text,
    marginTop: 2,
  },
  featureCard: {
    minHeight: 180,
  },
  featureRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingVertical: 8,
    alignItems: 'center',
  },
  featureRowWide: {
    width: '100%',
    justifyContent: 'space-between',
    gap: 0,
  },
  featureItem: {
    width: 88,
    alignItems: 'center',
    gap: 10,
  },
  featureItemWide: {
    flex: 1,
    width: 'auto',
    minWidth: 0,
  },
  featureIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: {
    ...textStyles.body,
    fontSize: 13,
    color: theme.colors.text,
  },
  reminderMainCardWide: {
    flex: 1,
    minHeight: 360,
  },
  reminderListScroll: {
    flex: 1,
  },
  reminderListContent: {
    paddingBottom: 4,
  },
  reminderCard: {
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceVariant,
    padding: theme.spacing.sm + 2,
    marginTop: theme.spacing.sm,
    flexDirection: 'row',
    gap: theme.spacing.sm,
    minHeight: 132,
  },
  reminderLeft: {
    width: 132,
    alignItems: 'center',
  },
  reminderRight: {
    flex: 1,
    justifyContent: 'space-between',
  },
  medicineImage: {
    width: 78,
    height: 78,
    borderRadius: 10,
    backgroundColor: '#EEF2F7',
  },
  imagePlaceholder: {
    width: 78,
    height: 78,
    borderRadius: 10,
    backgroundColor: '#EEF2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  medicineName: {
    ...textStyles.semi,
    fontSize: 13,
    color: theme.colors.text,
    marginTop: 6,
    textAlign: 'center',
  },
  reminderInfoText: {
    ...textStyles.body,
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 20,
    marginTop: 4,
  },
  takeBtn: {
    alignSelf: 'flex-end',
    marginTop: theme.spacing.sm,
  },
  subTitle: {
    ...textStyles.semi,
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.sm,
    marginBottom: 4,
  },
  tabRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: 2,
    marginBottom: theme.spacing.xs,
    flexWrap: 'wrap',
  },
  recordRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.outlineVariant,
    paddingTop: 8,
    marginTop: 8,
  },
  recordText: {
    ...textStyles.body,
    fontSize: 13,
    color: theme.colors.text,
  },
  recordSource: {
    ...textStyles.semi,
    fontSize: 12,
    color: theme.colors.primary,
    marginBottom: 2,
  },
  recordExtra: {
    ...textStyles.body,
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  recordTime: {
    ...textStyles.body,
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  emptyText: {
    ...textStyles.body,
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
  },
  fixedPanelScroll: {
    flex: 1,
  },
  fixedPanelContent: {
    paddingBottom: 6,
  },
  detailsDialog: {
    maxWidth: 980,
    width: '92%',
    alignSelf: 'center',
    borderRadius: theme.borderRadius.lg,
    backgroundColor: '#FFFFFF',
  },
  detailsTitle: {
    ...textStyles.title,
    fontSize: 28,
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
    ...textStyles.title,
    flex: 1,
    fontSize: 18,
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
    ...textStyles.title,
    fontSize: 12,
  },
  detailsMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  detailsMetaText: {
    ...textStyles.body,
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
    ...textStyles.body,
    color: theme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  detailsDivider: {
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    ...textStyles.title,
    fontSize: 14,
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
  detailLabel: {
    ...textStyles.emphasis,
    fontSize: 14,
    color: theme.colors.primary,
    marginBottom: theme.spacing.xs,
  },
  detailValue: {
    ...textStyles.body,
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 20,
  },
  detailValueLong: {
    lineHeight: 22,
  },
  detailInlineRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  detailInlineLabel: {
    ...textStyles.title,
    width: 76,
    color: theme.colors.textSecondary,
    fontSize: 13,
  },
  detailInlineValue: {
    ...textStyles.body,
    flex: 1,
    color: theme.colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
});


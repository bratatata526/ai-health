import React, { useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Platform,
  Alert,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { Text, Title, Paragraph, Button, Menu, Portal, Dialog, TextInput } from 'react-native-paper';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { theme, textStyles } from '../theme';
import { CareAccountService } from '../services/CareAccountService';
import { MedicineService } from '../services/MedicineService';
import { CloudSyncService } from '../services/CloudSyncService';
import { CareAddAccountModal } from '../components/CareAddAccountModal';

function ReportDropdown({ onPick }) {
  const [open, setOpen] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);

  if (Platform.OS === 'web') {
    const show = hoverOpen;
    return (
      <View
        style={styles.dropdownWrapWeb}
        onMouseEnter={() => setHoverOpen(true)}
        onMouseLeave={() => setHoverOpen(false)}
      >
        <Pressable style={styles.dropdownBtnWeb}>
          <Text style={styles.dropdownBtnText}>查看报告 ▾</Text>
        </Pressable>
        {show ? (
          <View style={styles.dropdownMenuWeb}>
            <Pressable style={styles.dropdownItemWeb} onPress={() => onPick('week')}>
              <Text style={styles.dropdownItemWebText}>周报告</Text>
            </Pressable>
            <Pressable style={styles.dropdownItemWeb} onPress={() => onPick('month')}>
              <Text style={styles.dropdownItemWebText}>月报告</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <Menu
      visible={open}
      onDismiss={() => setOpen(false)}
      anchor={
        <Button compact mode="outlined" onPress={() => setOpen(true)}>
          查看报告
        </Button>
      }
    >
      <Menu.Item
        onPress={() => {
          onPick('week');
          setOpen(false);
        }}
        title="周报告"
      />
      <Menu.Item
        onPress={() => {
          onPick('month');
          setOpen(false);
        }}
        title="月报告"
      />
    </Menu>
  );
}

export default function CareAccountsScreen() {
  const navigation = useNavigation();
  const [mainTab, setMainTab] = useState('targets'); // targets: 我关怀了谁；caregivers: 谁关怀了我
  const [accounts, setAccounts] = useState([]);
  const [incomingCareGroups, setIncomingCareGroups] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [alertByUser, setAlertByUser] = useState({});
  const [recordByUser, setRecordByUser] = useState({});
  const [expandedViewByUser, setExpandedViewByUser] = useState({});
  const [loadingExpand, setLoadingExpand] = useState(null);
  const [careAddOpen, setCareAddOpen] = useState(false);
  const [remarkDialogVisible, setRemarkDialogVisible] = useState(false);
  const [remarkTarget, setRemarkTarget] = useState(null);
  const [remarkInput, setRemarkInput] = useState('');

  const getDisplayName = useCallback((acc) => {
    return acc?.remark || acc?.name || acc?.email || '关怀账号';
  }, []);

  const loadAccounts = useCallback(async () => {
    // 先拉取一次云端，确保“谁关怀了我”与下发记录是最新快照
    try {
      await CloudSyncService.syncDown();
    } catch (e) {
      // 忽略：离线时仍可展示本地缓存
      console.warn('关怀页云端同步失败，改用本地缓存：', e?.message || e);
    }

    const list = await CareAccountService.listCareAccounts();
    setAccounts(list);
    const meds = await MedicineService.getAllMedicines();
    const incomingRows = (Array.isArray(meds) ? meds : [])
      .filter((m) => m && typeof m === 'object' && m.careTemplateFrom)
      .map((m) => ({
        id: m.id,
        medicineName: m.name || '未命名药品',
        dosage: m.dosage || '',
        frequency: m.frequency || '',
        reminderSummary:
          m.reminderConfig?.enabled === false
            ? '未启用提醒'
            : Array.isArray(m.reminderConfig?.times) && m.reminderConfig.times.length
              ? `定点提醒：${m.reminderConfig.times.join('、')}`
              : m.reminderConfig?.mode === 'times_per_day'
                ? `每日 ${Number(m.reminderConfig?.timesPerDay || 2)} 次`
                : m.reminderConfig?.mode === 'interval_hours'
                  ? `每隔 ${Number(m.reminderConfig?.intervalHours || 8)} 小时`
                  : m.reminderConfig?.mode === 'prn'
                    ? '按需用药（无定时提醒）'
                    : '未设置提醒时间',
        careTemplateAt: m.careTemplateAt || m.createdAt || null,
        caregiver: m.careTemplateFrom || '未知关怀人',
      }));
    const grouped = incomingRows.reduce((acc, row) => {
      const key = row.caregiver;
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});
    const groups = Object.entries(grouped).map(([caregiver, rows]) => ({
      caregiver,
      rows: rows.sort((a, b) => new Date(b.careTemplateAt || 0).getTime() - new Date(a.careTemplateAt || 0).getTime()),
    }));
    setIncomingCareGroups(groups);
    await CareAccountService.refreshCareAlerts();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAccounts().catch(() => {});
    }, [loadAccounts])
  );

  const toggleAlerts = async (acc) => {
    if (expandedId === acc.userId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(acc.userId);
    setExpandedViewByUser((prev) => ({ ...prev, [acc.userId]: prev[acc.userId] || 'records' }));
    if (alertByUser[acc.userId] && recordByUser[acc.userId]) return;
    setLoadingExpand(acc.userId);
    try {
      const [alerts, records] = await Promise.all([
        CareAccountService.fetchDerivedAlertsForAccount(acc),
        CareAccountService.fetchCareRecordsForAccount(acc),
      ]);
      setAlertByUser((prev) => ({ ...prev, [acc.userId]: alerts || [] }));
      setRecordByUser((prev) => ({ ...prev, [acc.userId]: records || [] }));
    } finally {
      setLoadingExpand(null);
    }
  };

  const removeCare = (acc) => {
    const displayName = getDisplayName(acc);
    const detail = `确定要移除关怀账号「${displayName}」吗？移除后将无法继续查看对方的关怀动态与报告，需重新添加账号才能恢复。`;
    const doRemove = async () => {
      await CareAccountService.removeCareAccount(acc.userId);
      setAlertByUser((prev) => {
        const next = { ...prev };
        delete next[acc.userId];
        return next;
      });
      setRecordByUser((prev) => {
        const next = { ...prev };
        delete next[acc.userId];
        return next;
      });
      setExpandedViewByUser((prev) => {
        const next = { ...prev };
        delete next[acc.userId];
        return next;
      });
      setExpandedId(null);
      await loadAccounts();
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm(`移除关怀账号\n\n${detail}`)) return;
      doRemove().catch(() => {});
      return;
    }
    Alert.alert('移除关怀账号', detail, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: () => {
          doRemove().catch(() => {});
        },
      },
    ]);
  };

  const openCareReport = (acc, period) => {
    navigation.navigate('报告', {
      careUserId: acc.userId,
      careDisplayName: getDisplayName(acc),
      reportTypeForCare: period,
    });
  };

  const openRemarkDialog = (acc) => {
    setRemarkTarget(acc);
    setRemarkInput(String(acc?.remark || ''));
    setRemarkDialogVisible(true);
  };

  const saveRemark = async () => {
    if (!remarkTarget?.userId) return;
    await CareAccountService.setCareAccountRemark(remarkTarget.userId, remarkInput);
    setRemarkDialogVisible(false);
    setRemarkTarget(null);
    setRemarkInput('');
    await loadAccounts();
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={Platform.OS === 'web' ? styles.scrollWeb : undefined}
        contentContainerStyle={styles.scroll}
      >
        <Title style={styles.pageTitle}>关怀账号</Title>
        <Paragraph style={styles.intro}>
          支持双向查看：在「被关怀账号」里管理你关怀的人；在「关怀账号」里查看谁给你下发了关怀记录。
        </Paragraph>
        <View style={styles.mainTabRow}>
          <Button
            mode={mainTab === 'targets' ? 'contained' : 'outlined'}
            onPress={() => setMainTab('targets')}
          >
            被关怀账号
          </Button>
          <Button
            mode={mainTab === 'caregivers' ? 'contained' : 'outlined'}
            onPress={() => setMainTab('caregivers')}
          >
            关怀账号
          </Button>
        </View>
        <Button mode="text" compact onPress={() => loadAccounts()} style={{ alignSelf: 'flex-start' }}>
          刷新列表
        </Button>
        {mainTab === 'targets' ? (
          accounts.length === 0 ? (
            <Paragraph style={styles.empty}>暂未添加被关怀账号，请在底部添加。</Paragraph>
          ) : (
            accounts.map((acc) => (
              <View key={acc.userId} style={styles.card}>
                <View style={styles.row}>
                  <TouchableOpacity
                    style={styles.rowMain}
                    activeOpacity={0.7}
                    onPress={() => toggleAlerts(acc)}
                  >
                    <Ionicons name="heart" size={22} color={theme.colors.error} style={styles.heartIcon} />
                    <View style={styles.rowText}>
                      <Text style={[textStyles.semi, styles.name]}>{getDisplayName(acc)}</Text>
                      {acc?.remark ? (
                        <Text style={styles.email}>原账号：{acc.name || acc.email}</Text>
                      ) : null}
                      <Text style={styles.email}>{acc.email}</Text>
                    </View>
                    <Ionicons
                      name={expandedId === acc.userId ? 'chevron-up' : 'chevron-down'}
                      size={20}
                      color={theme.colors.textSecondary}
                    />
                  </TouchableOpacity>
                  <View style={styles.rowRight}>
                    <ReportDropdown onPick={(period) => openCareReport(acc, period)} />
                    <Button compact onPress={() => openRemarkDialog(acc)}>
                      备注
                    </Button>
                    <Button compact textColor={theme.colors.error} onPress={() => removeCare(acc)}>
                      移除
                    </Button>
                  </View>
                </View>
                {expandedId === acc.userId ? (
                  <View style={styles.alertsBox}>
                    <View style={styles.subTabRow}>
                      <Button
                        compact
                        mode={expandedViewByUser[acc.userId] === 'records' ? 'contained' : 'outlined'}
                        onPress={() =>
                          setExpandedViewByUser((prev) => ({ ...prev, [acc.userId]: 'records' }))
                        }
                      >
                        关怀记录
                      </Button>
                      <Button
                        compact
                        mode={expandedViewByUser[acc.userId] === 'alerts' ? 'contained' : 'outlined'}
                        onPress={() =>
                          setExpandedViewByUser((prev) => ({ ...prev, [acc.userId]: 'alerts' }))
                        }
                      >
                        关怀动态
                      </Button>
                    </View>
                    {loadingExpand === acc.userId ? (
                      <Paragraph>加载动态...</Paragraph>
                    ) : (expandedViewByUser[acc.userId] || 'records') === 'records' ? (
                      (recordByUser[acc.userId] || []).length === 0 ? (
                        <Paragraph style={styles.muted}>暂无关怀记录（你还未给该账号下发用药提醒）</Paragraph>
                      ) : (
                        (recordByUser[acc.userId] || []).slice(0, 40).map((row) => (
                          <View key={row.id} style={styles.recordCard}>
                            <Text style={styles.recordName}>{row.medicineName}</Text>
                            <Text style={styles.recordMeta}>
                              {row.dosage || '每次用量未设置'} · {row.frequency || '频率未设置'}
                            </Text>
                            <Text style={styles.recordMeta}>{row.reminderSummary}</Text>
                            <Text style={styles.recordTime}>
                              下发时间：
                              {row.careTemplateAt
                                ? new Date(row.careTemplateAt).toLocaleString('zh-CN')
                                : '未知'}
                            </Text>
                          </View>
                        ))
                      )
                    ) : (alertByUser[acc.userId] || []).length === 0 ? (
                      <Paragraph style={styles.muted}>
                        暂无近期异常或未同步对方数据（请确认对方开启云上传）
                      </Paragraph>
                    ) : (
                      (alertByUser[acc.userId] || []).slice(0, 40).map((al) => (
                        <Paragraph key={al.id} style={styles.alertLine}>
                          {al.message}
                        </Paragraph>
                      ))
                    )}
                  </View>
                ) : null}
              </View>
            ))
          )
        ) : incomingCareGroups.length === 0 ? (
          <Paragraph style={styles.empty}>暂无关怀账号给你下发记录。</Paragraph>
        ) : (
          incomingCareGroups.map((group) => (
            <View key={group.caregiver} style={styles.card}>
              <Text style={[textStyles.semi, styles.name]}>关怀人：{group.caregiver}</Text>
              <Paragraph style={styles.muted}>已下发 {group.rows.length} 条用药关怀记录</Paragraph>
              <View style={{ marginTop: theme.spacing.sm }}>
                {group.rows.slice(0, 50).map((row) => (
                  <View key={`${group.caregiver}_${row.id}`} style={styles.recordCard}>
                    <Text style={styles.recordName}>{row.medicineName}</Text>
                    <Text style={styles.recordMeta}>
                      {row.dosage || '每次用量未设置'} · {row.frequency || '频率未设置'}
                    </Text>
                    <Text style={styles.recordMeta}>{row.reminderSummary}</Text>
                    <Text style={styles.recordTime}>
                      下发时间：{row.careTemplateAt ? new Date(row.careTemplateAt).toLocaleString('zh-CN') : '未知'}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
      <View style={styles.footer}>
        <Button mode="contained" icon="heart-plus" onPress={() => setCareAddOpen(true)}>
          添加关怀账号
        </Button>
      </View>
      <CareAddAccountModal
        visible={careAddOpen}
        onDismiss={() => setCareAddOpen(false)}
        onAdded={loadAccounts}
      />
      <Portal>
        <Dialog visible={remarkDialogVisible} onDismiss={() => setRemarkDialogVisible(false)}>
          <Dialog.Title>设置备注</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              label="备注名称（最多32字）"
              value={remarkInput}
              onChangeText={setRemarkInput}
              maxLength={32}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRemarkDialogVisible(false)}>取消</Button>
            <Button mode="contained" onPress={() => saveRemark().catch(() => {})}>保存</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollWeb: {
    overflow: 'visible',
  },
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scroll: {
    padding: theme.spacing.md,
    paddingBottom: 96,
    ...(Platform.OS === 'web' ? { overflow: 'visible' } : {}),
  },
  pageTitle: {
    ...textStyles.title,
    marginBottom: theme.spacing.sm,
  },
  intro: {
    marginBottom: theme.spacing.sm,
    opacity: 0.9,
  },
  mainTabRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
    flexWrap: 'wrap',
  },
  empty: {
    marginTop: theme.spacing.lg,
    textAlign: 'center',
    opacity: 0.72,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.sm + 2,
    marginTop: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    ...(Platform.OS === 'web' ? { overflow: 'visible' } : {}),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    ...(Platform.OS === 'web' ? { overflow: 'visible' } : {}),
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  heartIcon: {
    marginRight: 10,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 16,
  },
  email: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  alertsBox: {
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.outlineVariant,
  },
  subTabRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    flexWrap: 'wrap',
  },
  muted: {
    opacity: 0.75,
    fontSize: 13,
  },
  recordCard: {
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surfaceVariant,
    padding: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  recordName: {
    ...textStyles.semi,
    fontSize: 14,
    color: theme.colors.text,
  },
  recordMeta: {
    ...textStyles.body,
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  recordTime: {
    ...textStyles.body,
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 6,
  },
  alertLine: {
    fontSize: 13,
    marginBottom: 8,
    color: theme.colors.text,
  },
  footer: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.outlineVariant,
    backgroundColor: theme.colors.surface,
  },
  /** Web：整块悬停区包含按钮与菜单，纵向紧贴排列，避免绝对定位留出空隙导致鼠标离开时菜单消失 */
  dropdownWrapWeb: {
    position: 'relative',
    alignSelf: 'center',
    zIndex: 60,
  },
  dropdownBtnWeb: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.outline,
    backgroundColor: theme.colors.surface,
  },
  dropdownBtnText: {
    fontSize: 13,
    color: theme.colors.primary,
  },
  dropdownMenuWeb: {
    position: 'absolute',
    right: 0,
    top: '100%',
    marginTop: -2,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    minWidth: 132,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  dropdownItemWeb: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.outlineVariant,
  },
  dropdownItemWebText: {
    fontSize: 14,
    color: theme.colors.text,
  },
});

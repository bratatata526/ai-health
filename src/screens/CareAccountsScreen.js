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
import { Text, Title, Paragraph, Button, Menu } from 'react-native-paper';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { theme, textStyles } from '../theme';
import { CareAccountService } from '../services/CareAccountService';
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
  const [accounts, setAccounts] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [alertByUser, setAlertByUser] = useState({});
  const [loadingExpand, setLoadingExpand] = useState(null);
  const [careAddOpen, setCareAddOpen] = useState(false);

  const loadAccounts = useCallback(async () => {
    const list = await CareAccountService.listCareAccounts();
    setAccounts(list);
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
    if (alertByUser[acc.userId]) return;
    setLoadingExpand(acc.userId);
    try {
      const alerts = await CareAccountService.fetchDerivedAlertsForAccount(acc);
      setAlertByUser((prev) => ({ ...prev, [acc.userId]: alerts }));
    } finally {
      setLoadingExpand(null);
    }
  };

  const removeCare = (acc) => {
    const detail = `确定要移除关怀账号「${acc.name}」吗？移除后将无法继续查看对方的关怀动态与报告，需重新添加账号才能恢复。`;
    const doRemove = async () => {
      await CareAccountService.removeCareAccount(acc.userId);
      setAlertByUser((prev) => {
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
      careDisplayName: acc.name || acc.email,
      reportTypeForCare: period,
    });
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={Platform.OS === 'web' ? styles.scrollWeb : undefined}
        contentContainerStyle={styles.scroll}
      >
        <Title style={styles.pageTitle}>关怀账号</Title>
        <Paragraph style={styles.intro}>
          点击账号信息展开关怀动态（漏服、心率与血糖异常等）。鼠标移到「查看报告」可选择周报告或月报告（基于对方云快照）。
        </Paragraph>
        <Button mode="text" compact onPress={() => loadAccounts()} style={{ alignSelf: 'flex-start' }}>
          刷新列表
        </Button>

        {accounts.length === 0 ? (
          <Paragraph style={styles.empty}>暂未添加关怀账号，请在底部添加。</Paragraph>
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
                    <Text style={[textStyles.semi, styles.name]}>{acc.name}</Text>
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
                  <Button compact textColor={theme.colors.error} onPress={() => removeCare(acc)}>
                    移除
                  </Button>
                </View>
              </View>
              {expandedId === acc.userId ? (
                <View style={styles.alertsBox}>
                  {loadingExpand === acc.userId ? (
                    <Paragraph>加载动态...</Paragraph>
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
  muted: {
    opacity: 0.75,
    fontSize: 13,
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

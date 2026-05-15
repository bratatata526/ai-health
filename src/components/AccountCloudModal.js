import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Modal, Paragraph, Portal, Snackbar, TextInput, Title, Text } from 'react-native-paper';
import { theme, textStyles } from '../theme';
import { AuthService } from '../services/AuthService';
import { CareAccountService } from '../services/CareAccountService';
import { CareAddAccountModal } from './CareAddAccountModal';
import { computeBmi, normalizeBodyMetrics } from '../utils/bmi';

const formatSyncTime = (isoString) => {
  if (!isoString) return '暂无（建议先上传或下载）';
  try {
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } catch {
    return '未知';
  }
};

function normalizeInput(value) {
  const text = String(value || '');
  const clean = text.replace(/[^0-9.]/g, '');
  const firstDot = clean.indexOf('.');
  if (firstDot === -1) return clean;
  return `${clean.slice(0, firstDot + 1)}${clean.slice(firstDot + 1).replace(/\./g, '')}`;
}

export function AccountCloudModal({
  visible,
  onDismiss,
  profile,
  cloudMeta,
  onProfileUpdated,
  onOpenPassword,
  onDeleteAccount,
  onLogout,
}) {
  const [heightInput, setHeightInput] = useState('');
  const [weightInput, setWeightInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [successVisible, setSuccessVisible] = useState(false);

  const [careList, setCareList] = useState([]);
  const [careAlerts, setCareAlerts] = useState([]);
  const [careAddOpen, setCareAddOpen] = useState(false);

  const loadCareBundle = useCallback(async () => {
    try {
      const list = await CareAccountService.listCareAccounts();
      setCareList(list);
      await CareAccountService.refreshCareAlerts();
      setCareAlerts(CareAccountService.getLatestAlerts());
    } catch {
      setCareAlerts([]);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    loadCareBundle();
    const timer = setInterval(() => loadCareBundle(), 45000);
    return () => clearInterval(timer);
  }, [visible, loadCareBundle]);

  useEffect(() => {
    if (!visible) return;
    setHeightInput(profile?.heightCm !== null && profile?.heightCm !== undefined ? String(profile.heightCm) : '');
    setWeightInput(profile?.weightKg !== null && profile?.weightKg !== undefined ? String(profile.weightKg) : '');
  }, [visible, profile]);

  const bmi = useMemo(() => computeBmi(heightInput, weightInput), [heightInput, weightInput]);

  const saveBodyMetrics = async () => {
    try {
      setSaving(true);
      const normalized = normalizeBodyMetrics({
        heightCm: heightInput,
        weightKg: weightInput,
      });
      const hasHeightInput = String(heightInput || '').trim() !== '';
      const hasWeightInput = String(weightInput || '').trim() !== '';

      if (hasHeightInput && normalized.heightCm === null) {
        Alert.alert('提示', '身高范围应在 50 - 250 cm');
        return;
      }
      if (hasWeightInput && normalized.weightKg === null) {
        Alert.alert('提示', '体重范围应在 20 - 300 kg');
        return;
      }

      const nextProfile = await AuthService.mergeProfile({
        heightCm: normalized.heightCm,
        weightKg: normalized.weightKg,
      });
      onProfileUpdated?.(nextProfile);
      Alert.alert('成功', '身高体重已保存；约数秒内会自动上传云端，退出登录时也会再完整备份一次。');
      setSuccessVisible(true);
    } catch (e) {
      Alert.alert('失败', e?.message || '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const removeCare = (acc) => {
    Alert.alert('移除关怀账号', `确定移除「${acc.name}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: async () => {
          await CareAccountService.removeCareAccount(acc.userId);
          await loadCareBundle();
        },
      },
    ]);
  };

  return (
    <>
      <Portal>
        <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modalContainer}>
          <Title style={styles.title}>账号与云同步</Title>
          <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
          <Paragraph style={styles.infoText}>
            {profile
              ? `当前用户：${profile.name}（${profile.email}）`
              : '当前未获取到用户资料'}
          </Paragraph>
          <Paragraph style={styles.infoText}>
            上次同步时间：{formatSyncTime(cloudMeta?.updatedAt)}
          </Paragraph>

          <View style={styles.careSection}>
            <Title style={styles.sectionTitle}>关怀账号</Title>
            <Paragraph style={[styles.infoText, { marginBottom: theme.spacing.sm }]}>
              添加后会在本机长期保存与对方的关怀绑定（对方登录令牌用于拉取其已上传的云快照），用于提示漏服与心率、血糖偏高/偏低等。退出登录不会解除绑定；重新登录同一账号后仍可使用。若令牌过期需在列表中移除该关怀账号后重新添加。本机关联仅对当前登录账号可见；换用其他账号登录时不会看到他人的绑定。
            </Paragraph>
            <View style={[styles.actionRow, { flexWrap: 'wrap', gap: 8 }]}>
              <Button mode="outlined" onPress={() => setCareAddOpen(true)} compact>
                添加关怀账号
              </Button>
              <Button mode="text" onPress={loadCareBundle} compact>
                刷新
              </Button>
            </View>
            {careList.length === 0 ? (
              <Paragraph style={[styles.infoText, styles.muted]}>暂未添加关怀账号</Paragraph>
            ) : (
              careList.map((a) => (
                <View key={a.userId} style={styles.careRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[textStyles.semi]}>{a.name}</Text>
                    <Text style={styles.muted}>{a.email}</Text>
                  </View>
                  <Button compact textColor={theme.colors.error} onPress={() => removeCare(a)}>
                    移除
                  </Button>
                </View>
              ))
            )}
            <Title style={[styles.sectionTitle, { marginTop: theme.spacing.md }]}>关怀动态</Title>
            {careAlerts.length === 0 ? (
              <Paragraph style={[styles.infoText, styles.muted]}>暂无近期异常或未同步对方数据（请确认对方开启云上传）</Paragraph>
            ) : (
              careAlerts.slice(0, 24).map((al) => (
                <Paragraph key={al.id} style={styles.alertLine}>
                  {al.message}
                </Paragraph>
              ))
            )}
          </View>

          <TextInput
            label="身高（cm）"
            value={heightInput}
            onChangeText={(text) => setHeightInput(normalizeInput(text))}
            keyboardType="decimal-pad"
            mode="outlined"
            inputMode="decimal"
            style={styles.input}
            placeholder="例如 170"
          />
          <TextInput
            label="体重（kg）"
            value={weightInput}
            onChangeText={(text) => setWeightInput(normalizeInput(text))}
            keyboardType="decimal-pad"
            mode="outlined"
            inputMode="decimal"
            style={styles.input}
            placeholder="例如 60"
          />

          <View style={styles.bmiBox}>
            <Paragraph style={styles.bmiTitle}>BMI</Paragraph>
            <Paragraph style={styles.bmiValue}>
              {bmi ? `${bmi.value}` : '尚未填写身高或体重，填写后即可查看 BMI'}
            </Paragraph>
          </View>

          <Button
            mode="contained"
            loading={saving}
            disabled={saving}
            onPress={saveBodyMetrics}
            style={styles.saveButton}
            contentStyle={styles.saveButtonContent}
          >
            保存身体数据
          </Button>

          <View style={styles.actionRow}>
            <Button onPress={onOpenPassword}>修改密码</Button>
            <Button textColor={theme.colors.error} onPress={onDeleteAccount}>注销账号</Button>
          </View>
          <View style={styles.actionRow}>
            <Button onPress={onLogout}>退出登录</Button>
            <Button onPress={onDismiss}>关闭</Button>
          </View>
        </ScrollView>
        <Snackbar
          visible={successVisible}
          onDismiss={() => setSuccessVisible(false)}
          duration={1800}
        >
          身高体重已保存
        </Snackbar>
        </Modal>
      </Portal>

      <CareAddAccountModal
        visible={careAddOpen}
        onDismiss={() => setCareAddOpen(false)}
        onAdded={loadCareBundle}
      />
    </>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    margin: theme.spacing.lg,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface,
    maxHeight: '85%',
    width: '84%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  title: {
    ...textStyles.title,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
  },
  scrollArea: {
    maxHeight: '100%',
  },
  scrollContent: {
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    alignItems: 'flex-start',
  },
  infoText: {
    ...textStyles.body,
  },
  input: {
    marginTop: theme.spacing.xs,
    width: '100%',
    alignSelf: 'flex-start',
  },
  bmiBox: {
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    width: '100%',
    alignSelf: 'flex-start',
  },
  bmiTitle: {
    ...textStyles.body,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  bmiValue: {
    ...textStyles.title,
    fontSize: 16,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  saveButton: {
    alignSelf: 'flex-start',
    marginTop: theme.spacing.xs,
    minWidth: 132,
  },
  saveButtonContent: {
    paddingHorizontal: theme.spacing.xs,
  },
  careSection: {
    width: '100%',
    alignSelf: 'stretch',
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceVariant,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
  },
  sectionTitle: {
    ...textStyles.title,
    fontSize: 16,
    marginBottom: theme.spacing.xs,
  },
  careRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.outlineVariant,
  },
  muted: {
    color: theme.colors.textSecondary,
    fontSize: 13,
  },
  alertLine: {
    ...textStyles.body,
    fontSize: 13,
    marginBottom: 6,
    color: theme.colors.text,
  },
});


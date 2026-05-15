import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Modal, Paragraph, Portal, Snackbar, TextInput, Title } from 'react-native-paper';
import { theme, textStyles } from '../theme';
import { AuthService } from '../services/AuthService';
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
}) {
  const [heightInput, setHeightInput] = useState('');
  const [weightInput, setWeightInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [successVisible, setSuccessVisible] = useState(false);

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
      Alert.alert('成功', '身高体重已保存；约数秒内会自动上传云端。');
      setSuccessVisible(true);
    } catch (e) {
      Alert.alert('失败', e?.message || '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
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
});


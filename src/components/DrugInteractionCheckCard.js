import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, Chip, Dialog, Divider, Paragraph, Portal, Text } from 'react-native-paper';
import Markdown from 'react-native-markdown-display';
import { theme, appFontFamilies } from '../theme';
import { AIService } from '../services/AIService';

export function DrugInteractionCheckCard({ medicines = [] }) {
  const medicinesById = useMemo(() => {
    const m = new Map();
    for (const x of medicines) m.set(x.id, x);
    return m;
  }, [medicines]);

  const [selectedMedicineIds, setSelectedMedicineIds] = useState([]);
  const [interactionLoading, setInteractionLoading] = useState(false);
  const [interactionResult, setInteractionResult] = useState('');
  const [interactionVisible, setInteractionVisible] = useState(false);

  const toggleMedicine = (id) => {
    setSelectedMedicineIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  };

  const runInteractionCheck = async () => {
    if (interactionLoading) return;
    const selected = selectedMedicineIds.map((id) => medicinesById.get(id)).filter(Boolean);
    if (selected.length < 2) {
      setInteractionResult('请至少选择 2 个药品再分析相互作用。');
      setInteractionVisible(true);
      return;
    }

    setInteractionLoading(true);
    setInteractionResult('');
    setInteractionVisible(true);
    try {
      const res = await AIService.checkDrugInteractions(selected);
      setInteractionResult(res);
    } catch (e) {
      setInteractionResult(`调用AI失败：${e?.message || '请检查网络/配置后重试'}`);
    } finally {
      setInteractionLoading(false);
    }
  };

  return (
    <>
      <Card style={styles.card}>
        <Card.Content>
          <Text style={styles.title}>药物相互作用检测</Text>
          <Paragraph style={styles.hint}>选择 2 个或以上药品，让 AI 分析是否存在相互作用与风险。</Paragraph>
          <Divider style={styles.divider} />

          {medicines.length === 0 ? (
            <Paragraph style={styles.hint}>暂无药品数据，请先添加药品。</Paragraph>
          ) : (
            <View style={styles.chipsWrap}>
              {medicines.map((m) => {
                const selected = selectedMedicineIds.includes(m.id);
                return (
                  <Chip
                    key={m.id}
                    selected={selected}
                    onPress={() => toggleMedicine(m.id)}
                    style={styles.chip}
                    textStyle={styles.chipLabel}
                    icon={selected ? 'check' : 'pill'}
                  >
                    {m.name}
                  </Chip>
                );
              })}
            </View>
          )}

          <Button
            mode="contained"
            icon="flask"
            onPress={runInteractionCheck}
            disabled={interactionLoading || medicines.length === 0}
            loading={interactionLoading}
            style={styles.actionButton}
          >
            分析相互作用
          </Button>
        </Card.Content>
      </Card>

      <Portal>
        <Dialog
          visible={interactionVisible}
          onDismiss={() => setInteractionVisible(false)}
          style={styles.dialog}
        >
          <Dialog.Title style={styles.dialogTitle}>相互作用分析结果</Dialog.Title>
          {interactionLoading ? (
            <Dialog.Content>
              <View style={styles.dialogLoading}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text style={styles.loadingHint}>AI 正在分析…</Text>
              </View>
            </Dialog.Content>
          ) : (
            <Dialog.ScrollArea>
              <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={styles.resultContent}>
                <View style={styles.resultBox}>
                  <Markdown style={markdownStyles}>
                    {interactionResult || '暂无结果'}
                  </Markdown>
                </View>
              </ScrollView>
            </Dialog.ScrollArea>
          )}
          <Dialog.Actions>
            <Button onPress={() => setInteractionVisible(false)}>关闭</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: theme.spacing.md,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: '#F6F9FE',
    borderWidth: 1,
    borderColor: '#BFD2EA',
  },
  title: {
    fontFamily: appFontFamilies.bold,
    fontSize: 16,
    color: theme.colors.text,
  },
  hint: {
    fontFamily: appFontFamilies.regular,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
    lineHeight: 20,
  },
  divider: {
    marginVertical: theme.spacing.md,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  chip: {
    backgroundColor: '#EEF3FA',
  },
  chipLabel: {
    fontFamily: appFontFamilies.regular,
  },
  actionButton: {
    marginTop: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
  },
  dialog: {
    maxWidth: 980,
    width: '92%',
    alignSelf: 'center',
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface,
  },
  dialogTitle: {
    fontFamily: appFontFamilies.bold,
    fontSize: 28,
  },
  dialogLoading: {
    alignItems: 'center',
    paddingVertical: theme.spacing.lg,
  },
  loadingHint: {
    fontFamily: appFontFamilies.regular,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.sm,
  },
  resultContent: {
    paddingVertical: theme.spacing.sm,
  },
  resultBox: {
    borderWidth: 1,
    borderColor: '#DCE6F2',
    borderRadius: theme.borderRadius.md,
    backgroundColor: '#F6F9FE',
    padding: theme.spacing.md,
  },
  resultText: {
    fontFamily: appFontFamilies.regular,
    color: theme.colors.text,
    lineHeight: 22,
  },
});

const markdownStyles = {
  body: {
    fontFamily: appFontFamilies.regular,
    color: theme.colors.text,
    fontSize: 14,
    lineHeight: 22,
  },
  heading3: {
    fontFamily: appFontFamilies.bold,
    color: theme.colors.primary,
    fontSize: 15,
    marginTop: 10,
    marginBottom: 6,
  },
  bullet_list: {
    marginTop: 2,
    marginBottom: 4,
  },
  list_item: {
    marginBottom: 4,
  },
  paragraph: {
    marginTop: 4,
    marginBottom: 8,
  },
};


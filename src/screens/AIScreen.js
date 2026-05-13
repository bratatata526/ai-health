import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Chip,
  Dialog,
  Divider,
  Paragraph,
  Portal,
  SegmentedButtons,
  Text,
  TextInput,
  ActivityIndicator,
} from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import AIIcon from '../components/AIIcon';
import SuggestionIcon from '../components/SuggestionIcon';
import { theme, appFontFamilies } from '../theme';
import { AIService } from '../services/AIService';
import { MedicineService } from '../services/MedicineService';
import { DeviceService } from '../services/DeviceService';
import { PersonalizedAdviceCache } from '../services/PersonalizedAdviceCache';
import { AI_DISCLAIMER_ZH } from '../constants/aiDisclaimer';

/** Dialog 使用 MD3 elevation.level3（主题里常为淡紫Tint），此处强制纯白底与卡片一致，避免看起来像「透明无底」 */
const dialogSurfaceTheme = {
  ...theme,
  colors: {
    ...theme.colors,
    elevation: {
      ...(theme.colors.elevation ?? {}),
      level3: theme.colors.surface,
    },
  },
};

export default function AIScreen() {
  const [mode, setMode] = useState('chat'); // chat | interactions | advice

  const [medicines, setMedicines] = useState([]);
  const medicinesById = useMemo(() => {
    const m = new Map();
    for (const x of medicines) m.set(x.id, x);
    return m;
  }, [medicines]);

  // chat
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([
    {
      role: 'assistant',
      content: '你好！我是健康助手。你可以问我健康管理、用药提醒、指标解读等问题（重要问题仍建议咨询医生）。',
    },
  ]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatScrollRef = useRef(null);

  // interactions
  const [selectedMedicineIds, setSelectedMedicineIds] = useState([]);
  const [interactionLoading, setInteractionLoading] = useState(false);
  const [interactionResult, setInteractionResult] = useState('');
  const [interactionVisible, setInteractionVisible] = useState(false);

  // personalized advice
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [adviceText, setAdviceText] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const ms = await MedicineService.getAllMedicines();
        setMedicines(ms || []);
      } catch {
        setMedicines([]);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const cached = await PersonalizedAdviceCache.get();
        if (cached?.text) setAdviceText(cached.text);
      } catch {
        // ignore
      }
    })();
  }, []);

  const sendChat = async () => {
    const question = chatInput.trim();
    if (!question || chatLoading) return;
    setChatInput('');
    const nextMessages = [...chatMessages, { role: 'user', content: question }];
    setChatMessages(nextMessages);
    setChatLoading(true);
    try {
      const [healthData, devices] = await Promise.all([
        DeviceService.getHealthDataForStorage(),
        DeviceService.getConnectedDevices(),
      ]);
      const answer = await AIService.healthQnA(question, {
        medicines,
        healthData,
        devices,
      });
      setChatMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
      setTimeout(() => {
        try {
          chatScrollRef.current?.scrollToEnd?.({ animated: true });
        } catch {
          // ignore
        }
      }, 50);
    } catch (e) {
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `调用AI失败：${e?.message || '请检查网络/配置后重试'}` },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

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

  const generateAdvice = async () => {
    if (adviceLoading) return;
    setAdviceLoading(true);
    setAdviceText('');
    try {
      const healthData = await DeviceService.getHealthDataForStorage();
      const ms = medicines;
      const userData = {
        heartRate: healthData?.heartRate || [],
        bloodGlucose: healthData?.bloodGlucose || [],
        sleep: healthData?.sleep || [],
        medicines: ms || [],
      };
      const text = await AIService.generatePersonalizedAdvice(userData);
      setAdviceText(text);
      await PersonalizedAdviceCache.set(text);
    } catch (e) {
      setAdviceText(`调用AI失败：${e?.message || '请检查网络/配置后重试'}`);
    } finally {
      setAdviceLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.containerContent}
      keyboardShouldPersistTaps="handled"
    >
      <Card style={styles.card}>
        <Card.Content>
          <View style={styles.headerRow}>
            <AIIcon size={24} color={theme.colors.primary} focused={true} />
            <Text style={styles.headerTitle}>AI 助手</Text>
          </View>
          <SegmentedButtons
            value={mode}
            onValueChange={setMode}
            buttons={[
              { value: 'chat', label: '问答', labelStyle: styles.segmentLabel },
              { value: 'interactions', label: '相互作用', labelStyle: styles.segmentLabel },
              { value: 'advice', label: '建议', labelStyle: styles.segmentLabel },
            ]}
          />
        </Card.Content>
      </Card>

      {mode === 'chat' ? (
        <Card style={styles.card}>
          <Card.Content>
            <Text style={styles.sectionTitle}>健康问答</Text>
            <Paragraph style={[styles.sectionHint, styles.sansRegular]}>
              你可以提问：指标是否正常、如何改善睡眠、用药注意事项等（重要问题请咨询医生）。
            </Paragraph>
            <Divider style={styles.divider} />

            <ScrollView
              ref={chatScrollRef}
              style={styles.chatBox}
              contentContainerStyle={styles.chatBoxContent}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={true}
            >
              {chatMessages.map((m, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.chatBubble,
                    m.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAssistant,
                  ]}
                >
                  <Text style={styles.chatText}>{m.content}</Text>
                </View>
              ))}
              {chatLoading && (
                <View style={styles.chatLoadingRow}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                  <Text style={styles.chatLoadingText}>AI 正在思考…</Text>
                </View>
              )}
            </ScrollView>

            <View style={styles.chatInputRow}>
              <TextInput
                mode="outlined"
                placeholder="输入你的问题…"
                value={chatInput}
                onChangeText={setChatInput}
                style={styles.chatInput}
                multiline
              />
              <Button mode="contained" onPress={sendChat} loading={chatLoading} disabled={chatLoading}>
                发送
              </Button>
            </View>
          </Card.Content>
        </Card>
      ) : null}

      {mode === 'interactions' ? (
        <Card style={styles.card}>
          <Card.Content>
            <Text style={styles.sectionTitle}>药物相互作用检测</Text>
            <Paragraph style={[styles.sectionHint, styles.sansRegular]}>
              选择 2 个或以上药品，让 AI 分析是否存在相互作用与风险。
            </Paragraph>
            <Divider style={styles.divider} />

            {medicines.length === 0 ? (
              <Paragraph style={styles.sansRegular}>暂无药品数据，请先在“药品”页添加药品。</Paragraph>
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
              style={{ marginTop: theme.spacing.md }}
            >
              分析相互作用
            </Button>
          </Card.Content>
        </Card>
      ) : null}

      {mode === 'advice' ? (
        <Card style={styles.card}>
          <Card.Content>
            <Text style={styles.sectionTitle}>个性化健康建议</Text>
            <Paragraph style={[styles.sectionHint, styles.sansRegular]}>
              基于你的健康数据（心率/血糖/睡眠）与药品管理信息，生成可执行的个性化建议。
            </Paragraph>
            <Divider style={styles.divider} />

            <Button
              mode="contained"
              icon={({ size, color }) => (
                <SuggestionIcon size={size} color={color} focused={false} />
              )}
              onPress={generateAdvice}
              loading={adviceLoading}
            >
              生成建议
            </Button>

            {adviceText ? (
              <ScrollView
                style={styles.resultBox}
                contentContainerStyle={styles.resultBoxContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator
                persistentScrollbar
              >
                <Text style={styles.resultText}>{adviceText}</Text>
                <Paragraph style={styles.adviceDisclaimer}>{AI_DISCLAIMER_ZH}</Paragraph>
              </ScrollView>
            ) : null}
          </Card.Content>
        </Card>
      ) : null}

      <Portal>
        <Dialog
          visible={interactionVisible}
          onDismiss={() => setInteractionVisible(false)}
          theme={dialogSurfaceTheme}
        >
          <Dialog.Title style={styles.dialogTitle}>相互作用分析结果</Dialog.Title>
          {interactionLoading ? (
            <Dialog.Content style={styles.dialogContentBg}>
              <View style={styles.dialogLoading}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text style={[styles.loadingHint, styles.sansRegular]}>AI 正在分析…</Text>
              </View>
            </Dialog.Content>
          ) : (
            <Dialog.ScrollArea>
              <ScrollView
                nestedScrollEnabled
                style={{ maxHeight: 420 }}
                contentContainerStyle={{ paddingVertical: theme.spacing.sm }}
              >
                <Text style={styles.resultText}>{interactionResult || '暂无结果'}</Text>
              </ScrollView>
            </Dialog.ScrollArea>
          )}
          <Dialog.Actions style={styles.dialogActions}>
            <Button onPress={() => setInteractionVisible(false)}>关闭</Button>
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
  containerContent: {
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  card: {
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  sansRegular: {
    fontFamily: appFontFamilies.regular,
  },
  segmentLabel: {
    fontFamily: appFontFamilies.medium,
    fontWeight: Platform.OS === 'web' ? '600' : 'normal',
  },
  dialogTitle: {
    fontFamily: appFontFamilies.bold,
    fontWeight: Platform.OS === 'web' ? '700' : 'normal',
  },
  dialogContentBg: {
    backgroundColor: theme.colors.surface,
  },
  dialogActions: {
    backgroundColor: theme.colors.surface,
  },
  headerTitle: {
    fontFamily: appFontFamilies.bold,
    fontWeight: Platform.OS === 'web' ? '700' : 'normal',
    fontSize: 18,
    color: theme.colors.text,
  },
  sectionTitle: {
    fontFamily: appFontFamilies.bold,
    fontWeight: Platform.OS === 'web' ? '700' : 'normal',
    fontSize: 16,
    marginBottom: theme.spacing.xs,
  },
  sectionHint: {
    color: theme.colors.textSecondary,
  },
  divider: {
    marginVertical: theme.spacing.md,
  },
  chatBox: {
    maxHeight: 380,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceVariant,
  },
  chatBoxContent: {
    padding: theme.spacing.sm,
  },
  chatBubble: {
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
    maxWidth: '92%',
  },
  chatBubbleUser: {
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    alignSelf: 'flex-end',
  },
  chatBubbleAssistant: {
    backgroundColor: theme.colors.surface,
    alignSelf: 'flex-start',
  },
  chatText: {
    fontFamily: appFontFamilies.regular,
    color: theme.colors.text,
    lineHeight: 20,
  },
  chatInputRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
    alignItems: 'flex-end',
  },
  chatInput: {
    flex: 1,
  },
  chatLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  chatLoadingText: {
    fontFamily: appFontFamilies.regular,
    color: theme.colors.textSecondary,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  chip: {
    backgroundColor: theme.colors.surfaceVariant,
  },
  chipLabel: {
    fontFamily: appFontFamilies.regular,
    fontWeight: Platform.OS === 'web' ? '500' : 'normal',
  },
  resultBox: {
    marginTop: theme.spacing.md,
    maxHeight: 420,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceVariant,
  },
  resultBoxContent: {
    padding: theme.spacing.sm,
    paddingRight: theme.spacing.md,
  },
  resultText: {
    fontFamily: appFontFamilies.regular,
    fontSize: 14,
    lineHeight: 22,
    color: theme.colors.text,
  },
  adviceDisclaimer: {
    fontFamily: appFontFamilies.regular,
    fontSize: 11,
    lineHeight: 17,
    color: '#b45309',
    marginTop: theme.spacing.sm,
  },
  dialogLoading: {
    alignItems: 'center',
    paddingVertical: theme.spacing.lg,
  },
});


import React, { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Divider,
  Paragraph,
  Text,
  TextInput,
  ActivityIndicator,
} from 'react-native-paper';
import Markdown from 'react-native-markdown-display';
import AIIcon from '../components/AIIcon';
import { theme, appFontFamilies } from '../theme';
import { AIService } from '../services/AIService';
import { MedicineService } from '../services/MedicineService';
import { DeviceService } from '../services/DeviceService';
import { AuthService } from '../services/AuthService';
import { AIChatHistoryService } from '../services/AIChatHistoryService';

const INITIAL_CHAT_MESSAGES = [
  {
    role: 'assistant',
    content: '你好！我是健康助手。你可以问我健康管理、用药提醒、指标解读等问题（重要问题仍建议咨询医生）。',
  },
];

export default function AIScreen() {
  const [medicines, setMedicines] = useState([]);

  // chat
  const [chatUserId, setChatUserId] = useState('guest');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState(INITIAL_CHAT_MESSAGES);
  const [chatLoading, setChatLoading] = useState(false);
  const chatScrollRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [ms, profile] = await Promise.all([
          MedicineService.getAllMedicines(),
          AuthService.getProfile(),
        ]);
        setMedicines(ms || []);
        const userId = profile?.id || profile?.email || 'guest';
        setChatUserId(userId);
        const savedMessages = await AIChatHistoryService.get(userId);
        setChatMessages(savedMessages.length ? savedMessages : INITIAL_CHAT_MESSAGES);
      } catch {
        setMedicines([]);
        setChatMessages(INITIAL_CHAT_MESSAGES);
      }
    })();
  }, []);

  useEffect(() => {
    if (!chatUserId) return;
    AIChatHistoryService.set(chatUserId, chatMessages).catch(() => {});
  }, [chatUserId, chatMessages]);

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

  const handleChatInputKeyPress = (e) => {
    if (Platform.OS !== 'web') return;
    const key = e?.nativeEvent?.key;
    const shiftKey = Boolean(e?.nativeEvent?.shiftKey);
    if (key === 'Enter' && !shiftKey) {
      e?.preventDefault?.();
      sendChat();
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
        </Card.Content>
      </Card>
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
                {m.role === 'assistant' ? (
                  <Markdown style={markdownStyles}>{m.content}</Markdown>
                ) : (
                  <Text style={styles.chatText}>{m.content}</Text>
                )}
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
              onKeyPress={handleChatInputKeyPress}
              style={styles.chatInput}
              multiline
              blurOnSubmit={false}
            />
            <Button mode="contained" onPress={sendChat} loading={chatLoading} disabled={chatLoading}>
              发送
            </Button>
          </View>
          <Paragraph style={styles.chatInputHint}>回车发送，Shift + 回车换行</Paragraph>
        </Card.Content>
      </Card>
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
    maxWidth: 1300,
    width: '100%',
    alignSelf: 'center',
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
  chatInputHint: {
    marginTop: theme.spacing.xs,
    color: theme.colors.textSecondary,
    fontSize: 12,
  },
  dialogLoading: {
    alignItems: 'center',
    paddingVertical: theme.spacing.lg,
  },
});

const markdownStyles = {
  body: {
    fontFamily: appFontFamilies.regular,
    color: theme.colors.text,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 0,
    marginBottom: 0,
  },
  paragraph: {
    marginTop: 2,
    marginBottom: 6,
  },
  bullet_list: {
    marginTop: 2,
    marginBottom: 4,
  },
  list_item: {
    marginBottom: 4,
  },
  heading3: {
    fontFamily: appFontFamilies.bold,
    color: theme.colors.primary,
    fontSize: 15,
    marginTop: 8,
    marginBottom: 4,
  },
  heading4: {
    fontFamily: appFontFamilies.bold,
    color: theme.colors.primary,
    fontSize: 14,
    marginTop: 6,
    marginBottom: 4,
  },
};


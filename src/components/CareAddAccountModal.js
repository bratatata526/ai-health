import React, { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Modal,
  Paragraph,
  Portal,
  TextInput,
  Title,
} from 'react-native-paper';
import { CareAccountService } from '../services/CareAccountService';
import { theme, textStyles } from '../theme';

export function CareAddAccountModal({ visible, onDismiss, onAdded }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await CareAccountService.addCareAccountWithLogin({
        email: email.trim(),
        password,
      });
      setEmail('');
      setPassword('');
      onDismiss?.();
      onAdded?.();
      Alert.alert(
        '已添加',
        '关怀绑定已保存在本机：重新登录同一账号后仍有效。系统将定期从对方云端快照读取用药与健康记录以提示异常（仅保存对方登录令牌，不保存明文密码）。',
      );
    } catch (e) {
      Alert.alert('添加失败', e?.message || '请检查邮箱密码与云端服务');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={() => !busy && onDismiss?.()}
        contentContainerStyle={styles.modal}
      >
        <Title style={styles.title}>添加关怀账号</Title>
        <Paragraph style={styles.info}>
          请输入对方在本应用注册的邮箱与密码。验证成功后仅保存云端访问令牌，不会长期保存密码。
        </Paragraph>
        <TextInput
          label="对方邮箱"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          mode="outlined"
          style={styles.input}
        />
        <TextInput
          label="密码"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          mode="outlined"
          style={styles.input}
        />
        <View style={styles.actions}>
          <Button onPress={() => !busy && onDismiss?.()} disabled={busy}>
            取消
          </Button>
          {busy ? <ActivityIndicator style={{ marginLeft: 12 }} /> : null}
          <Button mode="contained" onPress={submit} disabled={busy}>
            确定
          </Button>
        </View>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: {
    margin: theme.spacing.lg,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface,
    alignSelf: 'center',
    width: '88%',
    maxWidth: 400,
  },
  title: {
    ...textStyles.title,
    marginBottom: theme.spacing.sm,
  },
  info: {
    marginBottom: theme.spacing.sm,
    opacity: 0.85,
  },
  input: {
    marginBottom: theme.spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: theme.spacing.sm,
    gap: 8,
  },
});

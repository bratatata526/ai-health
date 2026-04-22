import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Button, Card, Paragraph, Text, TextInput, Title } from 'react-native-paper';
import { theme } from '../theme';
import { AuthService } from '../services/AuthService';
import { CloudSyncService } from '../services/CloudSyncService';
import { isValidEmail, validatePassword, validateName } from '../utils/validation';

export default function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState('login'); // login | register
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Web 端：确保登录/注册页的浏览器标签标题不会被其它逻辑覆盖成 undefined
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;
    document.title = mode === 'register' ? '登录/注册' : '登录/注册';
  }, [mode]);

  const emailTrimmed = email.trim();
  const passwordCheck = validatePassword(password);
  const nameCheck = validateName(name);
  const emailOk = isValidEmail(emailTrimmed);
  const canSubmit =
    !loading &&
    emailTrimmed.length > 0 &&
    emailOk &&
    passwordCheck.ok &&
    (mode !== 'register' || nameCheck.ok);

  const submit = async () => {
    setError('');
    setLoading(true);
    try {
      // 前端兜底校验（避免无效请求）
      if (!emailOk) throw new Error('邮箱格式不正确');
      if (!passwordCheck.ok) throw new Error(passwordCheck.message);
      if (mode === 'register' && !nameCheck.ok) throw new Error(nameCheck.message);

      if (mode === 'register') {
        await AuthService.register({ email: emailTrimmed, password, name });
      } else {
        await AuthService.login({ email: emailTrimmed, password });
      }

      // 登录/注册成功后，立即从云端同步数据（确保用户数据隔离）
      try {
        await CloudSyncService.syncDown();
        console.log('登录后自动同步：云端数据已下载');
      } catch (syncError) {
        // 如果云端没有数据（新用户）或网络问题，不影响登录流程
        console.warn('登录后自动同步失败:', syncError.message);
      }

      onAuthed?.();
    } catch (e) {
      setError(e.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.overlay} />
      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.title}>{mode === 'register' ? '注册' : '登录'}</Title>
          <Paragraph style={styles.subtitle}>云端同步需要账号登录（每个用户只能访问自己的数据）。</Paragraph>

          {mode === 'register' && (
            <TextInput
              label="昵称（可选）"
              value={name}
              onChangeText={setName}
              mode="outlined"
              style={styles.input}
              error={!nameCheck.ok}
            />
          )}
          {mode === 'register' && !nameCheck.ok ? (
            <Text style={styles.fieldErrorText}>{nameCheck.message}</Text>
          ) : null}

          <TextInput
            label="邮箱"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            mode="outlined"
            style={styles.input}
            error={emailTrimmed.length > 0 && !emailOk}
          />
          {emailTrimmed.length > 0 && !emailOk ? (
            <Text style={styles.fieldErrorText}>邮箱格式不正确</Text>
          ) : null}
          <TextInput
            label="密码（至少6位）"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            mode="outlined"
            style={styles.input}
            error={!passwordCheck.ok && password.length > 0}
          />
          {!passwordCheck.ok && password.length > 0 ? (
            <Text style={styles.fieldErrorText}>{passwordCheck.message}</Text>
          ) : null}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Button
            mode="contained"
            onPress={submit}
            loading={loading}
            disabled={!canSubmit}
            style={styles.primaryButton}
          >
            {mode === 'register' ? '注册并登录' : '登录'}
          </Button>

          <Button
            mode="text"
            onPress={() => setMode(mode === 'register' ? 'login' : 'register')}
            disabled={loading}
            style={styles.switchModeButton}
          >
            {mode === 'register' ? '已有账号？去登录' : '没有账号？去注册'}
          </Button>
        </Card.Content>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.md,
    backgroundColor: '#DDEBFF',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    // 让背景图更“高级”：轻暗角 + 稍微冷色调
    backgroundColor: 'rgba(2, 6, 23, 0.38)',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: theme.shadow.colorStrong,
        shadowOpacity: 1,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
      },
      android: {
        elevation: 4,
      },
      web: {
        // RN Web 支持部分阴影属性
        shadowColor: theme.shadow.colorStrong,
        shadowOpacity: 1,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
      },
    }),
  },
  title: {
    marginBottom: theme.spacing.xs,
    fontSize: 26,
    fontWeight: '800',
    color: theme.colors.text,
  },
  subtitle: {
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
    lineHeight: 20,
  },
  input: {
    marginBottom: theme.spacing.sm,
  },
  primaryButton: {
    marginTop: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    paddingVertical: 2,
  },
  switchModeButton: {
    marginTop: theme.spacing.xs,
  },
  errorText: {
    color: theme.colors.error,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
  },
  fieldErrorText: {
    color: theme.colors.error,
    marginTop: -theme.spacing.xs,
    marginBottom: theme.spacing.xs,
    fontSize: 12,
  },
});



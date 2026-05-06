import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Dimensions, Alert, Platform } from 'react-native';
import { Card, Title, Paragraph, Button, Text, Dialog, Portal, TextInput } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { theme, textStyles } from '../theme';
import { CloudSyncService } from '../services/CloudSyncService';
import { AuthService } from '../services/AuthService';

const { width } = Dimensions.get('window');

// 格式化日期时间为友好格式
const formatSyncTime = (isoString) => {
  if (!isoString) return '未知';
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

export default function HomeScreen({ navigation, onLogout }) {
  const [syncing, setSyncing] = useState(false);
  const [accountDialogVisible, setAccountDialogVisible] = useState(false);
  const [pwdDialogVisible, setPwdDialogVisible] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [accountInfo, setAccountInfo] = useState({ profile: null, cloudMeta: null });

  const openAccountDialog = async () => {
    try {
      const profile = await AuthService.getProfile();
      let cloudMeta = await CloudSyncService.getCloudMeta();
      // 如果本地还没有云端同步时间缓存，打开弹窗时主动向云端查询一次（不覆盖本地数据）
      if (!cloudMeta?.updatedAt) {
        try {
          cloudMeta = await CloudSyncService.refreshCloudMeta();
        } catch {
          // ignore: 离线/云端不可达时仍可打开弹窗
        }
      }
      setAccountInfo({ profile, cloudMeta });
    } catch {
      setAccountInfo({ profile: null, cloudMeta: null });
    }
    setAccountDialogVisible(true);
  };

  const logout = async () => {
    try {
      await AuthService.logout();
      // 立即通知 App.js 更新状态，触发跳转到登录页
      if (onLogout) {
        onLogout();
      }
      // 延迟显示提示，避免阻塞跳转动画
      setTimeout(() => {
        Alert.alert('已退出', '已成功退出登录');
      }, 300);
    } catch (e) {
      Alert.alert('退出失败', e.message || '退出登录时发生错误');
    }
  };

  const changePassword = async () => {
    try {
      await AuthService.changePassword({ oldPassword, newPassword });
      setPwdDialogVisible(false);
      setOldPassword('');
      setNewPassword('');
      Alert.alert('成功', '密码已修改');
    } catch (e) {
      Alert.alert('失败', e.message || '修改密码失败');
    }
  };

  const deleteAccount = async () => {
    Alert.alert(
      '注销账号',
      '将删除云端账号与云端数据（本地数据不会自动删除）。确定继续吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认注销',
          style: 'destructive',
          onPress: async () => {
            try {
              await AuthService.deleteAccount();
              // 立即通知 App.js 更新状态，触发跳转到登录页
              if (onLogout) {
                onLogout();
              }
              // 延迟显示提示，避免阻塞跳转动画
              setTimeout(() => {
                Alert.alert('已注销', '账号已删除，请重新注册/登录');
              }, 300);
            } catch (e) {
              Alert.alert('失败', e.message || '注销失败');
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container}>
      <LinearGradient
        colors={['#2563EB', '#7C3AED']}
        style={styles.header}
      >
        <View style={styles.headerContent}>
          <Ionicons name="heart" size={48} color="#fff" />
          <Title style={styles.headerTitle}>AI健康管家</Title>
          <Paragraph style={styles.headerSubtitle}>您的专属健康助手</Paragraph>
        </View>
      </LinearGradient>

      <View style={styles.content}>
        <Card style={styles.card} onPress={openAccountDialog}>
          <Card.Content>
            <View style={styles.cardHeader}>
              <Ionicons name="person-circle" size={32} color={theme.colors.primary} />
              <Title style={styles.cardTitle}>账号与云同步</Title>
            </View>
            <Paragraph style={styles.cardDescription}>
              查看账号信息、同步时间，支持修改密码/退出/注销
            </Paragraph>
          </Card.Content>
        </Card>

        <Card style={styles.card} onPress={() => navigation.navigate('药品')}>
          <Card.Content>
            <View style={styles.cardHeader}>
              <Ionicons name="medical" size={32} color={theme.colors.primary} />
              <Title style={styles.cardTitle}>药品管理</Title>
            </View>
            <Paragraph style={styles.cardDescription}>
              拍摄药盒，智能识别药品信息，设置定时提醒
            </Paragraph>
          </Card.Content>
        </Card>

        <Card style={styles.card} onPress={() => navigation.navigate('设备')}>
          <Card.Content>
            <View style={styles.cardHeader}>
              <Ionicons name="watch" size={32} color={theme.colors.secondary} />
              <Title style={styles.cardTitle}>设备数据</Title>
            </View>
            <Paragraph style={styles.cardDescription}>
              连接智能手环、血糖仪，实时监测健康数据
            </Paragraph>
          </Card.Content>
        </Card>

        <Card style={styles.card} onPress={() => navigation.navigate('报告')}>
          <Card.Content>
            <View style={styles.cardHeader}>
              <Ionicons name="document-text" size={32} color={theme.colors.accent} />
              <Title style={styles.cardTitle}>健康报告</Title>
            </View>
            <Paragraph style={styles.cardDescription}>
              生成个性化周/月健康报告，全面了解身体状况
            </Paragraph>
          </Card.Content>
        </Card>

        <Card
          style={styles.card}
          onPress={() => {
            if (Platform.OS === 'web') {
              window.location.assign('http://localhost:5173');
            } else {
              Alert.alert('提示', '该功能仅支持 Web 端');
            }
          }}
        >
          <Card.Content>
            <View style={styles.cardHeader}>
              <Ionicons name="leaf" size={32} color={theme.colors.primary} />
              <Title style={styles.cardTitle}>AI舌诊</Title>
            </View>
            <Paragraph style={styles.cardDescription}>
            拍摄舌象，AI分析舌象特征，获取体质调养参考
            </Paragraph>
          </Card.Content>
        </Card>

        <View style={styles.quickActions}>
          <Button
            mode="contained"
            icon="camera"
            onPress={() => navigation.navigate('药品')}
            style={styles.actionButton}
            contentStyle={styles.actionButtonContent}
          >
            拍摄药盒
          </Button>
          <Button
            mode="outlined"
            icon="chart-line"
            onPress={() => navigation.navigate('报告')}
            style={styles.actionButton}
            contentStyle={styles.actionButtonContent}
          >
            查看报告
          </Button>

        </View>
      </View>

      <Portal>
        <Dialog visible={accountDialogVisible} onDismiss={() => setAccountDialogVisible(false)}>
          <Dialog.Title>账号与云同步</Dialog.Title>
          <Dialog.Content>
            <Paragraph>
              {accountInfo.profile
                ? `当前用户：${accountInfo.profile.name}（${accountInfo.profile.email}）`
                : '当前未获取到用户资料'}
            </Paragraph>
            <Paragraph style={{ marginTop: theme.spacing.sm }}>
              {accountInfo.cloudMeta?.updatedAt
                ? `上次同步时间：${formatSyncTime(accountInfo.cloudMeta.updatedAt)}`
                : '上次同步时间：暂无（建议先上传或下载）'}
            </Paragraph>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setPwdDialogVisible(true)}>修改密码</Button>
            <Button onPress={deleteAccount} textColor={theme.colors.error}>注销账号</Button>
            <Button onPress={logout}>退出登录</Button>
            <Button onPress={() => setAccountDialogVisible(false)}>关闭</Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={pwdDialogVisible} onDismiss={() => setPwdDialogVisible(false)}>
          <Dialog.Title>修改密码</Dialog.Title>
          <Dialog.Content>
            <TextInput
              label="旧密码"
              value={oldPassword}
              onChangeText={setOldPassword}
              secureTextEntry
              mode="outlined"
              style={styles.input}
            />
            <TextInput
              label="新密码（至少6位）"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              mode="outlined"
              style={styles.input}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setPwdDialogVisible(false)}>取消</Button>
            <Button onPress={changePassword} disabled={!oldPassword || !newPassword}>
              确定
            </Button>
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
  header: {
    paddingTop: 60,
    paddingBottom: 40,
    paddingHorizontal: theme.spacing.lg,
    borderBottomLeftRadius: theme.borderRadius.xl,
    borderBottomRightRadius: theme.borderRadius.xl,
  },
  headerContent: {
    alignItems: 'center',
  },
  headerTitle: {
    ...textStyles.title,
    color: '#fff',
    fontSize: 28,
    marginTop: theme.spacing.md,
  },
  headerSubtitle: {
    ...textStyles.body,
    color: '#fff',
    fontSize: 16,
    opacity: 0.9,
    marginTop: theme.spacing.xs,
  },
  content: {
    padding: theme.spacing.md,
  },
  card: {
    marginBottom: theme.spacing.md,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: theme.shadow.color,
        shadowOpacity: 1,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 2 },
      web: {
        shadowColor: theme.shadow.color,
        shadowOpacity: 1,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      },
    }),
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  cardTitle: {
    ...textStyles.title,
    marginLeft: theme.spacing.sm,
    fontSize: 20,
  },
  cardDescription: {
    ...textStyles.body,
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  quickActions: {
    marginTop: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  actionButton: {
    borderRadius: theme.borderRadius.md,
  },
  actionButtonContent: {
    paddingVertical: theme.spacing.sm,
  },
  input: {
    marginBottom: theme.spacing.sm,
  },
});


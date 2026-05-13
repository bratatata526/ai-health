import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform, TouchableOpacity } from 'react-native';
import { Button, Text, Dialog, Portal, TextInput, Avatar } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { theme, textStyles } from '../theme';
import { CloudSyncService } from '../services/CloudSyncService';
import { AuthService } from '../services/AuthService';

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

  // 功能入口数据
  const features = [
    { key: 'med', icon: 'medical', color: theme.colors.primary, title: '药品管理', desc: '拍盒识别 · 定时提醒', nav: '药品' },
    { key: 'dev', icon: 'watch', color: theme.colors.secondary, title: '设备数据', desc: '手环血糖 · 实时监测', nav: '设备' },
    { key: 'rpt', icon: 'document-text', color: theme.colors.accent, title: '健康报告', desc: '周月报告 · 趋势洞察', nav: '报告' },
    { key: 'tong', icon: 'leaf', color: '#16A34A', title: 'AI 舌诊', desc: '舌象识别 · 体质参考', nav: '舌诊' },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* 紧凑头部 */}
      <LinearGradient
        colors={['#2563EB', '#7C3AED']}
        style={styles.header}
      >
        <View style={styles.headerInner}>
          <View style={styles.headerLeft}>
            <Ionicons name="heart" size={24} color="#fff" />
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerTitle}>AI 健康管家</Text>
              <Text style={styles.headerSubtitle}>您的专属健康助手</Text>
            </View>
          </View>
          <TouchableOpacity onPress={openAccountDialog} style={styles.avatarBtn}>
            <Ionicons name="person-circle" size={36} color="#fff" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {/* 内容区：最大宽度居中 */}
      <View style={styles.content}>
        {/* 快捷入口 */}
        <Text style={styles.sectionTitle}>快捷入口</Text>
        <View style={styles.list}>
          {features.map((f) => (
            <TouchableOpacity
              key={f.key}
              activeOpacity={0.7}
              onPress={() => navigation.navigate(f.nav)}
              style={styles.listItem}
            >
              <View style={[styles.listIconWrap, { backgroundColor: `${f.color}1A` }]}>
                <Ionicons name={f.icon} size={22} color={f.color} />
              </View>
              <View style={styles.listTextWrap}>
                <Text style={styles.listTitle}>{f.title}</Text>
                <Text style={styles.listDesc} numberOfLines={1}>{f.desc}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>

        {/* AI 建议提示条 */}
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => navigation.navigate('报告')}
          style={styles.tipCard}
        >
          <Ionicons name="sparkles" size={20} color="#7C3AED" />
          <View style={{ flex: 1, marginLeft: theme.spacing.sm }}>
            <Text style={styles.tipTitle}>AI 智能建议</Text>
            <Text style={styles.tipDesc} numberOfLines={1}>查看个性化健康洞察与趋势分析</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
        </TouchableOpacity>
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
  scrollContent: {
    paddingBottom: theme.spacing.xl,
  },
  // 头部
  header: {
    paddingTop: Platform.OS === 'web' ? theme.spacing.lg : 52,
    paddingBottom: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
    borderBottomLeftRadius: theme.borderRadius.xl,
    borderBottomRightRadius: theme.borderRadius.xl,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    maxWidth: 1350,
    width: '100%',
    alignSelf: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerTextWrap: {
    marginLeft: theme.spacing.sm,
  },
  headerTitle: {
    ...textStyles.title,
    color: '#fff',
    fontSize: 20,
  },
  headerSubtitle: {
    ...textStyles.body,
    color: '#fff',
    fontSize: 13,
    opacity: 0.9,
    marginTop: 2,
  },
  avatarBtn: {
    marginLeft: theme.spacing.md,
    padding: 4,
  },
  // 内容
  content: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.lg,
    maxWidth: 1350,
    width: '100%',
    alignSelf: 'center',
  },
  sectionTitle: {
    ...textStyles.semi,
    fontSize: 15,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
    paddingLeft: theme.spacing.xs,
  },
  // 网格
  list: {
    gap: theme.spacing.sm,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    ...Platform.select({
      ios: {
        shadowColor: theme.shadow.color,
        shadowOpacity: 1,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 1 },
      web: {
        shadowColor: theme.shadow.color,
        shadowOpacity: 1,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        cursor: 'pointer',
      },
    }),
  },
  listIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  listTextWrap: {
    flex: 1,
  },
  listTitle: {
    ...textStyles.title,
    fontSize: 15,
    color: theme.colors.text,
  },
  listDesc: {
    ...textStyles.body,
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  // AI 建议条
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F3FF',
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    marginTop: theme.spacing.lg,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tipTitle: {
    ...textStyles.semi,
    fontSize: 14,
    color: '#5B21B6',
  },
  tipDesc: {
    ...textStyles.body,
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  input: {
    marginBottom: theme.spacing.sm,
  },
});


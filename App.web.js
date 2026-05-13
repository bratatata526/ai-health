import 'react-native-get-random-values';
import React, { useEffect, useState } from 'react';
import { Image, View, StyleSheet, TouchableOpacity } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { optionalAppFonts } from './src/optionalFonts';
import { Provider as PaperProvider, Text, Dialog, Portal, TextInput, Paragraph, Button } from 'react-native-paper';
import { useFonts } from 'expo-font';

import HomeScreen from './src/screens/HomeScreen';
import MedicineScreen from './src/screens/MedicineScreen';
import DeviceScreen from './src/screens/DeviceScreen';
import ReportScreen from './src/screens/ReportScreen';
import AuthScreen from './src/screens/AuthScreen';
import AIScreen from './src/screens/AIScreen';
import TongueScreen from './src/screens/TongueScreen';
import AIIcon from './src/components/AIIcon';
import FloatingAIAssistant from './src/components/FloatingAIAssistant';
import { theme, appFontFamilies } from './src/theme';
import { MedicineService } from './src/services/MedicineService';
import { AuthService } from './src/services/AuthService';
import { AutoCloudSyncService } from './src/services/AutoCloudSyncService';
import { CloudSyncService } from './src/services/CloudSyncService';

const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();
const WEB_SIDEBAR_WIDTH = 160;

const PAGE_TITLES = {
  '首页': '首页',
  '药品': '药品管理',
  '设备': '设备数据',
  '舌诊': 'AI 舌诊',
  'AI助手': 'AI 助手',
  '报告': '健康报告',
};

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

const WEB_NAV_ITEMS = [
  { name: '首页', icon: 'home-outline', iconActive: 'home' },
  { name: '药品', icon: 'medical-outline', iconActive: 'medical' },
  { name: '设备', icon: 'watch-outline', iconActive: 'watch' },
  { name: '舌诊', icon: 'scan-outline', iconActive: 'scan' },
  { name: 'AI助手', icon: null, iconActive: null },
  { name: '报告', icon: 'document-text-outline', iconActive: 'document-text' },
];


// Web 端兜底：有些情况下模板 title 可能是字符串 "undefined"
// 这里在模块加载阶段先纠正一次，后续再由 useEffect 根据登录状态覆盖。
if (typeof document !== 'undefined') {
  const t = String(document.title || '').trim();
  if (t === '' || t === 'undefined') {
    document.title = 'AI健康管家';
  }
}

// Logo组件 - 作为标题显示（可点击回到首页）
const LogoTitle = () => {
  const handleLogoPress = () => {
    if (navigationRef.isReady()) {
      const currentRoute = navigationRef.getCurrentRoute();
      
      // 如果当前不在首页，则跳转到首页
      if (currentRoute?.name !== '首页') {
        navigationRef.navigate('首页');
      }
      // 如果已经在首页，点击 logo 不做任何操作（或者可以触发刷新）
    }
  };

  return (
    <TouchableOpacity 
      style={styles.logoTitleContainer} 
      onPress={handleLogoPress}
      activeOpacity={0.7}
    >
      <Image
        source={require('./assets/logo_2.png')}
        style={styles.logo}
        resizeMode="contain"
      />
    </TouchableOpacity>
  );
};

export default function App() {
  // Web/原生：确保图标字体加载完成，否则 Ionicons/MaterialCommunityIcons 可能显示为空白
  const [fontsLoaded, fontError] = useFonts({
    ...Ionicons.font,
    ...MaterialCommunityIcons.font,
    ...optionalAppFonts,
  });
  const fontsReady = fontsLoaded || fontError != null;

  useEffect(() => {
    if (__DEV__ && fontError) {
      // eslint-disable-next-line no-console
      console.warn('[fonts] Load failed (will render with fallbacks):', fontError?.message ?? fontError);
    }
  }, [fontError]);

  /** Web：根结点继承正文栈（不依赖 expo-font 注册 Noto 文件名）。 */
  useEffect(() => {
    if (!fontsReady || typeof document === 'undefined') return;
    const rootFont = appFontFamilies.regular;
    try {
      document.documentElement.style.fontFamily = rootFont;
      document.body.style.fontFamily = rootFont;
    } catch {
      // ignore
    }
  }, [fontsReady]);

  const [authed, setAuthed] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState('首页');
  const [hoveredItem, setHoveredItem] = useState(null);
  const [accountDialogVisible, setAccountDialogVisible] = useState(false);
  const [pwdDialogVisible, setPwdDialogVisible] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [accountInfo, setAccountInfo] = useState({ profile: null, cloudMeta: null });

  useEffect(() => {
    (async () => {
      try {
        const ok = await AuthService.isLoggedIn();
        setAuthed(ok);
      } finally {
        setCheckingAuth(false);
      }
    })();
  }, []);

  // 自动云同步（自动上传）：全局启动，内部会在未登录时自动跳过
  useEffect(() => {
    AutoCloudSyncService.start();
    return () => AutoCloudSyncService.stop();
  }, []);

  // 账号弹窗
  const openAccountDialog = async () => {
    try {
      const profile = await AuthService.getProfile();
      let cloudMeta = await CloudSyncService.getCloudMeta();
      if (!cloudMeta?.updatedAt) {
        try { cloudMeta = await CloudSyncService.refreshCloudMeta(); } catch {}
      }
      setAccountInfo({ profile, cloudMeta });
    } catch {
      setAccountInfo({ profile: null, cloudMeta: null });
    }
    setAccountDialogVisible(true);
  };

  const accountLogout = async () => {
    try {
      await AuthService.logout();
      setAuthed(false);
    } catch (e) {
      // ignore
    }
  };

  const accountChangePassword = async () => {
    try {
      await AuthService.changePassword({ oldPassword, newPassword });
      setPwdDialogVisible(false);
      setOldPassword('');
      setNewPassword('');
    } catch {}
  };

  const accountDeleteAccount = () => {
    AuthService.deleteAccount()
      .then(() => setAuthed(false))
      .catch(() => {});
  };

  // Expo Web：修复浏览器标签标题显示为 undefined 的问题
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (checkingAuth) {
      document.title = '加载中...';
      return;
    }
    document.title = authed ? 'AI健康管家' : '登录/注册';
  }, [authed, checkingAuth]);

  return (
    <PaperProvider theme={theme}>
      <NavigationContainer
        ref={navigationRef}
        onReady={() => {
          if (typeof document !== 'undefined') {
            document.title = authed ? 'AI健康管家' : '登录/注册';
          }
        }}
      >
        <StatusBar style="light" />
        {!fontsReady ? (
          <View style={styles.loadingContainer}>
            <Ionicons name="cloud-outline" size={32} color="#fff" />
          </View>
        ) : checkingAuth ? (
          <View style={styles.loadingContainer}>
            <Ionicons name="cloud-outline" size={32} color="#fff" />
          </View>
        ) : !authed ? (
          <AuthScreen onAuthed={async () => setAuthed(await AuthService.isLoggedIn())} />
        ) : (
          <View style={styles.webAppContainer}>
          <View style={styles.webSidebar}>
            <View style={styles.webSidebarHeader}>
              <Image
                source={require('./assets/logo_1.png')}
                style={styles.webSidebarLogo}
                resizeMode="contain"
              />
              <Text style={styles.webSidebarTitle}>AI健康管家</Text>
            </View>
            <View style={styles.webSidebarMenu}>
              {WEB_NAV_ITEMS.map((item) => {
                const focused = activeTab === item.name;
                const hovered = hoveredItem === item.name;
                return (
                  <TouchableOpacity
                    key={item.name}
                    style={[
                      styles.webSidebarItem,
                      focused && styles.webSidebarItemActive,
                      !focused && hovered && styles.webSidebarItemHover,
                    ]}
                    activeOpacity={0.8}
                    onPress={() => {
                      setActiveTab(item.name);
                      if (navigationRef.isReady()) {
                        navigationRef.navigate(item.name);
                      }
                    }}
                    onMouseEnter={() => setHoveredItem(item.name)}
                    onMouseLeave={() => setHoveredItem(null)}
                  >
                    {item.name === 'AI助手' ? (
                      <AIIcon
                        size={18}
                        color={focused ? theme.colors.primary : theme.colors.textSecondary}
                        focused={focused}
                      />
                    ) : (
                      <Ionicons
                        name={focused ? item.iconActive : item.icon}
                        size={18}
                        color={focused ? theme.colors.primary : theme.colors.textSecondary}
                      />
                    )}
                    <Text style={[styles.webSidebarItemText, focused && styles.webSidebarItemTextActive]}>
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={{ flex: 1 }} />
            <View style={styles.webSidebarFooter}>
              <TouchableOpacity
                style={styles.webSidebarAccountBtn}
                activeOpacity={0.7}
                onPress={openAccountDialog}
                onMouseEnter={() => setHoveredItem('__account__')}
                onMouseLeave={() => setHoveredItem(null)}
              >
                <Ionicons name="person-circle-outline" size={20} color={hoveredItem === '__account__' ? theme.colors.primary : theme.colors.textSecondary} />
                <Text style={[styles.webSidebarAccountText, hoveredItem === '__account__' && { color: theme.colors.primary }]}>账号</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.webMainContent}>
          <Tab.Navigator
            screenListeners={({ route }) => ({
              focus: () => setActiveTab(route.name),
            })}
            screenOptions={({ route }) => ({
              tabBarStyle: {
                display: 'none',
              },
              headerStyle: {
                backgroundColor: theme.colors.surface,
                borderBottomWidth: 0,
                elevation: 0,
                shadowColor: 'rgba(15, 23, 42, 0.06)',
                shadowOpacity: 1,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 2 },
              },
              headerTintColor: theme.colors.text,
              headerTitleStyle: {
                fontFamily: appFontFamilies.bold,
                fontWeight: '700',
                fontSize: 17,
                color: theme.colors.text,
              },
              headerTitle: PAGE_TITLES[route.name] || route.name,
              headerRight: () => (
                <TouchableOpacity onPress={openAccountDialog} style={{ marginRight: 16 }}>
                  <Ionicons name="person-circle-outline" size={28} color={theme.colors.textSecondary} />
                </TouchableOpacity>
              ),
            })}
          >
            <Tab.Screen name="首页" options={{ headerShown: false }}>
              {(props) => <HomeScreen {...props} onLogout={() => setAuthed(false)} />}
            </Tab.Screen>
            <Tab.Screen name="药品" component={MedicineScreen} />
            <Tab.Screen name="设备" component={DeviceScreen} />
            <Tab.Screen name="舌诊" component={TongueScreen} />
            <Tab.Screen name="AI助手" component={AIScreen} />
            <Tab.Screen name="报告" component={ReportScreen} />
          </Tab.Navigator>
          </View>
          <FloatingAIAssistant
            onNavigate={(target) => {
              if (navigationRef.isReady()) {
                navigationRef.navigate(target);
              }
            }}
            getPendingMedicines={async () => {
              try {
                const allMeds = await MedicineService.getAllMedicines();
                const pending = [];
                for (const med of allMeds) {
                  const todayReminders = await MedicineService.getTodayReminders(med.id);
                  const notTaken = todayReminders.filter(
                    (r) => r.status === 'scheduled' || r.status === 'snoozed'
                  );
                  for (const r of notTaken) {
                    const d = new Date(r.scheduledAt);
                    const hh = String(d.getHours()).padStart(2, '0');
                    const mm = String(d.getMinutes()).padStart(2, '0');
                    pending.push({ name: med.name, time: `${hh}:${mm}` });
                  }
                }
                return pending;
              } catch (e) {
                console.warn('获取待服药品失败:', e);
                return [];
              }
            }}
          />
          {/* 账号弹窗（全局） */}
          <Portal>
            <Dialog visible={accountDialogVisible} onDismiss={() => setAccountDialogVisible(false)}>
              <Dialog.Title>账号与云同步</Dialog.Title>
              <Dialog.Content>
                <Paragraph>
                  {accountInfo.profile
                    ? `当前用户：${accountInfo.profile.name}（${accountInfo.profile.email}）`
                    : '当前未获取到用户资料'}
                </Paragraph>
                <Paragraph style={{ marginTop: 8 }}>
                  {accountInfo.cloudMeta?.updatedAt
                    ? `上次同步时间：${formatSyncTime(accountInfo.cloudMeta.updatedAt)}`
                    : '上次同步时间：暂无（建议先上传或下载）'}
                </Paragraph>
              </Dialog.Content>
              <Dialog.Actions>
                <Button onPress={() => setPwdDialogVisible(true)}>修改密码</Button>
                <Button onPress={accountDeleteAccount} textColor={theme.colors.error}>注销账号</Button>
                <Button onPress={accountLogout}>退出登录</Button>
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
                />
                <TextInput
                  label="新密码（至少6位）"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry
                  mode="outlined"
                  style={{ marginTop: 8 }}
                />
              </Dialog.Content>
              <Dialog.Actions>
                <Button onPress={() => setPwdDialogVisible(false)}>取消</Button>
                <Button onPress={accountChangePassword} disabled={!oldPassword || !newPassword}>确定</Button>
              </Dialog.Actions>
            </Dialog>
          </Portal>
          </View>
        )}
      </NavigationContainer>
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  logoTitleContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  logo: {
    width: 120,
    height: 40,
  },
  webAppContainer: {
    flex: 1,
    flexDirection: 'row',
    width: '100%',
    height: '100%',
    backgroundColor: theme.colors.background,
  },
  webSidebar: {
    width: WEB_SIDEBAR_WIDTH,
    backgroundColor: theme.colors.surface,
    borderRightWidth: 1,
    borderRightColor: theme.colors.outlineVariant,
    paddingHorizontal: 10,
    paddingTop: 14,
    paddingBottom: 12,
    flexShrink: 0,
  },
  webSidebarHeader: {
    alignItems: 'center',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.outlineVariant,
    marginBottom: 10,
  },
  webSidebarLogo: {
    width: 30,
    height: 30,
    marginBottom: 6,
  },
  webSidebarTitle: {
    fontFamily: appFontFamilies.medium,
    fontSize: 13,
    color: theme.colors.text,
  },
  webSidebarMenu: {
    gap: 4,
  },
  webSidebarItem: {
    minHeight: 42,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  webSidebarItemActive: {
    backgroundColor: 'rgba(37, 99, 235, 0.08)',
    borderLeftColor: theme.colors.primary,
  },
  webSidebarItemHover: {
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
  },
  webSidebarItemText: {
    fontFamily: appFontFamilies.regular,
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  webSidebarItemTextActive: {
    fontFamily: appFontFamilies.medium,
    color: theme.colors.primary,
  },
  webSidebarFooter: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.outlineVariant,
    paddingTop: 10,
  },
  webSidebarAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  webSidebarAccountText: {
    fontFamily: appFontFamilies.regular,
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  webMainContent: {
    flex: 1,
    minWidth: 0,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#4A90E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
});


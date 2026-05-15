import 'react-native-get-random-values';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, View, StyleSheet, TouchableOpacity, Animated, Easing, Alert } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { optionalAppFonts } from './src/optionalFonts';
import { Provider as PaperProvider, Text, Dialog, Portal, TextInput, Button } from 'react-native-paper';
import { useFonts } from 'expo-font';

import HomeScreen from './src/screens/HomeScreen';
import MedicineScreen from './src/screens/MedicineScreen';
import DeviceScreen from './src/screens/DeviceScreen';
import ReportScreen from './src/screens/ReportScreen';
import AuthScreen from './src/screens/AuthScreen';
import AIScreen from './src/screens/AIScreen';
import TongueScreen from './src/screens/TongueScreen';
import CareAccountsScreen from './src/screens/CareAccountsScreen';
import AIIcon from './src/components/AIIcon';
import FloatingAIAssistant from './src/components/FloatingAIAssistant';
import ScreenFadeTransition from './src/components/ScreenFadeTransition';
import { AccountCloudModal } from './src/components/AccountCloudModal';
import { theme, appFontFamilies } from './src/theme';
import { MedicineService } from './src/services/MedicineService';
import { AuthService } from './src/services/AuthService';
import { AutoCloudSyncService } from './src/services/AutoCloudSyncService';
import { CareAccountService } from './src/services/CareAccountService';
import { CloudSyncService } from './src/services/CloudSyncService';

const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();
const WEB_SIDEBAR_WIDTH = 160;

const PAGE_TITLES = {
  '首页': '首页',
  '关怀': '关怀账号',
  '药品': '药品管理',
  '设备': '设备数据',
  '舌诊': 'AI 舌诊',
  'AI助手': 'AI 助手',
  '报告': '健康报告',
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

/** Web 顶栏：[人像] [下三角]，悬停三角翻转为向上并变绿；菜单浮层紧贴下方避免失焦 */
function WebHeaderAccountDropdown({ prefetch, onAccountInfo, onChangePassword, onLogout }) {
  const [hover, setHover] = useState(false);
  const chevronSpin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(chevronSpin, {
      toValue: hover ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [hover, chevronSpin]);

  const rotate = chevronSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const chevronColor = hover ? theme.colors.success : theme.colors.textSecondary;

  return (
    <View
      style={styles.webHeaderAccountWrap}
      onMouseEnter={() => {
        prefetch?.();
        setHover(true);
      }}
      onMouseLeave={() => setHover(false)}
    >
      <View style={styles.webHeaderAccountTriggerRow}>
        <Ionicons name="person-circle-outline" size={26} color={theme.colors.textSecondary} />
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons name="chevron-down" size={17} color={chevronColor} />
        </Animated.View>
      </View>
      {hover ? (
        <View style={styles.webHeaderAccountMenu}>
          <TouchableOpacity
            style={styles.webHeaderAccountMenuItem}
            onPress={() => {
              setHover(false);
              onAccountInfo();
            }}
          >
            <Text style={styles.webHeaderAccountMenuText}>账号信息</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.webHeaderAccountMenuItem}
            onPress={() => {
              setHover(false);
              onChangePassword();
            }}
          >
            <Text style={styles.webHeaderAccountMenuText}>修改密码</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.webHeaderAccountMenuItem, styles.webHeaderAccountMenuItemLast]}
            onPress={() => {
              setHover(false);
              onLogout();
            }}
          >
            <Text style={[styles.webHeaderAccountMenuText, { color: theme.colors.error }]}>退出登录</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
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

  useEffect(() => {
    if (!authed) {
      CareAccountService.stopPolling();
      return undefined;
    }
    CareAccountService.startPolling();
    return () => CareAccountService.stopPolling();
  }, [authed]);

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
      const hadSession = await AuthService.isLoggedIn();
      const { cloudSaved } = await AuthService.logout();
      setAuthed(false);
      if (hadSession && !cloudSaved) {
        setTimeout(() => {
          Alert.alert(
            '已退出',
            '退出前未能将数据上传到云端，请确认云端服务可用。若本次登录中录入了身高或体征，下次登录可能无法从云端恢复。',
          );
        }, 200);
      }
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

  const prefetchHeaderAccount = useCallback(async () => {
    try {
      const profile = await AuthService.getProfile();
      setAccountInfo((prev) => ({ ...prev, profile }));
    } catch {
      // ignore
    }
  }, []);

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
                onPress={() => {
                  setActiveTab('关怀');
                  if (navigationRef.isReady()) {
                    navigationRef.navigate('关怀');
                  }
                }}
                onMouseEnter={() => setHoveredItem('__care__')}
                onMouseLeave={() => setHoveredItem(null)}
              >
                <Ionicons
                  name={activeTab === '关怀' ? 'heart' : 'heart-outline'}
                  size={20}
                  color={
                    hoveredItem === '__care__' || activeTab === '关怀'
                      ? theme.colors.primary
                      : theme.colors.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.webSidebarAccountText,
                    (hoveredItem === '__care__' || activeTab === '关怀') && { color: theme.colors.primary },
                  ]}
                >
                  关怀账号
                </Text>
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
                shadowColor: 'rgba(15, 23, 42, 0.08)',
                shadowOpacity: 1,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 3 },
                overflow: 'visible',
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
                <WebHeaderAccountDropdown
                  prefetch={prefetchHeaderAccount}
                  onAccountInfo={openAccountDialog}
                  onChangePassword={() => setPwdDialogVisible(true)}
                  onLogout={accountLogout}
                />
              ),
            })}
          >
            <Tab.Screen name="首页" options={{ headerShown: true, headerTitle: '首页信息' }}>
              {(props) => (
                <ScreenFadeTransition>
                  <HomeScreen {...props} onLogout={() => setAuthed(false)} />
                </ScreenFadeTransition>
              )}
            </Tab.Screen>
            <Tab.Screen name="关怀">
              {(props) => (
                <ScreenFadeTransition>
                  <CareAccountsScreen {...props} />
                </ScreenFadeTransition>
              )}
            </Tab.Screen>
            <Tab.Screen name="药品">
              {(props) => (
                <ScreenFadeTransition>
                  <MedicineScreen {...props} />
                </ScreenFadeTransition>
              )}
            </Tab.Screen>
            <Tab.Screen name="设备">
              {(props) => (
                <ScreenFadeTransition>
                  <DeviceScreen {...props} />
                </ScreenFadeTransition>
              )}
            </Tab.Screen>
            <Tab.Screen name="舌诊">
              {(props) => (
                <ScreenFadeTransition>
                  <TongueScreen {...props} />
                </ScreenFadeTransition>
              )}
            </Tab.Screen>
            <Tab.Screen name="AI助手">
              {(props) => (
                <ScreenFadeTransition>
                  <AIScreen {...props} />
                </ScreenFadeTransition>
              )}
            </Tab.Screen>
            <Tab.Screen name="报告">
              {(props) => (
                <ScreenFadeTransition>
                  <ReportScreen {...props} />
                </ScreenFadeTransition>
              )}
            </Tab.Screen>
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
                const parseHHMM = (val) => {
                  const m = String(val || '').match(/^(\d{1,2}):(\d{2})$/);
                  if (!m) return null;
                  const hh = Number(m[1]);
                  const mm = Number(m[2]);
                  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
                  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
                };
                const resolveMode = (med) => {
                  const cfg = med?.reminderConfig || {};
                  const raw = cfg.mode || (Array.isArray(cfg.times) && cfg.times.length ? 'fixed_times' : 'fixed_times');
                  return raw === 'prn' ? 'fixed_times' : raw;
                };
                const allMeds = await MedicineService.getAllMedicines();
                const pending = [];
                for (const med of allMeds) {
                  const mode = resolveMode(med);
                  const todayReminders = await MedicineService.getTodayReminders(med.id);
                  const activeNotTaken = todayReminders.filter(
                    (r) => r.status === 'scheduled' || r.status === 'snoozed'
                  );
                  if (mode === 'times_per_day') {
                    const totalCount =
                      todayReminders.length || Math.max(0, Number(med?.reminderConfig?.timesPerDay || 0));
                    const remain = activeNotTaken.length;
                    if (remain > 0) {
                      pending.push({
                        name: med.name,
                        message: `💊 ${med.name} 今天还需服用 ${remain} 次（共 ${totalCount} 次）`,
                      });
                    }
                    continue;
                  }
                  if (mode === 'interval_hours') {
                    let nextAt = null;
                    if (activeNotTaken.length > 0) {
                      nextAt = activeNotTaken
                        .map((r) => new Date(r.scheduledAt))
                        .sort((a, b) => a - b)[0];
                    } else {
                      const cfg = med?.reminderConfig || {};
                      const ih = Math.max(1, Number(cfg.intervalHours || 8));
                      const startText = parseHHMM(cfg.intervalStartTime) || '08:00';
                      const [sh, sm] = startText.split(':').map(Number);
                      const now = new Date();
                      const nowMin = now.getHours() * 60 + now.getMinutes();
                      let nextMin = sh * 60 + sm;
                      if (nowMin >= nextMin) {
                        const step = Math.floor((nowMin - nextMin) / (ih * 60)) + 1;
                        nextMin += step * ih * 60;
                      }
                      const d = new Date(now);
                      d.setHours(Math.floor(nextMin / 60), nextMin % 60, 0, 0);
                      if (d < now) d.setDate(d.getDate() + 1);
                      nextAt = d;
                    }
                    if (nextAt) {
                      const hh = String(nextAt.getHours()).padStart(2, '0');
                      const mm = String(nextAt.getMinutes()).padStart(2, '0');
                      pending.push({
                        name: med.name,
                        message: `💊 ${med.name} 下次建议服用时间：${hh}:${mm}`,
                      });
                    }
                    continue;
                  }
                  for (const r of activeNotTaken) {
                    const d = new Date(r.scheduledAt);
                    const hh = String(d.getHours()).padStart(2, '0');
                    const mm = String(d.getMinutes()).padStart(2, '0');
                    pending.push({
                      name: med.name,
                      time: `${hh}:${mm}`,
                      message: `💊 ${med.name} 记得在 ${hh}:${mm} 服用`,
                    });
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
          <AccountCloudModal
            visible={accountDialogVisible}
            onDismiss={() => setAccountDialogVisible(false)}
            profile={accountInfo.profile}
            cloudMeta={accountInfo.cloudMeta}
            onProfileUpdated={(nextProfile) => {
              setAccountInfo((prev) => ({ ...prev, profile: nextProfile }));
            }}
            onOpenPassword={() => setPwdDialogVisible(true)}
            onDeleteAccount={accountDeleteAccount}
            onLogout={accountLogout}
          />

          <Portal>
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
  webHeaderAccountWrap: {
    position: 'relative',
    alignItems: 'flex-end',
    marginRight: 12,
    paddingLeft: 12,
    zIndex: 2000,
  },
  webHeaderAccountTriggerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  webHeaderAccountMenu: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: -3,
    minWidth: 176,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  webHeaderAccountMenuItem: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.outlineVariant,
  },
  webHeaderAccountMenuItemLast: {
    borderBottomWidth: 0,
  },
  webHeaderAccountMenuText: {
    fontFamily: appFontFamilies.regular,
    fontSize: 14,
    color: theme.colors.text,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#4A90E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
});


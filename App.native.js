import 'react-native-get-random-values';
import React, { useEffect, useState } from 'react';
import { Image, View, StyleSheet, TouchableOpacity } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { optionalAppFonts } from './src/optionalFonts';
import { Provider as PaperProvider } from 'react-native-paper';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
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
import { theme, appFontFamilies } from './src/theme';
import {
  MedicineService,
  MEDICINE_REMINDER_CATEGORY,
  MEDICINE_ACTION_TAKEN,
  MEDICINE_ACTION_SNOOZE_5M,
  MEDICINE_ACTION_SNOOZE_15M,
  MEDICINE_ACTION_SNOOZE_30M,
} from './src/services/MedicineService';
import { AuthService } from './src/services/AuthService';
import { AutoCloudSyncService } from './src/services/AutoCloudSyncService';
import { CareAccountService } from './src/services/CareAccountService';

const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();

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

  const [authed, setAuthed] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

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

  useEffect(() => {
    // 1) 通知处理器（全局）
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    // 2) 通知动作（已服/稍后）
    (async () => {
      try {
        await Notifications.setNotificationCategoryAsync(MEDICINE_REMINDER_CATEGORY, [
          {
            identifier: MEDICINE_ACTION_TAKEN,
            buttonTitle: '已服用',
            options: { opensAppToForeground: true },
          },
          {
            identifier: MEDICINE_ACTION_SNOOZE_5M,
            buttonTitle: '稍后5分钟',
            options: { opensAppToForeground: false },
          },
          {
            identifier: MEDICINE_ACTION_SNOOZE_15M,
            buttonTitle: '稍后15分钟',
            options: { opensAppToForeground: false },
          },
          {
            identifier: MEDICINE_ACTION_SNOOZE_30M,
            buttonTitle: '稍后30分钟',
            options: { opensAppToForeground: false },
          },
        ]);
      } catch (e) {
        console.warn('设置通知分类失败:', e);
      }
    })();

    // 3) 监听通知点击/动作
    const sub = Notifications.addNotificationResponseReceivedListener(async (response) => {
      try {
        const actionIdentifier = response.actionIdentifier;
        const data = response.notification.request.content.data || {};
        const medicineId = data.medicineId;
        const reminderId = data.reminderId;

        // 记录动作闭环
        await MedicineService.handleNotificationAction({ medicineId, reminderId, actionIdentifier });

        // 点击通知正文（默认动作）：跳转到“药品”页
        if (actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
          if (navigationRef.isReady()) {
            navigationRef.navigate('药品');
          }
        }
      } catch (e) {
        console.warn('处理通知响应失败:', e);
      }
    });

    return () => {
      try {
        sub.remove();
      } catch {
        // ignore
      }
    };
  }, []);

  return (
    <PaperProvider theme={theme}>
      <NavigationContainer
        ref={navigationRef}
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
          <View style={{ flex: 1, position: 'relative', overflow: 'visible' }}>
          <Tab.Navigator
            initialRouteName="首页"
            screenOptions={({ route }) => ({
              tabBarIcon: ({ focused, color, size }) => {
                // AI 助手使用自定义 SVG 图标
                if (route.name === 'AI助手') {
                  return (
                    <View style={styles.aiTabIconWrap}>
                      <AIIcon size={Math.max(18, size - 3)} color={color} focused={focused} />
                    </View>
                  );
                }

                // 其他页面使用 Ionicons
                let iconName;
                if (route.name === '首页') {
                  iconName = focused ? 'home' : 'home-outline';
                } else if (route.name === '药品') {
                  iconName = focused ? 'medical' : 'medical-outline';
                } else if (route.name === '设备') {
                  iconName = focused ? 'watch' : 'watch-outline';
                } else if (route.name === '舌诊') {
                  iconName = focused ? 'scan' : 'scan-outline';
                } else if (route.name === '关怀') {
                  iconName = focused ? 'heart' : 'heart-outline';
                } else if (route.name === '报告') {
                  iconName = focused ? 'document-text' : 'document-text-outline';
                }

                return <Ionicons name={iconName} size={size} color={color} />;
              },
              tabBarActiveTintColor: theme.colors.primary,
              tabBarInactiveTintColor: theme.colors.textSecondary,
              tabBarStyle: {
                backgroundColor: theme.colors.surface,
                borderTopWidth: 0,
                height: Platform.OS === 'android' ? 68 : 74,
                paddingTop: Platform.OS === 'android' ? 3 : 6,
                paddingBottom: Platform.OS === 'android' ? 6 : 8,
                shadowColor: '#0F172A',
                shadowOpacity: 0.08,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: -3 },
                elevation: 10,
              },
              tabBarIconStyle: {
                marginTop: 1,
              },
              tabBarLabelStyle: {
                fontFamily: appFontFamilies.regular,
                fontSize: 12,
                marginTop: 2,
                paddingBottom: 2,
              },
              headerStyle: {
                backgroundColor: theme.colors.surface,
                borderBottomWidth: 0,
                shadowColor: '#0F172A',
                shadowOpacity: 0.06,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 },
                elevation: 4,
              },
              headerTintColor: theme.colors.text,
              headerTitleStyle: {
                fontFamily: appFontFamilies.bold,
              },
              headerTitle: () => <LogoTitle />,
            })}
          >
            <Tab.Screen
              name="关怀"
              options={{
                headerTitle: '关怀账号',
                tabBarButton: Platform.OS === 'android' ? () => null : undefined,
              }}
            >
              {(props) => (
                <ScreenFadeTransition>
                  <CareAccountsScreen {...props} />
                </ScreenFadeTransition>
              )}
            </Tab.Screen>
            <Tab.Screen name="首页">
              {(props) => (
                <ScreenFadeTransition>
                  <HomeScreen {...props} onLogout={() => setAuthed(false)} />
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
  aiTabIconWrap: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 0,
    paddingBottom: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#4A90E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
});


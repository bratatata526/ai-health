import React, { useEffect, useState, useCallback } from 'react';
import { Image, View, StyleSheet, TouchableOpacity } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
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
import AIIcon from './src/components/AIIcon';
import FloatingAIAssistant from './src/components/FloatingAIAssistant';
import { theme } from './src/theme';
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

const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();

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
  const [fontsLoaded] = useFonts({
    ...Ionicons.font,
    ...MaterialCommunityIcons.font,
  });

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

  // Expo Web：修复浏览器标签标题显示为 undefined 的问题
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;
    if (checkingAuth) {
      document.title = '加载中...';
      return;
    }
    document.title = authed ? 'AI健康管家' : '登录/注册';
  }, [authed, checkingAuth]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

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
        onReady={() => {
          // Web 端：导航就绪后强制设置一次 document.title，防止 React Navigation 写入 undefined
          if (Platform.OS === 'web' && typeof document !== 'undefined') {
            document.title = authed ? 'AI健康管家' : '登录/注册';
          }
        }}
      >
        <StatusBar style="light" />
        {!fontsLoaded ? (
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
          <View style={{ flex: 1 }}>
          <Tab.Navigator
            screenOptions={({ route }) => ({
              tabBarIcon: ({ focused, color, size }) => {
                // AI 助手使用自定义 SVG 图标
                if (route.name === 'AI助手') {
                  return <AIIcon size={size} color={color} focused={focused} />;
                }

                // 其他页面使用 Ionicons
                let iconName;
                if (route.name === '首页') {
                  iconName = focused ? 'home' : 'home-outline';
                } else if (route.name === '药品') {
                  iconName = focused ? 'medical' : 'medical-outline';
                } else if (route.name === '设备') {
                  iconName = focused ? 'watch' : 'watch-outline';
                } else if (route.name === '报告') {
                  iconName = focused ? 'document-text' : 'document-text-outline';
                }

                return <Ionicons name={iconName} size={size} color={color} />;
              },
              tabBarActiveTintColor: theme.colors.primary,
              tabBarInactiveTintColor: theme.colors.textSecondary,
              tabBarStyle: {
                backgroundColor: theme.colors.surface,
                borderTopColor: theme.colors.outlineVariant,
              },
              tabBarLabelStyle: {
                fontSize: 12,
                paddingBottom: 2,
              },
              headerStyle: {
                backgroundColor: theme.colors.primary,
              },
              headerTintColor: '#fff',
              headerTitleStyle: {
                fontWeight: 'bold',
              },
              headerTitle: () => <LogoTitle />,
            })}
          >
            <Tab.Screen name="首页">
              {(props) => <HomeScreen {...props} onLogout={() => setAuthed(false)} />}
            </Tab.Screen>
            <Tab.Screen name="药品" component={MedicineScreen} />
            <Tab.Screen name="设备" component={DeviceScreen} />
            <Tab.Screen name="AI助手" component={AIScreen} />
            <Tab.Screen name="报告" component={ReportScreen} />
          </Tab.Navigator>
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
  loadingContainer: {
    flex: 1,
    backgroundColor: '#4A90E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
});


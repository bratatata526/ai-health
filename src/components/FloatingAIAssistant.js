import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import DoctorAvatar from './DoctorAvatar';
import { subscribeHeartRateAlerts } from '../services/HeartRateAlertService';

const ICON_SIZE = 56;
const BUBBLE_WIDTH = 260;

/**
 * 浮动AI小助手组件
 * - 可拖拽移动
 * - 每次挂载自动弹出欢迎气泡（5s）
 * - 左键点击：读取待服药信息并显示气泡
 * - 右键点击：弹出导航菜单（AI助手/设备/报告）
 */
export default function FloatingAIAssistant({ onNavigate, getPendingMedicines }) {
  const dims = useRef(Dimensions.get('window'));

  const initialX = dims.current.width - ICON_SIZE - 16;
  const initialY = dims.current.height - ICON_SIZE - 160;

  const panX = useRef(new Animated.Value(initialX)).current;
  const panY = useRef(new Animated.Value(initialY)).current;
  const lastOffset = useRef({ x: initialX, y: initialY });

  // 气泡内容
  const [showBubble, setShowBubble] = useState(false);
  const [bubbleContent, setBubbleContent] = useState('');
  const bubbleOpacity = useRef(new Animated.Value(0)).current;
  const bubbleScale = useRef(new Animated.Value(0.6)).current;
  const bubbleTimerRef = useRef(null);

  // 右键菜单
  const [showMenu, setShowMenu] = useState(false);
  const menuOpacity = useRef(new Animated.Value(0)).current;
  const menuScale = useRef(new Animated.Value(0.7)).current;

  // 拖拽标志
  const isDragging = useRef(false);
  const bubbleVisibleRef = useRef(false);
  const menuVisibleRef = useRef(false);

  // 呼吸动画
  const breathAnim = useRef(new Animated.Value(1)).current;

  // Web 端不支持 useNativeDriver，需显式设为 false
  const nativeDriver = Platform.OS !== 'web';

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      dims.current = window;
    });
    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathAnim, {
          toValue: 1.08,
          duration: 1200,
          useNativeDriver: nativeDriver,
        }),
        Animated.timing(breathAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: nativeDriver,
        }),
      ])
    );
    breathLoop.start();

    // 欢迎气泡
    const welcomeTimer = setTimeout(() => {
      showBubbleWithContent('您好，我是您的个性化健康助手', 5000);
    }, 800);

    // Web 端注册右键事件拦截
    return () => {
      breathLoop.stop();
      sub?.remove?.();
      clearTimeout(welcomeTimer);
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    };
  }, []);

  // ---- 气泡控制 ----
  const showBubbleWithContent = useCallback((text, duration = 6000) => {
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    // 如果菜单正在显示，先关闭
    if (menuVisibleRef.current) hideMenu();

    setBubbleContent(text);
    setShowBubble(true);
    bubbleVisibleRef.current = true;
    bubbleOpacity.setValue(0);
    bubbleScale.setValue(0.6);
    Animated.parallel([
      Animated.spring(bubbleOpacity, { toValue: 1, useNativeDriver: nativeDriver }),
      Animated.spring(bubbleScale, { toValue: 1, friction: 6, useNativeDriver: nativeDriver }),
    ]).start();
    bubbleTimerRef.current = setTimeout(() => hideBubble(), duration);
  }, []);

  useEffect(() => {
    const unsub = subscribeHeartRateAlerts((payload) => {
      if (payload?.bubbleText) {
        showBubbleWithContent(payload.bubbleText, 12000);
      }
    });
    return unsub;
  }, [showBubbleWithContent]);

  const hideBubble = useCallback(() => {
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    Animated.timing(bubbleOpacity, {
      toValue: 0,
      duration: 250,
      useNativeDriver: nativeDriver,
    }).start(() => {
      setShowBubble(false);
      bubbleVisibleRef.current = false;
    });
  }, []);

  // ---- 右键菜单控制 ----
  const showMenuPopup = useCallback(() => {
    if (bubbleVisibleRef.current) hideBubble();
    setShowMenu(true);
    menuVisibleRef.current = true;
    menuOpacity.setValue(0);
    menuScale.setValue(0.7);
    Animated.parallel([
      Animated.spring(menuOpacity, { toValue: 1, useNativeDriver: nativeDriver }),
      Animated.spring(menuScale, { toValue: 1, friction: 6, useNativeDriver: nativeDriver }),
    ]).start();
  }, []);

  const hideMenu = useCallback(() => {
    Animated.timing(menuOpacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: nativeDriver,
    }).start(() => {
      setShowMenu(false);
      menuVisibleRef.current = false;
    });
  }, []);

  const handleMenuSelect = useCallback((target) => {
    hideMenu();
    onNavigate?.(target);
  }, [onNavigate]);

  // ---- 左键点击：获取待服药信息 ----
  const handleLeftClick = useCallback(async () => {
    if (menuVisibleRef.current) {
      hideMenu();
      return;
    }
    try {
      const pending = await getPendingMedicines?.();
      if (!pending || pending.length === 0) {
        showBubbleWithContent('您当前没有待服用的药品，继续保持哦~', 5000);
      } else {
        const lines = pending.map((item) => {
          return `💊 ${item.name} 记得在 ${item.time} 服用`;
        });
        const text = '您还有待服药品：\n' + lines.join('\n');
        showBubbleWithContent(text, 8000);
      }
    } catch (e) {
      showBubbleWithContent('您好，我是您的个性化健康助手', 5000);
    }
  }, [getPendingMedicines, showBubbleWithContent]);

  // ---- 边界限制 ----
  const clampPosition = (x, y) => {
    const { width: w, height: h } = dims.current;
    return {
      x: Math.max(0, Math.min(x, w - ICON_SIZE)),
      y: Math.max(0, Math.min(y, h - ICON_SIZE - 80)),
    };
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5,
      onPanResponderGrant: () => {
        isDragging.current = false;
        if (bubbleVisibleRef.current) hideBubble();
        if (menuVisibleRef.current) hideMenu();
      },
      onPanResponderMove: (_, gs) => {
        if (Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5) {
          isDragging.current = true;
        }
        panX.setValue(lastOffset.current.x + gs.dx);
        panY.setValue(lastOffset.current.y + gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        const raw = {
          x: lastOffset.current.x + gs.dx,
          y: lastOffset.current.y + gs.dy,
        };
        const clamped = clampPosition(raw.x, raw.y);
        const { width: w } = dims.current;
        const midX = (w - ICON_SIZE) / 2;
        const targetX = clamped.x < midX ? 8 : w - ICON_SIZE - 8;

        Animated.parallel([
          Animated.spring(panX, { toValue: targetX, friction: 7, useNativeDriver: false }),
          Animated.spring(panY, { toValue: clamped.y, friction: 7, useNativeDriver: false }),
        ]).start();

        lastOffset.current = { x: targetX, y: clamped.y };

        // 非拖拽时视为左键点击
        if (!isDragging.current) {
          handleLeftClick();
        }
      },
    })
  ).current;

  // Web 端右键事件
  const onContextMenu = useCallback((e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (isDragging.current) return;
    showMenuPopup();
  }, [showMenuPopup]);

  const menuItems = [
    { key: 'AI助手', label: '询问对话', icon: 'chatbubble-ellipses-outline' },
    { key: '设备', label: '设备详情', icon: 'watch-outline' },
    { key: '报告', label: '个人状况', icon: 'document-text-outline' },
  ];

  return (
    <Animated.View
      style={[
        styles.container,
        { transform: [{ translateX: panX }, { translateY: panY }] },
      ]}
      {...panResponder.panHandlers}
      // Web 端拦截右键
      {...(Platform.OS === 'web' ? { onContextMenu } : {})}
    >
      {/* 信息气泡 */}
      {showBubble && (
        <Animated.View
          style={[
            styles.bubble,
            styles.bubbleOnLeft,
            {
              opacity: bubbleOpacity,
              transform: [{ scale: bubbleScale }],
            },
          ]}
        >
          <Text style={styles.bubbleText}>{bubbleContent}</Text>
          <View style={[styles.bubbleArrow, styles.arrowPointRight]} />
        </Animated.View>
      )}

      {/* 右键菜单 */}
      {showMenu && (
        <Animated.View
          style={[
            styles.menu,
            styles.bubbleOnLeft,
            {
              opacity: menuOpacity,
              transform: [{ scale: menuScale }],
            },
          ]}
        >
          {menuItems.map((item, idx) => (
            <TouchableOpacity
              key={item.key}
              style={[
                styles.menuItem,
                idx < menuItems.length - 1 && styles.menuItemBorder,
              ]}
              onPress={() => handleMenuSelect(item.key)}
              activeOpacity={0.6}
            >
              <Ionicons name={item.icon} size={18} color="#2563EB" style={styles.menuIcon} />
              <Text style={styles.menuText}>{item.label}</Text>
            </TouchableOpacity>
          ))}
          <View style={[styles.bubbleArrow, styles.arrowPointRight, { top: 20 }]} />
        </Animated.View>
      )}

      {/* 图标 */}
      <Animated.View
        style={[
          styles.iconWrapper,
          { transform: [{ scale: breathAnim }] },
        ]}
      >
        <DoctorAvatar size={ICON_SIZE} />
      </Animated.View>
    </Animated.View>
  );
}

const BUBBLE_BG = 'rgba(255, 255, 255, 0.92)';

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 9999,
    ...Platform.select({
      web: { cursor: 'pointer', willChange: 'transform' },
      default: {},
    }),
  },
  iconWrapper: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 8 },
      web: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
    }),
  },
  // ---- 气泡 ----
  bubble: {
    position: 'absolute',
    minWidth: 200,
    maxWidth: BUBBLE_WIDTH,
    backgroundColor: BUBBLE_BG,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    bottom: 4,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 4 },
      web: { shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
    }),
  },
  bubbleOnLeft: {
    right: ICON_SIZE + 10,
  },
  bubbleText: {
    fontSize: 13,
    color: '#1E293B',
    lineHeight: 20,
  },
  bubbleArrow: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    top: '50%',
    marginTop: -6,
  },
  arrowPointRight: {
    right: -8,
    borderLeftWidth: 8,
    borderLeftColor: BUBBLE_BG,
  },
  // ---- 右键菜单 ----
  menu: {
    position: 'absolute',
    width: 160,
    backgroundColor: BUBBLE_BG,
    borderRadius: 10,
    paddingVertical: 4,
    bottom: -10,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
      android: { elevation: 6 },
      web: { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    }),
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  menuItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  menuIcon: {
    marginRight: 10,
  },
  menuText: {
    fontSize: 14,
    color: '#1E293B',
  },
});

import React, { useEffect, useRef, useState } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import DoctorAvatar from './DoctorAvatar';

const ICON_SIZE = 56;
const BUBBLE_WIDTH = 220;
const FIRST_VISIT_KEY = '@ai_assistant_first_visit';

/**
 * 浮动AI小助手组件
 * - 可拖拽移动
 * - 首次登录自动弹出欢迎气泡
 * - 点击跳转 AI助手 Tab
 */
export default function FloatingAIAssistant({ onPress }) {
  const dims = useRef(Dimensions.get('window'));

  // 初始位置：右下角，距底部 tab 栏上方
  const initialX = dims.current.width - ICON_SIZE - 16;
  const initialY = dims.current.height - ICON_SIZE - 160;

  const panX = useRef(new Animated.Value(initialX)).current;
  const panY = useRef(new Animated.Value(initialY)).current;
  const lastOffset = useRef({ x: initialX, y: initialY });

  // 气泡
  const [showBubble, setShowBubble] = useState(false);
  const bubbleOpacity = useRef(new Animated.Value(0)).current;
  const bubbleScale = useRef(new Animated.Value(0.6)).current;

  // 拖拽标志
  const isDragging = useRef(false);
  const bubbleRef = useRef(false); // 用 ref 避免 PanResponder 闭包陈旧问题

  // 呼吸动画
  const breathAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      dims.current = window;
    });
    // 呼吸动画循环
    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathAnim, {
          toValue: 1.08,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(breathAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    );
    breathLoop.start();

    // 每次挂载（打开页面/刷新）都弹出欢迎气泡
    const bubbleTimer = setTimeout(() => {
      showWelcomeBubble();
    }, 800);

    return () => { breathLoop.stop(); sub?.remove?.(); clearTimeout(bubbleTimer); };
  }, []);

  const showWelcomeBubble = () => {
    setShowBubble(true);
    bubbleRef.current = true;
    bubbleOpacity.setValue(0);
    bubbleScale.setValue(0.6);
    Animated.parallel([
      Animated.spring(bubbleOpacity, {
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.spring(bubbleScale, {
        toValue: 1,
        friction: 6,
        useNativeDriver: true,
      }),
    ]).start();
    // 5秒后自动隐藏
    setTimeout(() => hideBubble(), 5000);
  };

  const hideBubble = () => {
    Animated.timing(bubbleOpacity, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setShowBubble(false);
      bubbleRef.current = false;
    });
  };

  // 限制边界（仅在松手时调用）
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
        if (bubbleRef.current) hideBubble();
      },
      // 拖动时直接设值，不做边界计算，保证流畅
      onPanResponderMove: (_, gs) => {
        if (Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5) {
          isDragging.current = true;
        }
        panX.setValue(lastOffset.current.x + gs.dx);
        panY.setValue(lastOffset.current.y + gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        // 松手后再做边界修正 + 吸附
        const raw = {
          x: lastOffset.current.x + gs.dx,
          y: lastOffset.current.y + gs.dy,
        };
        const clamped = clampPosition(raw.x, raw.y);
        const { width: w } = dims.current;
        const midX = (w - ICON_SIZE) / 2;
        const targetX = clamped.x < midX ? 8 : w - ICON_SIZE - 8;

        Animated.parallel([
          Animated.spring(panX, {
            toValue: targetX,
            friction: 7,
            useNativeDriver: false,
          }),
          Animated.spring(panY, {
            toValue: clamped.y,
            friction: 7,
            useNativeDriver: false,
          }),
        ]).start();

        lastOffset.current = { x: targetX, y: clamped.y };

        if (!isDragging.current) {
          onPress?.();
        }
      },
    })
  ).current;

  // 气泡显示在图标左侧还是右侧
  const bubbleOnLeft = lastOffset.current.x > dims.current.width / 2;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          left: panX,
          top: panY,
        },
      ]}
      {...panResponder.panHandlers}
    >
      {/* 气泡 */}
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
          <Text style={styles.bubbleText}>您好，我是您的个性化健康助手</Text>
          {/* 气泡小三角 */}
          <View
            style={[
              styles.bubbleArrow,
              styles.arrowPointRight,
            ]}
          />
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

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 9999,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  iconWrapper: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    // 阴影
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: {
        elevation: 8,
      },
      web: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
    }),
  },
  bubble: {
    position: 'absolute',
    width: BUBBLE_WIDTH,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    bottom: 4,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 4 },
      web: {
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  bubbleOnLeft: {
    right: ICON_SIZE + 10,
  },
  arrowPointRight: {
    right: -8,
    borderLeftWidth: 8,
    borderLeftColor: 'rgba(255, 255, 255, 0.85)',
  },
  bubbleText: {
    fontSize: 14,
    color: '#000',
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
});

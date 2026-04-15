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
  const { width: screenW, height: screenH } = Dimensions.get('window');

  // 初始位置：右下角，距底部 tab 栏上方
  const initialX = screenW - ICON_SIZE - 16;
  const initialY = screenH - ICON_SIZE - 160;

  const pan = useRef(new Animated.ValueXY({ x: initialX, y: initialY })).current;
  const lastOffset = useRef({ x: initialX, y: initialY });

  // 气泡
  const [showBubble, setShowBubble] = useState(false);
  const bubbleOpacity = useRef(new Animated.Value(0)).current;
  const bubbleScale = useRef(new Animated.Value(0.6)).current;

  // 拖拽标志
  const isDragging = useRef(false);

  // 呼吸动画
  const breathAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
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

    // 首次登录检查
    checkFirstVisit();

    return () => breathLoop.stop();
  }, []);

  const checkFirstVisit = async () => {
    try {
      const visited = await AsyncStorage.getItem(FIRST_VISIT_KEY);
      if (!visited) {
        // 首次登录，延迟一点后弹出气泡
        setTimeout(() => {
          setShowBubble(true);
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
        }, 800);
        await AsyncStorage.setItem(FIRST_VISIT_KEY, 'true');
      }
    } catch (e) {
      // ignore
    }
  };

  const hideBubble = () => {
    Animated.timing(bubbleOpacity, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => setShowBubble(false));
  };

  // 限制边界
  const clampPosition = (x, y) => {
    const { width: w, height: h } = Dimensions.get('window');
    const clampedX = Math.max(0, Math.min(x, w - ICON_SIZE));
    const clampedY = Math.max(0, Math.min(y, h - ICON_SIZE - 80));
    return { x: clampedX, y: clampedY };
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // 移动超过 5px 才认为是拖拽
        return Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5;
      },
      onPanResponderGrant: () => {
        isDragging.current = false;
        // 隐藏气泡
        if (showBubble) hideBubble();
      },
      onPanResponderMove: (_, gestureState) => {
        if (Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5) {
          isDragging.current = true;
        }
        const newX = lastOffset.current.x + gestureState.dx;
        const newY = lastOffset.current.y + gestureState.dy;
        const clamped = clampPosition(newX, newY);
        pan.setValue(clamped);
      },
      onPanResponderRelease: (_, gestureState) => {
        const newX = lastOffset.current.x + gestureState.dx;
        const newY = lastOffset.current.y + gestureState.dy;
        const clamped = clampPosition(newX, newY);

        // 吸附到左右边缘
        const { width: w } = Dimensions.get('window');
        const midX = (w - ICON_SIZE) / 2;
        const targetX = clamped.x < midX ? 8 : w - ICON_SIZE - 8;

        Animated.spring(pan, {
          toValue: { x: targetX, y: clamped.y },
          friction: 7,
          useNativeDriver: false,
        }).start();

        lastOffset.current = { x: targetX, y: clamped.y };

        // 如果不是拖拽，视为点击
        if (!isDragging.current) {
          onPress?.();
        }
      },
    })
  ).current;

  // 气泡显示在图标左侧还是右侧
  const bubbleOnLeft = lastOffset.current.x > Dimensions.get('window').width / 2;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [
            { translateX: pan.x },
            { translateY: pan.y },
          ],
        },
      ]}
      {...panResponder.panHandlers}
    >
      {/* 气泡 */}
      {showBubble && (
        <Animated.View
          style={[
            styles.bubble,
            bubbleOnLeft ? styles.bubbleLeft : styles.bubbleRight,
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
              bubbleOnLeft ? styles.arrowRight : styles.arrowLeft,
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
    backgroundColor: '#95EC69',
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
  bubbleRight: {
    right: ICON_SIZE + 10,
  },
  bubbleLeft: {
    left: ICON_SIZE + 10,
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
  arrowRight: {
    right: -8,
    borderLeftWidth: 8,
    borderLeftColor: '#95EC69',
  },
  arrowLeft: {
    left: -8,
    borderRightWidth: 8,
    borderRightColor: '#95EC69',
  },
});

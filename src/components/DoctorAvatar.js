import React from 'react';
import Svg, {
  Circle,
  Ellipse,
  G,
  Path,
  Rect,
  Defs,
  LinearGradient,
  Stop,
} from 'react-native-svg';

/**
 * 卡通医生头像 SVG 组件
 * 一个可爱的卡通医生头像，包含白大褂、听诊器和医生帽元素
 */
export default function DoctorAvatar({ size = 56 }) {
  const s = size;
  return (
    <Svg width={s} height={s} viewBox="0 0 120 120">
      <Defs>
        {/* 脸部渐变 */}
        <LinearGradient id="faceGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFE0BD" />
          <Stop offset="1" stopColor="#FFCF9F" />
        </LinearGradient>
        {/* 帽子渐变 */}
        <LinearGradient id="hatGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="1" stopColor="#E8F0FE" />
        </LinearGradient>
        {/* 身体渐变 */}
        <LinearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="1" stopColor="#E3EAFC" />
        </LinearGradient>
      </Defs>

      {/* 背景圆 */}
      <Circle cx="60" cy="60" r="58" fill="#4A90E2" />
      <Circle cx="60" cy="60" r="54" fill="#5BA0F2" />

      {/* 白大褂身体 */}
      <Path
        d="M30 105 Q30 82 42 75 L60 70 L78 75 Q90 82 90 105 Z"
        fill="url(#bodyGrad)"
        stroke="#CBD5E1"
        strokeWidth="0.5"
      />
      {/* 衣领 V 领 */}
      <Path d="M50 75 L60 90 L70 75" fill="none" stroke="#94A3B8" strokeWidth="1.5" />

      {/* 听诊器线条 */}
      <Path
        d="M55 78 Q52 88 50 95"
        fill="none"
        stroke="#3B82F6"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* 听诊器头 */}
      <Circle cx="50" cy="96" r="3.5" fill="#3B82F6" />
      <Circle cx="50" cy="96" r="1.8" fill="#60A5FA" />

      {/* 脖子 */}
      <Rect x="53" y="64" width="14" height="12" rx="5" fill="#FFCF9F" />

      {/* 耳朵 */}
      <Ellipse cx="30" cy="48" rx="6" ry="8" fill="#FFCF9F" />
      <Ellipse cx="30" cy="48" rx="3.5" ry="5" fill="#F5C28A" />
      <Ellipse cx="90" cy="48" rx="6" ry="8" fill="#FFCF9F" />
      <Ellipse cx="90" cy="48" rx="3.5" ry="5" fill="#F5C28A" />

      {/* 头部 / 脸 */}
      <Ellipse cx="60" cy="45" rx="28" ry="30" fill="url(#faceGrad)" />

      {/* 头发 */}
      <Path
        d="M32 40 Q32 18 60 15 Q88 18 88 40 Q85 28 60 25 Q35 28 32 40 Z"
        fill="#4A3728"
      />

      {/* 医生帽 */}
      <Path
        d="M30 32 Q30 10 60 8 Q90 10 90 32 Q88 22 60 18 Q32 22 30 32 Z"
        fill="url(#hatGrad)"
        stroke="#CBD5E1"
        strokeWidth="0.5"
      />
      {/* 帽子底边 */}
      <Path
        d="M32 30 Q60 26 88 30"
        fill="none"
        stroke="#CBD5E1"
        strokeWidth="1"
      />
      {/* 红十字标志 */}
      <Rect x="55" y="10" width="10" height="3" rx="1" fill="#EF4444" />
      <Rect x="58.5" y="7" width="3" height="10" rx="1" fill="#EF4444" />

      {/* 眼睛 */}
      <G>
        {/* 左眼白 */}
        <Ellipse cx="48" cy="44" rx="7" ry="7.5" fill="white" />
        {/* 左瞳孔 */}
        <Circle cx="49" cy="44" r="4" fill="#1E293B" />
        {/* 左眼高光 */}
        <Circle cx="51" cy="42.5" r="1.8" fill="white" />
        <Circle cx="47.5" cy="45.5" r="0.8" fill="white" />
      </G>
      <G>
        {/* 右眼白 */}
        <Ellipse cx="72" cy="44" rx="7" ry="7.5" fill="white" />
        {/* 右瞳孔 */}
        <Circle cx="71" cy="44" r="4" fill="#1E293B" />
        {/* 右眼高光 */}
        <Circle cx="73" cy="42.5" r="1.8" fill="white" />
        <Circle cx="69.5" cy="45.5" r="0.8" fill="white" />
      </G>

      {/* 眉毛 */}
      <Path d="M41 36 Q48 33 55 36" fill="none" stroke="#4A3728" strokeWidth="1.5" strokeLinecap="round" />
      <Path d="M65 36 Q72 33 79 36" fill="none" stroke="#4A3728" strokeWidth="1.5" strokeLinecap="round" />

      {/* 鼻子 */}
      <Ellipse cx="60" cy="52" rx="2.5" ry="2" fill="#F5C28A" />

      {/* 微笑 */}
      <Path d="M50 58 Q60 66 70 58" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" />

      {/* 腮红 */}
      <Ellipse cx="40" cy="56" rx="5" ry="3" fill="#FCA5A5" opacity="0.4" />
      <Ellipse cx="80" cy="56" rx="5" ry="3" fill="#FCA5A5" opacity="0.4" />
    </Svg>
  );
}

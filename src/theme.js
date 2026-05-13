import { MD3LightTheme, configureFonts } from 'react-native-paper';
import { Platform } from 'react-native';

/**
 * Expo Web：不写 NotoSansSC_* 文件名（应由可选字体包注册后再用）。
 * Web 仅以系统级黑体系（微软雅黑等）保底，避免在无注册名时回退到奇怪字体。
 */
const WEB_FONT_REGULAR =
  '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Microsoft JhengHei", ui-sans-serif, sans-serif';
const WEB_FONT_MEDIUM = WEB_FONT_REGULAR;
const WEB_FONT_BOLD = WEB_FONT_REGULAR;

/** RN 已通过 expo-font 加载后的 PostScript / 字体名（与 @expo-google-fonts/noto-sans-sc 一致） */
export const appFontFamilies = {
  regular: Platform.OS === 'web' ? WEB_FONT_REGULAR : 'NotoSansSC_400Regular',
  medium: Platform.OS === 'web' ? WEB_FONT_MEDIUM : 'NotoSansSC_500Medium',
  bold: Platform.OS === 'web' ? WEB_FONT_BOLD : 'NotoSansSC_700Bold',
};

const paperFonts = configureFonts({
  isV3: true,
  config:
    Platform.OS === 'web'
      ? { fontFamily: WEB_FONT_REGULAR }
      : { fontFamily: 'NotoSansSC_400Regular' },
});

/**
 * 设计系统（轻量版）
 * - 目标：统一全局色板/圆角/间距/阴影，让各页面视觉一致且更现代
 * - 注意：在 Paper MD3 主题基础上扩展了一些自定义字段（spacing/borderRadius/shadow）
 */
export const theme = {
  ...MD3LightTheme,
  fonts: paperFonts,
  roundness: 8,
  colors: {
    ...MD3LightTheme.colors,

    // Brand
    primary: '#2563EB',
    secondary: '#10B981',
    accent: '#A855F7',

    // Surfaces
    background: '#F6F7FB',
    surface: '#FFFFFF',
    surfaceVariant: '#F1F5F9',

    // Text
    text: '#0F172A',
    textSecondary: '#64748B',

    // Semantic
    error: '#EF4444',
    warning: '#F59E0B',
    success: '#22C55E',

    // Borders
    outline: '#CBD5E1',
    outlineVariant: '#E2E8F0',

    // 确保 elevation 配置完整（部分组件依赖）
    elevation: {
      level0: 'transparent',
      level1: 'rgb(247, 243, 249)',
      level2: 'rgb(243, 237, 247)',
      level3: 'rgb(238, 232, 244)',
      level4: 'rgb(236, 230, 242)',
      level5: 'rgb(233, 227, 240)',
    },
  },

  // 自定义布局 token（业务侧 StyleSheet 直接复用）
  spacing: {
    xxs: 2,
    xs: 6,
    sm: 10,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 40,
  },
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
  },
  shadow: {
    // iOS shadow + Android elevation（按需在各 Screen 使用）
    color: 'rgba(15, 23, 42, 0.08)',
    colorStrong: 'rgba(15, 23, 42, 0.12)',
  },
};

/**
 * 全项目统一 UI 字面：移动端显式绑定 Noto Sans SC/Web 绑定雅黑栈，避免仅用 fontWeight:800／bold 时回退为系统字体。
 */
export const textStyles = {
  /** 大块标题（原 StyleSheet fontWeight `800`） */
  title: {
    fontFamily: appFontFamilies.bold,
    fontWeight: Platform.OS === 'web' ? '700' : 'normal',
  },
  /** 数据强调、次级粗体（原 `bold`） */
  emphasis: {
    fontFamily: appFontFamilies.bold,
    fontWeight: Platform.OS === 'web' ? 'bold' : 'normal',
  },
  /** 正文、说明 */
  body: {
    fontFamily: appFontFamilies.regular,
  },
  /** 略强调标签（接近 600） */
  semi: {
    fontFamily: appFontFamilies.medium,
    fontWeight: Platform.OS === 'web' ? '600' : 'normal',
  },
};


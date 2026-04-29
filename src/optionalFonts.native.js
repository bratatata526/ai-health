import {
  NotoSansSC_400Regular,
  NotoSansSC_500Medium,
  NotoSansSC_700Bold,
} from '@expo-google-fonts/noto-sans-sc';

/**
 * 仅原生端打包并通过 expo-font 注册；避免 Webpack 解析 .ttf 导致 Web 白屏。
 */
export const optionalAppFonts = {
  NotoSansSC_400Regular,
  NotoSansSC_500Medium,
  NotoSansSC_700Bold,
};

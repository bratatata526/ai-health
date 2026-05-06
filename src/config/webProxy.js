// Web 端代理配置（用于绕过浏览器 CORS / Mixed Content 限制）
// 启动方式：先运行 `npm run proxy`，再运行 `npm run web`

export const WEB_PROXY_CONFIG = {
  // Expo Web 支持 EXPO_PUBLIC_* 注入到运行时
  // 例如：EXPO_PUBLIC_API_BASE_URL=http://localhost:3001
  BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3001',
};



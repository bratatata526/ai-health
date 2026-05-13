// 云端 API 配置
// 优先级：
// 1) EXPO_PUBLIC_CLOUD_API_BASE_URL（推荐：通过 .env 或运行环境注入）
// 2) app.json -> expo.extra.CLOUD_API_BASE_URL（当无法/不方便使用 .env 时的兜底）
// 3) 默认 http://localhost:4000（本地开发：先运行 `npm run cloud`）

import appConfig from '../../app.json';

const extraBaseUrl = appConfig?.expo?.extra?.CLOUD_API_BASE_URL;

export const CLOUD_CONFIG = {
  BASE_URL:
    process.env.EXPO_PUBLIC_CLOUD_API_BASE_URL ||
    extraBaseUrl ||
    'http://172.20.10.3:4000',
};




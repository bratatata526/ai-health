// AI服务配置 - 硅基流动 SiliconFlow
// 官网：https://www.siliconflow.cn/
//
// Key 来源优先级：
// 1) EXPO_PUBLIC_SILICONFLOW_API_KEY（Expo 前端推荐）
// 2) SILICONFLOW_API_KEY（Node/代理常用）
// 3) app.json -> expo.extra.SILICONFLOW_API_KEY（兜底，不建议长期使用）

import appConfig from '../../app.json';

const normalizeKey = (v) => String(v || '').trim();

const extraKey = normalizeKey(appConfig?.expo?.extra?.SILICONFLOW_API_KEY);
const expoPublicKey = normalizeKey(process.env.EXPO_PUBLIC_SILICONFLOW_API_KEY);
const nodeEnvKey = normalizeKey(process.env.SILICONFLOW_API_KEY);
const siliconFlowKey = expoPublicKey || nodeEnvKey || extraKey;

export const AI_CONFIG = {
  SILICONFLOW: {
    BASE_URL: 'https://api.siliconflow.cn/v1',
    API_KEY: siliconFlowKey,
    MODEL: 'Qwen/Qwen2.5-7B-Instruct', // 推荐模型，也可使用其他模型如 'deepseek-ai/DeepSeek-V2.5', 'meta-llama/Llama-3.1-8B-Instruct' 等
    ENABLED: true,
    MAX_TOKENS: 1000,
  },
};

// 当前启用的AI服务
export const getEnabledAIServices = () => {
  return [AI_CONFIG.SILICONFLOW].filter(service => service.ENABLED && service.API_KEY);
};

// 默认使用的AI服务
export const DEFAULT_AI_SERVICE = getEnabledAIServices()[0] || null;

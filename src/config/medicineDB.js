// 药物数据库API配置
// Key 来源优先级：
// 1) EXPO_PUBLIC_*（前端推荐）
// 2) 非 EXPO_PUBLIC_*（Node/代理常用）
// 3) 代码中的默认值（仅示例）

const normalizeKey = (v) => String(v || '').trim();
const hasKey = (v) => normalizeKey(v).length > 0;

const juheKey = normalizeKey(
  process.env.EXPO_PUBLIC_JUHE_API_KEY || process.env.JUHE_API_KEY || '4cf1a2001a4c972985cef0dbb4cd5db4'
);
const tianKey = normalizeKey(
  process.env.EXPO_PUBLIC_TIANAPI_KEY || process.env.TIANAPI_KEY || 'YOUR_TIANAPI_KEY'
);
const wanweiCode = normalizeKey(
  process.env.EXPO_PUBLIC_WANWEI_APP_CODE || process.env.WANWEI_APP_CODE || 'YOUR_APP_CODE'
);
const jisuKey = normalizeKey(
  process.env.EXPO_PUBLIC_JISU_API_KEY || process.env.JISU_API_KEY || 'YOUR_JISU_API_KEY'
);

export const MEDICINE_DB_CONFIG = {
  // 方案一：聚合数据药品查询API（已配置）
  // 官网：https://www.juhe.cn/docs/api/id/77
  // 注意：该API可能处于维护状态，如不可用请切换其他API
  JUHE_API: {
    // 使用 https 以兼容 Web / iOS 等更严格的环境；若接口确实不支持 https，可在 Web 端走本地代理
    BASE_URL: 'https://apis.juhe.cn/drug/query',
    API_KEY: juheKey,
    ENABLED: hasKey(juheKey),
  },

  // 方案二：天聚数行药品说明书API（备用）
  // 官网：https://www.tianapi.com/apiview/134
  // 提供近2万种中西药说明书数据
  TIANAPI: {
    BASE_URL: 'https://apis.tianapi.com/yaopin/index',
    API_KEY: tianKey,
    ENABLED: hasKey(tianKey) && tianKey !== 'YOUR_TIANAPI_KEY',
  },

  // 方案三：万维易源药品信息查询API（阿里云市场）
  // 官网：https://market.aliyun.com/products/57124001/cmapi00043217.html
  WANWEI_API: {
    BASE_URL: 'https://ali-medicine.showapi.com',
    APP_CODE: wanweiCode,
    ENABLED: hasKey(wanweiCode) && wanweiCode !== 'YOUR_APP_CODE',
  },

  // 方案四：极速数据药品信息API
  // 官网：https://www.jisuapi.com/api/medicine/
  JISU_API: {
    BASE_URL: 'https://api.jisuapi.com/drug/query',
    API_KEY: jisuKey,
    ENABLED: hasKey(jisuKey) && jisuKey !== 'YOUR_JISU_API_KEY',
  },
};

// 当前使用的API配置（仅作为默认/兼容；实际查询会按 ENABLED 数据源自动降级）
export const CURRENT_API = MEDICINE_DB_CONFIG.JUHE_API;


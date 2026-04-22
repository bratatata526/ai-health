const path = require('path');
const createExpoWebpackConfigAsync = require('@expo/webpack-config');

module.exports = async function (env, argv) {
  const config = await createExpoWebpackConfigAsync(
    {
      ...env,
      babel: {
        dangerouslyAddModulePathsToTranspile: ['@expo/vector-icons'],
      },
    },
    argv
  );

  // 添加 webpack alias，将原生图标库重定向到 Expo 图标库
  // Web 端使用 BleHeartRateService 占位实现，不打包 react-native-ble-plx
  config.resolve.alias = {
    ...config.resolve.alias,
    [path.resolve(__dirname, 'src/services/BleHeartRateService.js')]: path.resolve(
      __dirname,
      'src/services/BleHeartRateService.web.js'
    ),
    '@react-native-vector-icons/material-design-icons': '@expo/vector-icons/MaterialCommunityIcons',
    '@react-native-vector-icons': '@expo/vector-icons',
  };

  // 忽略特定的警告
  config.ignoreWarnings = [
    ...(config.ignoreWarnings || []),
    {
      module: /MaterialCommunityIcon\.js/,
      message: /Can't resolve '@react-native-vector-icons/,
    },
  ];

  return config;
};

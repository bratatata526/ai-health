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
  config.resolve.alias = {
    ...config.resolve.alias,
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

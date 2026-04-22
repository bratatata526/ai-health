const { getDefaultConfig } = require('expo/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// 根目录下嵌套了完整副本 ai-health/ai-health/，会与主项目产生同名模块，触发 Metro “Duplicated files or mocks”
config.resolver.blockList = exclusionList([
  /[/\\]ai-health[/\\]ai-health[/\\].*/,
]);

module.exports = config;

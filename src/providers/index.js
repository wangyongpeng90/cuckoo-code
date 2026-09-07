/**
 * Provider 注册表
 * 加载所有内置的 AI 平台 Provider 定义，以及用户导入的自定义 Provider。
 */
const deepseek = require('./deepseek');
const claude = require('./claude');
const chatgpt = require('./chatgpt');
const { loadCustomProviders } = require('./custom/loader');

const builtinProviders = [deepseek, claude, chatgpt];

function getAllProviders() {
  return [...builtinProviders, ...loadCustomProviders()];
}

function getProvider(id) {
  return getAllProviders().find((p) => p.id === id) || null;
}

/** 根据 URL 自动识别所属平台 */
function getProviderByUrl(url) {
  if (!url) return null;
  return getAllProviders().find((p) => p.matchesUrl(url)) || null;
}

module.exports = {
  providers: getAllProviders(),
  getProvider,
  getAllProviders,
  getProviderByUrl,
};

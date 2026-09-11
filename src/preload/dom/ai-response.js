/**
 * AI 回复完成检测
 * 平台差异统一由 Provider 的 isResponseComplete() 实现。
 */
const { getProviderByUrl } = require('../../../src/providers');

async function isAIResponseComplete() {
  try {
    const url = window.location.href;
    const provider = getProviderByUrl(url);
    if (!provider || typeof provider.isResponseComplete !== 'function') {
      console.warn('[Cuckoo Code] 当前平台未提供 isResponseComplete 方法, url=' + url + ', provider=' + (provider ? provider.id : 'null'));
      return false;
    }
    const result = await provider.isResponseComplete();
    return result;
  } catch (err) {
    console.error('[Cuckoo Code] ❌ 检测 AI 完成状态出错:', err);
    return false;
  }
}

module.exports = { isAIResponseComplete };

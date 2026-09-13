/**
 * 构建配置（集中管理功能开关）
 */
module.exports = {
  /** 反向网关：把已登录的 ChatGPT 网页会话暴露成本地 OpenAI 兼容 API */
  reverseGateway: {
    enabled: true,
    host: '127.0.0.1',      // 仅本地回环
    port: 8788,
    // 留空 = 首次启动自动生成 48 位随机 token，持久化到 userData/api-server-token.json
    apiKey: '',
    defaultModel: 'gpt-4o',
  },
};

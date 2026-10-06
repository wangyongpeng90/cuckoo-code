/**
 * 示例 DSH 风格插件
 *
 * 演示 Cuckoo 的 DSH 兼容层能力：
 *   - 命名导出 name / inject / apply
 *   - 使用 ctx.on('session/event') / ctx.on('agent/assistant-stream')
 *   - 使用 ctx.agents 发消息
 */
export const name = 'hello-dsh';
export const inject = ['agents'];

export function apply(ctx, config) {
  ctx.log('hello-dsh 已激活');

  // 监听助手逐字流
  ctx.on('agent/assistant-stream', (payload) => {
    const frame = payload && payload.frame ? payload.frame : {};
    if (frame.text) {
      ctx.log('逐字流:', frame.text.slice(0, 40));
    }
  });

  // 监听会话事件（一轮回复完成）
  ctx.on('session/event', (record) => {
    if (record && record.type === 'assistant/message') {
      ctx.log('收到回复，token:', record.tokenUsage && record.tokenUsage.accumulatedTokens);
    }
  });

  // 监听任务空闲
  ctx.on('agent/task-idle', () => {
    ctx.log('任务空闲');
  });
}

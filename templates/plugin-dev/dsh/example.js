/**
 * DSH 风格插件示例
 *
 * 命名导出 name / inject / apply(ctx, config)
 */
export const name = 'my-plugin'
export const inject = ['agents']   // 声明依赖的服务（可选，可省略）

export function apply(ctx, config) {
  ctx.log('my-plugin 已激活')

  // 监听 AI 逐字流
  ctx.on('agent/assistant-stream', ({ frame }) => {
    if (frame.text) ctx.log('逐字:', frame.text.slice(0, 30))
  })

  // 监听一轮回复完成
  ctx.on('session/event', (rec) => {
    if (rec.type === 'assistant/message') {
      ctx.log('收到回复，token:', rec.tokenUsage?.accumulatedTokens)
    }
  })

  // 监听工具调用
  ctx.on('tool/call', ({ code }) => ctx.log('工具调用:', code))

  // 可逆副作用（卸载时自动清理）
  ctx.effect(() => {
    const timer = setInterval(() => {}, 60000)
    return () => clearInterval(timer)
  })

  // 提供服务（供其他插件注入）
  // ctx.provide('my-service', { doSomething: () => {} })
}

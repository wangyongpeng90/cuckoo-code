/**
 * UI 扩展插件示例
 *
 * 在 ctx 基础上额外有 ctx.ui（挂载 DOM、注入样式）
 */
export const name = 'my-ui-plugin'

export function apply(ctx, config) {
  ctx.log('UI 插件已激活')

  // 注入样式
  ctx.ui.css(`
    #my-widget { position: fixed; right: 20px; bottom: 20px; z-index: 2147482500; }
  `)

  // 创建并挂载 DOM
  const el = document.createElement('div')
  el.id = 'my-widget'
  el.textContent = '👋 我的挂件'
  el.style.cssText = 'padding:8px 12px;background:#8b93ff;color:#fff;border-radius:8px;cursor:pointer;'
  ctx.ui.mount(el)

  // 响应 agent 状态
  ctx.on('agent/assistant-stream', ({ frame }) => {
    if (frame.text) el.textContent = '💬 ' + frame.text.slice(0, 10)
  })

  // 点击跟 agent 说话
  el.addEventListener('click', () => {
    ctx.agents.get()?.followup({ role: 'user', content: '你好' })
  })
}

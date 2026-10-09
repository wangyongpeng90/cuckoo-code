/**
 * 对话记录插件 - UI 扩展
 *
 * 在 Cuckoo 壳页面侧边栏注入「对话记录」页内容。
 * 用 ctx.shell 的槽位/挂载能力（这里用 addStyle 注入样式 + 由 shell 宿主渲染）。
 * 简化实现：直接往侧边栏加一个面板。
 */
export const name = 'cuckoo-conversation-records-ui';

export function apply(ctx) {
  ctx.log('对话记录 UI 已加载');
  // 侧边栏页（复用核心已注册的 records 页 id；插件未装时该页为空）
  try {
    if (ctx.shell && typeof ctx.shell.addSidebarPanel === 'function') {
      ctx.shell.addSidebarPanel({
        id: 'records',
        title: '对话记录',
        html: '<div style="padding:12px;color:var(--ck-text-dim);font-size:12px;">对话记录加载中…</div>',
      });
    }
  } catch (err) {
    ctx.log('注入侧边栏失败: ' + (err && err.message));
  }
}

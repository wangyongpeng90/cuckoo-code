/**
 * 示例：服务提供者插件
 *
 * 演示 DSH 的服务机制：
 *   - ctx.provide() 提供全局服务
 *   - 其他插件用 ctx.get() / ctx.inject() 消费
 *
 * 这个插件提供一个 "greeter" 服务，其他插件可注入使用。
 */
export const name = 'example-service-provider';

export function apply(ctx) {
  ctx.log('服务提供者已激活');

  // 提供一个服务
  const greeter = {
    /** 打招呼 */
    greet(who) {
      return '你好，' + (who || '世界') + '！我是鲸鱼娘～';
    },
    /** 当前时间 */
    now() {
      return new Date().toISOString();
    },
  };

  const dispose = ctx.provide('greeter', greeter);
  ctx.log('已提供 greeter 服务');

  // 卸载时自动注销（ctx.provide 返回的 disposer 已自动登记）
}

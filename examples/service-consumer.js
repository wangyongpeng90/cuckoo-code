/**
 * 示例：服务消费者插件
 *
 * 演示用 ctx.inject() 等待服务就绪后使用。
 * 依赖 example-service-provider 提供的 greeter 服务。
 */
export const name = 'example-service-consumer';
export const inject = ['greeter'];   // 声明依赖 greeter 服务

export function apply(ctx) {
  // 走到这里，说明 greeter 已就绪（inject 生效）
  ctx.log('服务消费者已激活，greeter 已就绪');

  const greeter = ctx.get('greeter');
  if (greeter) {
    ctx.log(greeter.greet('Cuckoo'));
  }

  // 响应 AI 回复，用 greeter 生成消息
  ctx.on('session/event', (rec) => {
    if (rec && rec.type === 'assistant/message' && greeter) {
      ctx.log('AI 说完了，greeter 问候：' + greeter.greet('主人'));
    }
  });
}

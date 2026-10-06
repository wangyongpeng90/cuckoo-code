/**
 * Cuckoo 插件系统 - Service 基类
 *
 * 对齐 DSH 的 Service：插件通过"继承 Service + super(ctx, 'name')"提供服务，
 * 其他插件用 ctx.get('name') / inject 消费。
 *
 * 用法：
 *   export default class Metrics extends Service {
 *     static inject = ['tools']
 *     constructor(ctx) {
 *       super(ctx, 'metrics')
 *     }
 *     record(x) { ... }
 *   }
 */
export class Service {
  /** 该服务提供的名称 */
  readonly name: string;
  /** 挂载的上下文 */
  protected ctx: any;

  constructor(ctx: any, name: string) {
    if (!ctx) throw new Error('Service 需要 ctx');
    if (typeof name !== 'string' || !name) throw new Error('Service 需要 name');
    this.ctx = ctx;
    this.name = name;
    // 自动把自身注册为服务
    if (typeof ctx.provide === 'function') {
      ctx.provide(name, this);
    }
  }
}

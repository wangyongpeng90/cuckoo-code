/**
 * dsh-slot-probe — 宿主侧入口（空壳）
 *
 * DSH 插件的宿主侧只负责注册工具/服务；本探针只验客户端链路，宿主侧什么都不做。
 * 故意保持空壳：如果阶段 0 发现宿主侧也报错，说明加载链路本身有问题。
 */
export const name = 'dsh-slot-probe';

export function apply(_ctx) {
  // 空实现：探针只验客户端插槽链路
}

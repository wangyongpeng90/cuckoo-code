/**
 * overlay / ui 测试的 DOM 环境 helper。
 *
 * 前置条件：测试文件顶部带 `// @vitest-environment happy-dom` docblock，
 * happy-dom 环境会注入全局 document/window。本 helper 负责写入 html、
 * 并在 cleanup 时还原 body，保证测试间隔离。
 *
 * ⚠️ 断言红线：失败的断言不要把「已挂载到 document 的 DOM 节点」放进
 * actual/expected（如 assert.strictEqual(el.querySelector('img'), null)）——
 * vitest 序列化 AssertionError 时会递归整个 document/window 循环引用图，
 * 内存可膨胀到上百 GB（2026-09 实测复现，详见 task-5 排查记录）。
 * 正确写法：断言原始值，如 assert.strictEqual(el.querySelector('img') === null, true)。
 */

export interface DomContext {
  document: Document;
  cleanup(): void;
}

export function setupDom(html: string = ''): DomContext {
  document.body.innerHTML = html;

  return {
    document,
    cleanup() {
      document.body.innerHTML = '';
    },
  };
}

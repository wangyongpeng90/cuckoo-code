/**
 * DSH 兼容层单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/plugins/runtime/events.js';
import { createContext } from '../src/plugins/runtime/context.js';
import { loadPluginModule, safeLoad } from '../src/plugins/runtime/loader.js';
import { ServiceRegistryImpl } from '../src/plugins/runtime/service-registry.js';
import { Service } from '../src/plugins/runtime/service.js';
import { esmToCjs } from '../src/plugins/runtime/loader.js';
import { parseCordisPatch, hasPatchDeclared } from '../src/plugins/runtime/patch.js';
import { PluginHost, diagnose } from '../src/plugins/runtime/plugin-host.js';
import { registerContext, unregisterContext, bindCuckooEvents } from '../src/plugins/runtime/compat/bridge.js';

/** 一个假的宿主能力 */
function fakeHost() {
  return {
    sent: [],
    async sendToChat(text) { this.sent.push(text); return true; },
    getCurrentSessionId: () => 'session-1',
    getProjectDir: () => 'D:/proj',
    listSessions: () => [{ id: 'session-1', title: 't' }],
    listTools: () => ['read', 'write'],
    getSetting: () => undefined,
    setSetting: () => {},
  };
}

describe('EventBus - 5 种派发模式', () => {
  let bus;
  beforeEach(() => { bus = new EventBus(); });

  it('emit 同步广播', () => {
    let got = null;
    bus.on('x', (v) => { got = v; });
    bus.emit('x', 42);
    expect(got).toBe(42);
  });

  it('parallel 并发收集返回值', async () => {
    bus.on('x', async () => 1);
    bus.on('x', async () => 2);
    const r = await bus.parallel('x');
    expect(r).toEqual([1, 2]);
  });

  it('serial 返回第一个非空', async () => {
    bus.on('x', async () => undefined);
    bus.on('x', async () => 'first');
    bus.on('x', async () => 'second');
    const r = await bus.serial('x');
    expect(r).toBe('first');
  });

  it('bail 同步版 serial', () => {
    bus.on('x', () => undefined);
    bus.on('x', () => 'found');
    const r = bus.bail('x');
    expect(r).toBe('found');
  });

  it('waterfall 环绕中间件', async () => {
    bus.on('x', async (val, next) => { return next(val + 1); });
    bus.on('x', async (val, next) => { return next(val * 2); });
    const r = await bus.waterfall('x', 1);
    // (1+1)*2 = 4
    expect(r).toBe(4);
  });

  it('on 返回 disposer 可取消', () => {
    let count = 0;
    const d = bus.on('x', () => { count++; });
    bus.emit('x');
    d();
    bus.emit('x');
    expect(count).toBe(1);
  });

  it('once 只触发一次', () => {
    let count = 0;
    bus.once('x', () => { count++; });
    bus.emit('x');
    bus.emit('x');
    expect(count).toBe(1);
  });
});

describe('createContext - 服务', () => {
  it('agents.followup 调用 sendToChat', async () => {
    const host = fakeHost();
    const ctx = createContext('test', host);
    const agent = ctx.agents.get();
    const ok = await agent.followup({ role: 'user', content: '你好' });
    expect(ok).toBe(true);
    expect(host.sent).toEqual(['你好']);
  });

  it('sessions.current 返回会话与项目', () => {
    const ctx = createContext('test', fakeHost());
    const cur = ctx.sessions.current();
    expect(cur.id).toBe('session-1');
    expect(cur.projectDir).toBe('D:/proj');
  });

  it('tools.list 返回工具名', () => {
    const ctx = createContext('test', fakeHost());
    expect(ctx.tools.list()).toContain('read');
  });

  it('settings 读写', () => {
    let store = {};
    const host = fakeHost();
    host.getSetting = (k) => store[k];
    host.setSetting = (k, v) => { store[k] = v; };
    const ctx = createContext('test', host);
    ctx.settings.set('foo', 'bar');
    expect(ctx.settings.get('foo')).toBe('bar');
  });
});

describe('loadPluginModule - 入口契约', () => {
  it('加载命名导出插件', () => {
    const activated = [];
    const mod = {
      name: 'my-plugin',
      inject: ['agents'],
      apply(ctx) { activated.push(ctx.name); },
    };
    const p = loadPluginModule(mod, fakeHost());
    expect(p.name).toBe('my-plugin');
    expect(activated).toEqual(['my-plugin']);
  });

  it('缺 apply 时报错', () => {
    const r = safeLoad(() => loadPluginModule({ name: 'x' }, fakeHost()));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/apply/);
  });

  it('inject 任意服务名不再报错（DSH 允许自定义服务）', () => {
    const mod = { name: 'x', inject: ['not-exist'], apply() {} };
    const r = safeLoad(() => loadPluginModule(mod, fakeHost()));
    expect(r.ok).toBe(true);
  });

  it('inject 非法格式（空串）报错', () => {
    const mod = { name: 'x', inject: [''], apply() {} };
    const r = safeLoad(() => loadPluginModule(mod, fakeHost()));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/inject/);
  });

  it('裸 default 导出被拒', () => {
    const mod = { default: () => {} };
    const r = safeLoad(() => loadPluginModule(mod, fakeHost()));
    expect(r.ok).toBe(false);
  });
});

describe('parseCordisPatch', () => {
  it('解析单个 insert', () => {
    const yml = `- insert:
    - id: dsh-market
      name: 'dshmarket'
`;
    const r = parseCordisPatch(yml);
    expect(r.ok).toBe(true);
    expect(r.inserts.length).toBe(1);
    expect(r.inserts[0].id).toBe('dsh-market');
    expect(r.inserts[0].name).toBe('dshmarket');
  });

  it('解析多个 insert + config', () => {
    const yml = `- insert:
    - id: a
      name: 'pkg-a'
      config:
        foo: 1
        bar: true
    - id: b
      name: 'pkg-b'
`;
    const r = parseCordisPatch(yml);
    expect(r.inserts.length).toBe(2);
    expect(r.inserts[0].id).toBe('a');
    expect(r.inserts[0].config.foo).toBe(1);
    expect(r.inserts[0].config.bar).toBe(true);
    expect(r.inserts[1].id).toBe('b');
  });

  it('空输入', () => {
    const r = parseCordisPatch('');
    expect(r.ok).toBe(true);
    expect(r.inserts.length).toBe(0);
  });

  it('非字符串报错', () => {
    const r = parseCordisPatch(null);
    expect(r.ok).toBe(false);
  });
});

describe('hasPatchDeclared', () => {
  it('识别 dsh.bundle.patch', () => {
    expect(hasPatchDeclared({ dsh: { bundle: { patch: './cordis.patch.yml' } } })).toBe(true);
    expect(hasPatchDeclared({ dsh: {} })).toBe(false);
    expect(hasPatchDeclared({})).toBe(false);
  });
});


describe('ctx.effect - 可逆副作用', () => {
  it('卸载时自动执行 cleanup', () => {
    let cleaned = false;
    const ctx = createContext('t', fakeHost());
    ctx.effect(() => () => { cleaned = true; });
    ctx.__dispose();
    expect(cleaned).toBe(true);
  });

  it('无返回值时安全', () => {
    const ctx = createContext('t', fakeHost());
    expect(() => ctx.effect(() => {})).not.toThrow();
  });
});

describe('ctx.provide/get/inject - 服务', () => {
  it('provide 后 get 可取到', () => {
    const ctx = createContext('t', fakeHost());
    ctx.provide('my-service', { hello: () => 'hi' });
    expect(ctx.get('my-service').hello()).toBe('hi');
  });

  it('inject 在服务就绪时回调', () => {
    const reg = new ServiceRegistryImpl();
    const ctxA = createContext('a', fakeHost(), reg);
    const ctxB = createContext('b', fakeHost(), reg);
    let ready = false;
    ctxB.inject(['shared'], () => { ready = true; });
    expect(ready).toBe(false);
    ctxA.provide('shared', { x: 1 });
    expect(ready).toBe(true);
  });
});


describe('PluginHost - 统一插件管理', () => {
  it('加载多个插件', () => {
    const host = new PluginHost(fakeHost());
    const r = host.loadAll([
      { name: 'p1', kind: 'dsh', source: `export const name = 'p1'; export function apply() {}` },
      { name: 'p2', kind: 'ui', source: `export const name = 'p2'; export function apply() {}` },
    ]);
    expect(r.loaded).toEqual(['p1', 'p2']);
    expect(host.stats()).toEqual({ total: 2, dsh: 1, ui: 1, failed: 0 });
  });

  it('加载失败被记录', () => {
    const host = new PluginHost(fakeHost());
    const r = host.loadAll([{ name: 'bad', kind: 'dsh', source: `export const name = 'bad';` }]);
    expect(r.loaded).toEqual([]);
    expect(r.failed.length).toBe(1);
    expect(host.stats().failed).toBe(1);
  });

  it('卸载插件', () => {
    const host = new PluginHost(fakeHost());
    host.load({ name: 'x', kind: 'dsh', source: `export const name = 'x'; export function apply() {}` });
    expect(host.list()).toEqual(['x']);
    expect(host.unload('x')).toBe(true);
    expect(host.list()).toEqual([]);
  });

  it('跨插件服务注入', () => {
    const host = new PluginHost(fakeHost());
    host.load({
      name: 'provider', kind: 'dsh',
      source: `export const name = 'provider'; export function apply(ctx) { ctx.provide('svc', { v: 42 }); }`,
    });
    let got = null;
    host.load({
      name: 'consumer', kind: 'dsh',
      source: `export const name = 'consumer'; export function apply(ctx) { got = ctx.get('svc'); }`,
    });
    // consumer 加载后能取到 provider 提供的服务
    const ctxC = host.getContext('consumer');
    expect(ctxC.get('svc').v).toBe(42);
  });

  it('重复加载同名插件被拒', () => {
    const host = new PluginHost(fakeHost());
    const src = `export const name = 'dup'; export function apply() {}`;
    expect(host.load({ name: 'dup', kind: 'dsh', source: src }).ok).toBe(true);
    expect(host.load({ name: 'dup', kind: 'dsh', source: src }).ok).toBe(false);
  });
});


describe('PluginHost - UI 插件能力', () => {
  it('UI 插件拿到 ctx.ui', () => {
    // 模拟 DOM
    global.document = {
      createElement: () => ({ id: '', style: {}, setAttribute: () => {}, appendChild: () => {}, isConnected: true }),
      getElementById: () => null,
      body: { appendChild: () => {} },
      head: { appendChild: () => {} },
    };
    const host = new PluginHost(fakeHost());
    host.load({
      name: 'ui-p', kind: 'ui',
      source: `export const name = 'ui-p'; export function apply(ctx) {}`,
    });
    // 直接检查该插件 ctx 上有无 ui 能力
    const c = host.getContext('ui-p');
    expect(!!(c.ui && c.ui.mount)).toBe(true);
  });
});


describe('事件桥 - bindCuckooEvents', () => {
  it('Cuckoo 事件转发为 DSH 事件名', () => {
    const received = [];
    const ctx = createContext('listener', fakeHost());
    registerContext(ctx);
    ctx.on('session/event', (rec) => received.push(['session', rec.type]));
    ctx.on('tool/result', (r) => received.push(['tool', r.success]));

    // 模拟 Cuckoo 事件源
    let respCb = null, toolCb = null;
    const src = {
      onInterceptedResponse: (cb) => { respCb = cb; return () => {}; },
      onStream: () => () => {},
      onTaskIdle: () => () => {},
      onToolCall: (cb) => { toolCb = cb; return () => {}; },
    };
    bindCuckooEvents(src);

    respCb('hello', { tokenUsage: { accumulatedTokens: 100 } });
    toolCb({ phase: 'end', code: 'read', success: true });

    expect(received).toContainEqual(['session', 'assistant/message']);
    expect(received).toContainEqual(['tool', true]);
    unregisterContext(ctx);
  });
});


describe('ctx.scope - 子作用域', () => {
  it('scope 内 effect 独立清理', () => {
    const ctx = createContext('t', fakeHost());
    let cleaned = false;
    const s = ctx.scope();
    s.effect(() => () => { cleaned = true; });
    expect(cleaned).toBe(false);
    s.dispose();
    expect(cleaned).toBe(true);
    expect(s.disposed).toBe(true);
  });

  it('父 dispose 时子 scope 一起销毁', () => {
    const ctx = createContext('t', fakeHost());
    let cleaned = false;
    const s = ctx.scope();
    s.effect(() => () => { cleaned = true; });
    ctx.__dispose();
    expect(cleaned).toBe(true);
  });

  it('scope 内事件监听 dispose 时移除', () => {
    const ctx = createContext('t', fakeHost());
    let count = 0;
    const s = ctx.scope();
    s.on('x', () => { count++; });
    ctx.emit('x');
    s.dispose();
    ctx.emit('x');
    expect(count).toBe(1);
  });
});


describe('依赖等待 - inject 服务就绪才 apply', () => {
  it('服务未就绪时不 apply，就绪后才 apply', () => {
    const reg = new ServiceRegistryImpl();
    let applied = false;
    const mod = {
      name: 'waiter',
      inject: ['later-svc'],
      apply() { applied = true; },
    };
    // 用 loadPluginModule（带 registry）
    loadPluginModule(mod, fakeHost(), undefined, reg);
    // 服务未就绪 → 还没 apply
    expect(applied).toBe(false);
    // 提供服务 → 触发 apply
    reg.provide('later-svc', { ok: true });
    expect(applied).toBe(true);
  });

  it('服务已就绪时立即 apply', () => {
    const reg = new ServiceRegistryImpl();
    reg.provide('ready-svc', {});
    let applied = false;
    const mod = { name: 'immediate', inject: ['ready-svc'], apply() { applied = true; } };
    loadPluginModule(mod, fakeHost(), undefined, reg);
    expect(applied).toBe(true);
  });
});


describe('卸载清理 - 服务注销', () => {
  it('插件卸载后服务被注销', () => {
    const reg = new ServiceRegistryImpl();
    const ctx = createContext('svc-provider', fakeHost(), reg);
    ctx.provide('temp-svc', { v: 1 });
    expect(reg.has('temp-svc')).toBe(true);
    ctx.__dispose();
    expect(reg.has('temp-svc')).toBe(false);
  });
});


describe('diagnose - 可操作错误诊断', () => {
  it('ESM 残留', () => {
    const d = diagnose("Unexpected token 'export'", { name: 'x', kind: 'dsh' });
    expect(d).toMatch(/ESM/);
  });
  it('缺 apply', () => {
    const d = diagnose('插件缺少 apply(ctx, config) 入口函数', { name: 'x', kind: 'dsh' });
    expect(d).toMatch(/缺入口/);
  });
  it('裸 default', () => {
    const d = diagnose('插件用裸 export default 导出', { name: 'x', kind: 'dsh' });
    expect(d).toMatch(/导出方式/);
  });
  it('其他错误原样带前缀', () => {
    const d = diagnose('some random error', { name: 'x', kind: 'ui' });
    expect(d).toMatch(/ui 插件加载失败/);
  });
});


describe('ctx.assets + ctx.ui.injectScript（UI 插件资源能力）', () => {
  it('UI 插件拿到 ctx.assets 和 injectScript', () => {
    // 模拟 DOM
    global.document = {
      createElement: () => ({ id: '', style: {}, setAttribute: () => {}, appendChild: () => {}, isConnected: true, textContent: '', src: '' }),
      getElementById: () => null,
      body: { appendChild: () => {} },
      head: { appendChild: () => {} },
    };
    global.window = { addEventListener: () => {}, removeEventListener: () => {}, innerWidth: 800, innerHeight: 600 };
    global.Blob = class {};
    global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
    global.atob = (s) => Buffer.from(s, 'base64').toString('binary');

    const host = new PluginHost({
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => 'D:/p',
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    });
    host.load({ name: 'ui-assets', kind: 'ui', source: `export const name = 'ui-assets'; export function apply(ctx) {}` });
    const c = host.getContext('ui-assets');
    expect(typeof c.ui.injectScript).toBe('function');
    expect(typeof c.ui.injectScriptSrc).toBe('function');
    expect(typeof c.assets.read).toBe('function');
    expect(typeof c.assets.url).toBe('function');
  });
});


describe('ctx.tools.register（插件注册工具）', () => {
  it('注册接口存在且记录工具', () => {
    const registered = [];
    const host = {
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => 'D:/p',
      listSessions: () => [], listTools: () => [],
      getSetting: () => undefined, setSetting: () => {},
      registerPluginTool: (pluginName, tool) => {
        registered.push({ pluginName, name: tool.name });
        return () => {};
      },
    };
    const ctx = createContext('tool-plugin', host);
    const dispose = ctx.tools.register({
      name: 'my-tool',
      description: '测试工具',
      execute: async () => 'ok',
    });
    expect(registered.length).toBe(1);
    expect(registered[0].name).toBe('my-tool');
    expect(typeof dispose).toBe('function');
  });

  it('缺 name 抛错', () => {
    const ctx = createContext('tool-plugin', fakeHost());
    expect(() => ctx.tools.register({ description: 'x', execute: () => {} })).toThrow();
  });

  it('缺 execute 抛错', () => {
    const ctx = createContext('tool-plugin', fakeHost());
    expect(() => ctx.tools.register({ name: 'x', description: 'x' })).toThrow();
  });
});


describe('类形式插件（extends Service）', () => {
  it('类形式插件提供服务', () => {
    const reg = new ServiceRegistryImpl();
    const src = `
import { Service } from 'cuckoo'
export default class Metrics extends Service {
  static inject = []
  constructor(ctx) {
    super(ctx, 'metrics')
  }
  record(x) { return 'recorded:' + x }
}
`;
    const mod = { exports: {} };
    const fn = new Function('module', 'exports', 'require', `
const { Service } = require('cuckoo');
exports.default = class Metrics extends Service {
  constructor(ctx) { super(ctx, 'metrics'); }
  record(x) { return 'recorded:' + x; }
};
`);
    fn(mod, mod.exports, (id) => {
      if (id === 'cuckoo') return { Service };
      throw new Error('no: ' + id);
    });
    const host = {
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => 'D:/p',
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    };
    const p = loadPluginModule(mod.exports, host, undefined, reg);
    expect(p.name).toBe('Metrics');
    // 服务已注册
    expect(reg.has('metrics')).toBe(true);
    expect(reg.get('metrics').record('x')).toBe('recorded:x');
  });

  it('esmToCjs 转换 import + class', () => {
    const src = `import { Service } from 'cuckoo'
export default class X extends Service {
  constructor(ctx) { super(ctx, 'x') }
}`;
    const cjs = esmToCjs(src);
    expect(cjs).toContain("require('cuckoo')");
    expect(cjs).toContain('exports.default =');
    expect(cjs).not.toMatch(/\bimport\b/);
    expect(cjs).not.toMatch(/\bexport\b/);
  });
});


describe('T4 服务移除→依赖者卸载', () => {
  it('依赖服务被移除时，依赖它的插件被卸载', () => {
    const host = new PluginHost({
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => 'D:/p',
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    });
    // provider 提供服务
    host.load({ name: 'prov', kind: 'dsh',
      source: `export const name = 'prov'; export function apply(ctx) { ctx.provide('svc-x', { v: 1 }); }` });
    // consumer 依赖 svc-x
    host.load({ name: 'cons', kind: 'dsh',
      source: `export const name = 'cons'; export const inject = ['svc-x']; export function apply(ctx) {}` });
    expect(host.list()).toContain('cons');

    // 移除 provider（其 provide 的 disposer 在 dispose 时触发 onRemove）
    host.unload('prov');
    // 依赖 svc-x 的 cons 应被卸载
    expect(host.list()).not.toContain('cons');
  });
});


describe('T5/T6 agents/sessions 核心能力', () => {
  it('agents.get/current/send/followup/status/session', async () => {
    const sent = [];
    const host = {
      sendToChat: async (t) => { sent.push(t); return true; },
      getCurrentSessionId: () => 'sess-1', getProjectDir: () => 'D:/proj',
      listSessions: () => [{ id: 'sess-1', title: 't1' }, { id: 'sess-2' }],
      listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    };
    const ctx = createContext('t', host);
    const a = ctx.agents.current();
    expect(a.id).toBe('sess-1');
    expect(a.status).toBe('idle');
    expect(a.session.id).toBe('sess-1');
    expect(a.session.projectDir).toBe('D:/proj');
    await a.followup({ role: 'user', content: 'hi' });
    await a.send({ role: 'user', content: 'yo' });
    expect(sent).toEqual(['hi', 'yo']);
  });

  it('sessions.get 按 id 找', () => {
    const host = {
      sendToChat: async () => true, getCurrentSessionId: () => 'sess-1', getProjectDir: () => null,
      listSessions: () => [{ id: 'sess-1', title: 't1' }, { id: 'sess-2' }],
      listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    };
    const ctx = createContext('t', host);
    expect(ctx.sessions.get('sess-2').id).toBe('sess-2');
    expect(ctx.sessions.get('nope')).toBe(null);
  });
});


describe('T9 对象形式插件', () => {
  it('export default { name, inject, apply }', () => {
    const mod = {
      default: {
        name: 'obj-plugin',
        inject: [],
        apply(ctx) { /* ok */ },
      },
    };
    const host = {
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => null,
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    };
    const p = loadPluginModule(mod, host);
    expect(p.name).toBe('obj-plugin');
  });
});


describe('T7/T8 插件 config（来自 cordis.patch.yml）', () => {
  it('parseCordisPatch 解析 config 字段', () => {
    const yml = `- insert:
    - id: my-plugin
      name: my-plugin
      config:
        greeting: hello
        count: 3
`;
    const r = parseCordisPatch(yml);
    expect(r.ok).toBe(true);
    expect(r.inserts[0].config.greeting).toBe('hello');
    expect(r.inserts[0].config.count).toBe(3);
  });

  it('config 传给 apply(ctx, config)', () => {
    const cfg = { greeting: 'hi' };
    let got = null;
    const mod = { name: 'cfg-plugin', apply: (ctx, c) => { got = c; } };
    const host = {
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => null,
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    };
    loadPluginModule(mod, host, cfg);
    expect(got).toEqual(cfg);
  });
});


describe('内置服务 inject 必须能触发 apply（根因修复）', () => {
  it('inject [agents] 时 apply 立即执行（内置服务视为就绪）', () => {
    let applied = false;
    const reg = new ServiceRegistryImpl();
    const mod = {
      name: 'builtin-inject',
      inject: ['agents'],
      apply() { applied = true; },
    };
    const host = {
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => null,
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    };
    loadPluginModule(mod, host, undefined, reg);
    // agents 是内置服务，应视为就绪，apply 立即跑
    expect(applied).toBe(true);
  });

  it('inject 自定义未就绪服务时仍推迟', () => {
    let applied = false;
    const reg = new ServiceRegistryImpl();
    const mod = { name: 'custom-inject', inject: ['not-ready'], apply() { applied = true; } };
    const host = {
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => null,
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    };
    loadPluginModule(mod, host, undefined, reg);
    expect(applied).toBe(false);
    reg.provide('not-ready', {});
    expect(applied).toBe(true);
  });
});


describe('ctx.ui.overlay（插件覆盖层能力）', () => {
  function mockDom() {
    global.document = {
      createElement: () => ({ id: '', style: {}, setAttribute: () => {}, appendChild: () => {}, isConnected: true, textContent: '', src: '' }),
      getElementById: () => null,
      body: { appendChild: () => {} },
      head: { appendChild: () => {} },
    };
    global.window = {
      addEventListener: () => {}, removeEventListener: () => {},
      innerWidth: 800, innerHeight: 600,
      electronAPI: undefined,
    };
    global.Blob = class {};
    global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
    global.atob = (s) => Buffer.from(s, 'base64').toString('binary');
  }

  it('UI 插件拿到 ctx.ui.overlay（三个方法）', () => {
    mockDom();
    const host = new PluginHost({
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => 'D:/p',
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    });
    host.load({ name: 'ui-ov', kind: 'ui', source: `export const name = 'ui-ov'; export function apply(ctx) {}` });
    const c = host.getContext('ui-ov');
    expect(!!(c.ui && c.ui.overlay)).toBe(true);
    expect(typeof c.ui.overlay.init).toBe('function');
    expect(typeof c.ui.overlay.eval).toBe('function');
    expect(typeof c.ui.overlay.html).toBe('function');
  });

  it('overlay.init：electronAPI 不可用时优雅返回，不抛', async () => {
    mockDom();
    global.window.electronAPI = undefined;
    const host = new PluginHost({
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => 'D:/p',
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    });
    host.load({ name: 'ui-ov2', kind: 'ui', source: `export const name = 'ui-ov2'; export function apply(ctx) {}` });
    const c = host.getContext('ui-ov2');
    const r = await c.ui.overlay.init();
    expect(r && r.success).toBe(false);
    expect(typeof r.error).toBe('string');
  });

  it('overlay.init：有 electronAPI 时透传结果', async () => {
    mockDom();
    let called = 0;
    global.window.electronAPI = {
      overlayInit: async () => { called++; return { success: true }; },
      overlayEval: async (code) => { called++; return { success: true, result: code }; },
      overlayHtml: async (html) => { called++; return { success: true }; },
    };
    const host = new PluginHost({
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => 'D:/p',
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    });
    host.load({ name: 'ui-ov3', kind: 'ui', source: `export const name = 'ui-ov3'; export function apply(ctx) {}` });
    const c = host.getContext('ui-ov3');
    const r = await c.ui.overlay.init();
    expect(r.success).toBe(true);
    expect(called).toBe(1);
  });

  it('overlay.eval：把 code 透传给 electronAPI 并返回结果', async () => {
    mockDom();
    let gotCode = null;
    global.window.electronAPI = {
      overlayInit: async () => ({ success: true }),
      overlayEval: async (code) => { gotCode = code; return { success: true, result: 42 }; },
      overlayHtml: async () => ({ success: true }),
    };
    const host = new PluginHost({
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => 'D:/p',
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    });
    host.load({ name: 'ui-ov4', kind: 'ui', source: `export const name = 'ui-ov4'; export function apply(ctx) {}` });
    const c = host.getContext('ui-ov4');
    const r = await c.ui.overlay.eval('1 + 1');
    expect(gotCode).toBe('1 + 1');
    expect(r.result).toBe(42);
  });

  it('overlay.html：把 html 透传', async () => {
    mockDom();
    let gotHtml = null;
    global.window.electronAPI = {
      overlayInit: async () => ({ success: true }),
      overlayEval: async () => ({ success: true }),
      overlayHtml: async (html) => { gotHtml = html; return { success: true }; },
    };
    const host = new PluginHost({
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => 'D:/p',
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    });
    host.load({ name: 'ui-ov5', kind: 'ui', source: `export const name = 'ui-ov5'; export function apply(ctx) {}` });
    const c = host.getContext('ui-ov5');
    await c.ui.overlay.html('<div>x</div>');
    expect(gotHtml).toBe('<div>x</div>');
  });
});


describe('ctx.webServer（本地 HTTP · 静态资源）', () => {
  function mockDom() {
    global.document = {
      createElement: () => ({ id: '', style: {}, setAttribute: () => {}, appendChild: () => {}, isConnected: true, textContent: '', src: '' }),
      getElementById: () => null,
      body: { appendChild: () => {} },
      head: { appendChild: () => {} },
    };
    global.window = { addEventListener: () => {}, removeEventListener: () => {}, innerWidth: 800, innerHeight: 600 };
    global.Blob = class {};
    global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
    global.atob = (s) => Buffer.from(s, 'base64').toString('binary');
  }

  it('UI 插件拿到 ctx.webServer（serve/info）', () => {
    mockDom();
    const host = new PluginHost({
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => 'D:/p',
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    });
    host.load({ name: 'ws-p', kind: 'ui', source: `export const name = 'ws-p'; export function apply(ctx) {}` });
    const c = host.getContext('ws-p');
    expect(!!(c.webServer)).toBe(true);
    expect(typeof c.webServer.serve).toBe('function');
    expect(typeof c.webServer.info).toBe('function');
  });

  it('webServer 不可用时优雅返回，不抛', async () => {
    mockDom();
    global.window.electronAPI = undefined;
    const host = new PluginHost({
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => 'D:/p',
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    });
    host.load({ name: 'ws-p2', kind: 'ui', source: `export const name = 'ws-p2'; export function apply(ctx) {}` });
    const c = host.getContext('ws-p2');
    const r = await c.webServer.serve('/assets', 'assets');
    expect(r && r.success).toBe(false);
  });

  it('webServer.serve 透传给 electronAPI', async () => {
    mockDom();
    let got = null;
    global.window.electronAPI = {
      webServerServe: async (pluginId, prefix, dir) => { got = { pluginId, prefix, dir }; return { success: true, url: 'http://127.0.0.1:9/x', port: 9 }; },
      webServerInfo: async () => ({ success: true, base: 'http://127.0.0.1:9', port: 9 }),
    };
    const host = new PluginHost({
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => 'D:/p',
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    });
    host.load({ name: 'ws-p3', kind: 'ui', source: `export const name = 'ws-p3'; export function apply(ctx) {}` });
    const c = host.getContext('ws-p3');
    const r = await c.webServer.serve('/assets', 'assets');
    expect(r.success).toBe(true);
    expect(got.pluginId).toBe('ws-p3');
    expect(got.prefix).toBe('/assets');
    expect(got.dir).toBe('assets');
  });
});

describe('ctx.ui.shell（Cuckoo 界面挂载）', () => {
  function mockDom() {
    global.document = {
      createElement: () => ({ id: '', style: {}, setAttribute: () => {}, appendChild: () => {}, isConnected: true, textContent: '', src: '' }),
      getElementById: () => null,
      body: { appendChild: () => {} },
      head: { appendChild: () => {} },
    };
    global.window = { addEventListener: () => {}, removeEventListener: () => {}, innerWidth: 800, innerHeight: 600 };
    global.Blob = class {};
    global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
    global.atob = (s) => Buffer.from(s, 'base64').toString('binary');
  }

  it('UI 插件拿到 ctx.ui.shell（三个方法）', () => {
    mockDom();
    const host = new PluginHost({
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => 'D:/p',
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    });
    host.load({ name: 'sh-p', kind: 'ui', source: `export const name = 'sh-p'; export function apply(ctx) {}` });
    const c = host.getContext('sh-p');
    expect(!!(c.ui && c.ui.shell)).toBe(true);
    expect(typeof c.ui.shell.addSidebarPanel).toBe('function');
    expect(typeof c.ui.shell.addStatusItem).toBe('function');
    expect(typeof c.ui.shell.addToolbarButton).toBe('function');
  });

  it('addStatusItem 透传 target=statusbar + pluginId', async () => {
    mockDom();
    let got = null;
    global.window.electronAPI = {
      shellMount: async (pluginId, target, id, spec) => { got = { pluginId, target, id }; return { success: true }; },
    };
    const host = new PluginHost({
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => 'D:/p',
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    });
    host.load({ name: 'sh-p2', kind: 'ui', source: `export const name = 'sh-p2'; export function apply(ctx) {}` });
    const c = host.getContext('sh-p2');
    await c.ui.shell.addStatusItem({ id: 'x', text: 'hi' });
    expect(got.pluginId).toBe('sh-p2');
    expect(got.target).toBe('statusbar');
    expect(got.id).toBe('x');
  });

  it('addToolbarButton 透传 target=toolbar', async () => {
    mockDom();
    let got = null;
    global.window.electronAPI = {
      shellMount: async (pluginId, target, id, spec) => { got = { pluginId, target, id }; return { success: true }; },
    };
    const host = new PluginHost({
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => 'D:/p',
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    });
    host.load({ name: 'sh-p3', kind: 'ui', source: `export const name = 'sh-p3'; export function apply(ctx) {}` });
    const c = host.getContext('sh-p3');
    await c.ui.shell.addToolbarButton({ id: 'b', label: 'Hi' });
    expect(got.target).toBe('toolbar');
  });
});

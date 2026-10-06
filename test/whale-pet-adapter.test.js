/**
 * 桌宠适配器测试（模拟 DOM，不启动 Electron）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadPluginSource } from '../src/plugins/runtime/loader.js';

/** 极简 DOM 模拟 */
function fakeDom() {
  const created = [];
  const listeners = {};
  global.document = {
    createElement: (tag) => {
      const el = {
        tagName: tag, id: '', style: { cssText: '' }, children: [],
        setAttribute: () => {}, appendChild: (c) => el.children.push(c),
        isConnected: true,
      };
      created.push(el);
      return el;
    },
    getElementById: () => null,
    body: { appendChild: () => {} },
    head: { appendChild: () => {} },
  };
  global.window = {
    dispatchEvent: (ev) => { (listeners[ev.type] = listeners[ev.type] || []).push(ev.detail); return true; },
    addEventListener: (t, cb) => { (listeners[t] = listeners[t] || []).push(cb); },
    removeEventListener: () => {},
    innerWidth: 1920, innerHeight: 1080,
  };
  global.CustomEvent = class { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } };
  return { created, listeners };
}

function fakeHost() {
  return {
    sendToChat: async () => true,
    getCurrentSessionId: () => 's1',
    getProjectDir: () => 'D:/p',
    listSessions: () => [],
    listTools: () => [],
    getSetting: () => undefined,
    setSetting: () => {},
  };
}

describe('鲸鱼娘桌宠适配器', () => {
  beforeEach(() => { fakeDom(); });

  it('能加载并挂载容器', () => {
    const src = `export const name = 'whale-pet'; export const inject = ['agents'];
export function apply(ctx) {
  const c = document.createElement('div'); c.id = 'cuckoo-whale-pet';
  if (ctx.ui && ctx.ui.mount) ctx.ui.mount(c);
}`;
    const p = loadPluginSource(src, fakeHost(), 'whale-pet');
    expect(p.name).toBe('whale-pet');
  });
});

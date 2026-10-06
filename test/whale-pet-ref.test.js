
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PluginHost } from '../src/plugins/runtime/plugin-host.js';

describe('参考实现 - 桌宠 UI 插件', () => {
  it('能加载参考实现源码', () => {
    global.document = {
      createElement: () => ({ id: '', style: {}, classList: { toggle: () => {}, add: () => {}, remove: () => {} }, addEventListener: () => {}, appendChild: () => {}, setAttribute: () => {}, textContent: '', isConnected: true }),
      getElementById: () => null,
      body: { appendChild: () => {} },
      head: { appendChild: () => {} },
    };
    global.setInterval = () => 0;
    global.clearInterval = () => {};
    global.setTimeout = () => 0;
    global.clearTimeout = () => {};

    const src = fs.readFileSync(path.join(__dirname, '..', 'examples', 'whale-pet-demo.js'), 'utf-8');
    const host = new PluginHost({
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => 'D:/p',
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    });
    const r = host.load({ name: 'whale-pet-demo', source: src, kind: 'ui' });
    expect(r.ok).toBe(true);
    expect(host.getContext('whale-pet-demo')).toBeTruthy();
  });
});


import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PluginHost } from '../src/plugins/runtime/plugin-host.js';

describe('服务提供/消费示例', () => {
  it('consumer 等到 provider 的服务就绪', () => {
    global.document = { createElement: () => ({ style: {}, appendChild: () => {}, setAttribute: () => {}, isConnected: true }), getElementById: () => null, body: { appendChild: () => {} }, head: { appendChild: () => {} } };
    const base = path.join(__dirname, '..', 'examples');
    const provSrc = fs.readFileSync(path.join(base, 'service-provider.js'), 'utf-8');
    const consSrc = fs.readFileSync(path.join(base, 'service-consumer.js'), 'utf-8');

    const host = new PluginHost({
      sendToChat: async () => true, getCurrentSessionId: () => 's', getProjectDir: () => 'D:/p',
      listSessions: () => [], listTools: () => [], getSetting: () => undefined, setSetting: () => {},
    });
    const r = host.loadAll([
      { name: 'provider', source: provSrc, kind: 'dsh' },
      { name: 'consumer', source: consSrc, kind: 'dsh' },
    ]);
    console.log('LOADED:', JSON.stringify(r.loaded));
    console.log('FAILED:', JSON.stringify(r.failed));
    console.log('HOST LIST:', JSON.stringify(host.list()));
    expect(r.loaded).toContain('provider');
    expect(r.loaded).toContain('consumer');
    // consumer 能取到 provider 的服务
    // 插件的 name 由它自己导出（example-service-consumer）
    const cCtx = host.getContext('example-service-consumer');
    expect(cCtx.get('greeter')).toBeTruthy();
  });
});

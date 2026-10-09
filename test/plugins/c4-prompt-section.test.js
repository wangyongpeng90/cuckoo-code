/**
 * C4-A 测试：DSH 插件的 ctx.systemPrompt.section 注册提示词段。
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCuckooPlugin } from '../../src/plugins/cuckoo-plugins/loader.js';
import { getPromptSections, clearPromptSections } from '../../src/plugins/dsh-compat/prompt-sections.js';

function makePluginDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-c4-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'c4-test', version: '1.0.0', main: 'index.js' }), 'utf-8');
  fs.writeFileSync(path.join(dir, 'index.js'), [
    "export const name = 'c4-test';",
    "export function apply(ctx) {",
    "  ctx.systemPrompt.section({ name: 'my-rule', order: 42, text: '永远用中文回答。' });",
    "  ctx.systemPrompt.section({ name: 'another', order: 10, text: '你是 Cuckoo。' });",
    "}",
  ].join('\n'), 'utf-8');
  return dir;
}

test('C4：插件 ctx.systemPrompt.section 注册提示词段', async () => {
  clearPromptSections();
  const dir = makePluginDir();
  try {
    await loadCuckooPlugin(dir);
    const secs = getPromptSections();
    assert.strictEqual(secs.length, 2);
    // 按 order 排序：another(10) < my-rule(42)
    assert.strictEqual(secs[0].name, 'another');
    assert.strictEqual(secs[0].text, '你是 Cuckoo。');
    assert.strictEqual(secs[1].name, 'my-rule');
    assert.strictEqual(secs[1].text, '永远用中文回答。');
    assert.strictEqual(secs[0].plugin, 'c4-test');
  } finally {
    clearPromptSections();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

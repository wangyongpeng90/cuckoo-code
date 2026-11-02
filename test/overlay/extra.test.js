import { test } from 'vitest';
import assert from 'node:assert';

test('randomDelay 返回 10000-19999ms', async () => {
  const { randomDelay } = await import('../../src/overlay/chat-input.js');
  for (let i = 0; i < 10; i++) {
    const d = randomDelay();
    assert.ok(d >= 10000 && d <= 19999);
  }
});

test('updateProjectDirDisplay 更新显示', async () => {
  const span = { textContent: '' };
  const section = { style: {} };
  global.document = {
    getElementById: (id) => id === 'cuckoo-project-dir-display' ? { querySelector: () => span } : null,
    querySelector: (sel) => sel === '.cuckoo-project-dir-section' ? section : null,
  };
  const { updateProjectDirDisplay } = await import('../../src/overlay/project-dir.js');
  updateProjectDirDisplay('C:\\proj');
  assert.strictEqual(span.textContent, 'C:\\proj');
  assert.strictEqual(section.style.display, '');
  updateProjectDirDisplay(null);
  assert.strictEqual(span.textContent, '未选择');
  assert.strictEqual(section.style.display, 'none');
});

test('renderSessions API 不可用显示提示', async () => {
  const el = { innerHTML: '' };
  global.document = { getElementById: () => el };
  global.window = {};
  const { renderSessions } = await import('../../src/overlay/session-list.js');
  await renderSessions();
  assert.match(el.innerHTML, /API 不可用/);
});

test('renderSessions 无会话显示暂无', async () => {
  const el = { innerHTML: '', querySelectorAll: () => [] };
  global.document = { getElementById: () => el };
  global.window = { electronAPI: { listSessions: async () => ({ success: true, sessions: [] }) } };
  const { renderSessions } = await import('../../src/overlay/session-list.js');
  await renderSessions();
  assert.match(el.innerHTML, /暂无会话/);
});

test('renderSessions 有会话渲染并绑定', async () => {
  const el = { innerHTML: '', querySelectorAll: () => [] };
  const mkEl = () => {
    let text = '';
    return {
      set textContent(v) { text = String(v); },
      get textContent() { return text; },
      get innerHTML() { return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); },
      set innerHTML(v) {},
      style: {},
    };
  };
  global.document = { getElementById: () => el, createElement: () => mkEl() };
  global.window = { electronAPI: { listSessions: async () => ({ success: true, sessions: ['abc'] }) } };
  const { renderSessions } = await import('../../src/overlay/session-list.js');
  await renderSessions();
  assert.match(el.innerHTML, /abc/);
});

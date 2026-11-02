import { test, beforeEach } from 'vitest';
import assert from 'node:assert';

/** 安装一个内存版 localStorage（每个用例前重置） */
function installLocalStorage(initial) {
  const store = new Map(Object.entries(initial || {}));
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
  return store;
}

const KEY = 'cuckoo-js-result-phrases';

/**
 * 每次重新 import，并注入"通用设置读取函数"。
 * 生产环境由 bridge/entry 注入（数据来自主进程），测试里用 localStorage mock 充当数据源。
 */
async function load() {
  const mod = await import('../../src/overlay/js-result-phrases.js');
  mod.setSharedSettingReader((k) => {
    try { return localStorage.getItem(k) || undefined; } catch (_) { return undefined; }
  });
  return mod;
}

beforeEach(() => {
  installLocalStorage({});
});

test('pickJsResultPhrase：{n} 被替换为脚本数', async () => {
  installLocalStorage({ [KEY]: '跑了 {n} 段脚本' });
  const { pickJsResultPhrase } = await load();
  assert.strictEqual(pickJsResultPhrase(3), '跑了 3 段脚本');
});

test('pickJsResultPhrase：多个 {n} 全部替换', async () => {
  installLocalStorage({ [KEY]: '{n} 段，共 {n} 个' });
  const { pickJsResultPhrase } = await load();
  assert.strictEqual(pickJsResultPhrase(5), '5 段，共 5 个');
});

test('pickJsResultPhrase：无占位符时原样返回', async () => {
  installLocalStorage({ [KEY]: '结果都在这儿了' });
  const { pickJsResultPhrase } = await load();
  assert.strictEqual(pickJsResultPhrase(2), '结果都在这儿了');
});

test('用户池优先：只从用户填的文案里取', async () => {
  installLocalStorage({ [KEY]: '甲\n乙\n丙' });
  const { pickJsResultPhrase } = await load();
  const allowed = new Set(['甲', '乙', '丙']);
  for (let i = 0; i < 50; i++) {
    assert.ok(allowed.has(pickJsResultPhrase(1)), '不应取到内置默认文案');
  }
});

test('用户池：过滤空行与首尾空白', async () => {
  installLocalStorage({ [KEY]: '  甲乙  \n\n   \n丙丁\n' });
  const { pickJsResultPhrase } = await load();
  const allowed = new Set(['甲乙', '丙丁']);
  for (let i = 0; i < 50; i++) {
    assert.ok(allowed.has(pickJsResultPhrase(1)));
  }
});

test('用户池为空字符串 → 回退内置默认', async () => {
  installLocalStorage({ [KEY]: '' });
  const { pickJsResultPhrase, DEFAULT_JS_RESULT_PHRASES } = await load();
  const allowed = new Set(DEFAULT_JS_RESULT_PHRASES.map((s) => s.replace(/\{n\}/g, '7')));
  for (let i = 0; i < 50; i++) {
    assert.ok(allowed.has(pickJsResultPhrase(7)), '空池应回退到内置默认');
  }
});

test('用户池只有空白行 → 回退内置默认', async () => {
  installLocalStorage({ [KEY]: '   \n\n  \n' });
  const { pickJsResultPhrase, DEFAULT_JS_RESULT_PHRASES } = await load();
  const allowed = new Set(DEFAULT_JS_RESULT_PHRASES.map((s) => s.replace(/\{n\}/g, '1')));
  assert.ok(allowed.has(pickJsResultPhrase(1)));
});

test('localStorage 抛错 → 回退内置默认，不崩溃', async () => {
  global.localStorage = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => {},
    removeItem: () => {},
  };
  const { pickJsResultPhrase, DEFAULT_JS_RESULT_PHRASES } = await load();
  const allowed = new Set(DEFAULT_JS_RESULT_PHRASES.map((s) => s.replace(/\{n\}/g, '2')));
  assert.ok(allowed.has(pickJsResultPhrase(2)));
});

test('随机性：多条文案都会被取到', async () => {
  installLocalStorage({ [KEY]: 'A\nB\nC\nD' });
  const { pickJsResultPhrase } = await load();
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(pickJsResultPhrase(1));
  assert.ok(seen.size >= 3, '500 次抽样至少命中 3 条不同文案，实际 ' + seen.size);
});

test('DEFAULT_JS_RESULT_PHRASES 非空且均为非空字符串', async () => {
  const { DEFAULT_JS_RESULT_PHRASES } = await load();
  assert.ok(Array.isArray(DEFAULT_JS_RESULT_PHRASES));
  assert.ok(DEFAULT_JS_RESULT_PHRASES.length > 0);
  for (const p of DEFAULT_JS_RESULT_PHRASES) {
    assert.strictEqual(typeof p, 'string');
    assert.ok(p.trim().length > 0);
  }
});


// ===== 脚本标题模板 =====

const TPL_KEY = 'cuckoo-js-result-item-templates';

test('pickJsResultItemTemplate：用户池优先', async () => {
  installLocalStorage({ [TPL_KEY]: 'A{i}\nB{i}\nC{i}' });
  const { pickJsResultItemTemplate } = await load();
  const allowed = new Set(['A{i}', 'B{i}', 'C{i}']);
  for (let i = 0; i < 50; i++) assert.ok(allowed.has(pickJsResultItemTemplate()));
});

test('pickJsResultItemTemplate：池为空回退内置默认', async () => {
  installLocalStorage({ [TPL_KEY]: '' });
  const { pickJsResultItemTemplate, DEFAULT_JS_RESULT_ITEM_TEMPLATES } = await load();
  const allowed = new Set(DEFAULT_JS_RESULT_ITEM_TEMPLATES);
  for (let i = 0; i < 50; i++) assert.ok(allowed.has(pickJsResultItemTemplate()));
});

test('pickJsResultItemTemplate：localStorage 抛错不崩溃', async () => {
  global.localStorage = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => {}, removeItem: () => {},
  };
  const { pickJsResultItemTemplate, DEFAULT_JS_RESULT_ITEM_TEMPLATES } = await load();
  assert.ok(DEFAULT_JS_RESULT_ITEM_TEMPLATES.indexOf(pickJsResultItemTemplate()) >= 0);
});

test('formatJsResultItemTitle：成对写法成功侧', async () => {
  const { formatJsResultItemTitle } = await load();
  assert.strictEqual(
    formatJsResultItemTitle('第 {i} 块跑完，成功，你看下|第 {i} 块失败，得改改', 2, true),
    '第 2 块跑完，成功，你看下'
  );
});

test('formatJsResultItemTitle：成对写法失败侧', async () => {
  const { formatJsResultItemTitle } = await load();
  assert.strictEqual(
    formatJsResultItemTitle('第 {i} 块跑完，成功，你看下|第 {i} 块失败，得改改', 2, false),
    '第 2 块失败，得改改'
  );
});

test('formatJsResultItemTitle：成对写法不再追加成败', async () => {
  const { formatJsResultItemTitle } = await load();
  const out = formatJsResultItemTitle('甲 {i}|乙 {i}', 1, true);
  assert.strictEqual(out, '甲 1');
});

test('formatJsResultItemTitle：单句 {r} 成功/失败', async () => {
  const { formatJsResultItemTitle } = await load();
  assert.strictEqual(formatJsResultItemTitle('这是第 {i} 条，{r}', 3, true), '这是第 3 条，成功');
  assert.strictEqual(formatJsResultItemTitle('这是第 {i} 条，{r}', 3, false), '这是第 3 条，失败');
});

test('formatJsResultItemTitle：单句多处 {r} 全部替换', async () => {
  const { formatJsResultItemTitle } = await load();
  assert.strictEqual(formatJsResultItemTitle('{i} 号 · {r} · 结论 {r}', 2, true), '2 号 · 成功 · 结论 成功');
});

test('formatJsResultItemTitle：单句漏写 {r} 时末尾追加', async () => {
  const { formatJsResultItemTitle } = await load();
  assert.strictEqual(formatJsResultItemTitle('第 {i} 块代码', 5, false), '第 5 块代码 失败');
});

test('formatJsResultItemTitle：成对写法某一侧为空时退化为单句（不丢结果）', async () => {
  const { formatJsResultItemTitle } = await load();
  assert.strictEqual(formatJsResultItemTitle('甲 {i}|', 1, false), '甲 1 失败');
  assert.strictEqual(formatJsResultItemTitle('|乙 {i}', 2, true), '乙 2 成功');
});

test('formatJsResultItemTitle：成对写法侧内含 {r} 也会替换', async () => {
  const { formatJsResultItemTitle } = await load();
  assert.strictEqual(
    formatJsResultItemTitle('第 {i} 条，{r}，你看下|第 {i} 条，{r}，得改改', 4, false),
    '第 4 条，失败，得改改'
  );
});

test('isPairedTemplate 判定', async () => {
  const { isPairedTemplate } = await load();
  assert.strictEqual(isPairedTemplate('甲|乙'), true);
  assert.strictEqual(isPairedTemplate('单句 {r}'), false);
});

test('DEFAULT_JS_RESULT_ITEM_TEMPLATES 每行含 {i}，且含 {r} 或为成对写法', async () => {
  const { DEFAULT_JS_RESULT_ITEM_TEMPLATES, isPairedTemplate } = await load();
  assert.ok(DEFAULT_JS_RESULT_ITEM_TEMPLATES.length > 0);
  for (const t of DEFAULT_JS_RESULT_ITEM_TEMPLATES) {
    assert.ok(t.trim().length > 0);
    assert.ok(t.indexOf('{i}') >= 0, '模板应含 {i}：' + t);
    assert.ok(isPairedTemplate(t) || t.indexOf('{r}') >= 0, '模板应含 {r} 或用 | 分侧：' + t);
  }
});

test('两个池互不干扰：只设置头部池时，标题模板仍走内置默认', async () => {
  installLocalStorage({ [KEY]: '自定义头部 {n}' });
  const { pickJsResultItemTemplate, DEFAULT_JS_RESULT_ITEM_TEMPLATES } = await load();
  assert.ok(DEFAULT_JS_RESULT_ITEM_TEMPLATES.indexOf(pickJsResultItemTemplate()) >= 0);
});

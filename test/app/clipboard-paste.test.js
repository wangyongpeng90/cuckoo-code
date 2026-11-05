'use strict';
/**
 * [261105-geaofb] 剪贴板借用逻辑（B 方案）测试。
 *
 * 被测对象是 src/app/ipc/clipboard-paste.ts —— 之所以能从 app 层单测，
 * 是因为它把 clipboard / paste 作为参数注入。这里的 FakeClipboard 是
 * **外部边界替身**（等价于测试规则里的 window/document 替身），不是内部模块 mock。
 *
 * 重点钉住失败路径：
 *   1) 正常路径：粘贴完成后剪贴板必须是用户原来的内容
 *   2) 原剪贴板为空：恢复走 clear()
 *   3) 用户抢复制：绝不能把用户的新内容覆盖回去
 *   4) paste 抛错：仍然要恢复
 *   5) 串行锁：并发两次粘贴不能交错备份/恢复
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  readSnapshot,
  restoreSnapshot,
  pasteText,
  createClipboardLock,
} from '../../src/app/ipc/clipboard-paste.js';

const silentLog = { info() {}, error() {} };
const noSleep = async () => {};

/** 外部边界替身：模拟 electron clipboard 的读写语义 */
class FakeClipboard {
  constructor(initial = {}) {
    this.item = { text: '', html: '', rtf: '', image: null, bookmark: null, ...initial };
    this.writes = [];
    this.cleared = 0;
    this.onWriteText = null;
  }
  readText() { return this.item.text; }
  readHTML() { return this.item.html; }
  readRTF() { return this.item.rtf; }
  readImage() { return this.item.image; }
  readBookmark() { return this.item.bookmark; }
  writeText(text) {
    if (this.onWriteText) this.onWriteText(text);
    this.item = { text, html: '', rtf: '', image: null, bookmark: null };
  }
  write(item) {
    this.writes.push(item);
    this.item = {
      text: item.text ?? '',
      html: item.html ?? '',
      rtf: item.rtf ?? '',
      image: item.image ?? null,
      bookmark: item.bookmark ?? null,
    };
  }
  clear() {
    this.cleared += 1;
    this.item = { text: '', html: '', rtf: '', image: null, bookmark: null };
  }
}

test('正常路径：粘贴后恢复用户原有文本', async () => {
  const cb = new FakeClipboard({ text: '用户自己复制的一段话' });
  let seenAtPaste = '';

  const r = await pasteText(cb, () => { seenAtPaste = cb.readText(); }, '工具结果回传', {
    sleep: noSleep, log: silentLog,
  });

  assert.equal(r.success, true);
  assert.equal(seenAtPaste, '工具结果回传', 'paste 时剪贴板里应是提示词');
  assert.equal(cb.readText(), '用户自己复制的一段话', '粘贴后必须还原');
});

test('正常路径：html/rtf/bookmark 一并还原', async () => {
  const cb = new FakeClipboard({
    text: '带格式的原文',
    html: '<b>带格式的原文</b>',
    rtf: '{\\rtf1 带格式的原文}',
    bookmark: { url: 'https://example.com', title: '示例' },
  });

  await pasteText(cb, () => {}, '提示词', { sleep: noSleep, log: silentLog });

  assert.equal(cb.readText(), '带格式的原文');
  assert.equal(cb.readHTML(), '<b>带格式的原文</b>');
  assert.equal(cb.readRTF(), '{\\rtf1 带格式的原文}');
  // electron 的 write({ bookmark }) 只接受 URL 字符串，title 无法回写
  assert.equal(cb.readBookmark(), 'https://example.com');
});

test('日志实测占用窗口：恢复成功后打印毫秒数（真机验收第 6 项依赖它）', async () => {
  const cb = new FakeClipboard({ text: '用户原文' });
  const logs = [];
  const recLog = { info: (m) => logs.push(m), error: (m) => logs.push('ERR:' + m) };

  await pasteText(cb, () => {}, '提示词', { sleep: noSleep, log: recLog });

  assert.equal(logs.length, 1);
  assert.match(logs[0], /占用 \d+ms（已恢复原内容）/, '应打印可直接对照 30ms 阈值的耗时');
});

test('原剪贴板为空：恢复走 clear()，不残留提示词', async () => {
  const cb = new FakeClipboard();

  const r = await pasteText(cb, () => {}, '不该残留的提示词', { sleep: noSleep, log: silentLog });

  assert.equal(r.success, true);
  assert.equal(cb.cleared, 1, '空快照应触发 clear()');
  assert.equal(cb.readText(), '', '剪贴板必须回到空状态');
});

test('原剪贴板是图片：图片对象原样写回', async () => {
  const image = { isEmpty: () => false, tag: 'IMAGE' };
  const cb = new FakeClipboard({ text: '', image });

  await pasteText(cb, () => {}, '提示词', { sleep: noSleep, log: silentLog });

  assert.equal(cb.writes.length, 1);
  assert.equal(cb.writes[0].image, image, '应写回同一张图片');
  assert.equal(cb.readText(), '', '图片场景不得写入文本');
});

test('用户在这几十毫秒内抢复制：跳过恢复，保留用户的新内容', async () => {
  const cb = new FakeClipboard({ text: '用户原文' });

  const r = await pasteText(cb, () => { cb.writeText('用户刚复制的新内容'); }, '提示词', {
    sleep: noSleep, log: silentLog,
  });

  assert.equal(r.success, true);
  assert.equal(cb.readText(), '用户刚复制的新内容', '用户的新内容不能被覆盖');
  assert.equal(cb.cleared, 0);
  assert.equal(cb.writes.length, 0);
});

test('paste 抛错：仍恢复剪贴板，并返回失败', async () => {
  const cb = new FakeClipboard({ text: '用户原文' });

  const r = await pasteText(cb, () => { throw new Error('view 已销毁'); }, '提示词', {
    sleep: noSleep, log: silentLog,
  });

  assert.equal(r.success, false);
  assert.match(r.error, /view 已销毁/);
  assert.equal(cb.readText(), '用户原文', '异常路径也必须恢复');
});

test('writeText 抛错：不覆盖原剪贴板，返回失败', async () => {
  const cb = new FakeClipboard({ text: '用户原文' });
  cb.onWriteText = () => { throw new Error('clipboard 不可用'); };

  const r = await pasteText(cb, () => {}, '提示词', { sleep: noSleep, log: silentLog });

  assert.equal(r.success, false);
  assert.match(r.error, /clipboard 不可用/);
  assert.equal(cb.readText(), '用户原文', '没写成就不该动原内容');
  assert.equal(cb.cleared, 0);
});

test('空提示词不抛异常（调用方已过滤，这里只保证不崩）', async () => {
  const cb = new FakeClipboard({ text: '用户原文' });

  const r = await pasteText(cb, () => {}, '', { sleep: noSleep, log: silentLog });

  assert.equal(r.success, true);
  assert.equal(cb.readText(), '用户原文');
});

test('串行锁：并发两次粘贴不交错备份/恢复', async () => {
  const cb = new FakeClipboard({ text: '用户原文' });
  const lock = createClipboardLock();
  const timeline = [];

  const run = (label) => lock(async () => {
    timeline.push(label + ':start');
    await pasteText(cb, () => {
      timeline.push(label + ':paste:' + cb.readText());
    }, '提示词-' + label, { sleep: noSleep, log: silentLog });
    timeline.push(label + ':end:' + cb.readText());
  });

  await Promise.all([run('A'), run('B')]);

  assert.deepEqual(timeline, [
    'A:start',
    'A:paste:提示词-A',
    'A:end:用户原文',
    'B:start',
    'B:paste:提示词-B',
    'B:end:用户原文',
  ], '第二次必须等第一次完全恢复后才开始');
});

test('串行锁：前一次抛错不阻塞后续调用', async () => {
  const lock = createClipboardLock();
  const seen = [];

  await lock(async () => { throw new Error('boom'); }).catch((e) => seen.push(e.message));
  await lock(async () => { seen.push('second'); });

  assert.deepEqual(seen, ['boom', 'second']);
});

test('readSnapshot/restoreSnapshot 往返一致', () => {
  const cb = new FakeClipboard({ text: 'txt', html: '<i>txt</i>', rtf: 'rtf', bookmark: { title: 't' } });
  const snap = readSnapshot(cb);

  cb.clear();
  restoreSnapshot(cb, snap);

  assert.equal(cb.readText(), 'txt');
  assert.equal(cb.readHTML(), '<i>txt</i>');
  assert.equal(cb.readRTF(), 'rtf');
  // 书签只回写 URL（见上一条测试的说明）
  assert.equal(cb.readBookmark(), 't');
});

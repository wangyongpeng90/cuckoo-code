// @vitest-environment happy-dom
'use strict';
/**
 * src/overlay/dom.ts 安全 DOM 构建助手测试。
 * 核心安全属性：字符串子节点一律走 textNode，绝不解析 HTML。
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';

import { h, clearChildren, replaceChildrenOf } from '../../src/overlay/dom.js';
import { setupDom } from '../helpers/dom';

let ctx;

beforeEach(() => {
  ctx = setupDom();
});

afterEach(() => {
  ctx.cleanup();
});

describe('h()', () => {
  it('设置 class / dataset / onClick / 文本子节点', () => {
    let clicked = 0;
    const el = h('div', { class: 'a b', dataset: { id: '1' }, onClick: () => { clicked++; } }, 'text');

    assert.strictEqual(el.tagName, 'DIV');
    assert.strictEqual(el.className, 'a b');
    assert.strictEqual(el.dataset.id, '1');
    assert.strictEqual(el.textContent, 'text');

    el.click();
    assert.strictEqual(clicked, 1);
  });

  it('字符串子节点含 HTML 标签时按纯文本呈现（不解析）', () => {
    const el = h('div', null, '<b>bold</b>');

    assert.strictEqual(el.textContent, '<b>bold</b>');
    assert.strictEqual(el.querySelector('b'), null);
    assert.strictEqual(el.childNodes.length, 1);
    assert.strictEqual(el.childNodes[0].nodeType, 3);
  });

  it('Node 子节点原样挂载；null/undefined 被跳过', () => {
    const child = h('span', { class: 'inner' }, 'in');
    const el = h('div', null, child, null, undefined, 'tail');

    assert.strictEqual(el.children.length, 1);
    assert.strictEqual(el.children[0], child);
    assert.strictEqual(el.textContent, 'intail');
  });

  it('style 对象整体赋值', () => {
    const el = h('div', { style: { display: 'none', color: 'red' } });

    assert.strictEqual(el.style.display, 'none');
    assert.strictEqual(el.style.color, 'red');
  });

  it('返回具体标签对应的元素类型', () => {
    const btn = h('button', { class: 'x' }, 'ok');

    assert.ok(btn instanceof HTMLButtonElement);
    assert.strictEqual(btn.textContent, 'ok');
  });

  it('未知 props 抛错，防止 onclick 之类的拼写静默失效', () => {
    assert.throws(() => h('div', { onclick: () => {} }), /unsupported prop/);
  });
});

describe('clearChildren()', () => {
  it('清空元素所有子节点', () => {
    const el = h('div', null, 'a', h('span', null, 'b'));

    clearChildren(el);

    assert.strictEqual(el.childNodes.length, 0);
    assert.strictEqual(el.innerHTML, '');
  });
});

describe('replaceChildrenOf()', () => {
  it('替换为新的子节点集合，字符串仍走 textNode', () => {
    const el = h('div', null, 'old');

    replaceChildrenOf(el, h('i', null, 'n'), '<em>x</em>', null);

    assert.strictEqual(el.children.length, 1);
    assert.strictEqual(el.children[0].tagName, 'I');
    assert.strictEqual(el.textContent, 'n<em>x</em>');
    assert.strictEqual(el.querySelector('em'), null);
  });
});

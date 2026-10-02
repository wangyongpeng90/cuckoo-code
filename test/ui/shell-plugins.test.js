'use strict';
/**
 * shell.html 插件页的样式安全检查
 *
 * 背景：插件市场页曾出现"看不到安装按钮"——
 * 安装按钮被包进了 `.ck-snip-actions`，而那个类是为 snippet 卡片设计的
 * **悬停才显形**样式（`opacity: 0` + `pointer-events: none`，
 * 且显示规则绑定在 `.ck-snip-item:hover` 上）。
 * 卡片本身是 `.ck-plugin-item`，选择器不匹配 → 按钮永远不可见也点不到。
 *
 * 这类 bug 靠肉眼读代码很难发现（语法、类型、单测全绿），所以固化成检查：
 * **插件区段用到的每个 class，其基础 CSS 规则都不得隐藏元素。**
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const SHELL = path.join(import.meta.dirname, '../../src/ui/shell.html');

/** 读取整个 shell.html（显式 UTF-8，避免中文被打断） */
function readShell() {
  return fs.readFileSync(SHELL, 'utf-8');
}

/** 截取插件页的 JS 区段（模块化后 plugins.ts 编译进 bundle，用函数锚点定位） */
function pluginSection(html) {
  const start = html.indexOf('function pluginContribSummary');
  const end = html.indexOf('document.getElementById("plugin-open-dir")');
  assert.ok(start > 0, '未找到「pluginContribSummary」锚点，测试需要同步更新');
  assert.ok(end > start, '未找到「plugin-open-dir」锚点，测试需要同步更新');
  return html.slice(start, end);
}

/** 区块自身的基础规则体（不含 :hover / 后代选择器） */
function baseRuleBodies(css, className) {
  const re = new RegExp('\\.' + className + '\\s*\\{[^}]*\\}', 'g');
  return css.match(re) || [];
}

test('shell.html 存在且可读', () => {
  const html = readShell();
  assert.ok(html.length > 10000, 'shell.html 内容异常');
  assert.ok(html.includes('cuckoo-plugin'), '市场区应标出唯一搜索源');
});

test('插件区段不复用 snippet 的悬停类（回归防护）', () => {
  const seg = pluginSection(readShell());
  // .ck-snip-actions 带 opacity:0 + pointer-events:none，且显示规则绑定 .ck-snip-item:hover
  assert.ok(!seg.includes('ck-snip-actions'), '插件卡片不得使用 .ck-snip-actions（会永远不可见）');
  assert.ok(seg.includes('ck-plugin-actions'), '插件卡片应用常驻可见的 .ck-plugin-actions');
});

test('插件区段用到的每个 class，基础规则都不隐藏元素', () => {
  const html = readShell();
  const seg = pluginSection(html);

  const classes = Array.from(new Set(seg.match(/ck-[a-z0-9-]+/g) || []));
  assert.ok(classes.length > 5, '未从插件区段解析出 class，选择器可能已变');

  const offenders = [];
  for (const c of classes) {
    for (const body of baseRuleBodies(html, c)) {
      if (/opacity:\s*0(?!\.)/.test(body) || /pointer-events:\s*none/.test(body)) {
        offenders.push('.' + c + ' → ' + body.replace(/\s+/g, ' '));
      }
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    '插件区段用到了"悬停才显形"的 class，元素会不可见也点不到：\n  ' + offenders.join('\n  ')
  );
});

test('插件区段的关键 class 都在 CSS 里有定义', () => {
  const html = readShell();
  const required = [
    'ck-plugin-item',
    'ck-plugin-head',
    'ck-plugin-name',
    'ck-plugin-actions',
    'ck-plugin-desc',
    'ck-plugin-meta',
    'ck-plugin-req',
    'ck-plugin-switch-row',
  ];
  for (const c of required) {
    assert.ok(new RegExp('\\.' + c + '\\s*\\{').test(html), '缺少样式定义：.' + c);
  }
});

test('开关用的是既有的 ck-switch 组件', () => {
  const seg = pluginSection(readShell());
  assert.ok(seg.includes('ck-switch'), '插件开关应复用 ck-switch');
  assert.ok(seg.includes('ck-switch-track'), '缺少 ck-switch 的轨道元素');
});

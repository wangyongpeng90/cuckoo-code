'use strict';
/**
 * 窗口解析契约守卫测试（插件按 profile 定位窗口）。
 *
 * 背景：dsh-tasks 等插件指定 model = profileId。历史上 cuckoo-host 和 navigate-session
 * 在按 profileId 找不到窗口时，会静默回退到"最后一个已打开的窗口"，导致：
 *   1) 命令在错误的窗口执行（用户看到别的窗口突然动起来）
 *   2) 点「打开对话」跳到错误窗口，甚至完全没反应
 *
 * 修复后的不变式：
 *   1) 插件宿主能力（navigateWindowToHome / sendUserMessage）按 profileId 找不到窗口时，
 *      必须主动拉起新窗口（createWindow），而不是回退到最后一个窗口
 *   2) navigate-session 按 logicId 查数据库拿归属 profile_id，再定位/拉起目标窗口
 *   3) 依赖通过显式注入传递（injectSessionDeps / buildCuckooHost 的 opts），
 *      避免 IPC 层直接依赖 app 层的 createWindow
 */
import { test } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const HOST_TS = read('src/app/cuckoo-host.ts');
const SESSION_IPC = read('src/app/ipc/session.ts');
const ENTRY_TS = read('src/app/entry.ts');

/** 取某段源码的正文（从标记处向后截断） */
function bodyFrom(src, marker, len = 2200) {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, '未找到标记：' + marker);
  return src.slice(i, i + len);
}

// ===== 插件宿主：按 profileId 拉起窗口 =====

test('buildCuckooHost 接受 createWindow / profileManager 注入', () => {
  const body = bodyFrom(HOST_TS, 'function buildCuckooHost', 400);
  assert.ok(body.includes('createWindow'), 'buildCuckooHost 的 opts 应包含 createWindow');
  assert.ok(body.includes('profileManager'), 'buildCuckooHost 的 opts 应包含 profileManager');
});

test('navigateWindowToHome 找不到窗口时主动拉起（而不是回退最后一个窗口）', () => {
  const body = bodyFrom(HOST_TS, 'navigateWindowToHome:', 1600);
  assert.ok(body.includes('getWindowByProfileId'), '应先按 profileId 找窗口');
  assert.ok(body.includes('createWindow'), '找不到时应主动拉起新窗口');
  assert.ok(!/ctx = ctxs\[ctxs\.length - 1\]/.test(body), '不应回退到"最后一个窗口"（会执行错乱）');
});

test('sendUserMessage 找不到窗口时主动拉起（而不是回退最后一个窗口）', () => {
  const body = bodyFrom(HOST_TS, 'sendUserMessage:', 1600);
  assert.ok(body.includes('getWindowByProfileId'), '应先按 profileId 找窗口');
  assert.ok(body.includes('createWindow'), '找不到时应主动拉起新窗口');
  assert.ok(!/ctx = ctxs\[ctxs\.length - 1\]/.test(body), '不应回退到"最后一个窗口"（会执行错乱）');
});

// ===== navigate-session：按 logicId 定位目标窗口 =====

test('session IPC 暴露依赖注入入口', () => {
  assert.ok(/function injectSessionDeps\s*\(/.test(SESSION_IPC), '应有 injectSessionDeps');
  assert.ok(SESSION_IPC.includes('export { registerSessionIpc, injectSessionDeps }'), '应导出 injectSessionDeps');
});

test('navigate-session 按 logicId 查归属 profile_id', () => {
  const body = bodyFrom(SESSION_IPC, "ipcMain.handle('navigate-session'", 2200);
  assert.ok(body.includes('profile_id'), '应查数据库拿 profile_id');
  assert.ok(body.includes('web_id'), '应查数据库拿 web_id');
  assert.ok(body.includes('getWindowByProfileId'), '应按 profileId 定位窗口');
  assert.ok(body.includes('createWindow'), '目标窗口未打开时应主动拉起');
});

test('navigate-session 保留同 URL 跳过（防中断 Agent loop）', () => {
  const body = bodyFrom(SESSION_IPC, "ipcMain.handle('navigate-session'", 2600);
  assert.ok(body.includes('sameSessionUrl'), '应保留同 URL 跳过逻辑');
  assert.ok(body.includes('skipped: true'), '同 URL 时应返回 skipped 标记');
});

// ===== 依赖注入接线 =====

test('entry.ts 把 createWindow / profileManager 注入到 session IPC', () => {
  assert.ok(
    /injectSessionDeps\s*\(\s*\{\s*createWindow\s*,\s*profileManager\s*\}\s*\)/.test(ENTRY_TS),
    'entry.ts 应调用 injectSessionDeps({ createWindow, profileManager })'
  );
});

test('entry.ts 把 createWindow / profileManager 注入到插件宿主', () => {
  const body = bodyFrom(ENTRY_TS, 'buildCuckooHost(', 300);
  assert.ok(body.includes('createWindow'), 'buildCuckooHost 调用应传 createWindow');
  assert.ok(body.includes('profileManager'), 'buildCuckooHost 调用应传 profileManager');
});

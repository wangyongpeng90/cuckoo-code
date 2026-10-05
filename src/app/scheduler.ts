/**
 * 定时任务调度器
 *
 * 存储：<userData>/scheduled-tasks.json
 *   { tasks: [ { id, name, time: "HH:MM", enabled, prompt, lastRun: "YYYY-MM-DD" } ] }
 *
 * 行为：
 *  - 每分钟检查一次，到点（HH:MM）且今天没跑过 → 触发
 *  - 启动时补跑：今天该跑的点已过、且今天没跑过 → 立即补跑
 *  - 触发：给"当前活跃窗口"的 AI 页面发提示词（复用 cuckoo-trigger-snippet 通道，自动发送）
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as windowState from './window.js';

const require = createRequire(import.meta.url);
const { app } = require('electron');

interface Task {
  id: string;
  name: string;
  /** HH:MM（24 小时制） */
  time: string;
  enabled: boolean;
  /** 发给 AI 的提示词 */
  prompt: string;
  /** 上次运行日期 YYYY-MM-DD */
  lastRun: string;
}

function getFile(): string {
  return path.join(app.getPath('userData'), 'scheduled-tasks.json');
}

function readTasks(): Task[] {
  try {
    const f = getFile();
    if (!fs.existsSync(f)) return [];
    const raw = JSON.parse(fs.readFileSync(f, 'utf-8'));
    if (raw && Array.isArray(raw.tasks)) return raw.tasks;
    return [];
  } catch (err: any) {
    console.error('[Scheduler] 读取失败:', err.message);
    return [];
  }
}

function writeTasks(tasks: Task[]): boolean {
  try {
    fs.writeFileSync(getFile(), JSON.stringify({ tasks }, null, 2), 'utf-8');
    return true;
  } catch (err: any) {
    console.error('[Scheduler] 写入失败:', err.message);
    return false;
  }
}

function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/** 当前 HH:MM */
function nowHM(d = new Date()): string {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** 给当前活跃窗口的 AI 页面发提示词（自动发送） */
function sendToActiveWindow(prompt: string): boolean {
  try {
    // 优先聚焦窗口，其次最近活跃
    const contexts = windowState.getAllContexts ? windowState.getAllContexts() : [];
    let ctx: any = null;
    for (const c of contexts) {
      if (c && c.view && c.win && !c.win.isDestroyed()) { ctx = c; if (c.win.isFocused && c.win.isFocused()) break; }
    }
    if (!ctx) ctx = windowState.getMainContext ? windowState.getMainContext() : null;
    if (!ctx || !ctx.view || ctx.view.webContents.isDestroyed()) {
      console.warn('[Scheduler] 无可用 AI 窗口');
      return false;
    }
    ctx.view.webContents.send('cuckoo-trigger-snippet', { content: prompt, autoSend: true });
    return true;
  } catch (err: any) {
    console.error('[Scheduler] 发送失败:', err.message);
    return false;
  }
}

/** 触发单个任务 */
function runTask(t: Task): void {
  console.log('[Scheduler] 触发任务:', t.name, '→', t.prompt.slice(0, 40));
  sendToActiveWindow(t.prompt);
  // 更新 lastRun
  const tasks = readTasks();
  const found = tasks.find((x) => x.id === t.id);
  if (found) {
    found.lastRun = todayStr();
    writeTasks(tasks);
  }
}

let timer: any = null;
let started = false;

/** 检查并触发到点的任务 */
function tick(isStartup: boolean): void {
  const tasks = readTasks();
  const today = todayStr();
  const cur = nowHM();
  for (const t of tasks) {
    if (!t.enabled) continue;
    if (!/^\d{1,2}:\d{2}$/.test(t.time)) continue;
    const [th, tm] = t.time.split(':').map((x) => parseInt(x, 10));
    const taskMin = th * 60 + tm;
    const [ch, cm] = cur.split(':').map((x) => parseInt(x, 10));
    const curMin = ch * 60 + cm;
    // 今天已跑 → 跳过
    if (t.lastRun === today) continue;
    if (isStartup) {
      // 启动补跑：时间已过（<= 当前）→ 补跑
      if (taskMin <= curMin) runTask(t);
    } else {
      // 运行中：到点（当前分钟 == 任务分钟）→ 跑
      if (taskMin === curMin) runTask(t);
    }
  }
}

/** 启动调度器（幂等） */
function startScheduler(): void {
  if (started) return;
  started = true;
  console.log('[Scheduler] 启动定时任务调度器');
  // 启动补跑
  tick(true);
  // 每分钟检查
  timer = setInterval(() => {
    try { tick(false); } catch (_) {}
  }, 60 * 1000);
}

function stopScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
  started = false;
}

export { startScheduler, stopScheduler, readTasks, writeTasks };

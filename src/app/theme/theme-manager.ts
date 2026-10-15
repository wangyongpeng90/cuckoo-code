/**
 * 主进程主题管理器（权威单例）
 *
 * 主题是应用级全局状态，权威放主进程：
 *   - 持有唯一的 ThemeRuntime（纯逻辑，从 plugins/runtime 复用）
 *   - 变化时广播给所有窗口（壳页面改 --ck-* 变量；AI 页面同步）
 *   - 渲染进程的 ctx.theme 通过 IPC 代理到这里
 *
 * 与渲染进程那份的关系：
 *   - plugins/runtime/theme-runtime.ts 是平台无关纯逻辑，两处共用
 *   - 本文件是主进程权威实例；渲染进程不自己建注册表
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ThemeRuntime } from '../../plugins/runtime/theme-runtime.js';
import type { ThemeSnapshot, ThemeDefinition, ThemeTokenOverrides } from '../../plugins/runtime/theme-runtime.js';
import os from 'node:os';
import * as windowState from '../window.js';

const require = createRequire(import.meta.url);

let runtime: ThemeRuntime | null = null;

// ===== 偏好持久化（对齐 DSH：偏好存盘，退出不丢）=====
interface ThemeState { preference?: string }
function getStateFile(): string {
  return path.join(process.env.CUCKOO_HOME || path.join(os.homedir(), '.cuckoo'), 'theme-state.json');
}
function readPreference(): string | null {
  try {
    const file = getStateFile();
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return raw && typeof raw.preference === 'string' ? raw.preference : null;
  } catch { return null; }
}
function writePreference(preference: string): void {
  try {
    const file = getStateFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ preference }, null, 2), 'utf-8');
  } catch { /* ignore */ }
}
/** 订阅者：窗口 webContents，变化时推快照 */
const subscribers = new Set<any>();

// ===== 用户自定义颜色（持久化覆盖层，供主题类插件/UI 使用）=====
// 存 {CUCKOO_HOME}/user-theme.json，形如 { token: { light, dark } }。
// 启动时应用为固定 source 'user-custom' 的覆盖层，插件可读写。
const USER_THEME_SOURCE = 'user-custom';
function getUserThemeFile(): string {
  return path.join(process.env.CUCKOO_HOME || path.join(os.homedir(), '.cuckoo'), 'user-theme.json');
}
function readUserTheme(): ThemeTokenOverrides | null {
  try {
    const file = getUserThemeFile();
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!raw || typeof raw !== 'object') return null;
    return raw as ThemeTokenOverrides;
  } catch { return null; }
}
function applyUserTheme(tokens: ThemeTokenOverrides | null): void {
  const t = getTheme();
  try { t.overrideTokens(USER_THEME_SOURCE, tokens && Object.keys(tokens).length ? tokens : {}); } catch { /* ignore */ }
}
function getUserTheme(): ThemeTokenOverrides {
  return readUserTheme() || {};
}
function setUserTheme(tokens: ThemeTokenOverrides): boolean {
  let ok = true;
  try {
    const file = getUserThemeFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(tokens || {}, null, 2), 'utf-8');
  } catch { ok = false; }
  if (ok) applyUserTheme(tokens);
  return ok;
}
function resetUserTheme(): boolean {
  try {
    const file = getUserThemeFile();
    if (fs.existsSync(file)) fs.rmSync(file);
  } catch { /* ignore */ }
  applyUserTheme(null);
  return true;
}

/** 取（或懒创建）主进程主题权威实例 */
function getTheme(): ThemeRuntime {
  if (runtime) return runtime;
  const bus = {
    on() { return () => {}; },
    once() { return () => {}; },
    off() {},
    emit(event: string, ...args: any[]) {
      if (event === 'theme/change') broadcastSnapshot(args[0] as ThemeSnapshot);
    },
    async parallel() { return []; },
    async serial() { return undefined; },
    bail() { return undefined; },
    async waterfall(v: any) { return v; },
    clear() {},
  };
  // 系统配色提供者：主进程 nativeTheme（主进程无 matchMedia）
  const sysProvider = (): 'light' | 'dark' => {
    try {
      const nt = require('electron').nativeTheme;
      return nt && nt.shouldUseDarkColors ? 'dark' : 'light';
    } catch { return 'light'; }
  };
  runtime = new ThemeRuntime(bus as any, sysProvider);
  // 系统配色变化时（偏好为 system）重新发布
  try {
    const nt = require('electron').nativeTheme;
    if (nt && typeof nt.on === 'function') {
      nt.on('updated', () => {
        try { if (runtime && runtime.getTheme().preference === 'system') (runtime as any).publish(); } catch (_) {}
      });
    }
  } catch (_) { /* ignore */ }
  // 读回上次保存的偏好（若合法）
  const saved = readPreference();
  if (saved) {
    try { runtime.setTheme(saved); } catch { /* 未注册的旧主题，忽略 */ }
  }
  // 应用用户自定义颜色覆盖层
  try { applyUserTheme(readUserTheme()); } catch { /* ignore */ }
  return runtime;
}

/** 当前快照 */
function snapshot(): ThemeSnapshot {
  return getTheme().getTheme();
}

/** 把一个 webContents 加入订阅（返回退订函数） */
function subscribe(webContents: any): () => void {
  subscribers.add(webContents);
  return () => { subscribers.delete(webContents); };
}

/** 同步原生主题（AI 网页按 prefers-color-scheme 跟随；不注入网页）*/
function syncNativeTheme(snap: ThemeSnapshot): void {
  try {
    const electron = require('electron');
    const nativeTheme = electron && electron.nativeTheme;
    if (!nativeTheme) return;
    // 偏好为 system → 让原生跟随系统；否则用激活主题的 colorScheme
    if (snap.preference === 'system') nativeTheme.themeSource = 'system';
    else nativeTheme.themeSource = snap.active && snap.active.colorScheme === 'dark' ? 'dark' : 'light';
  } catch (_) { /* ignore */ }
}

/** 变化时推送快照给所有订阅者 + 所有窗口 */
function broadcastSnapshot(snap: ThemeSnapshot): void {
  syncNativeTheme(snap);
  // 订阅者（显式订阅的 webContents）
  for (const wc of subscribers) {
    try { wc.send('theme-changed', snap); } catch (_) { /* ignore */ }
  }
  // 所有窗口的壳页面 + AI 页面都推一份（保证一致）
  try {
    for (const ctx of windowState.getAllContexts()) {
      try { ctx.win && ctx.win.webContents && ctx.win.webContents.send('theme-changed', snap); } catch (_) {}
      try { ctx.view && ctx.view.webContents && ctx.view.webContents.send('theme-changed', snap); } catch (_) {}
    }
  } catch (_) { /* ignore */ }
}

// ===== 供 IPC 调用的操作 =====
function setTheme(id: string): ThemeSnapshot {
  getTheme().setTheme(id);
  writePreference(id);
  return snapshot();
}
function register(definition: ThemeDefinition): string {
  const dispose = getTheme().register(definition);
  // 注册表以主进程为权威；这里返回一个 token，IPC 侧据此撤销
  return storeDisposer(dispose);
}
function overrideTokens(source: string, tokens: ThemeTokenOverrides): string {
  const dispose = getTheme().overrideTokens(source, tokens);
  return storeDisposer(dispose);
}
function list(): readonly ThemeDefinition[] {
  return getTheme().list();
}

// disposer 仓库：IPC 不能传函数，用字符串 token 映射
const disposers = new Map<string, () => void>();
let disposerSeq = 0;
function storeDisposer(fn: () => void): string {
  const id = 'd' + (disposerSeq++);
  disposers.set(id, fn);
  return id;
}
function dispose(token: string): boolean {
  const fn = disposers.get(token);
  if (!fn) return false;
  disposers.delete(token);
  try { fn(); } catch (_) { /* ignore */ }
  return true;
}

export {
  getTheme, snapshot, subscribe, broadcastSnapshot,
  setTheme, register, overrideTokens, list, dispose,
  getUserTheme, setUserTheme, resetUserTheme,
};

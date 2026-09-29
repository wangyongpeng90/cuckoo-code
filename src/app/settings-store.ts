/**
 * overlay 设置的主进程持久化存储（userData/settings.json）
 *
 * 由原 AI 页面 localStorage 的 16 个 cuckoo-* 设置键迁移而来（UI 改版 Task 1）。
 * 文件为扁平 JSON：16 个设置字段 + `migrated` 标记（旧版 localStorage 数据是否已迁入）。
 * 读取容错：文件缺失 / 坏 JSON / 字段类型非法 → 对应字段回退默认值；未知键忽略。
 *
 * 渲染侧不直接读文件，经 IPC（settings-get/set/reset/migrate）访问，
 * 并在 overlay/settings.ts 里做内存缓存（retry/watchdog 的 timer 回调需同步读）。
 *
 * 测试通过 setSettingsDir 注入临时目录，不触达真实 userData。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Settings } from '../bridge/api-types.js';

const require = createRequire(import.meta.url);

const DEFAULT_RETRY_PROMPT = '刚才的回复似乎中断了，请重新完整回答上一个问题。';
const DEFAULT_WATCHDOG_PROMPT = '请继续';

const DEFAULT_SETTINGS: Settings = {
  retryEnabled: true,
  retryDelayMin: 4000,
  retryDelayMax: 10000,
  retryCount: 10,
  retry429Delay: 60000,
  retry429Count: 20,
  retryPrompt: DEFAULT_RETRY_PROMPT,
  xhrIdleTimeout: 300000,
  watchdogPrompt: DEFAULT_WATCHDOG_PROMPT,
  watchdogCount: 3,
  sendDelayMin: 2000,
  sendDelayMax: 4000,
  attachDelayMin: 500,
  attachDelayMax: 1000,
  autoCompactEnabled: false,
  autoCompactThreshold: 80,
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

let storeDir: string | null = null;
/** 测试用：注入存储目录；生产环境为 userData */
function setSettingsDir(dir: string): void {
  storeDir = dir;
}

function file(): string {
  const dir = storeDir || require('electron').app.getPath('userData');
  return path.join(dir, 'settings.json');
}

function readRaw(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(file(), 'utf-8');
    const o = JSON.parse(raw);
    return (o && typeof o === 'object') ? o : {};
  } catch (_) {
    return {};
  }
}

function writeRaw(o: Record<string, unknown>): void {
  try {
    fs.writeFileSync(file(), JSON.stringify(o, null, 2), 'utf-8');
  } catch (_) {}
}

/** 单个字段值是否合法（与该字段默认值同型；字符串非空） */
function isValidValue(key: keyof Settings, v: unknown): boolean {
  const d = DEFAULT_SETTINGS[key];
  if (typeof d === 'boolean') return typeof v === 'boolean';
  if (typeof d === 'number') return typeof v === 'number' && Number.isFinite(v);
  return typeof v === 'string' && v.length > 0;
}

/** 归一化任意对象为完整 Settings：未知键忽略，非法字段回退默认 */
function normalize(raw: Record<string, unknown>): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const k of SETTING_KEYS) {
    const v = raw[k];
    if (isValidValue(k, v)) (s as any)[k] = v;
  }
  return s;
}

/** 从补丁对象中挑出合法字段（忽略未知键与非法值） */
function pickValid(patch: unknown): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (!patch || typeof patch !== 'object') return out;
  const p = patch as Record<string, unknown>;
  for (const k of SETTING_KEYS) {
    if (!(k in p)) continue;
    if (isValidValue(k, p[k])) (out as any)[k] = p[k];
  }
  return out;
}

function getSettings(): Settings {
  return normalize(readRaw());
}

function isMigrated(): boolean {
  return readRaw().migrated === true;
}

/** 部分更新设置并持久化；返回更新后的完整设置。保留 migrated 标记与已有字段。 */
function saveSettings(patch: unknown): Settings {
  const raw = readRaw();
  const next = { ...normalize(raw), ...pickValid(patch) };
  writeRaw({ ...next, migrated: raw.migrated === true });
  return next;
}

/** 「恢复默认」不含自动压缩配置（沿用旧 localStorage 时代的语义：autoCompact 由独立区块管理） */
const RESET_EXCLUDED: (keyof Settings)[] = ['autoCompactEnabled', 'autoCompactThreshold'];

/** 恢复默认设置并持久化；保留 migrated 标记与 RESET_EXCLUDED 字段的现值。 */
function resetSettings(): Settings {
  const raw = readRaw();
  const cur = normalize(raw);
  const next: Settings = { ...DEFAULT_SETTINGS };
  for (const k of RESET_EXCLUDED) (next as any)[k] = cur[k];
  writeRaw({ ...next, migrated: raw.migrated === true });
  return next;
}

/**
 * 旧版 localStorage 设置迁入：只应用一次。
 * 已迁移过（migrated=true）则 no-op，返回 false；否则合并补丁并标记 migrated。
 */
function applyLegacyMigration(patch: unknown): boolean {
  const raw = readRaw();
  if (raw.migrated === true) return false;
  const next = { ...normalize(raw), ...pickValid(patch) };
  writeRaw({ ...next, migrated: true });
  return true;
}

export {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  resetSettings,
  applyLegacyMigration,
  isMigrated,
  setSettingsDir,
};

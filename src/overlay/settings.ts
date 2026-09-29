/**
 * 渲染侧设置缓存（overlay / bridge 唯一读取入口）
 *
 * 设置的真实存储在主进程 userData/settings.json（见 app/settings-store.ts），
 * 渲染进程经 window.electronAPI 的 getSettings/saveSettings/resetSettings/migrateSettings 访问。
 * retry / watchdog 的 timer 回调需要同步读取，故本模块在 init 时拉取一次到内存缓存，
 * 之后由三处刷新：本窗口 saveSettings / resetSettings 成功、主进程广播 'settings-changed'
 *（另一窗口保存时，见 bridge/entry.ts 的 ipcRenderer.on 注册）。所有读取方一律走同步的
 * getCachedSettings()。缓存每次刷新都会重镜像 hook 键并通知 onSettingsChanged 订阅者
 *（auto-compact 借此同步运行态与 UI）。
 *
 * 另负责两件与存储介质相关的事：
 *  1) 旧数据迁移：检测页面 localStorage 中的旧版 cuckoo-* 设置键，
 *     解析后经 migrateSettings 交给主进程（主进程按 migrated 标记只应用一次），
 *     然后删除旧键。token 统计、ds-headers 等非设置键不动；
 *     'cuckoo-xhr-idle-timeout' 也跳过删除——它是 hook 镜像键，由镜像覆盖写，
 *     避免"删旧键 → 镜像写入"之间的 IPC 间隙让新启动的流读到缺省值。
 *  2) hook 镜像：主世界注入的 hook（providers/hooks/deepseek.ts）无法 import 本模块，
 *     仍从 localStorage 读 'cuckoo-xhr-idle-timeout'，故每次拿到新设置后把该键
 *     镜像写回 localStorage（hook 代码不动）。
 */
import type { Settings } from '../bridge/api-types.js';
import { DEFAULT_SETTINGS } from '../app/settings-store.js';
import { KEYS } from './storage.js';

// 内存缓存：initSettings() 前为默认值（DEFAULT_SETTINGS 即旧 localStorage 键缺失时的语义）
let cache: Settings = { ...DEFAULT_SETTINGS };

// 设置变更订阅者（auto-compact 用来同步运行态与 UI）
const changeListeners: ((s: Settings) => void)[] = [];

/** 同步读取当前设置（init 前返回默认值） */
function getCachedSettings(): Settings {
  return cache;
}

/** 主世界 hook 需要的设置键镜像回 localStorage */
function mirrorHookKeys(s: Settings): void {
  try {
    localStorage.setItem(KEYS.xhrIdleTimeout, String(s.xhrIdleTimeout));
  } catch (_) {}
}

/** 应用一份完整设置：刷新缓存、重镜像 hook 键、通知订阅者 */
function applySettings(s: Settings): void {
  cache = { ...DEFAULT_SETTINGS, ...s };
  mirrorHookKeys(cache);
  for (const cb of changeListeners) {
    try { cb(cache); } catch (_) {}
  }
}

/** 主进程广播 'settings-changed' 时调用（另一窗口保存/重置/迁移后同步本窗口） */
function applyRemoteSettings(s: unknown): void {
  if (!s || typeof s !== 'object') return;
  applySettings({ ...DEFAULT_SETTINGS, ...(s as Partial<Settings>) });
}

/** 订阅设置变更（缓存每次刷新后触发，含本窗口保存与主进程广播） */
function onSettingsChanged(cb: (s: Settings) => void): void {
  changeListeners.push(cb);
}

function readLegacyRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

/** 收集 localStorage 中仍存在的旧版设置键，解析为 Settings 补丁；无旧键返回 null */
function collectLegacyPatch(): Partial<Settings> | null {
  const patch: Partial<Settings> = {};
  let found = false;

  const boolKey = (legacyKey: string, field: 'retryEnabled' | 'autoCompactEnabled') => {
    const raw = readLegacyRaw(legacyKey);
    if (raw === '1' || raw === '0') { patch[field] = raw === '1'; found = true; }
    else if (raw !== null) found = true; // 键存在即视为待迁移（值非法则主进程忽略该字段）
  };
  const intKey = (legacyKey: string, field: keyof Settings) => {
    const raw = readLegacyRaw(legacyKey);
    if (raw === null) return;
    found = true;
    const v = parseInt(raw, 10);
    if (Number.isFinite(v)) (patch as any)[field] = v;
  };
  const strKey = (legacyKey: string, field: 'retryPrompt' | 'watchdogPrompt') => {
    const raw = readLegacyRaw(legacyKey);
    if (raw === null) return;
    found = true;
    if (raw) patch[field] = raw;
  };

  boolKey(KEYS.retryEnabled, 'retryEnabled');
  intKey(KEYS.retryDelayMin, 'retryDelayMin');
  intKey(KEYS.retryDelayMax, 'retryDelayMax');
  intKey(KEYS.retryCount, 'retryCount');
  intKey(KEYS.retry429Delay, 'retry429Delay');
  intKey(KEYS.retry429Count, 'retry429Count');
  strKey(KEYS.retryPrompt, 'retryPrompt');
  intKey(KEYS.xhrIdleTimeout, 'xhrIdleTimeout');
  strKey(KEYS.watchdogPrompt, 'watchdogPrompt');
  intKey(KEYS.watchdogCount, 'watchdogCount');
  intKey(KEYS.sendDelayMin, 'sendDelayMin');
  intKey(KEYS.sendDelayMax, 'sendDelayMax');
  intKey(KEYS.attachDelayMin, 'attachDelayMin');
  intKey(KEYS.attachDelayMax, 'attachDelayMax');
  boolKey(KEYS.autoCompactEnabled, 'autoCompactEnabled');
  const th = readLegacyRaw(KEYS.autoCompactThreshold);
  if (th !== null) {
    found = true;
    const v = parseFloat(th);
    if (Number.isFinite(v) && v > 0) patch.autoCompactThreshold = v;
  }

  return found ? patch : null;
}

/**
 * 删除旧版设置键（迁移后调用；非设置键如 token 统计/ds-headers 不动）。
 * 跳过 KEYS.xhrIdleTimeout：它是 hook 镜像键，留着旧值直到镜像覆盖写，
 * 避免删除后到镜像写入前的间隙让 hook 读到缺省值。
 */
function removeLegacyKeys(): void {
  const legacyKeys = [
    KEYS.retryEnabled, KEYS.retryDelayMin, KEYS.retryDelayMax,
    KEYS.retryCount, KEYS.retry429Delay, KEYS.retry429Count,
    KEYS.retryPrompt, KEYS.watchdogPrompt,
    KEYS.watchdogCount, KEYS.sendDelayMin, KEYS.sendDelayMax,
    KEYS.attachDelayMin, KEYS.attachDelayMax,
    KEYS.autoCompactEnabled, KEYS.autoCompactThreshold,
  ];
  for (const k of legacyKeys) {
    try { localStorage.removeItem(k); } catch (_) {}
  }
}

/**
 * 初始化设置：迁移旧 localStorage 数据（若有）→ 拉取主进程设置到缓存 → 镜像 hook 键。
 * bridge init 时调用一次，必须早于 retry / watchdog / 设置面板的使用。
 */
async function initSettings(): Promise<Settings> {
  const api = window.electronAPI;
  try {
    const legacy = collectLegacyPatch();
    if (legacy && api && typeof api.migrateSettings === 'function') {
      await api.migrateSettings(legacy);
      // 已交给主进程（其按 migrated 标记决定是否应用），本地旧键删除
      removeLegacyKeys();
    }
    if (api && typeof api.getSettings === 'function') {
      const s = await api.getSettings();
      if (s && typeof s === 'object') applySettings(s as Settings);
    }
  } catch (_) {}
  mirrorHookKeys(cache); // 兜底：getSettings 失败也用默认值镜像一次
  return cache;
}

/** 保存设置补丁到主进程；成功后刷新缓存并镜像 hook 键 */
async function saveSettings(patch: Partial<Settings>): Promise<boolean> {
  try {
    const r = await window.electronAPI.saveSettings(patch);
    if (r && r.settings) {
      applySettings(r.settings);
      return true;
    }
  } catch (_) {}
  return false;
}

/** 恢复默认设置（主进程；autoCompact 两个字段不在重置范围）；成功后刷新缓存并镜像 hook 键 */
async function resetSettings(): Promise<boolean> {
  try {
    const r = await window.electronAPI.resetSettings();
    if (r && r.settings) {
      applySettings(r.settings);
      return true;
    }
  } catch (_) {}
  return false;
}

/** 测试用：直接覆盖内存缓存（不触达主进程，不触发订阅者） */
function __setCacheForTest(patch: Partial<Settings>): void {
  cache = { ...cache, ...patch };
}

export {
  getCachedSettings,
  initSettings,
  saveSettings,
  resetSettings,
  applyRemoteSettings,
  onSettingsChanged,
  __setCacheForTest,
};

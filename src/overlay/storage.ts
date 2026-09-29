/**
 * localStorage 键名集中管理（T8）
 * overlay / bridge 渲染侧的所有 cuckoo-* 键在此定义，键名字符串保持不变。
 *
 * UI 改版 Task 1 之后，16 个设置键（retry 系列、watchdog 系列、xhr-idle-timeout、
 * send-delay、attach-delay、auto-compact 系列）已不再作为数据源：设置存于主进程
 * settings.json（见 app/settings-store.ts），渲染侧经 overlay/settings.ts 的内存缓存读取。
 * 这些键名常量仍保留，仅用于两处：
 *  1) overlay/settings.ts 检测并迁移页面 localStorage 中残留的旧版设置（迁移后删除）；
 *  2) 把 xhrIdleTimeout 镜像回 localStorage 供主世界 hook 读取。
 * 注意：注入主世界的 hook（providers/hooks/deepseek.ts）无法 import 本模块，
 * 其内部的 'cuckoo-xhr-idle-timeout' / 'cuckoo-ds-headers' 字面量须与这里保持一致。
 */
const KEYS = {
  /** 发送延迟（毫秒） */
  sendDelayMin: 'cuckoo-send-delay-min',
  sendDelayMax: 'cuckoo-send-delay-max',
  /** 失败自动重试 */
  retryEnabled: 'cuckoo-retry-enabled',
  retryDelayMin: 'cuckoo-retry-delay-min',
  retryDelayMax: 'cuckoo-retry-delay-max',
  retryCount: 'cuckoo-retry-count',
  retry429Delay: 'cuckoo-retry-429-delay',
  retry429Count: 'cuckoo-retry-429-count',
  retryPrompt: 'cuckoo-retry-prompt',
  /** SSE 流静默阈值（毫秒；主世界 hook 侧读取） */
  xhrIdleTimeout: 'cuckoo-xhr-idle-timeout',
  /** 工具循环看门狗 */
  watchdogPrompt: 'cuckoo-watchdog-prompt',
  watchdogCount: 'cuckoo-watchdog-count',
  /** 附件上传间隔（毫秒） */
  attachDelayMin: 'cuckoo-attach-delay-min',
  attachDelayMax: 'cuckoo-attach-delay-max',
  /** 自动压缩（阈值单位：万 token） */
  autoCompactEnabled: 'cuckoo-auto-compact-enabled',
  autoCompactThreshold: 'cuckoo-auto-compact-threshold',
  /** 对话 token 统计（JSON） */
  tokenCache: 'cuckoo-token-cache',
  tokenDaily: 'cuckoo-token-daily',
  tokenDailyVersion: 'cuckoo-token-daily-version',
} as const;

/**
 * 读取并 JSON 解析一个键；键不存在或解析失败（坏 JSON）时返回调用方给的默认值。
 * localStorage 不可用（抛错）时同样返回默认值。
 */
function readKey<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

/** JSON 序列化写入一个键；localStorage 不可用时静默忽略 */
function writeKey(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

/** 删除一个键；localStorage 不可用时静默忽略 */
function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (_) {}
}

export { KEYS, readKey, writeKey, removeKey };

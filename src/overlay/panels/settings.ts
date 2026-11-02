/**
 * 设置弹窗：加载/保存/恢复默认，以及自动压缩与 token 显示
 * 由 events.ts 拆分而来（P4.5），逻辑保持不变。
 */
import { showToast } from '../panel.js';
import { state } from '../state.js';
import {
  DEFAULT_JS_RESULT_PHRASES, JS_RESULT_PHRASES_KEY,
  DEFAULT_JS_RESULT_ITEM_TEMPLATES, JS_RESULT_ITEM_TEMPLATES_KEY,
} from '../js-result-phrases.js';
import { getSharedSetting, saveSharedSettingValues, removeSharedSettingKeys } from '../shared-settings-cache.js';
import { CONTINUE_PROMPT_KEY, DEFAULT_CONTINUE_PROMPTS } from '../../infra/continue-prompt-pool.js';
import {
  READ_HEADER_FULL_KEY, READ_HEADER_PARTIAL_KEY,
  READ_FOOTER_FULL_KEY, READ_FOOTER_PARTIAL_KEY, READ_FOOTER_CAPPED_KEY,
  GLOB_FOOTER_FULL_KEY, GLOB_FOOTER_TRUNCATED_KEY,
  WRITE_FOOTER_CREATE_KEY, WRITE_FOOTER_UPDATE_KEY,
  DEFAULT_READ_HEADER_FULL, DEFAULT_READ_HEADER_PARTIAL,
  DEFAULT_READ_FOOTER_FULL, DEFAULT_READ_FOOTER_PARTIAL, DEFAULT_READ_FOOTER_CAPPED,
  DEFAULT_GLOB_FOOTER_FULL, DEFAULT_GLOB_FOOTER_TRUNCATED,
  DEFAULT_WRITE_FOOTER_CREATE, DEFAULT_WRITE_FOOTER_UPDATE,
} from '../../infra/read-header-templates.js';


// ========== 纯数据读写（供 IPC：壳页面设置页调用） ==========
// 设置仍以 localStorage 为唯一数据源（AI 页面 loop / hook 需同步读，不能搬走）。
// 本组函数只负责"读 → 返回 UI 单位值" / "校验 → 写回 localStorage + 更新 state"。

/** 安全读 localStorage */
function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

/** AI 回复拦截的默认正则（每行一条，任意命中即拦截） */
const DEFAULT_AI_INTERCEPT_PATTERNS = [
  '^<\\s*｜｜DSML｜｜',
  '<\\s*(?:[\\w-]+:)?invoke\\s+name=',
  '<\\s*\\/\\s*(?:[\\w-]+:)?invoke\\s*>',
  '<\\s*(?:[\\w-]+:)?parameter\\s+name=',
].join('\n');

/** 设置数据（UI 单位：时间类为"秒"；count 为整数；prompt 为文本） */
interface SettingsData {
  retryEnabled: boolean;
  retryDelayMin: number;
  retryDelayMax: number;
  retryCount: number;
  retry429Delay: number;
  retry429Count: number;
  xhrIdleTimeout: number;
  watchdogCount: number;
  sendDelayMin: number;
  sendDelayMax: number;
  attachDelayMin: number;
  attachDelayMax: number;
  goalMaxIterations: number;
  /** 拒绝 webFetch 访问内网/保留地址（默认关闭） */
  ssrfGuard: boolean;
  /** AI 回复拦截的正则（每行一条，任意命中即视为 XML 工具调用） */
  aiInterceptPatterns: string;
  /** [261101-ym9l98] 「让 AI 继续」统一池（一行一条；空 = 使用内置默认） */
  continuePrompt: string;
  // [261101-ym9l98] 工具结果回传文案两个池（空 = 回退 js-result-phrases.ts 的内置默认）
  /** 工具结果回复语池（一行一条，{n} 替换为脚本数；空 = 使用内置默认） */
  jsResultPhrases: string;
  /** 脚本标题模板池（一行一条，{i} 替换为序号；空 = 使用内置默认） */
  jsResultItemTemplates: string;
  // [261101-ym9l98] read 工具首行模板（完整文件 / 部分读取两套池）
  /** 完整文件时的首行模板（{path} {total}） */
  readHeaderFull: string;
  /** 部分读取时的首行模板（{path} {start} {end} {total} {rest}） */
  readHeaderPartial: string;
  // [261101-ym9l98] read 结尾 + glob 结尾的模板池
  /** read 结尾·完整文件（{total}） */
  readFooterFull: string;
  /** read 结尾·部分读取（{start} {end} {total} {next}） */
  readFooterPartial: string;
  /** read 结尾·字节截断（{start} {end} {next}） */
  readFooterCapped: string;
  /** glob 结尾·未截断（{count}） */
  globFooterFull: string;
  /** glob 结尾·截断（{shown} {total}） */
  globFooterTruncated: string;
  // [261101-ym9l98] write 结尾（新建 / 覆盖更新两套池）
  /** write 新建文件（{path}） */
  writeFooterCreate: string;
  /** write 覆盖更新（{path}） */
  writeFooterUpdate: string;
}

// [261101-ym9l98] 保存/读取时归一化，保证单句写法不漏 {r}（否则成败信息会丢）
/**
 * 归一化一条标题模板：空行保留；成对写法（含 |）原样返回；
 * 单句写法缺 {r} 时末尾补上，避免丢成败信息。
 */
function normalizeItemTemplate(line: string): string {
  const t = line.trim();
  if (!t) return '';
  if (t.indexOf('|') >= 0) return t;
  return t.indexOf('{r}') >= 0 ? t : t + ' {r}';
}

/** 旧数据迁移：逐行归一化；无值时用内置默认 */
function migrateItemTemplates(raw: string | null): string {
  if (raw === null) return DEFAULT_JS_RESULT_ITEM_TEMPLATES.join('\n');
  return raw.split('\n').map(normalizeItemTemplate).join('\n');
}

/** 读取当前设置（UI 单位：秒） */
function getSettingsData(): SettingsData {
  const sec = (raw: string | null, dft: number) => {
    const n = parseInt(raw || '', 10);
    return Number.isFinite(n) ? n / 1000 : dft;
  };
  const int = (raw: string | null, dft: number) => {
    const n = parseInt(raw || '', 10);
    return Number.isFinite(n) ? n : dft;
  };
  const enRaw = lsGet('cuckoo-retry-enabled');
  return {
    retryEnabled: enRaw === null ? true : enRaw === '1',
    retryDelayMin: sec(lsGet('cuckoo-retry-delay-min'), 4),
    retryDelayMax: sec(lsGet('cuckoo-retry-delay-max'), 10),
    retryCount: int(lsGet('cuckoo-retry-count'), 10),
    retry429Delay: sec(lsGet('cuckoo-retry-429-delay'), 120),
    retry429Count: int(lsGet('cuckoo-retry-429-count'), 40),

    xhrIdleTimeout: sec(lsGet('cuckoo-xhr-idle-timeout'), 300),

    watchdogCount: int(lsGet('cuckoo-watchdog-count'), 3),
    sendDelayMin: sec(lsGet('cuckoo-send-delay-min'), 10),
    sendDelayMax: sec(lsGet('cuckoo-send-delay-max'), 20),
    attachDelayMin: sec(lsGet('cuckoo-attach-delay-min'), 0.5),
    attachDelayMax: sec(lsGet('cuckoo-attach-delay-max'), 1),
    goalMaxIterations: int(lsGet('cuckoo-goal-max-iterations'), 50),
    ssrfGuard: lsGet('cuckoo-ssrf-guard') === '1',
    aiInterceptPatterns: lsGet('cuckoo-ai-intercept-patterns') || DEFAULT_AI_INTERCEPT_PATTERNS,
    // [261101-ym9l98] 统一「继续」池：未自定义时展示内置全文（首次副本呈现）
    continuePrompt: getSharedSetting(CONTINUE_PROMPT_KEY) ?? DEFAULT_CONTINUE_PROMPTS.join('\n'),
    // [261101-ym9l98] 两个池存在主进程（所有窗口共享），未自定义时展示内置全文
    jsResultPhrases: getSharedSetting(JS_RESULT_PHRASES_KEY) ?? DEFAULT_JS_RESULT_PHRASES.join('\n'),
    jsResultItemTemplates: migrateItemTemplates(getSharedSetting(JS_RESULT_ITEM_TEMPLATES_KEY) ?? null),
    readHeaderFull: getSharedSetting(READ_HEADER_FULL_KEY) ?? DEFAULT_READ_HEADER_FULL.join('\n'),
    readHeaderPartial: getSharedSetting(READ_HEADER_PARTIAL_KEY) ?? DEFAULT_READ_HEADER_PARTIAL.join('\n'),
    readFooterFull: getSharedSetting(READ_FOOTER_FULL_KEY) ?? DEFAULT_READ_FOOTER_FULL.join('\n'),
    readFooterPartial: getSharedSetting(READ_FOOTER_PARTIAL_KEY) ?? DEFAULT_READ_FOOTER_PARTIAL.join('\n'),
    readFooterCapped: getSharedSetting(READ_FOOTER_CAPPED_KEY) ?? DEFAULT_READ_FOOTER_CAPPED.join('\n'),
    globFooterFull: getSharedSetting(GLOB_FOOTER_FULL_KEY) ?? DEFAULT_GLOB_FOOTER_FULL.join('\n'),
    globFooterTruncated: getSharedSetting(GLOB_FOOTER_TRUNCATED_KEY) ?? DEFAULT_GLOB_FOOTER_TRUNCATED.join('\n'),
    writeFooterCreate: getSharedSetting(WRITE_FOOTER_CREATE_KEY) ?? DEFAULT_WRITE_FOOTER_CREATE.join('\n'),
    writeFooterUpdate: getSharedSetting(WRITE_FOOTER_UPDATE_KEY) ?? DEFAULT_WRITE_FOOTER_UPDATE.join('\n'),
  };
}

/**
 * 校验并写回设置（UI 单位 → 存储毫秒）。
 * @returns { success, error? }
 */
async function applySettingsData(data: any): Promise<{ success: boolean; error?: string }> {
  const secToMs = (s: any) => Math.round(parseFloat(s) * 1000);
  const dmin = secToMs(data && data.retryDelayMin);
  const dmax = secToMs(data && data.retryDelayMax);
  if (!Number.isFinite(dmin) || dmin < 0) return { success: false, error: '普通失败最小间隔必须是非负数字' };
  if (!Number.isFinite(dmax) || dmax < dmin) return { success: false, error: '普通失败最大间隔不能小于最小间隔' };
  const cnt = parseInt(data && data.retryCount, 10);
  if (Number.isNaN(cnt)) return { success: false, error: '普通失败重试次数必须是整数' };
  const d429 = secToMs(data && data.retry429Delay);
  if (!Number.isFinite(d429) || d429 < 0) return { success: false, error: '操作频繁重试间隔必须是非负数字' };
  const c429 = parseInt(data && data.retry429Count, 10);
  if (Number.isNaN(c429)) return { success: false, error: '操作频繁重试次数必须是整数' };
  const idleTimeout = secToMs(data && data.xhrIdleTimeout);
  if (!Number.isFinite(idleTimeout) || idleTimeout < 0) return { success: false, error: 'AI 回复超时必须是非负数字' };
  const watchdogCount = parseInt(data && data.watchdogCount, 10);
  if (Number.isNaN(watchdogCount)) return { success: false, error: '超时重试次数必须是整数' };
  const smin = secToMs(data && data.sendDelayMin);
  const smax = secToMs(data && data.sendDelayMax);
  if (!Number.isFinite(smin) || smin < 0) return { success: false, error: '发送延迟最小值必须是非负数字' };
  if (!Number.isFinite(smax) || smax < smin) return { success: false, error: '发送延迟最大值不能小于最小值' };
  const amin = secToMs(data && data.attachDelayMin);
  const amax = secToMs(data && data.attachDelayMax);
  if (!Number.isFinite(amin) || amin < 0) return { success: false, error: '附件上传间隔最小值必须是非负数字' };
  if (!Number.isFinite(amax) || amax < amin) return { success: false, error: '附件上传间隔最大值不能小于最小值' };
  if (amax > 60000) return { success: false, error: '附件上传间隔最大值不能超过 60 秒' };
  // 目标最大迭代次数：属"纯净模式（harness）"自身设置（harness 页有独立入口）。
  // 壳页面设置页不提供此字段 → 仅在显式提供时才校验，缺失时保留原值（不清空、不报错）。
  let goalMax: number | null = null;
  if (data && data.goalMaxIterations !== undefined && data.goalMaxIterations !== null && data.goalMaxIterations !== '') {
    goalMax = parseInt(data.goalMaxIterations, 10);
    if (Number.isNaN(goalMax) || goalMax <= 0) return { success: false, error: '目标最大迭代次数必须是正整数' };
  }
  // AI 回复拦截正则：每条都必须是合法正则（提前校验，避免运行时抛错）
  if (data && data.aiInterceptPatterns !== undefined) {
    const lines = String(data.aiInterceptPatterns || '').split('\n').map((s: string) => s.trim()).filter(Boolean);
    for (const line of lines) {
      try { new RegExp(line, 'i'); } catch (e: any) {
        return { success: false, error: 'AI 拦截正则非法：' + line + '（' + e.message + '）' };
      }
    }
  }

  try {
    localStorage.setItem('cuckoo-retry-enabled', (data && data.retryEnabled) ? '1' : '0');
    localStorage.setItem('cuckoo-retry-delay-min', String(dmin));
    localStorage.setItem('cuckoo-retry-delay-max', String(dmax));
    localStorage.setItem('cuckoo-retry-count', String(cnt));
    localStorage.setItem('cuckoo-retry-429-delay', String(d429));
    localStorage.setItem('cuckoo-retry-429-count', String(c429));
    localStorage.setItem('cuckoo-xhr-idle-timeout', String(idleTimeout));
    localStorage.setItem('cuckoo-watchdog-count', String(watchdogCount));
    localStorage.setItem('cuckoo-send-delay-min', String(smin));
    localStorage.setItem('cuckoo-send-delay-max', String(smax));
    localStorage.setItem('cuckoo-attach-delay-min', String(amin));
    localStorage.setItem('cuckoo-attach-delay-max', String(amax));
    if (goalMax !== null) localStorage.setItem('cuckoo-goal-max-iterations', String(goalMax));
    // ssrfGuard 仅当显式提供时才写（避免未传该字段的调用方把它清成 0）
    if (data && data.ssrfGuard !== undefined) localStorage.setItem('cuckoo-ssrf-guard', data.ssrfGuard ? '1' : '0');
    // AI 回复拦截规则：只写非空字段（保留空列表的语义——空 = 不拦截）
    if (data && data.aiInterceptPatterns !== undefined) localStorage.setItem('cuckoo-ai-intercept-patterns', String(data.aiInterceptPatterns || ''));
  } catch (err: any) {
    return { success: false, error: '写入失败: ' + err.message };
  }

  // [261101-ym9l98] 两个池写主进程（所有窗口共享）；归一化后逐行保存
  const shared: Record<string, string> = {};
  if (data && data.jsResultPhrases !== undefined) {
    shared[JS_RESULT_PHRASES_KEY] = String(data.jsResultPhrases || '');
  }
  if (data && data.jsResultItemTemplates !== undefined) {
    shared[JS_RESULT_ITEM_TEMPLATES_KEY] = String(data.jsResultItemTemplates || '')
      .split('\n').map(normalizeItemTemplate).join('\n');
  }
  if (data && data.readHeaderFull !== undefined) {
    shared[READ_HEADER_FULL_KEY] = String(data.readHeaderFull || '');
  }
  if (data && data.readHeaderPartial !== undefined) {
    shared[READ_HEADER_PARTIAL_KEY] = String(data.readHeaderPartial || '');
  }
  if (data && data.continuePrompt !== undefined) {
    shared[CONTINUE_PROMPT_KEY] = String(data.continuePrompt || '');
  }
  const footerMap: Array<[string, string, string]> = [
    ['readFooterFull', READ_FOOTER_FULL_KEY, ''],
    ['readFooterPartial', READ_FOOTER_PARTIAL_KEY, ''],
    ['readFooterCapped', READ_FOOTER_CAPPED_KEY, ''],
    ['globFooterFull', GLOB_FOOTER_FULL_KEY, ''],
    ['globFooterTruncated', GLOB_FOOTER_TRUNCATED_KEY, ''],
    ['writeFooterCreate', WRITE_FOOTER_CREATE_KEY, ''],
    ['writeFooterUpdate', WRITE_FOOTER_UPDATE_KEY, ''],
  ];
  for (const [field, key] of footerMap) {
    if (data && (data as any)[field] !== undefined) {
      shared[key] = String((data as any)[field] || '');
    }
  }
  if (Object.keys(shared).length > 0) {
    const ok = await saveSharedSettingValues(shared);
    if (!ok) return { success: false, error: '通用设置写入失败' };
  }
  state.sendDelayMin = smin;
  state.sendDelayMax = smax;
  return { success: true };
}

/** 恢复默认：清 key + 重置 state，返回默认值 */
async function resetSettingsData(): Promise<SettingsData> {
  const KEYS = [
    'cuckoo-retry-enabled', 'cuckoo-retry-delay-min', 'cuckoo-retry-delay-max',
    'cuckoo-retry-count', 'cuckoo-retry-429-delay', 'cuckoo-retry-429-count',
    'cuckoo-retry-prompt', 'cuckoo-xhr-idle-timeout', 'cuckoo-watchdog-prompt',
    'cuckoo-watchdog-count', 'cuckoo-send-delay-min', 'cuckoo-send-delay-max',
    'cuckoo-attach-delay-min', 'cuckoo-attach-delay-max',
    'cuckoo-goal-max-iterations', 'cuckoo-ssrf-guard',
    'cuckoo-ai-intercept-patterns', 'cuckoo-ai-intercept-prompt',
  ];
  try { for (const k of KEYS) localStorage.removeItem(k); } catch (_) {}
  state.sendDelayMin = 10000;
  state.sendDelayMax = 20000;
  // [261101-ym9l98] 两个池存在主进程，单独删除
  await removeSharedSettingKeys([
    JS_RESULT_PHRASES_KEY, JS_RESULT_ITEM_TEMPLATES_KEY,
    READ_HEADER_FULL_KEY, READ_HEADER_PARTIAL_KEY,
    READ_FOOTER_FULL_KEY, READ_FOOTER_PARTIAL_KEY, READ_FOOTER_CAPPED_KEY,
    GLOB_FOOTER_FULL_KEY, GLOB_FOOTER_TRUNCATED_KEY,
    WRITE_FOOTER_CREATE_KEY, WRITE_FOOTER_UPDATE_KEY,
  ]);
  return getSettingsData();
}

export { getSettingsData, applySettingsData, resetSettingsData };
export type { SettingsData };

/**
 * Cuckoo 插件系统 - 主题运行时（对标 DSH ui-theme）
 *
 * 参考 DSH `packages/client/ui-theme/src/client/index.ts` 的 ThemeRuntime：
 *   - 内置 light / dark 两套基础调色板
 *   - 第三方主题通过 register() 注册（id + colorScheme + tokens）
 *   - overrideTokens() 栈式覆盖层（后注册者胜、可撤销）
 *   - 偏好 light / dark / system（system 走 prefers-color-scheme）
 *   - 每次变化发布不可变快照 + 派发 'theme/change' 事件
 *
 * Cuckoo 差异：
 *   - token 前缀用 --ck-*（Cuckoo 自己的体系），不照搬 --dsw-*
 *   - 呈现层不在本模块（见壳页面 scripts/theme-presenter.ts），
 *     本模块只管注册表/偏好/覆盖层，不碰 DOM —— 与 DSH 的"服务与呈现分离"一致
 */
import type { EventBus } from './events.js';

/** 主题 token 值：一个 token 名 → CSS 值 */
export type ThemeTokens = Record<string, string>;

/**
 * 覆盖层单条 token 值：亮/暗两套必须都给（同值时重复即可）。
 * 强制双值是 DSH 的设计——防止切换到另一套配色时不可读。
 */
export interface ThemeTokenModes {
  light: string;
  dark: string;
}

/** 覆盖层字典：token 名 → { light, dark } */
export type ThemeTokenOverrides = Record<string, ThemeTokenModes>;

/** 一个可选主题：id + 亮暗归属 + token 覆盖 */
export interface ThemeDefinition {
  /** 主题 id */
  id: string;
  /** 基于哪套基础调色板（呈现层据此设 data-ck-dark） */
  colorScheme: 'light' | 'dark';
  /** token 覆盖（--ck-* 变量名 → 值） */
  tokens: ThemeTokens;
}

/** 主题偏好（持久化用） */
export type ThemePreference = 'light' | 'dark' | 'system';

/** 每次变化发布的不可变快照 */
export interface ThemeSnapshot {
  /** 持久化偏好（可能是 system） */
  preference: ThemePreference;
  /** 解析后的当前主题（system 已按 prefers-color-scheme 解析，覆盖层已折叠） */
  active: ThemeDefinition;
  /** 已注册主题（注册顺序） */
  themes: readonly ThemeDefinition[];
  /** 单调递增的变更计数 */
  revision: number;
}

/** 主题服务（插件可见的 ctx.theme） */
export interface ThemeService {
  /** 读当前不可变快照 */
  getTheme(): ThemeSnapshot;
  /** 列出已注册主题 */
  list(): readonly ThemeDefinition[];
  /** 切换主题偏好（唯一用户偏好写入入口） */
  setTheme(id: string): void;
  /** 注册主题，返回 disposer */
  register(definition: ThemeDefinition): () => void;
  /** 叠加 token 覆盖层，返回 disposer */
  overrideTokens(source: string, tokens: ThemeTokenOverrides): () => void;
}

const BUILTIN_THEMES: readonly ThemeDefinition[] = Object.freeze([
  Object.freeze({ id: 'light', colorScheme: 'light' as const, tokens: Object.freeze({}) }),
  Object.freeze({ id: 'dark', colorScheme: 'dark' as const, tokens: Object.freeze({}) }),
]);

const DEFAULT_PREFERENCE: ThemePreference = 'system';

/**
 * 主题运行时：注册表 + 偏好 + 覆盖层。
 * 通过 ctx.provide('theme', ...) 暴露给插件；变化时 emit 'theme/change'。
 */
export class ThemeRuntime {
  private readonly bus: EventBus;
  private themes: ThemeDefinition[] = [...BUILTIN_THEMES];
  private preference: ThemePreference = DEFAULT_PREFERENCE;
  private revision = 0;
  private snapshot: ThemeSnapshot;
  private readonly media: MediaQueryList | undefined;
  /** 覆盖层：source → { seq, tokens }；seq 是叠加顺序 */
  private readonly overrides = new Map<string, { seq: number; tokens: ThemeTokenOverrides }>();
  private overrideSeq = 0;
  /** 想切但尚未注册的主题（等 register 时自动应用） */
  private pendingPreference: ThemePreference | null = null;

  /** 系统配色提供者（主进程注入 nativeTheme；缺省用 matchMedia）*/
  private readonly systemSchemeProvider?: () => 'light' | 'dark';

  constructor(bus: EventBus, systemSchemeProvider?: () => 'light' | 'dark') {
    this.bus = bus;
    this.systemSchemeProvider = systemSchemeProvider;
    this.media = typeof matchMedia === 'undefined'
      ? undefined
      : matchMedia('(prefers-color-scheme: dark)');
    this.snapshot = this.buildSnapshot();
    if (this.media !== undefined) {
      const media = this.media;
      const onChange = (): void => {
        if (this.preference !== 'system') return;
        this.publish();
      };
      try { media.addEventListener('change', onChange); } catch (_) { /* ignore */ }
    }
  }

  /** 读当前不可变快照（下次变化前引用稳定） */
  getTheme(): ThemeSnapshot {
    return this.snapshot;
  }

  /** 列出已注册主题 */
  list(): readonly ThemeDefinition[] {
    return this.snapshot.themes;
  }

  /**
   * 切换主题偏好——唯一的用户偏好写入入口。
   * @param id 已注册主题 id 或 'system'；未注册抛错
   */
  setTheme(id: string): void {
    if (id !== 'system' && !this.themes.some((t) => t.id === id)) {
      // 目标主题尚未注册（常见于启动时读回插件主题，但插件还没加载）——
      // 记进 pending，等该主题 register 时自动应用，不抛错丢失偏好。
      this.pendingPreference = id as ThemePreference;
      return;
    }
    this.pendingPreference = null;
    if (this.preference === id) return;
    this.preference = id as ThemePreference;
    this.publish();
  }

  /**
   * 注册一个主题。id 重复抛错；'system' 是偏好不是主题 id，不可注册。
   * @returns disposer；卸载当前激活主题会把偏好重置为默认
   */
  register(definition: ThemeDefinition): () => void {
    if (!definition || typeof definition.id !== 'string' || !definition.id) {
      throw new Error('主题必须有 id');
    }
    if (definition.id === 'system') {
      throw new Error('"system" 是偏好，不是可注册的主题 id');
    }
    if (this.themes.some((t) => t.id === definition.id)) {
      throw new Error('主题 "' + definition.id + '" 已注册');
    }
    const scheme = definition.colorScheme === 'dark' ? 'dark' : 'light';
    const def: ThemeDefinition = Object.freeze({
      id: definition.id,
      colorScheme: scheme,
      tokens: Object.freeze({ ...(definition.tokens || {}) }),
    });
    this.themes = [...this.themes, def];
    // 若之前有待定偏好指向本主题（启动时读回插件主题），现在应用它
    if (this.pendingPreference === def.id) {
      this.pendingPreference = null;
      this.preference = def.id as ThemePreference;
    }
    this.publish();
    return () => {
      if (!this.themes.some((t) => t.id === definition.id)) return;
      this.themes = this.themes.filter((t) => t.id !== definition.id);
      if (this.preference === definition.id) this.preference = DEFAULT_PREFERENCE;
      this.publish();
    };
  }

  /**
   * 叠加一层 token 覆盖（栈式：后注册者按 seq 胜出；移除一层恢复其覆盖前）。
   * 同一 source 再次调用会替换该层的整体并重新置顶（effect 重注册语义）。
   * @param source 层标识（一个 source 一层）
   * @param tokens token 名 → { light, dark }
   * @returns disposer，只撤销本次创建的层
   */
  overrideTokens(source: string, tokens: ThemeTokenOverrides): () => void {
    const layer = { seq: this.overrideSeq++, tokens: validateOverrides(source, tokens) };
    this.overrides.set(source, layer);
    this.publish();
    return () => {
      if (this.overrides.get(source) !== layer) return;
      this.overrides.delete(source);
      this.publish();
    };
  }

  /** 解析系统配色：优先用注入的 provider（主进程 nativeTheme），否则用 matchMedia */
  private resolveSystemScheme(): 'light' | 'dark' {
    if (this.systemSchemeProvider) {
      try { return this.systemSchemeProvider() === 'dark' ? 'dark' : 'light'; } catch { /* fall through */ }
    }
    return this.media?.matches === true ? 'dark' : 'light';
  }

  private buildSnapshot(): ThemeSnapshot {
    const resolvedId = this.preference === 'system'
      ? this.resolveSystemScheme()
      : this.preference;
    const active = this.themes.find((t) => t.id === resolvedId);
    if (active === undefined) {
      // 理论上不可达（built-in 恒在 + dispose 会重置偏好）
      throw new Error('主题注册表丢失了 "' + resolvedId + '"');
    }
    return Object.freeze({
      preference: this.preference,
      active: this.composeActive(active),
      themes: Object.freeze([...this.themes]),
      revision: this.revision,
    });
  }

  /** 把覆盖层折叠进激活主题：seq 顺序，后层按 token 胜出，按当前配色取 light/dark */
  private composeActive(active: ThemeDefinition): ThemeDefinition {
    if (this.overrides.size === 0) return active;
    const tokens: ThemeTokens = { ...active.tokens };
    const layers = [...this.overrides.values()].sort((a, b) => a.seq - b.seq);
    for (const layer of layers) {
      for (const [name, modes] of Object.entries(layer.tokens)) {
        tokens[name] = modes[active.colorScheme];
      }
    }
    return Object.freeze({ ...active, tokens: Object.freeze(tokens) });
  }

  private publish(): void {
    this.revision += 1;
    this.snapshot = this.buildSnapshot();
    try { this.bus.emit('theme/change', this.snapshot); } catch (_) { /* ignore */ }
  }
}

/** 覆盖层的运行时形状校验（模型/JS 调用方无类型，边界必须挡） */
function validateOverrides(source: string, tokens: ThemeTokenOverrides): ThemeTokenOverrides {
  const validated: ThemeTokenOverrides = {};
  for (const [name, value] of Object.entries(tokens || {})) {
    if (typeof value === 'string') {
      throw new TypeError(
        '主题覆盖 "' + name + '"（来自 "' + source + '"）是裸字符串——请传 '
        + '{ light: ' + JSON.stringify(value) + ', dark: ' + JSON.stringify(value) + ' }'
        + '（两套配色相同也重复写；单值在切换配色时会不可读）',
      );
    }
    if (typeof value !== 'object' || value === null
      || typeof (value as ThemeTokenModes).light !== 'string'
      || typeof (value as ThemeTokenModes).dark !== 'string') {
      throw new TypeError(
        '主题覆盖 "' + name + '"（来自 "' + source + '"）必须是 { light, dark } 字符串对——每套配色一个值',
      );
    }
    validated[name] = { light: (value as ThemeTokenModes).light, dark: (value as ThemeTokenModes).dark };
  }
  return validated;
}

export { DEFAULT_PREFERENCE, BUILTIN_THEMES };

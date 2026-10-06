/**
 * 渲染进程主题服务代理（转发到主进程权威）
 *
 * 插件通过 ctx.theme 访问主题能力；本代理把操作经 IPC 转发到主进程，
 * 并缓存最新快照供同步读取（getTheme/list 是同步的）。
 *
 * 为什么是代理：主题是应用级全局状态，权威在主进程（多窗口 + 标题栏统一）。
 * 渲染进程不自己维护注册表，只做转发 + 缓存。
 */
import type { ThemeService, ThemeSnapshot, ThemeDefinition, ThemeTokenOverrides } from './theme-runtime.js';

/** 兜底快照（主进程首个快照到达前用） */
const FALLBACK_SNAPSHOT: ThemeSnapshot = Object.freeze({
  preference: 'system',
  active: Object.freeze({ id: 'light', colorScheme: 'light' as const, tokens: Object.freeze({}) }),
  themes: Object.freeze([
    Object.freeze({ id: 'light', colorScheme: 'light' as const, tokens: Object.freeze({}) }),
    Object.freeze({ id: 'dark', colorScheme: 'dark' as const, tokens: Object.freeze({}) }),
  ]),
  revision: 0,
});

/** 创建一个 IPC 主题代理 */
export function createThemeProxy(): ThemeService {
  const api = () => (typeof window !== 'undefined' ? (window as any).electronAPI : undefined);
  let cached: ThemeSnapshot = FALLBACK_SNAPSHOT;
  let subscribed = false;

  // 懒订阅主进程推送，更新本地缓存
  function ensureSubscribed(): void {
    if (subscribed) return;
    const a = api();
    if (!a) return;
    subscribed = true;
    try {
      if (typeof a.onThemeChanged === 'function') {
        a.onThemeChanged((snap: ThemeSnapshot) => { if (snap) cached = snap; });
      }
      if (typeof a.themeSubscribe === 'function') {
        Promise.resolve(a.themeSubscribe()).catch(() => {});
      }
      if (typeof a.themeGet === 'function') {
        Promise.resolve(a.themeGet()).then((r: any) => {
          if (r && r.success && r.snapshot) cached = r.snapshot;
        }).catch(() => {});
      }
    } catch (_) { /* ignore */ }
  }

  // 同步：返回本地缓存（首次调用触发订阅拉取）
  function getTheme(): ThemeSnapshot {
    ensureSubscribed();
    return cached;
  }

  function list(): readonly ThemeDefinition[] {
    ensureSubscribed();
    return cached.themes;
  }

  function setTheme(id: string): void {
    const a = api();
    if (!a || typeof a.themeSet !== 'function') {
      throw new Error('theme API 不可用');
    }
    Promise.resolve(a.themeSet(id)).then((r: any) => {
      if (r && r.success && r.snapshot) cached = r.snapshot;
      else if (r && r.error) console.error('[theme] setTheme 失败:', r.error);
    }).catch((err: any) => console.error('[theme] setTheme 异常:', err));
  }

  // register/overrideTokens 返回同步 disposer；token 异步到达后填充
  function register(definition: ThemeDefinition): () => void {
    const a = api();
    if (!a || typeof a.themeRegister !== 'function') {
      throw new Error('theme API 不可用');
    }
    let token: string | null = null;
    let disposed = false;
    Promise.resolve(a.themeRegister(definition)).then((r: any) => {
      if (r && r.success) {
        token = r.token;
        if (disposed) {
          // 注册后才被撤销 → 立即撤
          try { a.themeDispose(token); } catch (_) {}
        }
      } else if (r && r.error) {
        console.error('[theme] register 失败:', r.error);
      }
    }).catch((err: any) => console.error('[theme] register 异常:', err));
    return () => {
      disposed = true;
      if (token) { try { a.themeDispose(token); } catch (_) {} }
    };
  }

  function overrideTokens(source: string, tokens: ThemeTokenOverrides): () => void {
    const a = api();
    if (!a || typeof a.themeOverride !== 'function') {
      throw new Error('theme API 不可用');
    }
    let token: string | null = null;
    let disposed = false;
    Promise.resolve(a.themeOverride(source, tokens)).then((r: any) => {
      if (r && r.success) {
        token = r.token;
        if (disposed) {
          try { a.themeDispose(token); } catch (_) {}
        }
      } else if (r && r.error) {
        console.error('[theme] overrideTokens 失败:', r.error);
      }
    }).catch((err: any) => console.error('[theme] overrideTokens 异常:', err));
    return () => {
      disposed = true;
      if (token) { try { a.themeDispose(token); } catch (_) {} }
    };
  }

  return { getTheme, list, setTheme, register, overrideTokens };
}

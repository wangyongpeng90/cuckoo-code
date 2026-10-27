/**
 * Cuckoo 插件（DSH 兼容）主进程集成：
 *   installAndLoad(pkgName)  —— npm 下载 + 加载 + 注册工具
 *   loadEnabledPlugins()     —— 启动时加载所有已启用插件
 *
 * 依赖方向：本模块在 plugins 层（纯 node + esbuild + 工具注册表）。
 */
import { Tool } from '../../tools/core/Tool.js';
import { loadCuckooPlugin } from './loader.js';
import type { CuckooHost } from './loader.js';
import { getCuckooPluginsDir, isValidPluginId } from './paths.js';
import {
  installToProfile,
  uninstallFromProfile,
  listEnabledPlugins,
  listProfilePluginEntries,
  setPluginEnabledInProfile,
} from '../profile/index.js';

/**
 * 从 JSON Schema 生成 JS 调用签名（供提示词），展开嵌套结构——
 * 如 todo_write(todos: {content: string, status: 'pending'|'in_progress'|'completed'}[])
 * AI 看签名就懂参数结构，减少误传。
 */
function typeOf(spec: any, depth: number): string {
  if (!spec || typeof spec !== 'object' || depth > 3) return 'any';
  const t = spec.type;
  if (Array.isArray(spec.enum)) {
    return spec.enum.map((v: any) => JSON.stringify(v)).join('|');
  }
  if (t === 'array') {
    const inner = spec.items ? typeOf(spec.items, depth + 1) : 'any';
    // 对象数组用 (…)[]，简单类型用 string[] 更简洁
    return /[{}()|]/.test(inner) ? '(' + inner + ')[]' : inner + '[]';
  }
  if (t === 'object') {
    const props = spec.properties || {};
    const req: string[] = spec.required || [];
    const inner = Object.keys(props).map((k) => k + (req.includes(k) ? '' : '?') + ': ' + typeOf(props[k], depth + 1));
    return '{' + inner.join(', ') + '}';
  }
  if (t === 'integer') return 'number';
  return t || 'any';
}

/** 生成 JS 调用签名，如 greet(name: string, age?: number) */
function buildJsApi(name: string, parameters: any): string {
  const props = (parameters && parameters.properties) || {};
  const required: string[] = (parameters && parameters.required) || [];
  const parts = Object.keys(props).map((k) => {
    const opt = required.includes(k) ? '' : '?';
    return k + opt + ': ' + typeOf(props[k], 0);
  });
  return name + '(' + parts.join(', ') + ')';
}

/** 把 DSH 插件工具（{name,description,parameters,execute}）包成 Cuckoo Tool */
class DshPluginTool extends Tool {
  private _exec: (args: any) => Promise<any>;
  constructor(def: any) {
    super(def.name, def.description, def.parameters, buildJsApi(def.name, def.parameters));
    this._exec = def.execute;
    this.dynamic = true; // 运行时工具：沙箱注入 + 提示词由运行期生成
  }
  async execute(params: any): Promise<any> {
    // Cuckoo 工具约定：返回 { success, data }
    const out = await this._exec(params);
    return { success: true, data: typeof out === 'string' ? out : JSON.stringify(out) };
  }
  getPromptSection() {
    return { name: 'tool:' + this.name, order: 200, text: '使用 ' + this.jsApi + ' 工具：' + this.description };
  }
}

/** 已加载的插件工具名（供沙箱注入用） */
const loadedPluginTools = new Set<string>();

/** HMR：已加载插件的记录（id → { pluginName, toolNames, disposers }） */
const loadedPlugins = new Map<string, { pluginName: string; toolNames: string[]; disposers: Array<() => void> }>();

/** 从插件目录加载并注册工具到 registry */
async function loadPluginFromDir(dir: string, registry: any, host?: CuckooHost): Promise<{ pluginName: string; tools: string[]; disposers: Array<() => void> }> {
  const { pluginName, tools, disposers } = await loadCuckooPlugin(dir, host);
  const names: string[] = [];
  for (const def of tools) {
    if (!def || typeof def.name !== 'string') continue;
    registry.register(new DshPluginTool(def));
    loadedPluginTools.add(def.name);
    names.push(def.name);
  }
  return { pluginName, tools: names, disposers };
}

/** HMR：卸载一个已加载的插件（调 disposers + 注销工具） */
function unloadPlugin(id: string, registry?: any): boolean {
  const rec = loadedPlugins.get(id);
  if (!rec) return false;
  // 1) 调所有 disposer（effect 清理 + 工具注销）
  for (const d of rec.disposers) { try { d(); } catch (e: any) { /* ignore */ } }
  // 2) 兜底：从 loadedPluginTools 移除工具名
  for (const n of rec.toolNames) {
    loadedPluginTools.delete(n);
    try { if (registry && typeof registry.unregister === 'function') registry.unregister(n); } catch (_) {}
  }
  loadedPlugins.delete(id);
  return true;
}

/** HMR：重新加载一个插件（卸载 + 加载） */
async function reloadPlugin(id: string, registry: any, host?: CuckooHost): Promise<{ ok: boolean; error?: string }> {
  try {
    // 1) 卸载旧的
    unloadPlugin(id, registry);
    // 2) 找到目录
    const entries = listProfilePluginEntries();
    const hit = entries.find((e) => e.id === id);
    if (!hit) return { ok: false, error: '未找到插件目录: ' + id };
    // 3) 加载新的
    const r = await loadPluginFromDir(hit.dir, registry, host);
    loadedPlugins.set(id, { pluginName: r.pluginName, toolNames: r.tools, disposers: r.disposers });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

/** 安装（pnpm 装进 profile）+ 加载 + 注册工具 */
async function installAndLoad(pkgName: string, registry: any, host?: CuckooHost): Promise<{ id: string; pluginName: string; tools: string[] }> {
  const r = await installToProfile(pkgName);
  if (!r.ok) throw new Error(r.error || '安装失败');
  if (!r.pluginDir) throw new Error('安装成功但未找到插件目录');
  const lr = await loadPluginFromDir(r.pluginDir, registry, host);
  return { id: r.id || '', pluginName: lr.pluginName, tools: lr.tools };
}

/** 启动时加载 profile 里所有"已启用"的插件 */
async function loadEnabledPlugins(registry: any, host?: CuckooHost): Promise<{ loaded: string[]; failed: { id: string; error: string }[] }> {
  const loaded: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const entry of listEnabledPlugins()) {
    try {
      const r = await loadPluginFromDir(entry.dir, registry, host);
      // HMR：记录（供 unload/reload）
      loadedPlugins.set(entry.id, { pluginName: r.pluginName, toolNames: r.tools, disposers: r.disposers });
      loaded.push(entry.id + '(' + r.pluginName + '):' + r.tools.join(','));
    } catch (err: any) {
      failed.push({ id: entry.id, error: err && err.message ? err.message : String(err) });
    }
  }
  return { loaded, failed };
}

/** 卸载插件（从 profile 移除；工具暂不动态移除，重启生效） */
async function uninstallCuckooPlugin(id: string): Promise<boolean> {
  const entries = listProfilePluginEntries();
  const hit = entries.find((e) => e.id === id);
  if (!hit) return false;
  const r = await uninstallFromProfile(hit.name);
  return r.ok;
}

export { installAndLoad, loadEnabledPlugins, loadPluginFromDir, uninstallCuckooPlugin, loadedPluginTools, DshPluginTool, unloadPlugin, reloadPlugin };

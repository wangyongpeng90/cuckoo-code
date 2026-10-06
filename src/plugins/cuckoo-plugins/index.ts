/**
 * Cuckoo 插件（DSH 兼容）主进程集成：
 *   installAndLoad(pkgName)  —— npm 下载 + 加载 + 注册工具
 *   loadEnabledPlugins()     —— 启动时加载所有已启用插件
 *
 * 依赖方向：本模块在 plugins 层（纯 node + esbuild + 工具注册表）。
 */
import { Tool } from '../../tools/core/Tool.js';
import { installCuckooPlugin } from './installer.js';
import { loadCuckooPlugin } from './loader.js';
import { listCuckooPluginDirs, getCuckooPluginDir, isValidPluginId } from './paths.js';
import { isCuckooPluginEnabled, setCuckooPluginEnabled, clearCuckooPluginState } from './state.js';

/** 从 JSON Schema 生成 JS 调用签名（供提示词），如 greet(name: string, age?: number) */
function buildJsApi(name: string, parameters: any): string {
  const props = (parameters && parameters.properties) || {};
  const required: string[] = (parameters && parameters.required) || [];
  const parts = Object.keys(props).map((k) => {
    const t = (props[k] && props[k].type) || 'any';
    const opt = required.includes(k) ? '' : '?';
    return k + opt + ': ' + t;
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

/** 从插件目录加载并注册工具到 registry */
async function loadPluginFromDir(dir: string, registry: any): Promise<{ pluginName: string; tools: string[] }> {
  const { pluginName, tools } = await loadCuckooPlugin(dir);
  const names: string[] = [];
  for (const def of tools) {
    if (!def || typeof def.name !== 'string') continue;
    registry.register(new DshPluginTool(def));
    loadedPluginTools.add(def.name);
    names.push(def.name);
  }
  return { pluginName, tools: names };
}

/** 安装（npm 下载）+ 加载 + 注册 */
async function installAndLoad(pkgName: string, registry: any): Promise<{ id: string; pluginName: string; tools: string[] }> {
  const { id, dir } = await installCuckooPlugin(pkgName);
  const r = await loadPluginFromDir(dir, registry);
  setCuckooPluginEnabled(id, true);
  return { id, pluginName: r.pluginName, tools: r.tools };
}

/** 启动时加载所有"已启用"的插件 */
async function loadEnabledPlugins(registry: any): Promise<{ loaded: string[]; failed: { id: string; error: string }[] }> {
  const loaded: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const dir of listCuckooPluginDirs()) {
    const id = dir.split(/[\\/]/).pop() || '';
    if (!isValidPluginId(id) || !isCuckooPluginEnabled(id)) continue;
    try {
      const r = await loadPluginFromDir(dir, registry);
      loaded.push(id + '(' + r.pluginName + '):' + r.tools.join(','));
    } catch (err: any) {
      failed.push({ id, error: err && err.message ? err.message : String(err) });
    }
  }
  return { loaded, failed };
}

/** 卸载插件（清状态；工具暂不动态移除，重启生效） */
function uninstallCuckooPlugin(id: string): boolean {
  clearCuckooPluginState(id);
  return true;
}

export { installAndLoad, loadEnabledPlugins, loadPluginFromDir, uninstallCuckooPlugin, loadedPluginTools, DshPluginTool };

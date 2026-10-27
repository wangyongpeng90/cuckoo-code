/**
 * DSH llm 服务兼容层（通用：任何插件调 ctx.get('llm') / ctx.llm 都可用）。
 *
 * DSH 契约：
 *   llm.listProviders() → [{ id, name }]
 *   llm.listModels(providerId) → [{ id, name }]
 *
 * Cuckoo 映射（用户定的规则）：
 *   一级 = provider（deepseek / claude / chatgpt / ''=未选平台）
 *   二级 = 该 provider 下的窗口（id = profile.id，name = 窗口名）
 *
 * 另：agentDefaultModel.currentSelection() 返回"当前窗口"的 { provider, model }。
 */

/** 窗口描述（来自 CuckooHost.listWindows） */
export interface CuckooWindow {
  id: string;
  name: string;
  providerId: string;
}

/** provider 显示名映射（与窗口侧边栏一致） */
const PROVIDER_NAMES: Record<string, string> = {
  deepseek: 'DeepSeek',
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  zhipu: '智谱',
  kimi: 'Kimi',
  qwen: '通义千问',
  doubao: '豆包',
};

/** provider 显示名（未知 id 直接用 id；空串 = 未选平台） */
function providerName(id: string): string {
  if (!id) return '未选平台';
  return PROVIDER_NAMES[id] || id;
}

/**
 * 创建 llm 服务（宿主注入 listWindows 回调）。
 * @param listWindows 返回所有窗口（id/name/providerId）
 */
export function createLlm(listWindows: () => CuckooWindow[]): any {
  return {
    /** 列"一级"：所有出现过的 provider（按窗口里出现的顺序，去重） */
    listProviders(): Array<{ id: string; name: string }> {
      const seen = new Set<string>();
      const out: Array<{ id: string; name: string }> = [];
      for (const w of listWindows()) {
        const pid = String(w.providerId || '');
        if (seen.has(pid)) continue;
        seen.add(pid);
        out.push({ id: pid, name: providerName(pid) });
      }
      return out;
    },
    /** 列"二级"：某 provider 下的窗口（id = profile.id，name = 窗口名） */
    async listModels(providerId: string): Promise<Array<{ id: string; name: string }>> {
      const pid = String(providerId || '');
      return listWindows()
        .filter((w) => String(w.providerId || '') === pid)
        .map((w) => ({ id: String(w.id || ''), name: String(w.name || w.id || '') }));
    },
  };
}

/**
 * 创建 agentDefaultModel（DSH 契约：currentSelection 返回当前默认选择）。
 * @param getCurrentWindow 返回当前窗口（无窗口返回 null）
 */
export function createAgentDefaultModelFromWindow(getCurrentWindow: () => CuckooWindow | null): any {
  return {
    /**
     * DSH 契约：当前默认模型选择。
     * Cuckoo：= 当前窗口 → { provider: providerId, model: profile.id }
     * （无窗口时回退 { provider: null, model: null }，插件按"无默认"处理）
     */
    currentSelection(): { provider: string | null; model: string | null } {
      const w = getCurrentWindow();
      if (!w) return { provider: null, model: null };
      return { provider: String(w.providerId || ''), model: String(w.id || '') };
    },
    /** 列可选模型（同 llm.listProviders 的扁平视图） */
    list(): CuckooWindow[] {
      return getCurrentWindow() ? [getCurrentWindow() as CuckooWindow] : [];
    },
    /** 订阅变化（空实现） */
    subscribe(_cb: any) { return () => {}; },
  };
}

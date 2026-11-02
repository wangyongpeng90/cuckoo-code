/**
 * 工具基类
 */

/** 工具系统提示词 section（仿 dsh 的 ctx.systemPrompt.section） */
interface PromptSection {
  name: string;
  order: number;
  text: string;
}

/** 工具描述（用于发送给 AI） */
interface ToolDescription {
  name: string;
  description: string;
  parameters: any;
  jsApi: string | null;
}

class Tool {
  name: string;
  description: string;
  parameters: any; // JSON Schema 格式
  jsApi: string | null; // JS 调用签名
  /** 运行时动态工具（如插件工具）：沙箱注入 + 提示词都需运行期生成 */
  dynamic?: boolean;

  constructor(name: string, description: string, parameters: any, jsApi?: string | null) {
    this.name = name;
    this.description = description;
    this.parameters = parameters;
    this.jsApi = jsApi || null;
  }

  async execute(params: any): Promise<any> {
    throw new Error('execute() 必须由子类实现');
  }

  /** 获取工具描述，用于发送给 AI */
  getDescription(): ToolDescription {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
      jsApi: this.jsApi
    };
  }

  /**
   * 获取工具的系统提示词 section（仿 dsh 的 ctx.systemPrompt.section）。
   * 返回 { name, order, text } 或 null（默认无 section）。
   */
  getPromptSection(): PromptSection | null {
    return null;
  }

  /**
   * 工具是否启用（用于按功能开关隐藏工具）。
   * 默认 true；子类可 override（如 remember 在记忆功能关闭时返回 false）。
   * 影响：{{TOOLS_LIST}}、{{TOOL_SECTIONS}} 均会过滤掉禁用的工具。
   */
  isEnabled(): boolean {
    return true;
  }
}

/** 工具 API 契约元数据（D12：构建期据此生成 api.d.ts） */
export interface ToolApiMeta {
  /** 全局排序（决定 api.d.ts 中的出现顺序） */
  order: number;
  /** 分类（同分类聚合，出现分类小标题） */
  category: string;
  /** 函数名 */
  name: string;
  /** 该工具用到的 interface/type 声明块（原样写入 api.d.ts） */
  types?: string;
  /** 函数 JSDoc 正文：这函数是什么、返回什么（不含 @param/@returns/@throws） */
  doc: string;
  /**
   * 使用指导：什么时候该用、别用什么替代（如"用 read 而不是 cat"）。
   * 生成到 api.d.ts 时会在 doc 之后另起一段（空行分隔）。
   */
  usage?: string;
  /** 参数列表（带类型），如 "command: string, options?: BashOptions" */
  params: string;
  /** 返回类型，如 "Promise<string>" */
  returns: string;
  /** @param 描述 */
  paramDocs?: Record<string, string>;
  /** @returns 描述 */
  returnsDoc?: string;
  /** @throws 描述 */
  throws?: string;
  /** JsRunner 沙箱注入的 bootstrap 代码（globalThis.x = async function ...） */
  bootstrap?: string;
  /**
   * 功能开关分组（可选）。有值 → 归入该 feature 的独立契约文件（api.<feature>.d.ts），
   * 仅在功能启用时注入提示词（如 'memories'）。
   * 无值 → 归入基础契约 api.d.ts，始终注入。
   */
  feature?: string;
}

export { Tool };
export type { PromptSection, ToolDescription };

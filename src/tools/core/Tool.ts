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
  /** 函数 JSDoc 正文（不含 @param/@returns/@throws） */
  doc: string;
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
}

export { Tool };
export type { PromptSection, ToolDescription };

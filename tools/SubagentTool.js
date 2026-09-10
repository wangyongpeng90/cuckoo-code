const { Tool, ToolResult } = require('./ToolRegistry');

/**
 * SubagentTool - 子 Agent 任务委派工具
 *
 * 委派边界清晰的子任务给独立子 Agent 窗口执行，阻塞等待其最终交付。
 * 返回 { resultFile, preview }：完整结果统一落盘，主 Agent 用 read(resultFile) 获取全文。
 * 工具名 'subagent' 与 JsRunner 的 LONG_RUNNING_TOOLS 白名单一致，
 * 调用期间豁免 JsRunner 整体 60s 超时（双闸门豁免）。
 */
class SubagentTool extends Tool {
  constructor() {
    super(
      'subagent',
      '委派边界清晰的子任务给独立子 Agent 窗口执行，并返回其交付结果。',
      {
        type: 'object',
        properties: {
          agentType: {
            type: 'string',
            description: '子 Agent 模板 id（对应 agents/ 目录下的 .md 文件名，不含扩展名）。省略时使用通用子 Agent。'
          },
          task: {
            type: 'string',
            description: '委派给子 Agent 的任务描述。'
          },
          timeoutMs: {
            type: 'number',
            description: '任务总超时（毫秒）。默认 1800000（30 分钟）。'
          }
        },
        required: ['task'],
        additionalProperties: false
      },
      'subagent(options)'
    );
  }

  getPromptSection() {
    return {
      name: 'tool:subagent',
      order: 90,
      text: '使用 subagent 工具委派子任务给独立子 Agent 窗口执行，阻塞等待交付。task 要写清交付格式（让子 Agent 在 subagent_result 代码块中给纯文本/JSON 交付物）。返回对象 { resultFile, preview }：用 log(result.preview) 看摘要，用 read(result.resultFile) 读完整内容（不要直接 log 整个对象，会显示 [object Object]）。子 Agent 无状态，续作时把上轮 resultFile 路径写进新 task。agentType 对应 agents/ 目录下模板 id，省略用通用子 Agent。'
    };
  }

  async execute(params) {
    const { task, agentType, timeoutMs } = params || {};

    if (typeof task !== 'string' || task.trim().length === 0) {
      return ToolResult.error('task must be a non-empty string');
    }

    // 壳阶段：未绑定 SubagentRunner 时绝不返回假成功，避免模型继续编造结果
    if (!this._runner) {
      return ToolResult.error('subagent 工具尚未启用（未绑定 SubagentRunner）');
    }

    return await this._runner.run({ task, agentType, projectDir: params.projectDir, timeoutMs });
  }

  /**
   * 绑定 SubagentRunner（由 src/main/index.js 在实例化 runner 后调用）。
   * 依赖方向：main → tools，避免循环 require。
   * @param {import('../src/main/subagent-runner').SubagentRunner} runner
   */
  bindRunner(runner) {
    this._runner = runner;
  }
}

module.exports = { SubagentTool };

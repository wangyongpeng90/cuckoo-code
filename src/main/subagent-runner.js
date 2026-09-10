/**
 * SubagentRunner - 子 Agent 窗口生命周期管理
 *
 * 职责：
 * - 通过注入的 windowFactory（index.js createWindow）创建子窗口，
 *   复用标准装配链：windowState.addWindow / sessionStore / did-navigate / UA / F12
 * - activeTasks 注册与清理
 * - 总超时、starting 超时、closed 监听、主窗口关闭反查
 * - 结果回传（Task 8 接入）、质量检测（Task 9 接入）、停住检测（Task 10 接入）
 */

const fs = require('fs');
const path = require('path');
const windowState = require('./window');
const profileManager = require('./profile-manager');
const agentTemplates = require('./agent-templates');

const WORKER_PARTITION = 'persist:subagent-worker';
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟
const STARTING_TIMEOUT_MS = 60 * 1000; // 启动阶段单独 60s（observer-ready 握手超时）
const RESULTS_CLEANUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 结果文件保留 7 天
// 专家模式开关：DeepSeek 已取消专家模式，默认关闭（旁路）。
// 若将来恢复专家模式，改回 true 即可启用自动开启逻辑（代码保留）。
const EXPERT_MODE_ENABLED = false;

// ========== Task 10：停住检测与轮次硬顶 ==========
const IDLE_TIMEOUT_MS = 180 * 1000;      // 场景 B：空闲 180s 触发提醒
const IDLE_REMINDER_MAX = 2;             // 场景 B：提醒上限 2 次，之后静默等待总超时
const MAX_INTERACTION_ROUNDS = 60;       // 场景 C：轮次硬顶 60 轮
const STALL_REMINDER_MAX = 2;            // 场景 A：纯文本停顿提醒上限 2 次，之后静默

/**
 * 登录态检测 JS：注入子窗口执行，返回 { loggedIn, reason }。
 * 三特征：URL 跳转登录页 / 聊天输入框缺失 / 登录按钮存在。
 */
const LOGIN_CHECK_JS = `(function () {
  try {
    const url = location.href;
    if (/sign_in|login|auth|oauth/i.test(url)) {
      return { loggedIn: false, reason: 'url-redirected-to-login' };
    }
    const textarea = document.querySelector('textarea');
    const editable = document.querySelector('[contenteditable="true"]');
    if (!textarea && !editable) {
      return { loggedIn: false, reason: 'no-chat-input' };
    }
    const loginBtn = Array.from(document.querySelectorAll('button, a')).find((el) => {
      const t = (el.textContent || '').trim();
      return t && (t === '登录' || t === 'Log in' || t === 'Sign in' || /登录/.test(t));
    });
    if (loginBtn) {
      return { loggedIn: false, reason: 'login-button-present' };
    }
    return { loggedIn: true };
  } catch (err) {
    return { loggedIn: false, reason: 'check-error:' + err.message };
  }
})()`;

/**
 * 专家模式检测/开启 JS：检测"使用专家模式开始对话"标题，无则点击"专家模式"按钮。
 * 返回 { expertMode, foundTitle, clickedButton, error }。
 */
const EXPERT_MODE_JS = `(function () {
  try {
    const isTitle = (el) => (el.textContent || '').trim() === '使用专家模式开始对话';
    const title = Array.from(document.querySelectorAll('h1, h2, h3, div, span')).find(isTitle);
    if (title) return { expertMode: true, foundTitle: true };

    const btn = Array.from(document.querySelectorAll('button, [role="button"], div, span')).find(
      (el) => (el.textContent || '').trim() === '专家模式'
    );
    if (!btn) return { expertMode: false, foundButton: false };

    btn.click();
    return { expertMode: false, clickedButton: true };
  } catch (err) {
    return { expertMode: false, error: err.message };
  }
})()`;

class SubagentRunner {
  /**
   * @param {Function} windowFactory 创建子窗口的工厂函数（index.js createWindow）
   */
  constructor(windowFactory) {
    if (typeof windowFactory !== 'function') {
      throw new Error('SubagentRunner 需要 windowFactory 函数');
    }
    this.windowFactory = windowFactory;
    /** @type {Map<string, object>} taskId -> taskState */
    this.activeTasks = new Map();
    /** 任务开始/结束时的状态变更回调（供主窗口控制台 ticker 生命周期管理） */
    this.onStatusChange = null;
  }

  /**
   * 注册状态变更回调（任务开始/结束时调用）。
   */
  setStatusChangeHandler(fn) {
    this.onStatusChange = typeof fn === 'function' ? fn : null;
  }

  /**
   * 触发状态变更通知（供主窗口 ticker 感知任务开始/结束）。
   */
  _notifyStatusChange() {
    if (this.onStatusChange) {
      try { this.onStatusChange(this.getStatusList()); } catch (_) {}
    }
  }

  /**
   * 运行子 Agent 任务。
   * @param {{ task: string, agentType?: string, projectDir?: string|null, timeoutMs?: number }} params
   * @returns {Promise<{ success: boolean, data?: any, error?: string, taskId?: string }>}
   */
  async run({ task, agentType, projectDir, timeoutMs }) {
    if (!task || typeof task !== 'string' || !task.trim()) {
      return { success: false, error: 'task must be a non-empty string' };
    }

    // 清理过期结果文件（> 7 天）
    this._cleanupOldResults(projectDir || null);

    // 动态加载模板（基于当前 projectDir）
    const templates = agentTemplates.load(projectDir || null);
    if (agentType && !templates.has(agentType)) {
      return { success: false, error: '未知的 agentType: ' + agentType };
    }
    const agentTemplate = agentType ? templates.get(agentType) : null;

    const taskId = 'sub-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const totalTimeout = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
    const startedAt = Date.now();

    // 主窗口上下文（用于复用 partition 与反查）
    const mainCtx = windowState.getMainContext();
    const parentWindowId = mainCtx ? mainCtx.win.id : null;
    // partition 字符串从 profile 获取（如 'persist:deepseek:profile-xxx'）
    let mainPartition = null;
    if (mainCtx && mainCtx.profileId) {
      const profile = profileManager.getProfileById(mainCtx.profileId);
      if (profile && profile.partition) mainPartition = profile.partition;
    }

    // activeTasks 注册（先占位，窗口创建后补充 win）
    const state = {
      taskId,
      agentType: agentType || null,
      agentTemplate: agentTemplate || null,
      task,
      projectDir: projectDir || null,
      timeoutMs: totalTimeout,
      startedAt,
      phase: 'starting',
      parentWindowId,
      win: null,
      currentPartition: mainPartition || WORKER_PARTITION,
      sessionStore: null,
      timer: null,
      startingTimer: null,
      idleTimer: null,
      interactionCount: 0,
      idleReminderCount: 0,
      stallReminderCount: 0, // 场景 A：纯文本停顿提醒次数（上限 2）
      supplementCount: 0, // 敷衍追问次数（上限 2）
      hasToolActivity: false, // 是否执行过工具（Task 10 停住检测用）
      resolve: null,
      reject: null,
      abortReason: null,
      closedByUser: false,
      readyPromise: null,
      readyResolve: null,
    };
    state.readyPromise = new Promise((resolve) => { state.readyResolve = resolve; });
    this.activeTasks.set(taskId, state);
    this._notifyStatusChange(); // 任务开始，通知主窗口控制台

    // 总超时：从 run() 第一行计时，覆盖 starting + working 全程
    state.timer = setTimeout(() => {
      this._failTask(taskId, '任务总超时（' + Math.round(totalTimeout / 1000) + 's）');
    }, totalTimeout);

    // starting 阶段单独超时：observer-ready 握手兜底
    state.startingTimer = setTimeout(() => {
      if (this.activeTasks.has(taskId) && state.phase === 'starting') {
        this._failTask(taskId, '子窗口启动超时（observer-ready 握手 ' + Math.round(STARTING_TIMEOUT_MS / 1000) + 's 未到达）');
      }
    }, STARTING_TIMEOUT_MS);

    return new Promise((resolve, reject) => {
      state.resolve = resolve;
      state.reject = reject;

      this._openWindow(state, mainPartition)
        .then(() => { /* starting 阶段完成由 observer-ready 握手推进（Task 5） */ })
        .catch((err) => {
          this._failTask(taskId, err.message || String(err));
        });
    });
  }

  /**
   * 敷衍检测（方案 §10.1）：长度 < 30 / 敷衍话术开头且 < 100 / 单句且 < 100。
   */
  isTrivialResult(text) {
    const trimmed = String(text || '').trim();
    if (trimmed.length < 30) return true;

    const TRIVIAL_PREFIXES = ['我完成了', '任务已完成', '已完成', '全部完成', '做完了', '已经完成', '处理完毕', 'done'];
    for (const p of TRIVIAL_PREFIXES) {
      if (trimmed.toLowerCase().startsWith(p.toLowerCase()) && trimmed.length < 100) return true;
    }

    // 按句号/换行/分号/感叹号/问号切分非空句子
    const sentences = trimmed.split(/[。\n；;！？!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length <= 1 && trimmed.length < 100) return true;

    return false;
  }

  /**
   * 结果真实性校验（方案 §10.4 启发式）：从结果文本提取声称的文件路径，
   * 核对存在性与 mtime。不一致附加 warning，不阻塞 resolve。漏报不告警。
   */
  _checkResultAuthenticity(state, text) {
    // 尽力提取：匹配常见路径形态（绝对路径 / 项目相对路径 / 盘符路径）
    const candidates = new Set();
    const patterns = [
      /[A-Za-z]:\\[^\s"'`，。；]+/g,          // C:\path\to\file
      /[A-Za-z]:\/[^\s"'`，。；]+/g,           // C:/path/to/file
      /(?:^|[\s"'`])\/[^\s"'`，。；]+/g,      // /abs/path
      /(?:^|[\s"'`])(?:[\w.-]+\/)+[\w.-]+\.[\w]+/g, // relative/path/file.ext
    ];
    for (const re of patterns) {
      const matches = text.match(re);
      if (matches) {
        for (const m of matches) candidates.add(m.trim());
      }
    }

    if (candidates.size === 0) return null; // 无声称路径，无 warning

    const warnings = [];
    for (const rawPath of candidates) {
      // 清理可能的引号/逗号残余
      const cleanPath = rawPath.replace(/^["'`]+|["'`，。；]+$/g, '');
      const absPath = path.isAbsolute(cleanPath)
        ? cleanPath
        : (state.projectDir ? path.join(state.projectDir, cleanPath) : cleanPath);

      let stat = null;
      try { stat = fs.statSync(absPath); } catch (_) { /* 不存在 */ }

      if (!stat) {
        warnings.push('声称的文件未找到: ' + cleanPath);
        continue;
      }
      if (!stat.isFile()) continue;
      if (stat.mtimeMs < state.startedAt) {
        warnings.push('声称的文件修改时间早于任务开始: ' + cleanPath);
      }
    }

    return warnings.length > 0 ? '真实性校验: ' + warnings.join('; ') : null;
  }

  /**
   * 组装包裹模板：角色段（agentType 模板全文或省略）+ 回复模式 + 行为规则 + 任务。
   */
  _buildWrapperTemplate(state) {
    const parts = [];

    const template = state.agentTemplate;
    if (template && template.fullText) {
      parts.push('');
      parts.push('【你的角色】');
      parts.push(template.fullText.trim());
    }

    // 子 Agent 无人值守：覆盖主窗口提示词中"向用户提问/澄清"的指引
    parts.push('');
    parts.push('【子 Agent 模式】');
    parts.push('你没有用户可问。前文任何关于"向用户提问""先提澄清性问题"的指引在本任务中不适用。');
    parts.push('遇到不确定时，自行做合理假设并继续执行，在最终交付中注明你的假设。');

    parts.push('');
    parts.push('【回复模式】');
    parts.push('你的每一条回复，只能是以下三种之一，不允许其他形式：');
    parts.push('');
    parts.push('模式 A - 工具调用：');
    parts.push('  如果下一步需要执行工具，只输出 cuckoo 代码块，');
    parts.push('  代码块之外不要有任何文字。');
    parts.push('');
    parts.push('模式 B - 最终交付：');
    parts.push('  只有当任务完全结束时，才输出 subagent_result 代码块。');
    parts.push('  里面是完整的交付物，不是一句话声明。');
    parts.push('');
    parts.push('模式 C - 错误交付：');
    parts.push('  如果任务确实无法完成，输出 subagent_result 代码块，');
    parts.push('  里面详细说明：已尝试的步骤、失败原因、建议替代方案。');
    parts.push('');
    parts.push('【禁止】');
    parts.push('- 禁止输出"好的"、"我来处理"、"正在分析"等过程性文字');
    parts.push('- 禁止在没有工具调用、没有 subagent_result 的情况下输出纯文本');
    parts.push('- 禁止在 subagent_result 中输出"我完成了"这类一句话声明');
    parts.push('- 禁止输出 XML 格式的工具调用（如 <invoke> 标签）');
    parts.push('- 禁止调用 subagent 工具（你不能再派子 Agent，这是主 Agent 的专属能力）');
    parts.push('- 你的任何一条回复都必须能驱动任务前进');
    parts.push('');
    parts.push('【行为规则】');
    parts.push('1. 自主完成任务，不要向用户提问。');
    parts.push('2. 可以使用全部工具（bash、read、write、glob、grep 等）。');
    parts.push('3. 如果修改了文件：交付时列出每个修改文件的路径和改动摘要。');
    parts.push('4. 如果发现了问题：交付时列出每个问题的位置（文件+行号）和描述。');
    parts.push('5. 如果进行了分析：交付时给出分析结论和支撑依据。');
    parts.push('6. 最终交付保持精炼：引用文件路径和行号，不要粘贴大段代码或完整文件内容。');
    parts.push('   大段产出物（完整 diff、生成的文档、测试输出）直接写入文件，报告中只写文件路径。');
    parts.push('');
    parts.push('【任务】');
    parts.push(state.task);

    return parts.join('\n');
  }

  /**
   * 组装首条消息：工具提示词 + 包裹模板（合并为一条）。
   */
  _buildFirstMessage(state) {
    // 复用主窗口提示词：同一套模板/占位符/工具清单/类型定义
    // 第三参默认空 = 子 Agent 不注入 MCP 章节
    const { buildPrompt } = require('./project-context');
    // I-1 嵌套封堵：子 Agent 提示词过滤 subagent（工具清单 + prompt section）
    let base = buildPrompt('deepseek', state.projectDir, '', ['subagent']);

    // 拼接子 Agent 包裹模板作为任务
    const wrapper = this._buildWrapperTemplate(state);
    return base + '\n\n---\n\n## 你的任务\n\n' + wrapper;
  }

  /**
   * 通过 windowFactory 创建子窗口（复用 index.js createWindow 装配链）。
   */
  async _openWindow(state, mainPartition) {
    const partition = mainPartition || WORKER_PARTITION;
    state.currentPartition = partition;

    // 构造临时 profile：复用主 profile 的 partition，providerId 固定 deepseek
    const mainCtx = windowState.getMainContext();
    const parentProfileId = mainCtx && mainCtx.profileId;
    const tempProfile = {
      id: (parentProfileId || 'subagent') + '-subagent-' + state.taskId,
      providerId: 'deepseek',
      name: '子 Agent - ' + (state.agentType || '通用'),
      partition,
    };

    // windowFactory 内部完成 addWindow / sessionStore / did-navigate / UA / closed 全套装配
    const win = this.windowFactory(tempProfile, {
      isSubagent: true,
      subagentId: state.taskId,
      title: 'Cuckoo 子 Agent - ' + (state.agentType || '通用'),
      width: 1100,
      height: 800,
    });

    if (!win || win.isDestroyed()) {
      throw new Error('子窗口创建失败');
    }

    state.win = win;

    // 从 windowState 取回装配好的 sessionStore（windowFactory 内部 addWindow 时创建）
    const ctx = windowState.getContextByWebContents(win.webContents);
    if (ctx && ctx.sessionStore) {
      state.sessionStore = ctx.sessionStore;
      // Task 5 会设置 pendingProjectDir
    }

    this._attachClosedHandler(win, state);

    win.webContents.once('did-finish-load', async () => {
      // 登录检测（等待页面渲染）
      await new Promise((r) => setTimeout(r, 1500));
      await this._checkLoginAndFallback(state);
    });
  }

  /**
   * 为指定窗口绑定 closed 处理。
   * 用窗口实例比对避免降级关窗时新旧窗口串线。
   */
  _attachClosedHandler(win, state) {
    win.on('closed', () => {
      // 只有当前记录的窗口关闭才处理（降级时旧窗口关闭会与 state.win 不一致）
      if (state.win !== win) return;

      // 用户手动关窗 → reject 任务，防止主 Agent 永久挂起
      if (this.activeTasks.has(state.taskId) && state.phase !== 'completed' && state.phase !== 'failed') {
        state.closedByUser = true;
        this._failTask(state.taskId, '子窗口被手动关闭');
      }
      this.activeTasks.delete(state.taskId);
    });
  }

  /**
   * 登录成功流程：专家模式 → pendingProjectDir → observer-ready 握手 → working。
   */
  async _handleLoggedIn(state, win) {
    console.log('[SubagentRunner] 子窗口登录态正常:', state.taskId, 'partition=' + state.currentPartition);

    if (EXPERT_MODE_ENABLED) {
      await this._ensureExpertMode(win);
    }

    // 写 pendingProjectDir：新会话产生 URL 时由 did-navigate 自动绑定
    if (state.sessionStore && state.projectDir) {
      state.sessionStore.state.pendingProjectDir = state.projectDir;
      console.log('[SubagentRunner] pendingProjectDir 已写入:', state.projectDir);
    }

    // 等待 observer-ready 握手（starting 60s 超时兜底在 run() 已设）
    const readyOk = await state.readyPromise;
    if (!readyOk || state.phase === 'failed') return; // 等待期间可能已失败
    state.phase = 'working';
    if (state.startingTimer) {
      clearTimeout(state.startingTimer);
      state.startingTimer = null;
    }
    console.log('[SubagentRunner] observer-ready 握手完成，进入 working:', state.taskId);

    // Task 10：进入 working 时启动空闲计时器（场景 B）
    this._resetIdleTimer(state);

    // Task 6：发首条消息（工具提示词 + 包裹模板）
    const firstMessage = this._buildFirstMessage(state);
    win.webContents.send('subagent-task', { taskId: state.taskId, task: firstMessage });
    console.log('[SubagentRunner] 首条消息已发送，长度:', firstMessage.length);
    // 首条消息算一次活动（重置 idleTimer 基准，避免发送后立即误判空闲）
    this.markActivity(state);
  }

  /**
   * 按 webContents 反查 activeTasks 中的子任务（Task 10 markActivity/轮次硬顶用）。
   * 与 handleCandidateResult 的 sender 反查同思路。
   * @param {object} webContents event.sender
   * @returns {object|null} 匹配的子任务 state；普通窗口返回 null
   */
  findTaskByWebContents(webContents) {
    if (!webContents) return null;
    for (const state of this.activeTasks.values()) {
      if (state.win && state.win.webContents === webContents) {
        return state;
      }
    }
    return null;
  }

  /* ================= Task 10：停住检测与轮次硬顶 ================= */

  /**
   * 重置空闲计时器（场景 B）：180s 无活动则触发提醒。
   * 发送/工具执行/subagent_result 到达/发提醒后均调用。
   */
  _resetIdleTimer(state) {
    if (state.idleTimer) clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => this._onIdleTimeout(state), IDLE_TIMEOUT_MS);
  }

  /**
   * 空闲超时回调（场景 B）：未达上限发提醒并重新 arm；达上限静默。
   * 抽为独立方法便于测试。
   */
  _onIdleTimeout(state) {
    // 任务已结束则不再处理
    if (!this.activeTasks.has(state.taskId) || state.phase === 'completed' || state.phase === 'failed') return;

    if (state.idleReminderCount < IDLE_REMINDER_MAX) {
      this._sendStallReminder(state, '【系统提醒】距离上次活动已超过 3 分钟，请立即继续执行任务。如果已完成，输出 subagent_result 代码块。');
      state.idleReminderCount++;
      this._resetIdleTimer(state); // 重置继续监控
    } else {
      console.log('[SubagentRunner] 空闲提醒已达上限，静默等待总超时:', state.taskId);
    }
  }

  /**
   * markActivity：复用现有 execute-js/execute-tool IPC（零新增消息）。
   * 子 Agent 每次工具调用到达主进程时触发：重置 idleTimer、interactionCount+1、标记工具活动。
   * @param {object} state activeTasks 中匹配的子任务状态
   * @returns {boolean} 当前是否允许继续执行（force_deliver 时返回 false）
   */
  markActivity(state) {
    if (!state) return false;

    // 场景 C：轮次硬顶（force_deliver 阶段拦截后续工具）
    if (state.phase === 'force_deliver') {
      // 已进入硬顶：持续拦截
      return false;
    }

    state.interactionCount++;
    state.hasToolActivity = true;
    state.idleReminderCount = 0; // 恢复活跃 → 空闲提醒计数归零（可再次提醒）
    this._resetIdleTimer(state); // 有活动→重置空闲计时

    // 递增后达到硬顶（第 60 轮）→ 转为强制交付
    if (state.interactionCount >= MAX_INTERACTION_ROUNDS) {
      state.phase = 'force_deliver';
      console.warn('[SubagentRunner] 轮次硬顶触发（' + MAX_INTERACTION_ROUNDS + ' 轮）:', state.taskId);
      this._sendStallReminder(state, '【系统提示】已达到最大交互轮次（' + MAX_INTERACTION_ROUNDS + ' 轮）。请立即整理当前工作进展，输出完整的 subagent_result 代码块交付结果。未完成的部分在结果中说明。');
      return false;
    }

    return true;
  }

  /**
   * 发送停住提醒（场景 A/C/空闲超时共用）：复用 subagent-reminder 通道。
   */
  _sendStallReminder(state, message) {
    if (!state || !state.win || state.win.isDestroyed()) return;
    try {
      state.win.webContents.send('subagent-reminder', { message });
    } catch (err) {
      console.warn('[SubagentRunner] 提醒发送失败（窗口可能已关）:', state.taskId, err.message);
    }
  }

  /**
   * 处理纯文本停顿（场景 A）：无工具活动时提醒；有活动则降级为质量检测（策略 B）。
   */
  _handlePlainText(state, text) {
    if (state.hasToolActivity) {
      // 策略 B：纯文本回退——质量检测已在 handleCandidateResult 的正常路径处理（无 subagent_result，此处仅记录）
      console.log('[SubagentRunner] plain_text 且有工具活动（策略 B 质量检测回退）:', state.taskId, (text || '').slice(0, 80));
      return;
    }
    // 场景 A：无工具活动 → 发"请继续执行任务"提醒（上限 STALL_REMINDER_MAX 次，超限静默）
    if (state.stallReminderCount >= STALL_REMINDER_MAX) {
      console.log('[SubagentRunner] 场景 A 停顿提醒已达上限，静默:', state.taskId);
      return;
    }
    state.stallReminderCount++;
    this._sendStallReminder(state, '【系统提醒】请继续执行任务。\n\n你当前不应该停顿。请检查：\n1. 如果任务尚未完成，需要执行工具就输出 cuckoo 代码块\n2. 如果任务已经完成，输出 subagent_result 代码块交付结果\n3. 不要输出"好的""我来处理"这类过程性文字\n4. 不要等待用户回复，你是子 Agent，必须自主推进任务');
  }

  /**
   * 检测登录态，未登录走降级路径。
   */
  async _checkLoginAndFallback(state) {
    const win = state.win;
    if (!win || win.isDestroyed()) return;

    const check = await this._checkLogin(win);
    if (check && check.loggedIn) {
      await this._handleLoggedIn(state, win);
      return;
    }

    // 主 partition 未登录 → 降级到 worker partition
    if (state.currentPartition !== WORKER_PARTITION) {
      console.warn('[SubagentRunner] 主 partition 未登录，降级到 worker partition:', state.taskId, check && check.reason);

      // 重置 readyPromise，避免旧窗口 observer 已上报导致 fallback 提前进入 working
      this._resetReadyPromise(state);

      // 先解绑旧窗口：把 state.win 置空，关闭旧窗口
      state.win = null;
      try { win.close(); } catch (_) {}

      state.currentPartition = WORKER_PARTITION;

      // 用 worker partition 重新走 windowFactory
      const mainCtx = windowState.getMainContext();
      const parentProfileId = mainCtx && mainCtx.profileId;
      const fallbackProfile = {
        id: (parentProfileId || 'subagent') + '-subagent-worker-' + state.taskId,
        providerId: 'deepseek',
        name: '子 Agent - ' + (state.agentType || '通用'),
        partition: WORKER_PARTITION,
      };

      const fallbackWin = this.windowFactory(fallbackProfile, {
        isSubagent: true,
        subagentId: state.taskId,
        title: 'Cuckoo 子 Agent - ' + (state.agentType || '通用'),
        width: 1100,
        height: 800,
      });

      if (!fallbackWin || fallbackWin.isDestroyed()) {
        this._failTask(state.taskId, 'worker partition 子窗口创建失败');
        return;
      }

      state.win = fallbackWin;

      const ctx = windowState.getContextByWebContents(fallbackWin.webContents);
      if (ctx && ctx.sessionStore) {
        state.sessionStore = ctx.sessionStore;
      }

      this._attachClosedHandler(fallbackWin, state);

      fallbackWin.webContents.once('did-finish-load', async () => {
        await new Promise((r) => setTimeout(r, 1500));
        const fallbackCheck = await this._checkLogin(fallbackWin);
        if (fallbackCheck && fallbackCheck.loggedIn) {
          // 完整流程：专家模式 + pendingProjectDir + observer-ready 握手
          await this._handleLoggedIn(state, fallbackWin);
          return;
        }
        // worker 也未登录 → 报错
        this._failTask(state.taskId, 'worker partition 未登录，请手动登录子窗口后重试');
        if (fallbackWin && !fallbackWin.isDestroyed()) fallbackWin.close();
      });
      return;
    }

    // 已在 worker partition 仍未登录
    this._failTask(state.taskId, 'worker partition 未登录，请手动登录子窗口后重试');
    try { win.close(); } catch (_) {}
  }

  /**
   * 注入 JS 检测登录态。
   */
  async _checkLogin(win) {
    try {
      if (!win || win.isDestroyed()) return { loggedIn: false, reason: 'window-destroyed' };
      const result = await win.webContents.executeJavaScript(LOGIN_CHECK_JS);
      return result;
    } catch (err) {
      return { loggedIn: false, reason: 'execute-error:' + err.message };
    }
  }

  /**
   * 专家模式自动开启：检测标题，无则点击按钮，等 1.5s 确认。失败非致命。
   */
  async _ensureExpertMode(win) {
    try {
      if (!win || win.isDestroyed()) return false;
      const r1 = await win.webContents.executeJavaScript(EXPERT_MODE_JS);
      if (r1 && r1.expertMode) return true;

      if (r1 && r1.clickedButton) {
        await new Promise((r) => setTimeout(r, 1500));
        const r2 = await win.webContents.executeJavaScript(EXPERT_MODE_JS);
        if (r2 && r2.expertMode) {
          console.log('[SubagentRunner] 专家模式已开启');
          return true;
        }
        console.warn('[SubagentRunner] 点击专家模式后 1.5s 未确认（非致命）');
        return false;
      }

      console.warn('[SubagentRunner] 未找到专家模式按钮（非致命）');
      return false;
    } catch (err) {
      console.warn('[SubagentRunner] 专家模式检测异常（非致命）:', err.message);
      return false;
    }
  }

  /**
   * 清理过期的结果落盘文件（> 7 天）。
   * 每次 run() 委派任务时对当前 projectDir 的结果目录执行一次。
   */
  _cleanupOldResults(projectDir) {
    if (!projectDir) return;
    const resultsDir = path.join(projectDir, '.cuckoo', 'subagent-results');
    let files;
    try {
      files = fs.readdirSync(resultsDir);
    } catch (_) {
      return; // 目录不存在，忽略
    }
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(resultsDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && now - stat.mtimeMs > RESULTS_CLEANUP_MAX_AGE_MS) {
          fs.unlinkSync(filePath);
          console.log('[SubagentRunner] 清理过期结果文件:', file);
        }
      } catch (err) {
        console.warn('[SubagentRunner] 清理失败:', filePath, err.message);
      }
    }
  }

  /**
   * 失败终止任务：清定时器、关闭窗口、reject。
   */
  _failTask(taskId, reason) {
    const state = this.activeTasks.get(taskId);
    if (!state) return;
    if (state.phase === 'completed' || state.phase === 'failed') return;

    state.phase = 'failed';
    state.abortReason = reason;
    if (state.timer) clearTimeout(state.timer);
    if (state.startingTimer) clearTimeout(state.startingTimer);
    if (state.idleTimer) clearTimeout(state.idleTimer);

    console.error('[SubagentRunner] 任务失败:', taskId, reason);

    // 解绑当前窗口引用，避免 closed 回调重复处理
    const win = state.win;
    state.win = null;
    if (win && !win.isDestroyed()) {
      try { win.close(); } catch (_) {}
    }

    // 解除 readyPromise，避免 _handleLoggedIn 的 await 永久悬挂
    if (state.readyResolve) {
      state.readyResolve(false);
      state.readyResolve = null;
    }

    if (state.reject) {
      state.reject(new Error(reason));
      state.reject = null;
    }
    this.activeTasks.delete(taskId);
    this._notifyStatusChange(); // 任务结束，通知主窗口控制台
  }

  /**
   * 主窗口关闭时反查并 abort 归属子任务。
   * @param {number} parentWindowId
   */
  abortByParentWindow(parentWindowId) {
    const taskIds = [];
    for (const [taskId, state] of this.activeTasks) {
      if (state.parentWindowId === parentWindowId) {
        taskIds.push(taskId);
      }
    }
    for (const taskId of taskIds) {
      this._failTask(taskId, '主窗口已关闭');
    }
    return taskIds.length;
  }

  /**
   * 重置 readyPromise（降级关旧窗前调用，避免旧窗口 observer 提前 resolve）。
   */
  _resetReadyPromise(state) {
    state.readyResolve = null;
    state.readyPromise = new Promise((resolve) => { state.readyResolve = resolve; });
  }

  /**
   * observer-ready 握手：preload 上报后 resolve readyPromise。
   * @param {string} taskId
   */
  markReady(taskId, senderWebContents) {
    const state = this.activeTasks.get(taskId);
    if (!state || state.phase !== 'starting') return false;

    // 窗口复用等场景下，校验上报来源必须是当前子窗口（纵深防御）
    if (state.win && senderWebContents && state.win.webContents !== senderWebContents) {
      console.warn('[SubagentRunner] subagent-ready 来源窗口不匹配:', taskId);
      return false;
    }
    if (state.readyResolve) {
      state.readyResolve(true);
      state.readyResolve = null;
    }
    return true;
  }

  /**
   * 接收子窗口上报的候选结果（subagent_result 或 plain_text）。
   * 按 event.sender 反查 activeTasks，命中才接收。
   * subagent_result：落盘 + resolve + 关窗（completed）。
   * plain_text：留给 Task 10 停住检测，当前仅记录。
   */
  handleCandidateResult(senderWebContents, { type, text } = {}) {
    if (!senderWebContents) return { success: false, error: '缺少 sender' };

    // 按 sender 反查任务（同 O-1 sender 校验思路）
    let matchedState = null;
    for (const state of this.activeTasks.values()) {
      if (state.win && state.win.webContents === senderWebContents) {
        matchedState = state;
        break;
      }
    }
    if (!matchedState) {
      return { success: false, accepted: false, error: '未匹配到子 Agent 任务（可能已结束）' };
    }

    // 仅 working / force_deliver 阶段接收结果
    // force_deliver 是轮次硬顶后的强制交付阶段，必须放行交付（否则硬顶逼出的结果被自己拒收 → 挂到总超时）
    if (matchedState.phase !== 'working' && matchedState.phase !== 'force_deliver') {
      return { success: false, accepted: false, error: '任务不在可接收阶段（当前 ' + matchedState.phase + '）' };
    }

    if (type === 'plain_text') {
      // Task 10 停住检测：无工具活动时发提醒，有工具活动则策略 B 回退
      this._handlePlainText(matchedState, text);
      return { success: true, accepted: true, handled: false };
    }

    if (type !== 'subagent_result') {
      return { success: false, accepted: false, error: '未知 result type: ' + type };
    }

    if (!text || typeof text !== 'string' || !text.trim()) {
      return { success: false, accepted: false, error: 'subagent_result 内容为空' };
    }

    // 敷衍检测（Task 9.1）：未通过且追问次数 < 2 → 追问，不落盘不 resolve
    if (this.isTrivialResult(text) && matchedState.supplementCount < 2) {
      this._sendSupplement(matchedState);
      return { success: true, accepted: true, handled: false, supplement: true };
    }

    // 追问超限：接受最后一次结果，附加 warning（Task 9.3）
    let warning = null;
    if (this.isTrivialResult(text) && matchedState.supplementCount >= 2) {
      warning = '子 Agent 连续 ' + matchedState.supplementCount + ' 次敷衍交付，已接受最后一次结果';
      console.warn('[SubagentRunner] ' + warning + ':', matchedState.taskId);
    }

    // 结果真实性校验（Task 9.4 启发式）
    const authenticityWarning = this._checkResultAuthenticity(matchedState, text);
    if (authenticityWarning) {
      warning = warning ? warning + '; ' + authenticityWarning : authenticityWarning;
    }

    // 落盘：projectDir/.cuckoo/subagent-results/{taskId}.md
    let resultFile = null;
    try {
      const baseDir = matchedState.projectDir || process.cwd();
      const resultsDir = path.join(baseDir, '.cuckoo', 'subagent-results');
      fs.mkdirSync(resultsDir, { recursive: true });
      resultFile = path.join(resultsDir, matchedState.taskId + '.md');
      fs.writeFileSync(resultFile, text, 'utf-8');
      console.log('[SubagentRunner] 结果已落盘:', resultFile);
    } catch (err) {
      console.error('[SubagentRunner] 落盘失败:', err.message);
      return { success: false, accepted: false, error: '落盘失败: ' + err.message };
    }

    const preview = text.slice(0, 500);

    // resolve 任务并关窗（completed 也关窗，一次性工人）
    this._completeTask(matchedState, { resultFile, preview, ...(warning ? { warning } : {}) });

    return { success: true, accepted: true, taskId: matchedState.taskId, resultFile, preview, ...(warning ? { warning } : {}) };
  }

  /**
   * 发送追问消息到子窗口（敷衍追问，Task 9.2）。
   */
  _sendSupplement(state) {
    if (!state.win || state.win.isDestroyed()) return;
    const reminder = '你的最终结果过于简单，不满足交付要求。请重新输出完整的 subagent_result 代码块。\n\n【必须包含】\n1. 实际完成的工作内容（不是"已完成"这类声明）\n2. 具体产出：修改的文件路径、发现的问题清单、分析结论、关键命令输出等\n3. 结果应当可验证、可执行\n\n请基于你此前的工作记录，直接输出完整结果，不要重新执行任务。';
    state.win.webContents.send('subagent-reminder', { message: reminder });
    state.supplementCount++;
    console.log('[SubagentRunner] 已发追问（第 ' + state.supplementCount + ' 次）:', state.taskId);
  }

  /**
   * 正常完成任务：清理定时器、resolve、关窗。
   */
  _completeTask(state, data) {
    if (state.phase === 'completed' || state.phase === 'failed') return;
    state.phase = 'completed';
    if (state.timer) clearTimeout(state.timer);
    if (state.startingTimer) clearTimeout(state.startingTimer);
    if (state.idleTimer) clearTimeout(state.idleTimer);

    // 先摘 win 引用，避免 closed 回调重复处理
    const win = state.win;
    state.win = null;

    if (state.resolve) {
      state.resolve({ success: true, data });
      state.resolve = null;
    }

    if (win && !win.isDestroyed()) {
      try { win.close(); } catch (_) {}
    }
    this.activeTasks.delete(state.taskId);
    this._notifyStatusChange(); // 任务结束，通知主窗口控制台
    console.log('[SubagentRunner] 任务 completed:', state.taskId);
  }

  /**
   * 获取运行中任务的状态列表（供主窗口控制台状态推送）。
   * 仅返回 starting/working 阶段的任务。
   * @returns {Array<{ taskId, agentType, elapsedMs, windowId }>}
   */
  getStatusList() {
    const list = [];
    for (const state of this.activeTasks.values()) {
      if (state.phase === 'starting' || state.phase === 'working' || state.phase === 'force_deliver') {
        list.push({
          taskId: state.taskId,
          agentType: state.agentType || '通用',
          elapsedMs: Date.now() - state.startedAt,
          windowId: state.win ? state.win.id : null,
        });
      }
    }
    return list;
  }

  /**
   * 获取当前可用 agent 模板清单（供"多 Agent"按钮机制说明拼接）。
   * @param {string|null} projectDir
   * @returns {Array<{ id, summary }>}
   */
  getAgentList(projectDir) {
    const templates = agentTemplates.load(projectDir || null);
    const list = [];
    for (const [id, t] of templates) {
      list.push({ id, summary: t.summary || '' });
    }
    return list;
  }

  /**
   * 按 windowId 中止任务（Task 12 subagent-abort）。
   * @param {number} windowId 子窗口 id
   * @returns {boolean} 是否命中并中止
   */
  abortByWindowId(windowId) {
    for (const state of this.activeTasks.values()) {
      if (state.win && state.win.id === windowId) {
        this._failTask(state.taskId, '子 Agent 任务已被用户中止');
        return true;
      }
    }
    return false;
  }

  /**
   * 按 windowId 聚焦子窗口（Task 12 focus-subagent-window）。
   * @param {number} windowId
   * @returns {boolean} 是否找到
   */
  focusByWindowId(windowId) {
    for (const state of this.activeTasks.values()) {
      if (state.win && state.win.id === windowId && !state.win.isDestroyed()) {
        if (state.win.isMinimized()) state.win.restore();
        state.win.focus();
        return true;
      }
    }
    return false;
  }

  /**
   * 用户中止任务（Task 12 接入 subagent-abort IPC）。
   */
  abortTask(taskId, reason) {
    this._failTask(taskId, reason || '已被用户中止');
  }
}

module.exports = { SubagentRunner, WORKER_PARTITION, LOGIN_CHECK_JS, EXPERT_MODE_JS };

/**
 * 覆盖层按钮事件绑定
 * 由原 preload.js 拆分而来，逻辑保持不变。
 */
const state = require('../dom/state');
const { hideOverlay, showOverlay, renderHistory, commandHistory, showToast, showConfirmDialog, hideFirstTimeDialog } = require('./ui');
const { handleInitProject, renderSessions } = require('../dom/session-list');
const { handleManualParse } = require('../dom/observer');
const { sendToChat } = require('../dom/chat-input');

/**
 * 渲染窗口列表（浮动管理面板内）
 */
async function renderWindowList() {
  const list = document.getElementById('cuckoo-window-list');
  if (!list) return;
  try {
    const res = await window.electronAPI.listProfiles();
    const profiles = res && res.success ? res.profiles : [];
    if (!profiles || profiles.length === 0) {
      list.innerHTML = '<div class="cuckoo-session-empty">暂无窗口</div>';
      return;
    }
    // 获取平台名映射
    const providerMap = {};
    try {
      const pvRes = await window.electronAPI.listProviders();
      if (pvRes && pvRes.success) {
        (pvRes.providers || []).forEach(pv => { providerMap[pv.id] = pv.name; });
      }
    } catch (_) {}

    list.innerHTML = profiles.map(p => {
      const pname = providerMap[p.providerId] || '平台';
      return '<div class="cuckoo-window-item" data-profile-id="' + p.id + '">' +
        '<span class="cuckoo-window-left">' +
          '<span class="cuckoo-window-name">' + p.name + '</span>' +
          '<span class="cuckoo-window-sep">|</span>' +
          '<span class="cuckoo-window-status">' + pname + '</span>' +
        '</span>' +
        '<span class="cuckoo-window-del" data-profile-id="' + p.id + '" title="删除窗口">删除</span>' +
      '</div>';
    }).join('');
    list.querySelectorAll('.cuckoo-window-item').forEach(el => {
      el.addEventListener('click', async (e) => {
        // 点击删除按钮不触发切换
        if (e.target.classList.contains('cuckoo-window-del')) return;
        const profileId = el.dataset.profileId;
        try {
          const r = await window.electronAPI.openProfileWindow(profileId);
          if (r && r.success) {
            showToast(r.focused ? '已切换到该窗口' : '已打开窗口', 2000);
            closeWindowManager();
          } else {
            showToast((r && r.error) || '打开失败', 3000);
          }
        } catch (err) {
          showToast('打开窗口失败: ' + (err.message || err), 3000);
        }
      });
    });
    // 绑定删除按钮
    list.querySelectorAll('.cuckoo-window-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const profileId = btn.dataset.profileId;
        try {
          const r = await window.electronAPI.deleteProfileWindow(profileId);
          if (r && r.success) {
            showToast('已删除窗口', 2000);
            await renderWindowList();
          } else {
            showToast((r && r.error) || '删除失败', 3000);
          }
        } catch (err) {
          showToast('删除失败: ' + (err.message || err), 3000);
        }
      });
    });
  } catch (err) {
    list.innerHTML = '<div class="cuckoo-session-empty">加载失败</div>';
  }
}

/**
 * 打开窗口管理浮动面板
 */
function openWindowManager() {
  const panel = document.getElementById('cuckoo-window-manager');
  if (panel) {
    panel.classList.remove('cuckoo-hidden');
    renderWindowList();
  }
}

/**
 * 关闭窗口管理浮动面板
 */
function closeWindowManager() {
  const panel = document.getElementById('cuckoo-window-manager');
  if (panel) panel.classList.add('cuckoo-hidden');
}

/**
 * 生成项目说明文档按钮点击处理
 */
function handleGenerateDoc() {
  const message = '根据当前项目生成一个类似 claude.md 的项目说明文件，并将文件放到当前项目 .cuckooCode/CUCKOO.md';
  if (!sendToChat(message, '生成文档', 300)) {
    showToast('未找到输入框，请确保已打开聊天界面', 3000);
  }
}

/**
 * 加载配置到 JSON 框
 */
async function loadMcpConfigToJson() {
  const res = await window.electronAPI.listMcpServers();
  const servers = res && res.success ? res.servers : [];
  // 转成主流 mcpServers 格式
  const mcpServers = {};
  for (const s of servers) {
    const def = {};
    if (s.type === 'http') {
      if (s.url) def.url = s.url;
      if (s.headers) def.headers = s.headers;
    } else {
      if (s.command) def.command = s.command;
      if (s.args && s.args.length) def.args = s.args;
      if (s.env) def.env = s.env;
    }
    mcpServers[s.name] = def;
  }
  const jsonInput = document.getElementById('cuckoo-mcp-json');
  if (jsonInput) jsonInput.value = JSON.stringify({ mcpServers }, null, 2);
}

/**
 * 渲染 MCP server 列表
 */
async function renderMcpList() {
  const list = document.getElementById('cuckoo-mcp-list');
  if (!list) return;
  try {
    const res = await window.electronAPI.listMcpServers();
    const servers = res && res.success ? res.servers : [];
    if (!servers || servers.length === 0) {
      list.innerHTML = '<div class="cuckoo-session-empty">暂无 MCP Server</div>';
      return;
    }
    list.innerHTML = servers.map(s => {
      const status = s.connected ? '已连接' : (s.enabled ? '未连接' : '已禁用');
      const statusColor = s.connected ? '#4ade80' : (s.enabled ? '#ffc107' : '#5d6280');
      return '<div class="cuckoo-window-item cuckoo-mcp-item" data-mcp-name="' + s.name + '">' +
        '<span class="cuckoo-window-name">' + s.name + '</span>' +
        '<span class="cuckoo-mcp-dot" style="width:8px;height:8px;border-radius:50%;background:' + statusColor + ';flex-shrink:0;" title="' + status + '"></span>' +
      '</div>';
    }).join('');

    list.querySelectorAll('.cuckoo-mcp-item').forEach(el => {
      el.addEventListener('click', async () => {
        const name = el.dataset.mcpName;
        const server = servers.find(s => s.name === name);
        if (!server) return;

        // 点击后立即显示 loading
        const dot = el.querySelector('.cuckoo-mcp-dot');
        if (dot) dot.style.background = '#ffc107';
        el.style.pointerEvents = 'none';

        try {
          if (server.connected || server.enabled) {
            // 已连接或已启用 → 断开/禁用
            await window.electronAPI.disableMcpServer(name);
            showToast('已断开 ' + name, 2000);
          } else {
            // 未启用 → 连接
            await window.electronAPI.enableMcpServer(name);
            showToast('已连接 ' + name, 2000);
          }
          await renderMcpList();
          await loadMcpConfigToJson();
        } catch (err) {
          showToast('操作失败: ' + (err.message || err), 3000);
          await renderMcpList();
        }
      });
    });
  } catch (err) {
    list.innerHTML = '<div class="cuckoo-session-empty">加载失败</div>';
  }
}

/**
 * 打开 MCP 管理面板
 */
function openMcpManager() {
  const panel = document.getElementById('cuckoo-mcp-manager');
  if (panel) {
    panel.classList.remove('cuckoo-hidden');
    renderMcpList();
    loadMcpConfigToJson();
  }
}

/**
 * 关闭 MCP 管理面板
 */
function closeMcpManager() {
  const panel = document.getElementById('cuckoo-mcp-manager');
  if (panel) panel.classList.add('cuckoo-hidden');
}

/**
 * 绑定覆盖层所有 UI 事件
 * 包括按钮点击、键盘快捷键、状态徽章点击等
 */
let eventsBound = false;
let mcpSending = false; // 防止 MCP 信息重复发送

function bindEvents() {
  // 防止重复绑定（SPA 导航或 preload 重载时可能导致多次执行）
  if (eventsBound) return;
  eventsBound = true;

  // 从 localStorage 恢复延迟配置
  try {
    const savedMin = localStorage.getItem('cuckoo-send-delay-min');
    const savedMax = localStorage.getItem('cuckoo-send-delay-max');
    if (savedMin) state.sendDelayMin = parseInt(savedMin, 10) || 2000;
    if (savedMax) state.sendDelayMax = parseInt(savedMax, 10) || 4000;
    // 同步到输入框
    const minInput = document.getElementById('cuckoo-delay-min');
    const maxInput = document.getElementById('cuckoo-delay-max');
    if (minInput) minInput.value = state.sendDelayMin;
    if (maxInput) maxInput.value = state.sendDelayMax;
  } catch (e) {}

  const minimizeBtn = document.getElementById('cuckoo-btn-minimize');
  const initBtn = document.getElementById('cuckoo-btn-init');
  const clearBtn = document.getElementById('cuckoo-btn-clear');

  minimizeBtn?.addEventListener('click', hideOverlay);
  initBtn?.addEventListener('click', handleInitProject);

  // 首次使用提示浮窗：初始化按钮（与右侧初始化项目逻辑一致）
  const firstInitBtn = document.getElementById('cuckoo-btn-first-init');
  firstInitBtn?.addEventListener('click', handleInitProject);

  // 首次使用提示浮窗：关闭按钮
  const firstCloseBtn = document.getElementById('cuckoo-btn-first-close');
  firstCloseBtn?.addEventListener('click', hideFirstTimeDialog);
  clearBtn?.addEventListener('click', () => {
    commandHistory.length = 0;
    renderHistory();
  });

  // 手动解析按钮
  const manualParseBtn = document.getElementById('cuckoo-btn-manual-parse');
  manualParseBtn?.addEventListener('click', handleManualParse);

  // 窗口管理按钮：打开浮动管理面板
  const windowManagerBtn = document.getElementById('cuckoo-btn-window-manager');
  windowManagerBtn?.addEventListener('click', () => {
    openWindowManager();
  });

  // MCP 按钮：打开 MCP 管理面板
  const mcpBtn = document.getElementById('cuckoo-btn-mcp');
  mcpBtn?.addEventListener('click', openMcpManager);

  // MCP 面板：关闭
  const mcpCloseBtn = document.getElementById('cuckoo-mcp-close');
  mcpCloseBtn?.addEventListener('click', closeMcpManager);

  // MCP 面板：刷新
  const mcpRefreshBtn = document.getElementById('cuckoo-mcp-refresh');
  mcpRefreshBtn?.addEventListener('click', renderMcpList);

  // MCP 面板：保存配置
  const mcpSaveBtn = document.getElementById('cuckoo-mcp-save');
  mcpSaveBtn?.addEventListener('click', async () => {
    const jsonInput = document.getElementById('cuckoo-mcp-json');
    if (!jsonInput || !jsonInput.value.trim()) {
      showToast('请输入配置', 3000);
      return;
    }
    try {
      const parsed = JSON.parse(jsonInput.value);
      if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
        showToast('配置格式错误，需要 mcpServers 对象', 3000);
        return;
      }

      // 校验每个 server 定义是否完整合法（发现错误立即中止，不删旧配置、不覆盖编辑框）
      for (const [name, def] of Object.entries(parsed.mcpServers)) {
        if (!def || typeof def !== 'object' || Array.isArray(def)) {
          showToast('配置错误：server "' + name + '" 的定义必须是对象', 4000);
          return;
        }
        const hasUrl = def.url !== undefined;
        const hasCommand = def.command !== undefined;
        if (hasUrl) {
          if (typeof def.url !== 'string' || !def.url.trim()) {
            showToast('配置错误：server "' + name + '" 的 url 必须是非空字符串', 4000);
            return;
          }
          if (hasCommand) {
            showToast('配置错误：server "' + name + '" 不能同时指定 url 和 command', 4000);
            return;
          }
        } else if (hasCommand) {
          if (typeof def.command !== 'string' || !def.command.trim()) {
            showToast('配置错误：server "' + name + '" 的 command 必须是非空字符串', 4000);
            return;
          }
        } else {
          showToast('配置错误：server "' + name + '" 缺少 command 或 url', 4000);
          return;
        }
        if (def.args !== undefined && !Array.isArray(def.args)) {
          showToast('配置错误：server "' + name + '" 的 args 必须是数组', 4000);
          return;
        }
        if (def.env !== undefined && (typeof def.env !== 'object' || def.env === null || Array.isArray(def.env))) {
          showToast('配置错误：server "' + name + '" 的 env 必须是对象', 4000);
          return;
        }
        if (def.headers !== undefined && (typeof def.headers !== 'object' || def.headers === null || Array.isArray(def.headers))) {
          showToast('配置错误：server "' + name + '" 的 headers 必须是对象', 4000);
          return;
        }
      }

      // 先删除 JSON 里不存在的旧 server
      const oldRes = await window.electronAPI.listMcpServers();
      const oldServers = (oldRes && oldRes.success && oldRes.servers) || [];
      const newNames = new Set(Object.keys(parsed.mcpServers));
      for (const old of oldServers) {
        if (!newNames.has(old.name)) {
          await window.electronAPI.removeMcpServer(old.name);
        }
      }

      // 逐个 upsert 新配置
      for (const [name, def] of Object.entries(parsed.mcpServers)) {
        const server = {
          name,
          type: def && def.url ? 'http' : 'stdio',
          command: def && def.command,
          args: def && def.args || [],
          url: def && def.url,
          headers: def && def.headers,
          env: def && def.env,
        };
        await window.electronAPI.upsertMcpServer(server);
      }
      showToast('配置已保存', 2200);
      await renderMcpList();
      await loadMcpConfigToJson();
      // 询问用户是否将 MCP 更新通知发给 AI（不自动发送）
      try {
        const confirmed = await showConfirmDialog(
          'MCP 配置已保存。\n\n是否告诉 AI 配置已更新？\n（请确保 AI 当前没有正在进行其他操作）',
          { okText: '发送', showCancel: true, cancelText: '取消' }
        );
        if (!confirmed) return;

        const res = await window.electronAPI.getMcpTools();
        const tools = res && res.success ? res.tools : [];
        const serverNames = Array.from(new Set(tools.map(t => t.server)));
        let msg = '【MCP 配置已更新】\n\n';
        if (serverNames.length === 0) {
          msg += '当前没有已连接的 MCP server。';
        } else {
          msg += '可用的 MCP server：' + serverNames.join('、') + '。\n';
          msg += '需要时用 mcpListServers() 查看概览，或用 mcpGetTools(serverName) 查看具体工具。';
        }
        sendToChat(msg, 'MCP信息', 300);
      } catch (err) {
        console.error('[Cuckoo Code] 发送 MCP 信息失败:', err);
      }
    } catch (err) {
      showToast('保存失败: ' + (err.message || err), 3000);
    }
  });



  // 浮动面板：新建窗口（不指定平台，让窗口显示平台选择页）
  const wmNewWindowBtn = document.getElementById('cuckoo-wm-new-window');
  wmNewWindowBtn?.addEventListener('click', async () => {
    try {
      await window.electronAPI.createProfileWindow();
      showToast('已打开平台选择', 2200);
      await renderWindowList();
    } catch (err) {
      showToast('创建新窗口失败: ' + (err.message || err), 3000);
    }
  });

  // 浮动面板：关闭
  const wmCloseBtn = document.getElementById('cuckoo-wm-close');
  wmCloseBtn?.addEventListener('click', closeWindowManager);

  // 浮动面板：刷新列表
  const wmRefreshBtn = document.getElementById('cuckoo-wm-refresh');
  wmRefreshBtn?.addEventListener('click', renderWindowList);

  // 生成项目说明文档按钮
  const genDocBtn = document.getElementById('cuckoo-btn-gen-doc');
  genDocBtn?.addEventListener('click', handleGenerateDoc);

  // 沉浸式交流按钮
  const immersiveBtn = document.getElementById('cuckoo-btn-immersive');
  immersiveBtn?.addEventListener('click', () => {
    const message = '现在你的任何疑问,或没有疑问的选择都需要和我确认 , 确认的方式是 你问一个问题我回答一个问题,然后你再问下一个问题, 最好给我选项, 也要给我个其他的选项, 谢谢 爱你哦';
    if (!sendToChat(message, '沉浸式交流', 300)) {
      showToast('未找到输入框，请确保已打开聊天界面', 3000);
    } else {
      showToast('已发送沉浸式交流提示', 2200);
    }
  });

  // 刷新会话列表按钮
  const refreshSessionsBtn = document.getElementById('cuckoo-btn-refresh-sessions');
  refreshSessionsBtn?.addEventListener('click', renderSessions);

  // 保存延迟设置按钮
  const saveDelayBtn = document.getElementById('cuckoo-btn-save-delay');
  const delayMinInput = document.getElementById('cuckoo-delay-min');
  const delayMaxInput = document.getElementById('cuckoo-delay-max');
  saveDelayBtn?.addEventListener('click', () => {
    const min = parseInt(delayMinInput?.value, 10);
    const max = parseInt(delayMaxInput?.value, 10);
    if (Number.isNaN(min) || min < 0) { showToast('最小延迟必须是非负整数', 3000); return; }
    if (Number.isNaN(max) || max < min) { showToast('最大延迟不能小于最小延迟', 3000); return; }
    if (max > 10000) { showToast('最大延迟不能超过 10000ms', 3000); return; }
    state.sendDelayMin = min;
    state.sendDelayMax = max;
    // 保存到 localStorage
    try {
      localStorage.setItem('cuckoo-send-delay-min', String(min));
      localStorage.setItem('cuckoo-send-delay-max', String(max));
    } catch (e) {}
    showToast('延迟设置已保存：' + min + ' - ' + max + ' ms', 3000);
  });

  // 悬浮球点击切换面板显隐
  const statusBadge = document.getElementById('cuckoo-status-badge');
  statusBadge?.addEventListener('click', () => {
    const overlay = document.getElementById('cuckoo-overlay');
    if (!overlay) return;
    if (overlay.classList.contains('cuckoo-hidden')) {
      showOverlay();
    } else {
      hideOverlay();
    }
  });

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+C 切换覆盖层显示
    if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
      e.preventDefault();
      const overlay = document.getElementById('cuckoo-overlay');
      if (overlay) {
        if (overlay.classList.contains('cuckoo-hidden')) {
          showOverlay();
        } else {
          hideOverlay();
        }
      }
    }
    // Esc 隐藏覆盖层和窗口管理面板
    if (e.key === 'Escape') {
      hideOverlay();
      closeWindowManager();
      closeMcpManager();
      hideFirstTimeDialog();
    }
  });

  // Task 11/12：子 Agent 控制台事件与状态监听
  bindSubagentConsole();
}

/* ================= Task 11/12：多 Agent 按钮 + 子 Agent 控制台 ================= */

// 当前运行中的子 Agent 任务（供切换窗口/中止使用）
let currentSubagentTask = null;

function formatElapsed(ms) {
  const totalSec = Math.floor((ms || 0) / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return m + ':' + s;
}

/**
 * 渲染子 Agent 控制台（运行中任务条目）。
 * @param {Array} tasks subagent-status 推送的任务列表
 */
function renderSubagentConsole(tasks) {
  const section = document.getElementById('cuckoo-subagent-task');
  if (!section) return;
  const list = Array.isArray(tasks) ? tasks : [];
  if (list.length === 0) {
    section.classList.add('cuckoo-hidden');
    currentSubagentTask = null;
    return;
  }
  const t = list[0]; // 仅串行，取第一条
  currentSubagentTask = t;
  section.classList.remove('cuckoo-hidden');
  const nameEl = document.getElementById('cuckoo-subagent-name');
  const elapsedEl = document.getElementById('cuckoo-subagent-elapsed');
  if (nameEl) nameEl.textContent = t.agentType || '通用';
  if (elapsedEl) elapsedEl.textContent = formatElapsed(t.elapsedMs);
}

/**
 * 点击"多 Agent"按钮：拉取 agent 清单 → 拼接机制说明 → 发送到聊天框。
 */
async function handleMultiAgentButton() {
  const btn = document.getElementById('cuckoo-btn-multi-agent');
  if (btn) { btn.disabled = true; setTimeout(() => { btn.disabled = false; }, 2000); }
  try {
    const res = await window.electronAPI.getAgentList();
    const agents = res && res.success ? (res.agents || []) : [];
    const agentDir = (res && res.agentDir) || '';
    const lines = [];
    lines.push('【多 Agent 机制说明】');
    lines.push('');
    lines.push('你现在具备搭建子 Agent 的能力。以下是完整机制：');
    lines.push('');
    lines.push('## 子 Agent 机制');
    lines.push('1. Cuckoo 内置了一批通用子 Agent（见下方清单）；你也可以创建自定义子 Agent');
    lines.push('2. 每个 .md 文件 = 一个子 Agent 类型。文件名是 agentType（如 code-reviewer.md）');
    lines.push('3. 文件内容 = 该子 Agent 的角色提示词');
    lines.push('');
    lines.push('## 当前可用的子 Agent');
    if (agents.length === 0) {
      lines.push('暂无预定义子 Agent，可调用通用 subagent');
    } else {
      for (const a of agents) lines.push('- ' + a.id + '：' + (a.summary || ''));
    }
    lines.push('');
    lines.push('## 包裹模板（自动应用，无需你在模板中重复）');
    lines.push('每个子 Agent 收到任务时，框架会自动包裹：');
    lines.push('- 回复模式：只能用 cuckoo 代码块执行工具，或用 subagent_result 代码块交付结果');
    lines.push('- 行为规则：自主完成，不向用户提问');
    lines.push('- 任务内容（由主 Agent 调用时提供）');
    lines.push('');
    lines.push('## 你现在可以做什么');
    if (agentDir) {
      lines.push('1. 用 write 工具在以下目录创建新的 .md 文件（自定义子 Agent 统一存放于此）：');
      lines.push('   ' + agentDir);
    } else {
      lines.push('1. 创建自定义子 Agent（目录由框架管理）');
    }
    lines.push('2. 调用 subagent({ agentType, task }) 委派任务给子 Agent');
    lines.push('3. 帮用户设计子 Agent 的角色、工作范围、输出规范');
    lines.push('');
    lines.push('## 创建子 Agent 的注意事项');
    lines.push('- 第一行写清楚"你是谁、专注什么"（给主 Agent 看的简介）');
    lines.push('- 明确工作范围和输出格式');
    lines.push('- 无需输出使用示范');
    lines.push('');
    lines.push('请回复"已理解多 Agent 机制，请告诉我你想创建什么子 Agent"。');

    sendToChat(lines.join(String.fromCharCode(10)), '多Agent机制');
  } catch (err) {
    showToast('拉取 agent 清单失败: ' + (err.message || err), 3000);
  }
}

/**
 * 绑定子 Agent 控制台相关事件（多 Agent 按钮/切换窗口/中止）+ 状态监听。
 */
function bindSubagentConsole() {
  const multiBtn = document.getElementById('cuckoo-btn-multi-agent');
  multiBtn?.addEventListener('click', handleMultiAgentButton);

  const focusBtn = document.getElementById('cuckoo-btn-subagent-focus');
  focusBtn?.addEventListener('click', async () => {
    if (!currentSubagentTask || !currentSubagentTask.windowId) return;
    try { await window.electronAPI.focusSubagentWindow(currentSubagentTask.windowId); } catch (_) {}
  });

  const abortBtn = document.getElementById('cuckoo-btn-subagent-abort');
  abortBtn?.addEventListener('click', async () => {
    if (!currentSubagentTask || !currentSubagentTask.windowId) return;
    const ok = await showConfirmDialog('确定要中止当前子 Agent 任务吗？', { showCancel: true });
    if (!ok) return;
    try {
      await window.electronAPI.subagentAbort(currentSubagentTask.windowId);
      showToast('已中止子 Agent 任务', 3000);
    } catch (err) {
      showToast('中止失败: ' + (err.message || err), 3000);
    }
  });

  // 状态推送监听
  try {
    window.electronAPI.onSubagentStatus((payload) => {
      renderSubagentConsole(payload && payload.tasks);
    });
  } catch (_) {}
}

module.exports = bindEvents;

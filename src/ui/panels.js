/**
 * shell 侧栏面板内容（ES Module，供 happy-dom 测试导入）。
 * 承载「会话」「窗口」「MCP」「任务」「设置」「项目」六个面板，逻辑对照迁移自 overlay 侧
 * session-list.ts、panels/window-manager.ts、panels/mcp-manager.ts、panels/settings.ts、
 * project-dir.ts、auto-compact.ts（功能等价）。
 * shell 是 file:// 自有页面，但会话 id / profile 名 / 项目目录等外部数据
 * 一律走 textContent / dataset，不拼 innerHTML。
 */
'use strict';

import { formatTokenCount } from './shell.js';

/** 面板内轻提示（替代 overlay 的 showToast） */
function showPanelToast(doc, text, ms) {
  const toast = doc.getElementById('panel-toast');
  if (!toast) return;
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(showPanelToast._timer);
  showPanelToast._timer = setTimeout(function () {
    toast.hidden = true;
  }, ms || 2500);
}

/** 创建元素（文本走 textContent） */
function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

export function initPanels(api, doc) {
  api = api || {};
  const sessionList = doc.getElementById('shell-session-list');
  const windowList = doc.getElementById('shell-window-list');

  // ===== 会话面板 =====

  function renderSessionEmpty(text) {
    if (!sessionList) return;
    sessionList.textContent = '';
    sessionList.appendChild(el(doc, 'div', 'panel-empty', text));
  }

  async function renderSessionList() {
    if (!sessionList) return;
    try {
      if (!api.listSessions) {
        renderSessionEmpty('API 不可用');
        return;
      }
      const result = await api.listSessions();
      if (!result || !result.success) {
        renderSessionEmpty('加载失败');
        return;
      }
      const sessions = result.sessions || [];
      if (sessions.length === 0) {
        renderSessionEmpty('暂无会话');
        return;
      }
      sessionList.textContent = '';
      for (const sessionId of sessions) {
        const item = el(doc, 'div', 'panel-item session-item');
        item.dataset.sessionId = String(sessionId);
        item.appendChild(el(doc, 'span', 'session-id', String(sessionId)));
        sessionList.appendChild(item);
      }
    } catch (err) {
      console.error('[Cuckoo Shell] 渲染会话列表失败:', err);
      renderSessionEmpty('加载出错');
    }
  }

  async function navigateToSession(sessionId) {
    if (!sessionId) return;
    try {
      if (!api.navigateSession) {
        showPanelToast(doc, '导航 API 不可用', 3000);
        return;
      }
      const result = await api.navigateSession(sessionId);
      if (result && result.success) {
        // 导航成功后小延迟刷新会话列表（页面可能正在跳转）
        setTimeout(renderSessionList, 2000);
      } else {
        showPanelToast(doc, '导航失败: ' + ((result && result.error) || '未知错误'), 3000);
      }
    } catch (err) {
      console.error('[Cuckoo Shell] 导航到会话失败:', err);
      showPanelToast(doc, '导航失败: ' + (err && err.message ? err.message : err), 3000);
    }
  }

  if (sessionList) {
    sessionList.addEventListener('click', function (e) {
      const item = e.target.closest('.session-item');
      if (!item || !sessionList.contains(item)) return;
      const sessionId = item.dataset.sessionId;
      if (sessionId) navigateToSession(sessionId);
    });
  }

  // ===== 窗口面板 =====

  function renderWindowEmpty(text) {
    if (!windowList) return;
    windowList.textContent = '';
    windowList.appendChild(el(doc, 'div', 'panel-empty', text));
  }

  function renderWindowItem(p, providerMap) {
    const pname = providerMap[p.providerId] || '平台';
    const item = el(doc, 'div', 'panel-item window-item');
    item.dataset.profileId = String(p.id);

    const checkbox = el(doc, 'input');
    checkbox.type = 'checkbox';
    checkbox.checked = p.autoOpen === true;
    checkbox.dataset.profileId = String(p.id);
    const label = el(doc, 'label', 'window-auto');
    label.title = '启动时默认打开此窗口';
    label.appendChild(checkbox);
    label.appendChild(doc.createTextNode('默认'));

    const left = el(doc, 'span', 'window-left');
    left.appendChild(el(doc, 'span', 'window-name', String(p.name)));
    left.appendChild(el(doc, 'span', 'window-status', pname));

    const del = el(doc, 'span', 'window-del', '删除');
    del.title = '删除窗口';
    del.dataset.profileId = String(p.id);

    item.appendChild(label);
    item.appendChild(left);
    item.appendChild(del);
    return item;
  }

  async function renderWindowList() {
    if (!windowList) return;
    if (!api.listProfiles) {
      renderWindowEmpty('API 不可用');
      return;
    }
    try {
      const res = await api.listProfiles();
      const profiles = res && res.success ? res.profiles : [];
      if (!profiles || profiles.length === 0) {
        renderWindowEmpty('暂无窗口');
        return;
      }
      // 获取平台名映射
      const providerMap = {};
      try {
        const pvRes = api.listProviders ? await api.listProviders() : null;
        if (pvRes && pvRes.success) {
          for (const pv of pvRes.providers || []) providerMap[pv.id] = pv.name;
        }
      } catch { /* 平台名映射失败时退化为“平台” */ }

      windowList.textContent = '';
      for (const p of profiles) windowList.appendChild(renderWindowItem(p, providerMap));
    } catch (err) {
      console.error('[Cuckoo Shell] 渲染窗口列表失败:', err);
      renderWindowEmpty('加载失败');
    }
  }

  if (windowList) {
    // 勾选「默认」→ 设置启动时自动打开（失败回滚）
    windowList.addEventListener('change', async function (e) {
      const cb = e.target.closest('.window-auto input');
      if (!cb || !windowList.contains(cb)) return;
      const profileId = cb.dataset.profileId;
      const on = cb.checked;
      try {
        const r = await api.setProfileAutoOpen(profileId, on);
        if (!r || !r.success) {
          showPanelToast(doc, (r && r.error) || '设置失败', 3000);
          cb.checked = !on;
        }
      } catch (err) {
        showPanelToast(doc, '设置失败: ' + (err && err.message ? err.message : err), 3000);
        cb.checked = !on;
      }
    });

    windowList.addEventListener('click', async function (e) {
      const target = e.target;

      const del = target.closest('.window-del');
      if (del && windowList.contains(del)) {
        const profileId = del.dataset.profileId;
        try {
          const r = await api.deleteProfileWindow(profileId);
          if (r && r.success) {
            showPanelToast(doc, '已删除窗口', 2000);
            await renderWindowList();
          } else {
            showPanelToast(doc, (r && r.error) || '删除失败', 3000);
          }
        } catch (err) {
          showPanelToast(doc, '删除失败: ' + (err && err.message ? err.message : err), 3000);
        }
        return;
      }

      // 点击复选框区域不触发切换
      if (target.closest('.window-auto')) return;

      const item = target.closest('.window-item');
      if (!item || !windowList.contains(item)) return;
      const profileId = item.dataset.profileId;
      try {
        const r = await api.openProfileWindow(profileId);
        if (r && r.success) {
          showPanelToast(doc, r.focused ? '已切换到该窗口' : '已打开窗口', 2000);
        } else {
          showPanelToast(doc, (r && r.error) || '打开失败', 3000);
        }
      } catch (err) {
        showPanelToast(doc, '打开窗口失败: ' + (err && err.message ? err.message : err), 3000);
      }
    });
  }

  // 新建窗口（不指定平台，让窗口显示平台选择页）
  const btnNewWindow = doc.getElementById('shell-btn-new-window');
  if (btnNewWindow) {
    btnNewWindow.addEventListener('click', async function () {
      try {
        await api.createProfileWindow();
        showPanelToast(doc, '已打开平台选择', 2200);
        await renderWindowList();
      } catch (err) {
        showPanelToast(doc, '创建新窗口失败: ' + (err && err.message ? err.message : err), 3000);
      }
    });
  }
  const btnRefreshWindows = doc.getElementById('shell-btn-refresh-windows');
  if (btnRefreshWindows) {
    btnRefreshWindows.addEventListener('click', function () { renderWindowList(); });
  }

  // ===== MCP 面板（逻辑对照迁移自 overlay panels/mcp-manager.ts） =====

  const mcpList = doc.getElementById('shell-mcp-list');
  const mcpJson = doc.getElementById('shell-mcp-json');
  const mcpNotify = doc.getElementById('shell-mcp-notify');
  /** 最近一次渲染的 server 列表（委托回调按名字查找状态） */
  let lastMcpServers = [];

  function renderMcpEmpty(text) {
    if (!mcpList) return;
    mcpList.textContent = '';
    mcpList.appendChild(el(doc, 'div', 'panel-empty', text));
  }

  function renderMcpItem(s) {
    const status = s.connected ? '已连接' : (s.enabled ? '未连接' : '已禁用');
    const dotClass = s.connected ? 'connected' : (s.enabled ? 'enabled' : 'disabled');
    const srcLabel = s.source === 'project' ? '项目' : '用户';
    const srcClass = s.source === 'project' ? 'project' : 'user';
    const item = el(doc, 'div', 'panel-item mcp-item');
    item.dataset.mcpName = String(s.name);
    item.appendChild(el(doc, 'span', 'mcp-name', String(s.name)));
    item.appendChild(el(doc, 'span', 'mcp-src ' + srcClass, srcLabel));
    const dot = el(doc, 'span', 'mcp-dot ' + dotClass);
    dot.title = status;
    item.appendChild(dot);
    return item;
  }

  /** 渲染 MCP server 列表 */
  async function renderMcpList() {
    if (!mcpList) return;
    if (!api.listMcpServers) {
      renderMcpEmpty('API 不可用');
      return;
    }
    try {
      const res = await api.listMcpServers();
      const servers = res && res.success ? res.servers : [];
      lastMcpServers = servers || [];
      if (!servers || servers.length === 0) {
        renderMcpEmpty('暂无 MCP Server');
        return;
      }
      mcpList.textContent = '';
      for (const s of servers) mcpList.appendChild(renderMcpItem(s));
    } catch (err) {
      console.error('[Cuckoo Shell] 渲染 MCP 列表失败:', err);
      lastMcpServers = [];
      renderMcpEmpty('加载失败');
    }
  }

  /** 加载配置到 JSON 框（只显示用户级，不混项目级） */
  async function loadMcpConfigToJson() {
    if (!mcpJson || !api.listMcpServers) return;
    try {
      const res = await api.listMcpServers({ scope: 'user' });
      const servers = res && res.success ? res.servers : [];
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
      mcpJson.value = JSON.stringify({ mcpServers: mcpServers }, null, 2);
    } catch (err) {
      console.error('[Cuckoo Shell] 加载 MCP 配置失败:', err);
    }
  }

  if (mcpList) {
    // 点击 server 条目：已连接/已启用 → 断开，否则 → 连接
    mcpList.addEventListener('click', async function (e) {
      const item = e.target.closest('.mcp-item');
      if (!item || !mcpList.contains(item)) return;
      const name = item.dataset.mcpName;
      const server = lastMcpServers.find(function (s) { return s.name === name; });
      if (!server) return;
      try {
        if (server.connected || server.enabled) {
          await api.disableMcpServer(name);
          showPanelToast(doc, '已断开 ' + name, 2000);
        } else {
          await api.enableMcpServer(name);
          showPanelToast(doc, '已连接 ' + name, 2000);
        }
        await renderMcpList();
        await loadMcpConfigToJson();
      } catch (err) {
        showPanelToast(doc, '操作失败: ' + (err && err.message ? err.message : err), 3000);
        await renderMcpList();
      }
    });
  }

  /** 校验单个 server 定义，返回错误文案或 null（与 overlay 版提示一致） */
  function validateMcpServerDef(name, def) {
    if (!def || typeof def !== 'object' || Array.isArray(def)) {
      return '配置错误：server "' + name + '" 的定义必须是对象';
    }
    const hasUrl = def.url !== undefined;
    const hasCommand = def.command !== undefined;
    if (hasUrl) {
      if (typeof def.url !== 'string' || !def.url.trim()) {
        return '配置错误：server "' + name + '" 的 url 必须是非空字符串';
      }
      if (hasCommand) {
        return '配置错误：server "' + name + '" 不能同时指定 url 和 command';
      }
    } else if (hasCommand) {
      if (typeof def.command !== 'string' || !def.command.trim()) {
        return '配置错误：server "' + name + '" 的 command 必须是非空字符串';
      }
    } else {
      return '配置错误：server "' + name + '" 缺少 command 或 url';
    }
    if (def.args !== undefined && !Array.isArray(def.args)) {
      return '配置错误：server "' + name + '" 的 args 必须是数组';
    }
    if (def.env !== undefined && (typeof def.env !== 'object' || def.env === null || Array.isArray(def.env))) {
      return '配置错误：server "' + name + '" 的 env 必须是对象';
    }
    if (def.headers !== undefined && (typeof def.headers !== 'object' || def.headers === null || Array.isArray(def.headers))) {
      return '配置错误：server "' + name + '" 的 headers 必须是对象';
    }
    return null;
  }

  function hideMcpNotify() {
    if (mcpNotify) mcpNotify.hidden = true;
  }

  /** 保存 MCP 配置（校验 → 删除旧 server → upsert → 显示「通知 AI」确认条） */
  async function handleMcpSave() {
    if (!mcpJson || !mcpJson.value.trim()) {
      showPanelToast(doc, '请输入配置', 3000);
      return;
    }
    try {
      const parsed = JSON.parse(mcpJson.value);
      if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
        showPanelToast(doc, '配置格式错误，需要 mcpServers 对象', 3000);
        return;
      }
      // 发现错误立即中止，不删旧配置、不覆盖编辑框
      for (const entry of Object.entries(parsed.mcpServers)) {
        const errText = validateMcpServerDef(entry[0], entry[1]);
        if (errText) {
          showPanelToast(doc, errText, 4000);
          return;
        }
      }

      // 先删除 JSON 里不存在的旧 server（只针对用户级，避免误删项目级）
      const oldRes = await api.listMcpServers({ scope: 'user' });
      const oldServers = (oldRes && oldRes.success && oldRes.servers) || [];
      const newNames = new Set(Object.keys(parsed.mcpServers));
      for (const old of oldServers) {
        if (!newNames.has(old.name)) {
          await api.removeMcpServer(old.name);
        }
      }

      // 逐个 upsert 新配置
      for (const entry of Object.entries(parsed.mcpServers)) {
        const name = entry[0];
        const def = entry[1];
        await api.upsertMcpServer({
          name: name,
          type: def && def.url ? 'http' : 'stdio',
          command: def && def.command,
          args: (def && def.args) || [],
          url: def && def.url,
          headers: def && def.headers,
          env: def && def.env,
        });
      }
      showPanelToast(doc, '配置已保存', 2200);
      await renderMcpList();
      await loadMcpConfigToJson();
      // 等价于 overlay 的 showConfirmDialog：面板内确认条，不自动发送
      if (mcpNotify) mcpNotify.hidden = false;
    } catch (err) {
      showPanelToast(doc, '保存失败: ' + (err && err.message ? err.message : err), 3000);
    }
  }

  const btnMcpSave = doc.getElementById('shell-btn-mcp-save');
  if (btnMcpSave) {
    btnMcpSave.addEventListener('click', function () { handleMcpSave(); });
  }
  const btnRefreshMcp = doc.getElementById('shell-btn-refresh-mcp');
  if (btnRefreshMcp) {
    btnRefreshMcp.addEventListener('click', function () { renderMcpList(); });
  }
  const btnMcpNotifySend = doc.getElementById('shell-btn-mcp-notify-send');
  if (btnMcpNotifySend) {
    btnMcpNotifySend.addEventListener('click', async function () {
      hideMcpNotify();
      try {
        const res = await api.getMcpTools();
        const tools = res && res.success ? res.tools : [];
        const serverNames = Array.from(new Set(tools.map(function (t) { return t.server; })));
        let msg = '【MCP 配置已更新】\n\n';
        if (serverNames.length === 0) {
          msg += '当前没有已连接的 MCP server。';
        } else {
          msg += '可用的 MCP server：' + serverNames.join('、') + '。\n';
          msg += '需要时用 mcpListServers() 查看概览，或用 mcpGetTools(serverName) 查看具体工具。';
        }
        if (api.sendToChat) await api.sendToChat(msg, 'MCP信息', 300);
      } catch (err) {
        console.error('[Cuckoo Shell] 发送 MCP 信息失败:', err);
      }
    });
  }
  const btnMcpNotifyCancel = doc.getElementById('shell-btn-mcp-notify-cancel');
  if (btnMcpNotifyCancel) {
    btnMcpNotifyCancel.addEventListener('click', hideMcpNotify);
  }

  // ===== 设置面板（逻辑对照迁移自 overlay panels/settings.ts，功能等价） =====
  // 读写全部走主进程设置存储 IPC（getSettings/saveSettings/resetSettings），不碰 localStorage。
  // 存储毫秒、界面秒：加载时 /1000，保存时 secToMs。校验顺序与文案与旧实现逐条一致。

  function setVal(id, v) {
    const node = doc.getElementById(id);
    if (node) node.value = v;
  }

  /** 把一份完整设置填入表单（存储毫秒，界面秒） */
  function fillSettingsForm(s) {
    const enEl = doc.getElementById('shell-set-retry-enabled');
    if (enEl) enEl.checked = !!s.retryEnabled;
    setVal('shell-set-retry-delay-min', s.retryDelayMin / 1000);
    setVal('shell-set-retry-delay-max', s.retryDelayMax / 1000);
    setVal('shell-set-retry-count', String(s.retryCount));
    setVal('shell-set-retry-429-delay', s.retry429Delay / 1000);
    setVal('shell-set-retry-429-count', String(s.retry429Count));
    setVal('shell-set-retry-prompt', s.retryPrompt);
    setVal('shell-set-xhr-idle-timeout', s.xhrIdleTimeout / 1000);
    setVal('shell-set-watchdog-prompt', s.watchdogPrompt);
    setVal('shell-set-watchdog-count', String(s.watchdogCount));
    setVal('shell-set-attach-delay-min', s.attachDelayMin / 1000);
    setVal('shell-set-attach-delay-max', s.attachDelayMax / 1000);
    setVal('shell-set-delay-min', s.sendDelayMin / 1000);
    setVal('shell-set-delay-max', s.sendDelayMax / 1000);
  }

  /** 打开设置面板：从主进程拉取设置填充表单 */
  async function loadSettingsForm() {
    if (!api.getSettings) {
      showPanelToast(doc, 'API 不可用', 3000);
      return;
    }
    let s;
    try {
      s = await api.getSettings();
    } catch {
      showPanelToast(doc, '设置加载失败', 3000);
      return;
    }
    if (!s || typeof s !== 'object') {
      showPanelToast(doc, '设置加载失败', 3000);
      return;
    }
    fillSettingsForm(s);
  }

  /** 保存设置：校验（顺序/文案与 overlay 一致）→ 秒转毫秒 → saveSettings */
  async function handleSettingsSave() {
    const val = function (id) {
      const node = doc.getElementById(id);
      return node ? node.value : '';
    };
    const secToMs = function (v) { return Math.round(parseFloat(v) * 1000); };
    const dmin = secToMs(val('shell-set-retry-delay-min'));
    const dmax = secToMs(val('shell-set-retry-delay-max'));
    if (Number.isNaN(dmin) || dmin < 0) { showPanelToast(doc, '普通失败最小间隔必须是非负数字（秒）', 3000); return; }
    if (Number.isNaN(dmax) || dmax < dmin) { showPanelToast(doc, '普通失败最大间隔不能小于最小间隔', 3000); return; }
    const cnt = parseInt(val('shell-set-retry-count'), 10);
    if (Number.isNaN(cnt)) { showPanelToast(doc, '普通失败重试次数必须是整数', 3000); return; }
    const d429 = secToMs(val('shell-set-retry-429-delay'));
    if (Number.isNaN(d429) || d429 < 0) { showPanelToast(doc, '操作频繁重试间隔必须是非负数字（秒）', 3000); return; }
    const c429 = parseInt(val('shell-set-retry-429-count'), 10);
    if (Number.isNaN(c429)) { showPanelToast(doc, '操作频繁重试次数必须是整数', 3000); return; }
    const prompt = val('shell-set-retry-prompt').trim();
    if (!prompt) { showPanelToast(doc, '重试提示词不能为空', 3000); return; }
    const idleTimeout = secToMs(val('shell-set-xhr-idle-timeout'));
    if (Number.isNaN(idleTimeout) || idleTimeout < 0) { showPanelToast(doc, '挂起超时必须是非负数字（秒）', 3000); return; }
    const watchdogPrompt = val('shell-set-watchdog-prompt').trim();
    if (!watchdogPrompt) { showPanelToast(doc, '工具循环超时提示词不能为空', 3000); return; }
    const watchdogCount = parseInt(val('shell-set-watchdog-count'), 10);
    if (Number.isNaN(watchdogCount)) { showPanelToast(doc, '工具循环催继续次数必须是整数', 3000); return; }
    const smin = secToMs(val('shell-set-delay-min'));
    const smax = secToMs(val('shell-set-delay-max'));
    if (Number.isNaN(smin) || smin < 0) { showPanelToast(doc, '发送延迟最小值必须是非负数字（秒）', 3000); return; }
    if (Number.isNaN(smax) || smax < smin) { showPanelToast(doc, '发送延迟最大值不能小于最小值', 3000); return; }
    if (smax > 10000) { showPanelToast(doc, '发送延迟最大值不能超过 10 秒', 3000); return; }
    const amin = secToMs(val('shell-set-attach-delay-min'));
    const amax = secToMs(val('shell-set-attach-delay-max'));
    if (Number.isNaN(amin) || amin < 0) { showPanelToast(doc, '附件上传间隔最小值必须是非负数字（秒）', 3000); return; }
    if (Number.isNaN(amax) || amax < amin) { showPanelToast(doc, '附件上传间隔最大值不能小于最小值', 3000); return; }
    if (amax > 60000) { showPanelToast(doc, '附件上传间隔最大值不能超过 60 秒', 3000); return; }

    if (!api.saveSettings) {
      showPanelToast(doc, 'API 不可用', 3000);
      return;
    }
    const enEl = doc.getElementById('shell-set-retry-enabled');
    let result;
    try {
      result = await api.saveSettings({
        retryEnabled: !!(enEl && enEl.checked),
        retryDelayMin: dmin,
        retryDelayMax: dmax,
        retryCount: cnt,
        retry429Delay: d429,
        retry429Count: c429,
        retryPrompt: prompt,
        xhrIdleTimeout: idleTimeout,
        watchdogPrompt: watchdogPrompt,
        watchdogCount: watchdogCount,
        sendDelayMin: smin,
        sendDelayMax: smax,
        attachDelayMin: amin,
        attachDelayMax: amax,
      });
    } catch {
      showPanelToast(doc, '设置保存失败', 3000);
      return;
    }
    if (!result || !result.settings) {
      showPanelToast(doc, '设置保存失败', 3000);
      return;
    }
    showPanelToast(doc, '设置已保存', 2500);
  }

  /** 恢复默认：resetSettings（主进程排除 autoCompact 两字段），用返回的完整设置重填表单 */
  async function handleSettingsReset() {
    if (!api.resetSettings) {
      showPanelToast(doc, 'API 不可用', 3000);
      return;
    }
    let result;
    try {
      result = await api.resetSettings();
    } catch {
      showPanelToast(doc, '恢复默认失败', 3000);
      return;
    }
    if (!result || !result.settings) {
      showPanelToast(doc, '恢复默认失败', 3000);
      return;
    }
    fillSettingsForm(result.settings);
    showPanelToast(doc, '已恢复默认设置', 2500);
  }

  /** 「刷新技能与代理」：让主进程重扫技能/代理目录，把最新清单发给 AI */
  async function handleSendSkills() {
    if (!api.refreshSkills) {
      showPanelToast(doc, '接口不可用', 3000);
      return;
    }
    try {
      const result = await api.refreshSkills();
      if (!result || !result.success) {
        showPanelToast(doc, '获取清单失败: ' + ((result && result.error) || '未知错误'), 3000);
        return;
      }
      const section = result.section || '';
      if (!section.trim()) {
        showPanelToast(doc, '没有找到任何技能或代理', 3000);
        return;
      }
      const sent = api.sendToChat ? await api.sendToChat(section, '技能与代理清单', 300) : null;
      if (!sent || !sent.success) {
        showPanelToast(doc, '发送失败: ' + ((sent && sent.error) || '未知错误'), 3000);
        return;
      }
      showPanelToast(doc, '已发送（技能 ' + (result.skillCount || 0) + ' 个 / 代理 ' + (result.agentCount || 0) + ' 个）', 2500);
    } catch (err) {
      showPanelToast(doc, '发送失败: ' + (err && err.message ? err.message : err), 3000);
    }
  }

  const btnSettingsSave = doc.getElementById('shell-btn-settings-save');
  if (btnSettingsSave) {
    btnSettingsSave.addEventListener('click', function () { handleSettingsSave(); });
  }
  const btnSettingsReset = doc.getElementById('shell-btn-settings-reset');
  if (btnSettingsReset) {
    btnSettingsReset.addEventListener('click', function () { handleSettingsReset(); });
  }
  const btnSkillsSend = doc.getElementById('shell-btn-skills-send');
  if (btnSkillsSend) {
    btnSkillsSend.addEventListener('click', function () { handleSendSkills(); });
  }

  // ===== 项目面板（逻辑对照迁移自 overlay project-dir.ts / events.ts / auto-compact.ts） =====

  const dirPathEl = doc.getElementById('shell-project-dir-path');

  function renderProjectDir(dirPath) {
    if (dirPathEl) dirPathEl.textContent = dirPath || '未选择';
  }

  /** 打开面板时拉取当前项目目录（shell 重载后事件不重放，需主动查） */
  async function loadProjectDir() {
    if (!api.getProjectDir) return;
    try {
      const res = await api.getProjectDir();
      if (res && res.success) renderProjectDir(res.projectDir || null);
    } catch (err) {
      console.error('[Cuckoo Shell] 获取项目目录失败:', err);
    }
  }

  // 主进程转发 AI 页面的 project-dir-updated：更新显示并刷新会话列表（目录换了会话集也变）
  if (api.onProjectDirUpdated) {
    api.onProjectDirUpdated(function (dirPath) {
      renderProjectDir(dirPath || null);
      renderSessionList();
    });
  }

  /** 初始化项目（按钮 busy 态对照 overlay handleInitProject） */
  const btnInitProject = doc.getElementById('shell-btn-init-project');
  if (btnInitProject) {
    btnInitProject.addEventListener('click', async function () {
      if (!api.initProject) {
        showPanelToast(doc, 'API 不可用', 3000);
        return;
      }
      btnInitProject.disabled = true;
      const prevText = btnInitProject.textContent;
      btnInitProject.textContent = '初始化中...';
      try {
        const result = await api.initProject();
        if (result && !result.success) {
          showPanelToast(doc, result.message || '初始化失败', 3000);
        }
      } catch (err) {
        showPanelToast(doc, '初始化失败: ' + (err && err.message ? err.message : err), 3000);
      } finally {
        btnInitProject.disabled = false;
        btnInitProject.textContent = prevText;
      }
    });
  }

  /** 修改目录：只更新目录映射，不重新发送初始提示（updateProjectDir = skipPrompt） */
  const btnChangeDir = doc.getElementById('shell-btn-change-dir');
  if (btnChangeDir) {
    btnChangeDir.addEventListener('click', async function () {
      if (!api.updateProjectDir) {
        showPanelToast(doc, 'API 不可用', 3000);
        return;
      }
      try {
        const result = await api.updateProjectDir();
        // 成功：主进程会推 shell-project-dir-updated 更新显示
        if (result && !result.success) {
          showPanelToast(doc, result.message || '修改目录失败', 3000);
        }
      } catch (err) {
        showPanelToast(doc, '修改目录失败: ' + (err && err.message ? err.message : err), 3000);
      }
    });
  }

  /** 生成项目说明（文案对照 overlay panels/window-manager.ts handleGenerateDoc） */
  const btnGenDoc = doc.getElementById('shell-btn-gen-doc');
  if (btnGenDoc) {
    btnGenDoc.addEventListener('click', async function () {
      if (!api.sendToChat) {
        showPanelToast(doc, '发送失败：未找到输入框', 3000);
        return;
      }
      try {
        const res = await api.sendToChat(
          '根据当前项目生成一个类似 claude.md 的项目说明文件，并将文件放到当前项目 .cuckoo/CUCKOO.md',
          '生成文档',
          300
        );
        if (res && !res.success) {
          showPanelToast(doc, '发送失败：未找到输入框', 3000);
        }
      } catch (err) {
        showPanelToast(doc, '发送失败: ' + (err && err.message ? err.message : err), 3000);
      }
    });
  }

  /** 催促继续（文案对照 overlay events.ts handleManualParseDispatch） */
  const btnNudge = doc.getElementById('shell-btn-nudge');
  if (btnNudge) {
    btnNudge.addEventListener('click', async function () {
      if (!api.sendToChat) {
        showPanelToast(doc, '发送失败：未找到输入框', 3000);
        return;
      }
      try {
        const res = await api.sendToChat('刚才卡住了请继续 爱你哦', '继续', 300);
        if (res && !res.success) {
          showPanelToast(doc, '发送失败：未找到输入框', 3000);
          return;
        }
        showPanelToast(doc, '已发送：继续', 2500);
      } catch (err) {
        showPanelToast(doc, '发送失败: ' + (err && err.message ? err.message : err), 3000);
      }
    });
  }

  // ===== Token 用量（五项明细：当前上下文/对话累计/窗口累计/今日累计/系统总累计） =====

  let lastTokenUsage = { context: 0, cumulative: 0, windowCumulative: 0, todayCumulative: 0 };
  let systemTotal = 0;

  function setUsageText(id, n) {
    const node = doc.getElementById(id);
    if (node) node.textContent = formatTokenCount(typeof n === 'number' ? n : 0);
  }

  function renderUsage() {
    setUsageText('shell-usage-context', lastTokenUsage.context);
    setUsageText('shell-usage-cumulative', lastTokenUsage.cumulative);
    setUsageText('shell-usage-window', lastTokenUsage.windowCumulative);
    setUsageText('shell-usage-today', lastTokenUsage.todayCumulative);
    setUsageText('shell-usage-system', systemTotal);
  }

  if (api.onTokenUpdated) {
    api.onTokenUpdated(function (data) {
      if (!data) return;
      lastTokenUsage = {
        context: typeof data.context === 'number' ? data.context : 0,
        cumulative: typeof data.cumulative === 'number' ? data.cumulative : 0,
        windowCumulative: typeof data.windowCumulative === 'number' ? data.windowCumulative : 0,
        todayCumulative: typeof data.todayCumulative === 'number' ? data.todayCumulative : 0,
      };
      renderUsage();
    });
  }
  if (api.onTotalUpdated) {
    api.onTotalUpdated(function (data) {
      if (!data) return;
      systemTotal = typeof data.systemTotal === 'number' ? data.systemTotal : 0;
      renderUsage();
    });
  }

  /** 打开面板时主动拉一次系统总累计（广播可能发生在面板打开前） */
  async function loadSystemTotal() {
    if (!api.getSystemTotal) return;
    try {
      const res = await api.getSystemTotal();
      if (res && res.success && typeof res.systemTotal === 'number') {
        systemTotal = res.systemTotal;
        renderUsage();
      }
    } catch (err) {
      console.error('[Cuckoo Shell] 获取系统总累计失败:', err);
    }
  }

  /** 压缩上下文：relay 到 AI 页面执行 runCompaction（清 IDB + 刷新流程在页面侧） */
  const btnCompact = doc.getElementById('shell-btn-compact');
  if (btnCompact) {
    btnCompact.addEventListener('click', async function () {
      if (!api.compact) {
        showPanelToast(doc, 'API 不可用', 3000);
        return;
      }
      try {
        const res = await api.compact();
        if (res && res.success) {
          showPanelToast(doc, '已开始压缩流程（在聊天页面执行）', 3000);
        } else {
          showPanelToast(doc, '压缩失败: ' + ((res && res.error) || '未知错误'), 3000);
        }
      } catch (err) {
        showPanelToast(doc, '压缩失败: ' + (err && err.message ? err.message : err), 3000);
      }
    });
  }

  // ===== 自动压缩设置（读写走 settings IPC；reset 排除语义由主进程 settings-store 保证） =====

  async function loadAutoCompactForm() {
    if (!api.getSettings) {
      showPanelToast(doc, 'API 不可用', 3000);
      return;
    }
    try {
      const s = await api.getSettings();
      if (!s || typeof s !== 'object') return;
      const enEl = doc.getElementById('shell-auto-compact-enabled');
      const thEl = doc.getElementById('shell-auto-compact-threshold');
      if (enEl) enEl.checked = !!s.autoCompactEnabled;
      if (thEl) thEl.value = String(s.autoCompactThreshold);
    } catch (err) {
      console.error('[Cuckoo Shell] 加载自动压缩设置失败:', err);
    }
  }

  /** 保存自动压缩设置（校验与提示文案对照 overlay auto-compact.ts） */
  async function handleAutoCompactSave() {
    const enEl = doc.getElementById('shell-auto-compact-enabled');
    const thEl = doc.getElementById('shell-auto-compact-threshold');
    const enabled = !!(enEl && enEl.checked);
    const th = thEl ? parseFloat(thEl.value) : NaN;
    if (!Number.isFinite(th) || th <= 0) {
      showPanelToast(doc, '阈值需为正数（万）', 3000);
      return;
    }
    if (!api.saveSettings) {
      showPanelToast(doc, '设置保存失败', 3000);
      return;
    }
    try {
      const result = await api.saveSettings({ autoCompactEnabled: enabled, autoCompactThreshold: th });
      if (!result || !result.settings) {
        showPanelToast(doc, '设置保存失败', 3000);
        return;
      }
      showPanelToast(doc, '自动压缩设置已保存：' + (enabled ? '开启，阈值 ' + th + ' 万' : '关闭'), 2500);
    } catch {
      showPanelToast(doc, '设置保存失败', 3000);
    }
  }

  const btnAutoCompactSave = doc.getElementById('shell-btn-auto-compact-save');
  if (btnAutoCompactSave) {
    btnAutoCompactSave.addEventListener('click', function () { handleAutoCompactSave(); });
  }

  /** 滚动到用量区（token 徽章点击展开项目面板后调用；shell.html 注入到 initShell hooks） */
  function revealUsage() {
    const usage = doc.getElementById('shell-usage-section');
    if (usage && typeof usage.scrollIntoView === 'function') {
      usage.scrollIntoView({ block: 'start' });
    }
  }

  // ===== 任务面板（工具活动：当前命令/状态/结果 + 历史；历史存主进程内存，按窗口隔离） =====
  // 数据流：executor → reportToolActivity → 主进程存历史 + 转发 shell-tool-activity → 本面板。
  // 面板未打开时只更新数据，不强制展开；打开时经 getToolHistory 拉一次全量补齐。

  const taskList = doc.getElementById('shell-task-list');
  const taskCurrent = doc.getElementById('shell-task-current');
  const taskCurrentStatus = doc.getElementById('shell-task-current-status');
  const taskCurrentCommand = doc.getElementById('shell-task-current-command');
  const taskCurrentOutput = doc.getElementById('shell-task-current-output');

  /** 与主进程历史保持一致（新→旧，上限 50） */
  let taskEntries = [];

  function truncateText(text, maxLen) {
    const s = text === undefined || text === null ? '' : String(text);
    return s.length > maxLen ? s.substring(0, maxLen) + '...' : s;
  }

  function formatTaskTime(ts) {
    const d = new Date(typeof ts === 'number' ? ts : Date.now());
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function taskStatusInfo(entry) {
    if (entry.status === 'running') return { text: '执行中', cls: 'running' };
    if (entry.canceled) return { text: '已忽略', cls: 'canceled' };
    return entry.success ? { text: '成功', cls: 'success' } : { text: '失败', cls: 'error' };
  }

  /** 当前命令区：最新一条（执行中带 spinner，完成后展示输出） */
  function renderTaskCurrent() {
    if (!taskCurrent) return;
    const entry = taskEntries[0];
    if (!entry) {
      taskCurrent.hidden = true;
      return;
    }
    taskCurrent.hidden = false;
    const info = taskStatusInfo(entry);
    if (taskCurrentStatus) {
      taskCurrentStatus.textContent = '';
      taskCurrentStatus.className = 'task-current-status ' + info.cls;
      if (entry.status === 'running') {
        taskCurrentStatus.appendChild(el(doc, 'span', 'task-spinner'));
      }
      taskCurrentStatus.appendChild(doc.createTextNode(info.text));
    }
    if (taskCurrentCommand) taskCurrentCommand.textContent = entry.command;
    if (taskCurrentOutput) {
      const show = entry.status !== 'running';
      taskCurrentOutput.hidden = !show;
      if (show) taskCurrentOutput.textContent = entry.output || '(无输出)';
    }
  }

  /** 历史条目：头部一行（命令/状态/时间）+ 可展开详情（完整命令 + 输出） */
  function renderTaskItem(entry) {
    const info = taskStatusInfo(entry);
    const item = el(doc, 'div', 'panel-item task-item');
    item.dataset.taskId = String(entry.id);

    const head = el(doc, 'div', 'task-item-head');
    head.appendChild(el(doc, 'span', 'task-item-command', truncateText(entry.command, 60)));
    head.appendChild(el(doc, 'span', 'task-item-status ' + info.cls, info.text));
    head.appendChild(el(doc, 'span', 'task-item-time', formatTaskTime(entry.timestamp)));
    item.appendChild(head);

    const detail = el(doc, 'div', 'task-item-detail');
    detail.hidden = true;
    detail.appendChild(el(doc, 'div', 'task-detail-command', entry.command));
    const outText = entry.status === 'running' ? '执行中...' : (entry.output || '(无输出)');
    detail.appendChild(el(doc, 'pre', 'task-output', outText));
    item.appendChild(detail);
    return item;
  }

  function renderTaskList() {
    renderTaskCurrent();
    if (!taskList) return;
    taskList.textContent = '';
    // 最新一条在「当前命令」区展示，历史列表从第二条开始
    const rest = taskEntries.slice(1);
    if (rest.length === 0) {
      if (taskEntries.length === 0) {
        taskList.appendChild(el(doc, 'div', 'panel-empty', '暂无记录'));
      }
      return;
    }
    for (const entry of rest) taskList.appendChild(renderTaskItem(entry));
  }

  /** 增量条目：同 id 覆盖（running → done），新条目插最前 */
  function applyToolActivity(entry) {
    if (!entry || !entry.id) return;
    const idx = taskEntries.findIndex(function (x) { return x.id === entry.id; });
    if (idx >= 0) taskEntries[idx] = entry;
    else taskEntries.unshift(entry);
    if (taskEntries.length > 50) taskEntries.length = 50;
    renderTaskList();
  }

  if (api.onToolActivity) {
    api.onToolActivity(function (entry) { applyToolActivity(entry); });
  }

  // 点击历史条目：面板内展开/收起该条详情
  if (taskList) {
    taskList.addEventListener('click', function (e) {
      const item = e.target.closest('.task-item');
      if (!item || !taskList.contains(item)) return;
      const detail = item.querySelector('.task-item-detail');
      if (detail) detail.hidden = !detail.hidden;
    });
  }

  /** 打开面板时拉一次全量（增量转发发生在面板打开前的部分靠这个补齐） */
  async function loadToolHistory() {
    if (!api.getToolHistory) return;
    try {
      const res = await api.getToolHistory();
      if (res && res.success && Array.isArray(res.entries)) {
        taskEntries = res.entries;
        renderTaskList();
      }
    } catch (err) {
      console.error('[Cuckoo Shell] 获取工具活动历史失败:', err);
    }
  }

  const btnClearTasks = doc.getElementById('shell-btn-clear-tasks');
  if (btnClearTasks) {
    btnClearTasks.addEventListener('click', async function () {
      try {
        if (api.clearToolHistory) await api.clearToolHistory();
      } catch (err) {
        console.error('[Cuckoo Shell] 清空工具活动历史失败:', err);
      }
      taskEntries = [];
      renderTaskList();
    });
  }

  // ===== 面板切换：显隐内容容器，按需渲染 =====
  function handlePanelChange(panelId) {
    const contents = doc.querySelectorAll('.panel-content');
    for (const c of contents) {
      c.hidden = c.dataset.panelContent !== panelId;
    }
    if (panelId === 'chat') renderSessionList();
    if (panelId === 'window') renderWindowList();
    if (panelId === 'settings') loadSettingsForm();
    if (panelId === 'project') {
      loadProjectDir();
      loadAutoCompactForm();
      loadSystemTotal();
      renderUsage();
    }
    if (panelId === 'mcp') {
      renderMcpList();
      loadMcpConfigToJson();
    }
    if (panelId === 'task') loadToolHistory();
  }

  return {
    handlePanelChange: handlePanelChange,
    renderSessionList: renderSessionList,
    renderWindowList: renderWindowList,
    renderMcpList: renderMcpList,
    loadMcpConfigToJson: loadMcpConfigToJson,
    loadSettingsForm: loadSettingsForm,
    revealUsage: revealUsage,
    renderTaskList: renderTaskList,
  };
}

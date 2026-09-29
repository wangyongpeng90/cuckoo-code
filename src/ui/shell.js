/**
 * 壳页面逻辑（ES Module，供 happy-dom 测试导入）。
 * shell.html 以 <script type="module"> 调用 initShell(window.shellAPI || {}, document)。
 */
'use strict';

/** 面板 id → 面板名（标题栏显示）；rail 首位的 home 图标是导航动作，不是面板 */
const PANEL_NAMES = {
  chat: '会话',
  window: '窗口',
  mcp: 'MCP',
  task: '任务',
  settings: '设置',
  project: '项目',
};

// 对话 token 显示
export function formatTokenCount(n) {
  if (!isFinite(n) || n < 0) return '0';
  if (n >= 100000000) return (n / 100000000).toFixed(2) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(2) + '万';
  return String(Math.round(n));
}

export function initShell(api, doc, hooks) {
  api = api || {};
  hooks = hooks || {};
  const input = doc.getElementById('url-input');
  const btnBack = doc.getElementById('btn-back');
  const btnForward = doc.getElementById('btn-forward');
  let currentUrl = '';
  let activePanel = null;

  // ===== 平台分支（无边框窗口） =====
  // macOS：系统红绿灯内嵌在标题栏左侧（CSS padding 留白）；
  // win32：标题栏右侧渲染自绘 min/max/close（linux 同样 frame:false，但暂未渲染，可用系统菜单/快捷键）
  const platform = typeof api.platform === 'string' ? api.platform : '';
  if (platform && doc.body) doc.body.classList.add('platform-' + platform);
  if (platform === 'win32') {
    const winControls = doc.getElementById('win-controls');
    if (winControls) {
      winControls.hidden = false;
      doc.getElementById('btn-win-min').addEventListener('click', function () { if (api.windowMinimize) api.windowMinimize(); });
      doc.getElementById('btn-win-max').addEventListener('click', function () { if (api.windowMaximize) api.windowMaximize(); });
      doc.getElementById('btn-win-close').addEventListener('click', function () { if (api.windowClose) api.windowClose(); });
    }
  }

  // 标题栏：provider 名 + 当前页面 hostname（pushUrlState 推送）
  function updateTitle(providerName) {
    const el = doc.getElementById('titlebar-title');
    if (!el) return;
    let hostname = '';
    try { hostname = new URL(currentUrl).hostname; } catch { /* 空/非法 URL */ }
    el.textContent = providerName
      ? (hostname ? providerName + ' · ' + hostname : providerName)
      : (hostname || 'Cuckoo Code');
  }

  function setBtn(btn, enabled) {
    if (enabled) btn.classList.remove('disabled');
    else btn.classList.add('disabled');
  }

  if (api.onUrlUpdated) {
    api.onUrlUpdated(function (data) {
      if (!data) return;
      currentUrl = data.url || '';
      if (doc.activeElement !== input) input.value = currentUrl;
      setBtn(btnBack, data.canGoBack);
      setBtn(btnForward, data.canGoForward);
      const lock = doc.getElementById('lock');
      if (lock) lock.classList.toggle('insecure', !/^https:/i.test(currentUrl));
      updateTitle(typeof data.providerName === 'string' ? data.providerName : '');
    });
  }

  input.addEventListener('focus', function () { input.select(); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      let url = input.value.trim();
      if (!url) return;
      if (!/^[a-z]+:\/\//i.test(url)) url = 'https://' + url;
      if (api.navigate) api.navigate(url);
      input.blur();
    } else if (e.key === 'Escape') {
      input.value = currentUrl;
      input.blur();
    }
  });

  // ===== 导航条滑出状态机（P2 机制复用：浮层 + view 临时下移） =====
  // 默认隐藏；标题栏导航图标 / Ctrl+L 唤出；离开导航条 600ms 后收起，
  // URL 输入框聚焦期间不收起（blur 后重新计时）。无 hover 热区（常驻标题栏已占顶部）。
  const navbar = doc.getElementById('navbar');
  const NAVBAR_HIDE_DELAY = 600;
  let navbarVisible = false;
  let hideTimer = null;

  function clearHideTimer() {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function setNavbarVisible(visible) {
    navbarVisible = visible;
    navbar.classList.toggle('visible', visible);
    // 同步主进程：滑出时 view 下移 44px 露出浮层，隐藏后回到标题栏下沿
    if (api.setTopbarVisible) api.setTopbarVisible(visible);
  }

  function showNavbar() {
    clearHideTimer();
    if (!navbarVisible) setNavbarVisible(true);
  }

  function scheduleHide() {
    clearHideTimer();
    hideTimer = setTimeout(function () {
      hideTimer = null;
      if (doc.activeElement === input) return; // URL 输入框聚焦期间不收起
      if (navbarVisible) setNavbarVisible(false);
    }, NAVBAR_HIDE_DELAY);
  }

  function focusUrlInput() {
    showNavbar();
    input.focus();
    input.select();
  }

  navbar.addEventListener('mouseenter', clearHideTimer);
  navbar.addEventListener('mouseleave', scheduleHide);
  input.addEventListener('focus', clearHideTimer);
  input.addEventListener('blur', scheduleHide);

  // 标题栏导航图标：唤出（并聚焦 URL 输入框）/ 收起导航条
  const btnNavToggle = doc.getElementById('btn-nav-toggle');
  if (btnNavToggle) {
    btnNavToggle.addEventListener('click', function () {
      if (navbarVisible) setNavbarVisible(false);
      else focusUrlInput();
    });
  }

  // AI 页面聚焦时 Ctrl+L 由主进程 before-input-event relay 回来
  if (api.onFocusUrl) api.onFocusUrl(focusUrlInput);

  // ===== 视图缩放（标题栏按钮 + 壳页面 Ctrl/Cmd +/-/0；AI 页面聚焦时由主进程直接应用） =====
  // mini 菜单是原生子窗口（层级高于 AI 页面 view），点击按钮时把按钮位置交给主进程弹出。
  const btnZoom = doc.getElementById('btn-zoom');
  const zoomValue = doc.getElementById('zoom-value');

  function setZoomLabel(factor) {
    if (zoomValue) zoomValue.textContent = Math.round((factor || 1) * 100) + '%';
  }

  if (btnZoom) {
    btnZoom.addEventListener('click', function () {
      const rect = btnZoom.getBoundingClientRect();
      if (api.openZoomMenu) {
        api.openZoomMenu({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
      } else if (api.zoom) {
        // 无主进程支持时退化为直接放大（测试环境/异常环境）
        api.zoom('in');
      }
    });
  }
  // 壳重载后回读主进程保留的倍率；运行中由 shell-zoom-updated 增量刷新
  if (api.getZoom) {
    api.getZoom().then(function (res) {
      if (res && typeof res.zoomFactor === 'number') setZoomLabel(res.zoomFactor);
    }).catch(function () {});
  }
  if (api.onZoomUpdated) {
    api.onZoomUpdated(function (data) {
      if (data && typeof data.zoomFactor === 'number') setZoomLabel(data.zoomFactor);
    });
  }

  // ===== 面板切换状态机 =====
  const panel = doc.getElementById('side-panel');
  const panelTitle = doc.getElementById('panel-title');
  let lastPanel = null;

  function setActivePanel(panelId, opts) {
    const quiet = !!(opts && opts.quiet);
    activePanel = panelId;
    if (panelId) lastPanel = panelId;
    const buttons = doc.querySelectorAll('.rail-btn');
    for (const btn of buttons) {
      btn.classList.toggle('active', btn.dataset.panel === panelId);
    }
    panel.hidden = !panelId;
    if (panelId) panelTitle.textContent = PANEL_NAMES[panelId] || '';
    if (hooks.onPanelChange) hooks.onPanelChange(panelId);
    // quiet：主进程回放面板状态（壳重载后恢复），状态已一致，不再回传
    if (!quiet && api.setPanelOpen) api.setPanelOpen(panelId);
  }

  // 原 overlay 的 Ctrl+Shift+C / Esc 快捷键迁入 shell（Task 10）：
  // Ctrl+Shift+C 展开（上次打开的面板，默认会话）/收起；Esc 收起
  function togglePanel() {
    setActivePanel(activePanel ? null : (lastPanel || 'chat'));
  }

  function isEditableTarget(target) {
    if (!target || !target.tagName) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  doc.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
      e.preventDefault();
      togglePanel();
      return;
    }
    // Ctrl+L / Cmd+L：无论导航条是否可见都唤出并聚焦 URL 输入框（浏览器惯例键，拦截）
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'L' || e.key === 'l')) {
      e.preventDefault();
      focusUrlInput();
      return;
    }
    // Ctrl/Cmd +/-/0：缩放 AI 页面（浏览器惯例键；'+' 与 '=' 同键、'_' 为 Shift+-，都放行）
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_' || e.key === '0')) {
      e.preventDefault();
      const action = (e.key === '=' || e.key === '+') ? 'in'
        : (e.key === '-' || e.key === '_') ? 'out'
        : 'reset';
      if (api.zoom) api.zoom(action);
      return;
    }
    if (e.key === 'Escape' && activePanel && !isEditableTarget(e.target)) {
      setActivePanel(null);
    }
  });

  // AI 页面聚焦时按键落在 view，由主进程 before-input-event relay 回来
  if (api.onTogglePanel) api.onTogglePanel(function () { togglePanel(); });
  if (api.onClosePanel) api.onClosePanel(function () { if (activePanel) setActivePanel(null); });

  const railButtons = doc.querySelectorAll('.rail-btn[data-panel]');
  for (const btn of railButtons) {
    btn.addEventListener('click', function () {
      const id = btn.dataset.panel;
      setActivePanel(activePanel === id ? null : id);
    });
  }
  doc.getElementById('panel-close').addEventListener('click', function () {
    setActivePanel(null);
  });

  // ===== token 徽章（当前会话上下文 token） =====
  const tokenValue = doc.getElementById('token-value');
  if (api.onTokenUpdated) {
    api.onTokenUpdated(function (data) {
      if (!data) return;
      if (tokenValue) tokenValue.textContent = formatTokenCount(data.context);
    });
  }

  // 点击徽章：展开「项目」面板并滚动到用量区（滚动细节由 panels.js 的 onRevealUsage hook 负责）
  const tokenBadge = doc.getElementById('token-badge');
  if (tokenBadge) {
    tokenBadge.addEventListener('click', function () {
      setActivePanel('project');
      if (hooks.onRevealUsage) {
        hooks.onRevealUsage();
      } else {
        const usage = doc.getElementById('shell-usage-section');
        if (usage && typeof usage.scrollIntoView === 'function') {
          usage.scrollIntoView({ block: 'start' });
        }
      }
    });
  }

  // 主进程回放面板状态（壳页面 did-finish-load 后恢复，修复壳重载状态脱钩）：
  // 主进程已有该状态，quiet 回写避免再次触发 setPanelOpen/relayout
  if (api.onPanelRestore) {
    api.onPanelRestore(function (data) {
      const panelId = data && data.panelId ? data.panelId : null;
      setActivePanel(panelId, { quiet: true });
      // 导航条可见性一并回放：壳重载丢失 .visible 类，需与主进程保留的 view 下移状态对齐。
      // showNavbar 会回传 setTopbarVisible(true)，主进程侧是幂等赋值，无环路风险。
      if (data && data.topbarVisible) showNavbar();
    });
  }

  btnBack.addEventListener('click', function () { if (api.back) api.back(); });
  btnForward.addEventListener('click', function () { if (api.forward) api.forward(); });
  doc.getElementById('btn-reload').addEventListener('click', function () { if (api.reload) api.reload(); });
  doc.getElementById('btn-home').addEventListener('click', function () { if (api.home) api.home(); });

  // rail 首位的 home 图标：与标题栏主页按钮同一动作（导航回平台主页），不展开面板、不高亮
  const railHome = doc.getElementById('rail-btn-home');
  if (railHome) {
    railHome.addEventListener('click', function () { if (api.home) api.home(); });
  }

  return {
    getActivePanel: function () { return activePanel; },
    isNavbarVisible: function () { return navbarVisible; },
    showNavbar: showNavbar,
  };
}

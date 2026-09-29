/**
 * 缩放 mini 菜单逻辑（原生子窗口内，供 happy-dom 测试导入）。
 * zoom-menu.html 以 <script type="module"> 调用 initZoomMenu(window.zoomMenuAPI || {}, document)。
 * 点击 +/-：api.apply(action)，窗口保持打开（支持连续缩放）；
 * 倍率显示由主进程 zoom-menu-init / zoom-menu-zoom 推送；
 * 快捷键提示按平台显示（macOS ⌘，其他 Ctrl）。
 */
'use strict';

export function initZoomMenu(api, doc) {
  api = api || {};
  doc = doc || document;
  const valueEl = doc.getElementById('zoom-value');
  const resetKbd = doc.getElementById('zoom-reset-kbd');

  function setLabel(zoomFactor) {
    if (valueEl) valueEl.textContent = Math.round((zoomFactor || 1) * 100) + '%';
  }

  // 快捷键提示按平台区分（与壳页面 title 文案一致用 Ctrl/Cmd 描述）
  if (resetKbd && api.platform) {
    resetKbd.textContent = api.platform === 'darwin' ? '⌘0' : 'Ctrl+0';
  }

  if (api.onInit) api.onInit(function (data) {
    if (data && typeof data.zoomFactor === 'number') setLabel(data.zoomFactor);
  });
  if (api.onZoom) api.onZoom(function (data) {
    if (data && typeof data.zoomFactor === 'number') setLabel(data.zoomFactor);
  });

  doc.addEventListener('click', function (e) {
    const item = e.target && e.target.closest ? e.target.closest('[data-zoom]') : null;
    if (!item) return;
    if (api.apply) api.apply(item.dataset.zoom);
  });

  return { setLabel };
}
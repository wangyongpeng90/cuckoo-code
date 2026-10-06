/**
 * 地址栏：URL 输入、前进/后退/刷新/主页、项目目录选择器。
 */
import { api } from './shared.js';

const input = document.getElementById('url-input') as HTMLInputElement;
const btnBack = document.getElementById('btn-back') as any;
const btnForward = document.getElementById('btn-forward') as any;
let currentUrl = '';

function setBtn(btn: any, enabled: boolean): void {
  if (enabled) btn.classList.remove('disabled');
  else btn.classList.add('disabled');
}

if (api.onUrlUpdated) {
  api.onUrlUpdated((data: any) => {
    if (!data) return;
    currentUrl = data.url || '';
    if (document.activeElement !== input) input.value = currentUrl;
    setBtn(btnBack, data.canGoBack);
    setBtn(btnForward, data.canGoForward);
    const lock = document.getElementById('lock');
    if (lock) lock.style.color = /^https:/i.test(currentUrl) ? '#5fbf7f' : '#c0a060';
  });
}

input.addEventListener('focus', () => input.select());
input.addEventListener('keydown', (e: KeyboardEvent) => {
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

export function projectBaseName(dirPath: string | null): string {
  if (!dirPath) return '未选择';
  const parts = String(dirPath).replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || dirPath;
}

export function renderProjectDir(dirPath: string | null): void {
  const nameEl = document.getElementById('pp-name');
  const iconEl = document.getElementById('pp-icon');
  const pickerEl = document.getElementById('project-picker');
  if (!nameEl || !iconEl) return;
  const name = projectBaseName(dirPath);
  nameEl.textContent = name;
  iconEl.textContent = (dirPath && name) ? name.charAt(0).toUpperCase() : '?';
  if (pickerEl) pickerEl.title = dirPath || '未选择项目目录（点击初始化）';
}

const pickerEl = document.getElementById('project-picker');
if (pickerEl) {
  pickerEl.addEventListener('click', () => { if (api.initProject) api.initProject(); });
}
if (api.onProjectDir) api.onProjectDir((dir: string | null) => renderProjectDir(dir));
if (api.getProjectDir) {
  api.getProjectDir().then((r: any) => { if (r && r.success) renderProjectDir(r.dir); }).catch(() => {});
}

// 纯净模式 / 原版模式 切换
const btnHarness = document.getElementById('btn-harness');
if (btnHarness) {
  btnHarness.addEventListener('click', async () => {
    if (api.toggleHarness) {
      try { await api.toggleHarness(); } catch (_) { /* ignore */ }
    }
  });
}
if (api.onHarnessMode) {
  api.onHarnessMode((d: any) => {
    if (btnHarness) btnHarness.textContent = (d && d.harness) ? '原' : '净';
  });
}

// 地址栏显隐切换（默认隐藏）
const btnAddress = document.getElementById('btn-address');
const urlWrap = document.querySelector('.url-wrap');
if (btnAddress && urlWrap) {
  btnAddress.addEventListener('click', () => {
    const hidden = urlWrap.classList.toggle('cuckoo-hidden');
    if (!hidden && input) { input.focus(); input.select(); }
  });
}

btnBack.addEventListener('click', () => { if (api.back) api.back(); });
btnForward.addEventListener('click', () => { if (api.forward) api.forward(); });
document.getElementById('btn-reload')!.addEventListener('click', () => { if (api.reload) api.reload(); });
// 加号：新建对话（优先用会清理纯净模式视图的 newWebConversation，否则回退到 home）
document.getElementById('btn-home')!.addEventListener('click', () => {
  if ((api as any).newWebConversation) { (api as any).newWebConversation(); return; }
  if (api.home) api.home();
});

// ===== 自绘标题栏：窗口控制按钮（mac 用系统红绿灯，隐藏自绘按钮）=====
const isMac = (api as any).platform === 'darwin';
if (isMac) {
  const wc = document.querySelector('.ck-win-controls') as any;
  if (wc) wc.style.display = 'none';
  document.body.classList.add('ck-mac');
}
const btnWinMin = document.getElementById('ck-win-min');
const btnWinMax = document.getElementById('ck-win-max');
const btnWinClose = document.getElementById('ck-win-close');

if (btnWinMin) btnWinMin.addEventListener('click', () => { if ((api as any).windowMinimize) (api as any).windowMinimize(); });
if (btnWinClose) btnWinClose.addEventListener('click', () => { if ((api as any).windowClose) (api as any).windowClose(); });
if (btnWinMax) btnWinMax.addEventListener('click', () => { if ((api as any).windowMaximize) (api as any).windowMaximize(); });

/**
 * 「文件」页内预览区。
 *
 * 两条拖拽条各司其职：
 *  - 左条（树/内容之间）：改树宽 → 树与内容此消彼长，侧栏总宽不变（AI 不变）
 *  - 右条（侧栏右缘，现成机制）：改侧栏总宽 → 树宽不变，内容区伸缩（AI 变）
 *
 * 实现：打开预览时「树固定宽 + 预览 flex:1」；
 * 左条改树的固定宽（总宽不动），右条改侧栏总宽（现成机制，树固定故内容跟随）。
 */
import { api, escapeHtml } from "./shared.js";
import { showInMonaco } from "./preview-monaco.js";

const PREVIEW_W_KEY = "cuckoo-preview-width";
const MIN_PREVIEW_W = 180;
const MIN_TREE_W = 120;

let openedBaseWidth = 0;    // 打开预览时的侧栏基础宽（关闭时恢复）
let currentRelPath = "";

function pane(): HTMLElement | null { return document.getElementById("ck-preview-pane"); }
function listEl(): HTMLElement | null { return document.getElementById("ft-list"); }
function sidebarEl(): HTMLElement | null { return document.getElementById("ck-sidebar"); }
function colsEl(): HTMLElement | null { return document.querySelector(".ck-files-cols"); }

function getPreviewWidth(): number {
  try {
    const v = Number(localStorage.getItem(PREVIEW_W_KEY));
    if (Number.isFinite(v) && v >= MIN_PREVIEW_W && v <= 1600) return Math.round(v);
  } catch (_) { /* ignore */ }
  return 420;
}

/** 预览可用最大宽：保证 AI 区域至少留 300px */
function maxPreviewWidth(): number {
  const avail = window.innerWidth - baseSidebarWidth() - 300;
  return Math.max(MIN_PREVIEW_W, avail);
}
function savePreviewWidth(w: number): void {
  try { localStorage.setItem(PREVIEW_W_KEY, String(w)); } catch (_) { /* ignore */ }
}

/** 侧栏"基础宽"：用 sidebar.ts 存的稳定值（不被预览加宽污染） */
function baseSidebarWidth(): number {
  try {
    const v = Number(localStorage.getItem("cuckoo-sidebar-width"));
    if (Number.isFinite(v) && v >= 320) return Math.round(v);
  } catch (_) { /* ignore */ }
  return 320;
}

/** 设置侧栏总宽（改 AI 区域）；clamp 到窗口的 75% 防超界 */
function setSidebarWidth(total: number): void {
  let ww = Math.round(total);
  const max = Math.round(window.innerWidth * 0.75);
  if (ww > max) ww = max;
  if (ww < 320) ww = 320;
  const sb = sidebarEl();
  if (sb && !sb.classList.contains("ck-collapsed")) sb.style.width = ww + "px";
  if (api.toggleSidebar) api.toggleSidebar(ww);
}

function fmtSize(n: any): string {
  if (typeof n !== "number") return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}

async function loadFile(relPath: string): Promise<void> {
  const nameEl = document.getElementById("ck-preview-name");
  const sizeEl = document.getElementById("ck-preview-size");
  const emptyEl = document.getElementById("ck-preview-empty");
  const monacoEl = document.getElementById("ck-monaco");
  if (nameEl) { nameEl.textContent = relPath; nameEl.title = relPath; }
  if (sizeEl) sizeEl.textContent = "";
  if (emptyEl) { emptyEl.style.display = "block"; emptyEl.textContent = "加载中…"; }
  if (monacoEl) monacoEl.style.display = "none";
  try {
    const r = await (api as any).readProjectFile(relPath);
    if (!r || !r.success) {
      if (emptyEl) { emptyEl.style.display = "block"; emptyEl.textContent = (r && r.error) || "读取失败"; }
      return;
    }
    if (sizeEl) sizeEl.textContent = fmtSize(r.size);
    if (monacoEl) {
      monacoEl.style.display = "block";
      if (emptyEl) emptyEl.style.display = "none";
      await showInMonaco(monacoEl, relPath, r.content);
    }
  } catch (err: any) {
    if (emptyEl) { emptyEl.style.display = "block"; emptyEl.textContent = "读取失败: " + escapeHtml(err.message); }
    if (monacoEl) monacoEl.style.display = "none";
  }
}

/** 打开预览：树固定宽 + 预览 flex:1；侧栏加宽给预览腾空间 */
export async function openPreview(relPath: string): Promise<void> {
  const p = pane();
  if (!p) return;
  currentRelPath = relPath;
  if (!p.classList.contains("open")) {
    const l = listEl();
    openedBaseWidth = baseSidebarWidth();
    // 树固定当前宽（不再被预览挤压）
    if (l) {
      const treeW = Math.round(l.getBoundingClientRect().width);
      l.style.flex = "0 0 " + treeW + "px";
      l.style.width = treeW + "px";
    }
    p.classList.add("open");
    // 预览占剩余空间
    p.style.flex = "1 1 0";
    p.style.width = "";
    // 侧栏加宽 = 初始预览宽（给预览腾地方）
    setSidebarWidth(openedBaseWidth + Math.min(getPreviewWidth(), maxPreviewWidth()));
  }
  await loadFile(relPath);
}

/** 临时隐藏（切走 tab / 收起侧栏）：记住文件 + 缩回侧栏 */
export function hidePreview(): void {
  const p = pane();
  if (!p || !p.classList.contains("open")) return;
  p.classList.remove("open");
  const l = listEl();
  if (l) { l.style.flex = ""; l.style.width = ""; }
  if (openedBaseWidth > 0) setSidebarWidth(openedBaseWidth);
  openedBaseWidth = 0;
}

/** 真关闭（点 ✕）：忘掉文件 + 缩回侧栏 */
export function dismissPreview(): void {
  currentRelPath = "";
  hidePreview();
}

/** 恢复之前看的文件（切回「文件」tab 时） */
export function restorePreview(): void {
  if (!currentRelPath) return;
  openPreview(currentRelPath);
}

// 事件绑定（由 React 渲染完后调用 initPreviewBindings()）
let previewBound = false;
/** 绑定预览区事件（幂等）。React 渲染出 #ck-preview-* 后调用。 */
export function initPreviewBindings(): void {
  if (previewBound) return;
  const closeBtn = document.getElementById("ck-preview-close");
  const extBtn = document.getElementById("ck-preview-ext");
  if (!closeBtn && !extBtn) return; // 还没渲染
  previewBound = true;
  closeBtn?.addEventListener("click", dismissPreview);
  extBtn?.addEventListener("click", () => {
    if (currentRelPath && (api as any).openFileExternal) (api as any).openFileExternal(currentRelPath).catch(() => {});
  });
  // 左条（树/内容之间）：改树宽（总宽不变 → AI 不变）
  const p = pane();
  if (p && !p.querySelector('.ck-preview-resizer')) {
    const rz = document.createElement("div");
    rz.className = "ck-preview-resizer";
    rz.title = "拖动调整：文件树 / 内容区";
    p.appendChild(rz);
    rz.addEventListener("mousedown", (e: any) => {
      e.preventDefault();
      const startX = e.clientX;
      const l = listEl();
      const cols = colsEl();
      if (!l || !cols) return;
      const startTreeW = l.getBoundingClientRect().width;
      const totalW = cols.getBoundingClientRect().width;
      const onMove = (ev: any) => {
        let treeW = Math.round(startTreeW + (ev.clientX - startX));
        const maxTree = Math.max(MIN_TREE_W, totalW - MIN_PREVIEW_W);
        if (treeW < MIN_TREE_W) treeW = MIN_TREE_W;
        if (treeW > maxTree) treeW = maxTree;
        l.style.flex = "0 0 " + treeW + "px";
        l.style.width = treeW + "px";
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        const treeW = l.getBoundingClientRect().width;
        savePreviewWidth(Math.max(MIN_PREVIEW_W, Math.round(totalW - treeW)));
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }
}

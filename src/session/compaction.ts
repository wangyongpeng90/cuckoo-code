/**
 * 压缩上下文：清 IDB + 刷新，让 DeepSeek 自己写回完整历史
 *
 * 背景（实测）：同会话内 AI 回复后 IDB 不更新；刷新页面才会补齐；
 * 清 IDB 后刷新，DeepSeek 会自动重新拉取完整历史写回（cache_control: REPLACE）。
 *
 * 流程：
 *  段1（当前页 runCompaction）：
 *    发摘要指令 → 等回复 → 清当前会话 IDB 记录 → 存项目目录 → URL 加标记 → 刷新
 *  段2（刷新后同页 checkPendingCompact）：
 *    检测 URL 标记 → 清标记 → 等 hook 的 IDB 写入事件 → 读 IDB
 *    → 取最近 20% 成对 → share/create → 存 pending-init → 跳分享链接
 *  段3（分享页 checkPendingInit）：
 *    现有逻辑：3 秒后自动初始化项目
 *
 * 依赖：
 *  - hook 已缓存真实请求头到 localStorage['cuckoo-ds-headers']
 *  - hook 在 URL 带 cuckoo-compact 时包装 IDBObjectStore.put，写入成功派发
 *    'cuckoo-idb-history-written' 事件
 */
import { sendToChat } from '../overlay/chat-input.js';
import { onInterceptedResponse } from '../bridge/intercept/observer.js';
import { showToast } from '../overlay/panel.js';
import * as retryEngine from '../bridge/loop/retry.js';
import * as watchdog from '../bridge/loop/watchdog.js';

const SUMMARY_INSTRUCTION =
  '请把以上对话总结成一份详细的摘要，尽可能完整地保留关键信息、背景上下文、' +
  '已完成的结论和未完成的事项，用中文，一次性输出全部内容，' +
  '直接输出摘要，不要输出其他解释。';

const COMPACT_URL_FLAG = 'cuckoo-compact';
const COMPACT_DIR_KEY = 'cuckoo-compact-project-dir';
const PENDING_INIT_KEY = 'cuckoo-compact-pending-init';
const IDB_WAIT_TIMEOUT = 20000;

function logStep(step: string, msg: string): void {
  console.log('[Cuckoo Compact] [' + step + '] ' + msg);
}

interface MessageItem {
  message_id: number;
  role: string;
  parent_id?: any;
}

/** 等待 AI 回复完成（拦截到完整回复） */
function waitForResponse(timeoutMs: number): Promise<{ text: string; meta: any }> {
  return new Promise((resolve, reject) => {
    let done = false;
    const off = onInterceptedResponse((text: string, meta: any) => {
      if (done) return;
      done = true;
      off();
      clearTimeout(timer);
      resolve({ text, meta: meta || {} });
    });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      off();
      reject(new Error('等待 AI 回复超时（' + timeoutMs + 'ms）'));
    }, timeoutMs);
  });
}

/** 从当前 URL 获取 chat_session_id */
function getSessionIdFromUrl(): string | null {
  const m = String(location.href).match(/\/chat\/s\/([a-f0-9-]+)/i);
  return m ? m[1] : null;
}

/** 从 localStorage 读取缓存的真实请求头 */
function getCachedHeaders(): any {
  try {
    const raw = localStorage.getItem('cuckoo-ds-headers');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/** 清掉当前会话在 IDB 的记录 */
function clearSessionFromIdb(sessionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let req: any;
    try { req = indexedDB.open('deepseek-chat'); } catch (e) { reject(e); return; }
    req.onerror = () => reject(new Error('打开 IndexedDB 失败'));
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction('history-message', 'readwrite');
        const st = tx.objectStore('history-message');
        const d = st.delete(sessionId);
        d.onsuccess = () => { db.close(); resolve(); };
        d.onerror = () => { db.close(); reject(new Error('删除 IDB 记录失败')); };
      } catch (e) { db.close(); reject(e); }
    };
  });
}

/** 等待 hook 派发的 IDB 写入完成事件 */
function waitForIdbWrite(timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const handler = () => {
      if (done) return;
      done = true;
      window.removeEventListener('cuckoo-idb-history-written', handler);
      clearTimeout(timer);
      resolve();
    };
    window.addEventListener('cuckoo-idb-history-written', handler);
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      window.removeEventListener('cuckoo-idb-history-written', handler);
      reject(new Error('等待 IDB 写入超时（' + timeoutMs + 'ms）'));
    }, timeoutMs);
  });
}

/**
 * 从 IndexedDB 读取指定会话的全量消息，按 message_id 升序。
 * 同时取出"当前叶子消息 id"（chat_session.current_message_id），
 * 用于沿 parent_id 回溯主对话链。
 */
function getMessagesFromIndexedDB(sessionId: string): Promise<{ list: MessageItem[]; currentMessageId: number | null }> {
  return new Promise((resolve, reject) => {
    let req: any;
    try { req = indexedDB.open('deepseek-chat'); } catch (e) { reject(e); return; }
    req.onerror = () => reject(new Error('打开 IndexedDB 失败'));
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction('history-message', 'readonly');
        const store = tx.objectStore('history-message');
        const g = store.get(sessionId);
        g.onsuccess = () => {
          db.close();
          const val = g.result;
          const data = val && val.data;
          const msgs = data && data.chat_messages;
          if (!Array.isArray(msgs)) { reject(new Error('IndexedDB 无该会话消息')); return; }
          const list = msgs
            .filter((m: any) => typeof m.message_id === 'number')
            .map((m: any) => ({ message_id: m.message_id, role: m.role || '', parent_id: m.parent_id }))
            .sort((a: any, b: any) => a.message_id - b.message_id);
          const rawLeaf = data && data.chat_session && data.chat_session.current_message_id;
          const currentMessageId = (typeof rawLeaf === 'number') ? rawLeaf : null;
          resolve({ list, currentMessageId });
        };
        g.onerror = () => { db.close(); reject(new Error('读取消息失败')); };
      } catch (e) { db.close(); reject(e); }
    };
  });
}

/**
 * 沿 parent_id 回溯出「主对话链」，取最近 ratio 比例，保证成对（USER + ASSISTANT），返回降序 id。
 *
 * 为什么不能直接按 message_id 排序取尾部：
 *   DeepSeek 的消息是**树**。重新生成/编辑会产生分支（一个 parent 有多个 child），
 *   message_id 全局递增 → 按 id 排序会把"被丢弃的分支"也混进来，角色序列不再是
 *   USER/ASSISTANT 交替 → share/create 报 MESSAGES_MUST_APPEAR_IN_PAIRS。
 *   必须从「当前叶子」沿 parent_id 回溯，得到真正的主线。
 *
 * @param msgs 全量消息（任意顺序，内部建 map）
 * @param leafId 当前叶子消息 id（chat_session.current_message_id），无则用最大 message_id
 * @param ratio 取最近比例
 */
function pickRecentPairedIds(msgs: MessageItem[], leafId: number | null, ratio: number): number[] {
  if (msgs.length === 0) return [];
  const byId = new Map<number, MessageItem>();
  for (const m of msgs) byId.set(m.message_id, m);

  // 1) 确定叶子：优先 current_message_id，否则用最大 message_id
  let leaf: number | null = (leafId != null && byId.has(leafId)) ? leafId : null;
  if (leaf == null) {
    let maxId: number | null = null;
    for (const m of msgs) if (maxId == null || m.message_id > maxId) maxId = m.message_id;
    leaf = maxId;
  }
  if (leaf == null) return [];

  // 2) 沿 parent_id 回溯主链（叶子 → 根），防环
  const chain: MessageItem[] = [];
  const seen = new Set<number>();
  let cur: number | null = leaf;
  while (cur != null && byId.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    const m: MessageItem = byId.get(cur) as MessageItem;
    chain.push(m);
    cur = (typeof m.parent_id === 'number') ? (m.parent_id as number) : null;
  }
  chain.reverse(); // 根 → 叶子

  // 3) 回溯失败（无 parent_id 数据）→ 回退到旧的"按 id 排序取尾部"
  let ordered: MessageItem[];
  if (chain.length <= 1 && msgs.length > 1) {
    ordered = msgs;
  } else {
    ordered = chain;
  }

  // 4) 取最近 ratio，保证成对
  const total = ordered.length;
  let keep = Math.max(2, Math.round(total * ratio));
  let start = Math.max(0, total - keep);
  while (start > 0 && ordered[start].role !== 'USER') start--;
  let end = total;
  while (end > start + 1 && ordered[end - 1].role !== 'ASSISTANT') end--;
  const picked = ordered.slice(start, end);
  return picked.map((m) => m.message_id).sort((a, b) => b - a);
}

/** 调 share/create 创建分享，返回 share_id */
async function createShare(sessionId: string, messageIds: number[], headers: any): Promise<string> {
  const h = Object.assign({}, headers);
  h['content-type'] = 'application/json';
  const resp = await fetch('/api/v0/share/create', {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ chat_session_id: sessionId, message_ids: messageIds }),
  });
  const txt = await resp.text();
  console.log('[Cuckoo Compact] [api] share/create HTTP ' + resp.status + ' 响应: ' + txt.slice(0, 600));
  let json: any = null;
  try { json = JSON.parse(txt); } catch (_) {}
  if (!json || json.code !== 0) {
    throw new Error('创建分享失败: ' + (json ? json.msg : txt.slice(0, 200)));
  }
  const shareId = json.data && json.data.biz_data && json.data.biz_data.share_id;
  if (!shareId) throw new Error('响应无 share_id（完整响应见日志）');
  return shareId;
}

/** 段1：当前页 —— 发摘要 → 清 IDB → 刷新 */
async function runCompaction(projectDir?: string): Promise<void> {
  const btn = document.getElementById('cuckoo-btn-compact') as any;
  if (btn) { btn.disabled = true; btn.textContent = '压缩中...'; }
  retryEngine.setCompacting(true);
  watchdog.setSuspended(true);

  try {
    const sessionId = getSessionIdFromUrl();
    if (!sessionId) throw new Error('无法从 URL 获取 chat_session_id');
    logStep('api', 'chat_session_id = ' + sessionId);

    logStep('summary', '发送摘要指令');
    const waitReply = waitForResponse(120000);
    sendToChat(SUMMARY_INSTRUCTION, '压缩-摘要', 300);
    const { text: summaryText } = await waitReply;
    logStep('summary', '收到摘要回复，长度=' + (summaryText || '').length);

    // 清当前会话 IDB 记录，触发刷新后 DeepSeek 重新拉取完整历史
    logStep('idb', '清除当前会话 IDB 记录');
    await clearSessionFromIdb(sessionId);

    // 存项目目录（跨页需要）
    try {
      if (projectDir) localStorage.setItem(COMPACT_DIR_KEY, projectDir);
      else localStorage.removeItem(COMPACT_DIR_KEY);
    } catch (_) {}

    // URL 加标记 → 刷新
    const url = new URL(location.href);
    url.searchParams.set(COMPACT_URL_FLAG, '1');
    logStep('reload', '刷新页面以让 DeepSeek 重建 IDB: ' + url.toString());
    showToast('压缩中，正在刷新页面...', 3000);
    location.href = url.toString();
  } catch (err: any) {
    console.error('[Cuckoo Compact] 压缩失败:', err);
    showToast('压缩失败: ' + err.message, 5000);
    retryEngine.setCompacting(false);
    watchdog.setSuspended(false);
    if (btn) { btn.disabled = false; btn.textContent = '压缩'; }
  }
}

/** 段2：刷新后同页 —— 检测 URL 标记，等 IDB 写入，创建分享并跳转 */
async function checkPendingCompact(): Promise<boolean> {
  let flag = '';
  try { flag = new URL(location.href).searchParams.get(COMPACT_URL_FLAG) || ''; } catch (_) {}
  if (!flag) return false;

  // 立即清掉 URL 参数，避免重复触发（URL 天然不持久，关页再开不会误触发）
  try {
    const url = new URL(location.href);
    url.searchParams.delete(COMPACT_URL_FLAG);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    logStep('reload', '已清除 URL 标记');
  } catch (_) {}

  let projectDir: string | null = null;
  try { projectDir = localStorage.getItem(COMPACT_DIR_KEY); } catch (_) {}

  try {
    const sessionId = getSessionIdFromUrl();
    if (!sessionId) throw new Error('无法从 URL 获取 chat_session_id');

    logStep('idb', '等待 DeepSeek 重建 IDB（监听写入事件）');
    await waitForIdbWrite(IDB_WAIT_TIMEOUT);
    logStep('idb', '收到 IDB 写入事件');

    const headers = getCachedHeaders();
    if (!headers || !headers['authorization']) {
      throw new Error('未获取到认证请求头（请刷新页面后重试）');
    }

    const { list: allMsgs, currentMessageId } = await getMessagesFromIndexedDB(sessionId);
    if (allMsgs.length === 0) throw new Error('未读取到消息列表');
    const tailIds = pickRecentPairedIds(allMsgs, currentMessageId, 0.2);
    if (tailIds.length === 0) throw new Error('裁剪后无有效消息');
    logStep('api', '全量消息 ' + allMsgs.length + ' 条（叶子=' + (currentMessageId || '?') + '），保留最近 ' + tailIds.length + ' 条（成对）');

    const shareId = await createShare(sessionId, tailIds, headers);
    const link = 'https://chat.deepseek.com/share/' + shareId;
    logStep('api', '分享链接: ' + link);

    showToast('压缩完成，正在打开新会话...', 3000);
    try {
      localStorage.setItem(PENDING_INIT_KEY, String(Date.now()));
      if (projectDir) localStorage.setItem(COMPACT_DIR_KEY, projectDir);
    } catch (_) {}
    location.href = link;
    return true;
  } catch (err: any) {
    console.error('[Cuckoo Compact] 段2失败:', err);
    showToast('压缩失败: ' + err.message, 5000);
    return false;
  }
}

/** 段3：分享页 —— 检测待初始化标记，自动初始化项目 */
function checkPendingInit(): void {
  let pending = null;
  let projectDir = null;
  try {
    pending = localStorage.getItem(PENDING_INIT_KEY);
    projectDir = localStorage.getItem(COMPACT_DIR_KEY);
  } catch (_) {}
  if (!pending) return;
  try {
    localStorage.removeItem(PENDING_INIT_KEY);
    localStorage.removeItem(COMPACT_DIR_KEY);
  } catch (_) {}
  console.log('[Cuckoo Compact] 检测到压缩后待初始化，3 秒后执行；项目目录=' + (projectDir || '(无)'));
  setTimeout(() => {
    try {
      (window as any).electronAPI.initProject(projectDir || null, true);
    } catch (err) {
      console.error('[Cuckoo Compact] 压缩后初始化失败:', err);
    }
  }, 3000);
}

export { runCompaction, checkPendingCompact, checkPendingInit };

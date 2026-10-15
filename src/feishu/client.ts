/**
 * 飞书同步：客户端（长连接 + 收发消息）
 *
 * 用飞书官方 SDK（@larksuiteoapi/node-sdk）：
 *  - WSClient：长连接接收事件（无需公网 IP）
 *  - Client：发消息
 *
 * 主进程内存态：连接实例 + 状态。配置变更时由外部调用 connect/disconnect。
 * 本模块依赖 electron?否——纯 Node。但 SDK 是 CJS，用 createRequire 加载。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readConfig, writeConfig } from './config.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lark = require('@larksuiteoapi/node-sdk');

/** 连接状态 */
type FeishuStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface FeishuCallbacks {
  /** 收到用户从飞书发来的文本消息（chatId 非空=群消息；空=单聊） */
  onUserMessage?: (text: string, chatId: string) => void;
  /** 收到用户从飞书发来的图片（已下载到本地临时文件） */
  onUserImage?: (filePath: string, chatId: string) => void;
  /** 状态变化（供 UI 刷新） */
  onStatusChange?: (status: FeishuStatus, detail?: string) => void;
}

/** 机器人所在的群 */
interface FeishuChat {
  chatId: string;
  name: string;
}

let wsClient: any = null;
let apiClient: any = null;
let currentStatus: FeishuStatus = 'disconnected';
let statusDetail = '';
let callbacks: FeishuCallbacks = {};

function setStatus(s: FeishuStatus, detail?: string): void {
  currentStatus = s;
  statusDetail = detail || '';
  try { callbacks.onStatusChange?.(s, statusDetail); } catch (_) {}
}

function getStatus(): { status: FeishuStatus; detail: string } {
  return { status: currentStatus, detail: statusDetail };
}

/** 从消息事件中取 chat_id（群消息）与 chat_type */
function extractChatId(event: any): string {
  try {
    const msg = event && event.message;
    if (!msg) return '';
    return typeof msg.chat_id === 'string' ? msg.chat_id : '';
  } catch (_) {
    return '';
  }
}

/** 查询机器人所在的群列表（分页取前 100） */
async function listChats(): Promise<{ success: boolean; chats?: FeishuChat[]; error?: string }> {
  const cfg = readConfig();
  if (!apiClient) {
    if (!cfg.appId || !cfg.appSecret) return { success: false, error: '未配置凭证' };
    apiClient = new lark.Client({ appId: cfg.appId, appSecret: cfg.appSecret });
  }
  try {
    const res = await apiClient.im.chat.list({ params: { page_size: 100 } });
    if (res && res.code !== 0 && res.code !== undefined) {
      return { success: false, error: res.msg || '查询群列表失败' };
    }
    const items = (res && res.data && res.data.items) || [];
    const chats = items.map((c: any) => ({ chatId: c.chat_id, name: c.name || '(未命名群)' }));
    return { success: true, chats };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/** 从事件中提取纯文本（只处理文本消息） */
function extractText(event: any): string {
  try {
    const msg = event && event.message;
    if (!msg) return '';
    if (msg.message_type !== 'text') return ''; // 只处理文本
    const content = JSON.parse(msg.content || '{}');
    return typeof content.text === 'string' ? content.text : '';
  } catch (_) {
    return '';
  }
}

/** 从图片消息事件中取 image_key 与 message_id；非图片消息返回空 */
function extractImageRef(event: any): { imageKey: string; messageId: string } {
  try {
    const msg = event && event.message;
    if (!msg) return { imageKey: '', messageId: '' };
    if (msg.message_type !== 'image') return { imageKey: '', messageId: '' };
    const content = JSON.parse(msg.content || '{}');
    const imageKey = typeof content.image_key === 'string' ? content.image_key : '';
    const messageId = typeof msg.message_id === 'string' ? msg.message_id : '';
    return { imageKey, messageId };
  } catch (_) {
    return { imageKey: '', messageId: '' };
  }
}

/**
 * 下载飞书消息里的图片到本地临时文件。
 * 用户发来的图片属于「消息资源」，用 im.v1.messageResource.get 下载
 * （im.v1.image.get 只能下载本机器人自己上传的图片）。
 * @param messageId 消息 id
 * @param imageKey message.content.image_key（即 file_key）
 * @returns 本地文件绝对路径；失败返回 null
 */
async function downloadImage(messageId: string, imageKey: string): Promise<string | null> {
  if (!messageId || !imageKey || !apiClient) return null;
  try {
    const res: any = await apiClient.im.v1.messageResource.get({
      params: { type: 'image' },
      path: { message_id: messageId, file_key: imageKey },
    });
    const dir = path.join(os.tmpdir(), 'cuckoo-feishu-images');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'feishu-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png');
    // SDK 返回对象带 writeFile；无则退回流收集
    if (res && typeof res.writeFile === 'function') {
      await res.writeFile(file);
    } else if (res && typeof res.getReadableStream === 'function') {
      const buf = await streamToBuffer(res.getReadableStream());
      fs.writeFileSync(file, buf);
    } else {
      console.error('[Feishu] 下载图片返回格式未知:', typeof res);
      return null;
    }
    return file;
  } catch (err: any) {
    console.error('[Feishu] 下载图片失败:', err && err.message);
    return null;
  }
}

/** 把可读流收集为 Buffer */
function streamToBuffer(stream: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', (e: any) => reject(e));
  });
}

/** 启动长连接（幂等：先断开旧的） */
function connect(cb?: FeishuCallbacks): { success: boolean; error?: string } {
  if (cb) callbacks = cb;
  const cfg = readConfig();
  if (!cfg.appId || !cfg.appSecret) {
    setStatus('error', '缺少 App ID / App Secret');
    return { success: false, error: '缺少 App ID / App Secret' };
  }
  // 先断开旧的
  disconnect(true);
  setStatus('connecting');

  try {
    apiClient = new lark.Client({ appId: cfg.appId, appSecret: cfg.appSecret });

    const dispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: any) => {
        console.log('[Feishu] ★ 收到 im.message.receive_v1 事件');
        try {
          // 记录推送目标（用户首次发消息时）
          const sender = data && data.sender;
          const openId = sender && sender.sender_id && sender.sender_id.open_id;
          if (openId) {
            const cur = readConfig();
            if (cur.targetOpenId !== openId) {
              writeConfig({ targetOpenId: openId });
              console.log('[Feishu] 已记录推送目标 open_id:', openId);
            }
          }
          const chatId = extractChatId(data);

          // 图片消息：下载到本地临时文件后回调
          const imageRef = extractImageRef(data);
          if (imageRef.imageKey) {
            console.log('[Feishu] 收到图片消息, image_key=' + imageRef.imageKey + (chatId ? ' 群=' + chatId : ' 单聊'));
            downloadImage(imageRef.messageId, imageRef.imageKey).then((filePath) => {
              if (filePath) {
                console.log('[Feishu] 图片已下载:', filePath);
                try { callbacks.onUserImage?.(filePath, chatId); } catch (_) {}
              } else {
                console.warn('[Feishu] 图片下载失败，丢弃');
              }
            }).catch((e: any) => console.error('[Feishu] 图片处理失败:', e && e.message));
            return;
          }

          const text = extractText(data);
          if (text) {
            console.log('[Feishu] 收到消息, 长度=' + text.length + (chatId ? ' 群=' + chatId : ' 单聊'));
            try { callbacks.onUserMessage?.(text, chatId); } catch (_) {}
          }
        } catch (err: any) {
          console.error('[Feishu] 处理消息失败:', err.message);
        }
      },
    });

    wsClient = new lark.WSClient({
      appId: cfg.appId,
      appSecret: cfg.appSecret,
      loggerLevel: lark.LoggerLevel.info,
      onReady: () => { console.log('[Feishu] 长连接就绪(onReady)'); setStatus('connected'); },
      onError: (err: any) => setStatus('error', (err && err.message) || String(err)),
      onReconnecting: () => setStatus('connecting', '重连中…'),
      onReconnected: () => setStatus('connected'),
    });
    wsClient.start({ eventDispatcher: dispatcher });
    return { success: true };
  } catch (err: any) {
    setStatus('error', err.message);
    return { success: false, error: err.message };
  }
}

/** 断开连接。@param silent 不更新状态（供内部切换用） */
function disconnect(silent?: boolean): void {
  try {
    if (wsClient) wsClient.close({});
  } catch (_) {}
  wsClient = null;
  apiClient = null;
  if (!silent) setStatus('disconnected');
}

/**
 * 发送文本消息。
 * @param text 文本
 * @param chatId 群 chat_id；**为空则回退单聊**（发给已记录的 targetOpenId）
 */
async function sendText(text: string, chatId?: string): Promise<{ success: boolean; error?: string }> {
  const cfg = readConfig();
  if (!apiClient) {
    // 没连接时惰性建一个（仅发消息）
    if (!cfg.appId || !cfg.appSecret) return { success: false, error: '未配置' };
    apiClient = new lark.Client({ appId: cfg.appId, appSecret: cfg.appSecret });
  }
  // 群模式：优先发到 chatId
  if (chatId) {
    try {
      const res = await apiClient.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) },
      });
      if (res && (res.code === 0 || res.code === undefined)) return { success: true };
      return { success: false, error: (res && res.msg) || '发送失败' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
  // 单聊回退：发给已记录的 targetOpenId
  if (!cfg.targetOpenId) {
    return { success: false, error: '该窗口尚未绑定飞书群（请先在飞书页绑定群）' };
  }
  try {
    const res = await apiClient.im.message.create({
      params: { receive_id_type: 'open_id' },
      data: {
        receive_id: cfg.targetOpenId,
        msg_type: 'text',
        content: JSON.stringify({ text: text }),
      },
    });
    if (res && (res.code === 0 || res.code === undefined)) return { success: true };
    return { success: false, error: (res && res.msg) || '发送失败' };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * 把 markdown 拆成飞书卡片 2.0 的 elements：
 *  - 普通文本 → { tag: 'markdown', content }
 *  - 表格（连续 | 行）→ { tag: 'table', columns, rows }
 * 飞书 markdown 元素不支持表格，故表格用 table 组件（卡片 2.0）。
 */
function buildCardElements(md: string): any[] {
  const lines = String(md || '').split('\n');
  const els: any[] = [];
  let textBuf: string[] = [];
  const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const parseRow = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const flushText = () => {
    const t = textBuf.join('\n');
    if (t.trim()) els.push({ tag: 'markdown', content: t });
    textBuf = [];
  };
  let i = 0;
  while (i < lines.length) {
    if (isTableRow(lines[i])) {
      flushText();
      const rows: string[] = [];
      while (i < lines.length && isTableRow(lines[i])) { rows.push(lines[i]); i++; }
      const header = parseRow(rows[0]);
      const sep = rows.length > 1 && /^[\s|:\-]+$/.test(rows[1]);
      const dataStart = sep ? 2 : 1;
      // 列宽：均分（百分比），避免 auto 太窄截断；单元格用 lark_md 支持 markdown
      const colPct = Math.floor(100 / header.length);
      const columns = header.map((h, idx) => ({
        name: 'col_' + idx,
        display_name: h || ('列' + (idx + 1)),
        data_type: 'lark_md',
        width: colPct + '%',
      }));
      const dataRows = [];
      for (let j = dataStart; j < rows.length; j++) {
        const cells = parseRow(rows[j]);
        const rowObj: any = {};
        header.forEach((_h, idx) => { rowObj['col_' + idx] = cells[idx] !== undefined ? cells[idx] : ''; });
        dataRows.push(rowObj);
      }
      els.push({
        tag: 'table',
        page_size: Math.max(dataRows.length, 1),
        row_height: 'low',
        header_style: { text_align: 'left', text_size: 'normal', background_style: 'grey', bold: true, lines: 1 },
        columns,
        rows: dataRows,
      });
    } else {
      textBuf.push(lines[i]);
      i++;
    }
  }
  flushText();
  if (els.length === 0) els.push({ tag: 'markdown', content: '' });
  return els;
}

/**
 * 发送 Markdown 消息（用飞书交互卡片渲染）。
 *
 * 飞书纯文本消息（msg_type: 'text'）不渲染 Markdown；
 * 交互卡片（msg_type: 'interactive'）的 markdown 元素支持常见语法
 * （粗体、斜体、列表、代码块、链接、分割线等）。
 *
 * @param md Markdown 文本
 * @param chatId 群 chat_id；为空则回退单聊
 */
async function sendMarkdown(md: string, chatId?: string): Promise<{ success: boolean; error?: string }> {
  const cfg = readConfig();
  if (!apiClient) {
    if (!cfg.appId || !cfg.appSecret) return { success: false, error: '未配置' };
    apiClient = new lark.Client({ appId: cfg.appId, appSecret: cfg.appSecret });
  }
  const fullText = String(md || '');
  // 飞书卡片内容上限，过长时分片（按原始文本切，每片 ~4000 字符）
  const MAX = 4000;
  const chunks: string[] = [];
  if (fullText.length <= MAX) {
    chunks.push(fullText);
  } else {
    for (let i = 0; i < fullText.length; i += MAX) chunks.push(fullText.slice(i, i + MAX));
  }

  const sendOne = async (chunk: string, receiveIdType: 'chat_id' | 'open_id', receiveId: string): Promise<{ success: boolean; error?: string }> => {
    // 卡片 2.0：文本 → markdown 元素；表格 → table 组件（能对齐）
    const card: any = {
      schema: '2.0',
      config: { wide_screen_mode: true },
      body: { elements: buildCardElements(chunk) },
    };
    try {
      const res = await apiClient.im.message.create({
        params: { receive_id_type: receiveIdType },
        data: {
          receive_id: receiveId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      });
      if (res && (res.code === 0 || res.code === undefined)) return { success: true };
      return { success: false, error: (res && res.msg) || '发送失败' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  // 群模式
  if (chatId) {
    for (const chunk of chunks) {
      const r = await sendOne(chunk, 'chat_id', chatId);
      if (!r.success) return r;
    }
    return { success: true };
  }
  // 单聊回退
  if (!cfg.targetOpenId) {
    return { success: false, error: '该窗口尚未绑定飞书群（请先在飞书页绑定群）' };
  }
  for (const chunk of chunks) {
    const r = await sendOne(chunk, 'open_id', cfg.targetOpenId);
    if (!r.success) return r;
  }
  return { success: true };
}

export { connect, disconnect, sendText, sendMarkdown, getStatus, readConfig, listChats };
export type { FeishuStatus, FeishuChat };

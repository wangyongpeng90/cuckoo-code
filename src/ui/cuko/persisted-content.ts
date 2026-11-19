/**
 * [261109-8ms69z-cuko-api] Cuko 用户消息的落库格式（附件持久化）
 * 此文件属于 Cuko API 独立工作窗口需求，详细设计见：
 * docs/requirements/261109-8ms69z-cuko-api.md
 *
 * 为什么附件不放进 content：
 * assistant-ui 的用户消息附件只认 `message.attachments`（见 core 的
 * `fromThreadMessageLike`），而 content 里的 `file` part 会被 `UserFilePart`
 * 当成 data URL 渲染成坏图。所以 content 只放文本，附件单独存元数据。
 *
 * 落库形态：
 * - 无附件：纯文本（兼容历史消息）
 * - 有附件：`{ v:1, text, attachments:[{ filename, mimeType, path }] }`
 *   path 是相对 `<userData>/cuko-attachments` 的路径
 */

/** 一条落库的附件元数据 */
export interface StoredAttachment {
  filename: string;
  mimeType: string;
  path: string;
}

/** 转换后的 assistant-ui 附件（CompleteAttachment 的结构子集） */
export interface UserAttachment {
  id: string;
  type: 'image' | 'document';
  name: string;
  contentType: string;
  content: Array<{ type: 'file'; filename: string; mimeType: string; data: string }>;
  status: { type: 'complete' };
}

export interface ParsedStoredContent {
  content: any;
  attachments?: UserAttachment[];
}

const URL_LIKE = /^(?:data|blob):/i;
const PROTOCOL_LIKE = /^(?:https?:)?\/\//i;

/** Cuko 附件存的是相对路径；data:/blob:/http(s) 都不是本地路径 */
export const isDiskAttachPath = (data: unknown): data is string =>
  typeof data === 'string' && data.length > 0 && !URL_LIKE.test(data) && !PROTOCOL_LIKE.test(data);

/** 把一条附件元数据转成 assistant-ui 的 CompleteAttachment */
export function toUserAttachment(
  msgId: string,
  index: number,
  part: { filename?: string; mimeType?: string; data: string },
): UserAttachment {
  const mimeType = part.mimeType || 'application/octet-stream';
  const filename = part.filename || 'attachment-' + (index + 1);
  return {
    id: msgId + '-att-' + index,
    // 图片必须看 mimeType：file part 会被 assistant-ui 映射成 type: "document"
    type: mimeType.toLowerCase().startsWith('image/') ? 'image' : 'document',
    name: filename,
    contentType: mimeType,
    content: [{ type: 'file', filename, mimeType, data: part.data }],
    status: { type: 'complete' },
  };
}

/** 发送时：有附件才写 JSON，无附件保持纯文本 */
export function serializeUserMessage(text: string, attachments: UserAttachment[]): string {
  if (attachments.length === 0) return text;
  return JSON.stringify({
    v: 1,
    text,
    attachments: attachments.map((a) => ({
      filename: a.name,
      mimeType: a.contentType || '',
      path: a.content[0]?.data || '',
    })),
  });
}

/** 每个元素都是带字符串 type 的对象才算「消息 part 数组」 */
const isMessageParts = (value: unknown[]): boolean =>
  value.length > 0 &&
  value.every((p) => !!p && typeof p === 'object' && typeof (p as { type?: unknown }).type === 'string');

/**
 * 读取时：把 `cuko_messages.content` 还原成 content + attachments。
 * - 工具卡片 / 旧版数组：原样当 content
 * - 有附件的用户消息：拆出 attachments，content 只留文本
 * - 普通文本（哪怕长得像 JSON）：原样返回
 */
export function parseStoredContent(raw: unknown, msgId: string): ParsedStoredContent {
  if (typeof raw !== 'string') return { content: raw };
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return { content: raw };

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { content: raw };
  }

  if (Array.isArray(parsed)) {
    if (!isMessageParts(parsed)) return { content: raw };
    // 兼容早期把 file part 直接塞进 content 的中间格式
    const stored = parsed.filter((p: any) => p && p.type === 'file' && isDiskAttachPath(p.data));
    if (stored.length === 0) return { content: parsed };
    return {
      content: parsed.filter((p: any) => p && p.type !== 'file'),
      attachments: stored.map((p: any, i: number) => toUserAttachment(msgId, i, p)),
    };
  }

  if (parsed && parsed.v === 1 && Array.isArray(parsed.attachments)) {
    const metas = parsed.attachments.filter((a: any) => a && isDiskAttachPath(a.path));
    if (metas.length > 0) {
      return {
        content: typeof parsed.text === 'string' && parsed.text.trim() ? parsed.text : [],
        attachments: metas.map((a: any, i: number) =>
          toUserAttachment(msgId, i, { filename: a.filename, mimeType: a.mimeType, data: a.path }),
        ),
      };
    }
  }

  return { content: raw };
}

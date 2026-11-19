/**
 * [261109-8ms69z-cuko-api] 切换模型时的历史压缩：把会话消息拼成 Provider 的 input 数组
 * 此文件属于 Cuko API 独立工作窗口需求，详细设计见：
 * docs/requirements/261109-8ms69z-cuko-api.md
 *
 * 规则（按用户需求）：
 * - 每个消息一个数组元素（type: "text"）
 * - AI 的思考内容（think）不发送
 * - 工具调用：如果代码里没有 edit / deleteFile，就不发送真实执行结果，
 *   统一写成「(该工具调用不涉及edit或delete,如需调用结果请重新调用)」，
 *   避免把可能过期的执行结果喂给新模型；涉及写操作的结果必须保留，
 *   否则新模型不知道文件已经改成什么样了。
 */

export interface CompressHistoryMessage {
  role: string;
  content: any;
  attachments?: Array<{ name?: string }>;
}

export interface CompressInputPart {
  type: 'text';
  text: string;
}

/** 工具调用是否涉及写操作（edit / deleteFile）：工具名或代码里出现都算 */
export function toolTouchesEditOrDelete(part: any): boolean {
  const name = String(part?.toolName || '');
  const code = String(part?.argsText || '');
  if (/(^|[\s+])edit($|[\s+(])/i.test(name)) return true;
  if (/(^|[\s+])(delete|deleteFile)($|[\s+(])/i.test(name)) return true;
  if (/await\s+(edit|delete|deleteFile)\s*\(/.test(code)) return true;
  return false;
}

const NOT_TOUCHED_RESULT = '(该工具调用不涉及edit或delete,如需调用结果请重新调用)';

function formatToolPart(part: any): string {
  const code = String(part?.argsText || '').trim();
  const rawResult = typeof part?.result === 'string' ? part.result : '';
  const touched = toolTouchesEditOrDelete(part);
  let resultText: string;
  if (!touched) {
    resultText = NOT_TOUCHED_RESULT;
  } else if (part?.isError) {
    resultText = '错误: ' + (rawResult || '未知错误');
  } else {
    resultText = rawResult || '(无输出)';
  }
  return [
    '[工具调用] ' + (part?.toolName || 'cuckoo'),
    '```cuckoo',
    code,
    '```',
    '工具结果: ' + resultText,
  ].join('\n');
}

/** 把单条消息压成一段纯文本（think 不参与） */
export function messageToCompressText(message: CompressHistoryMessage): string {
  const chunks: string[] = [];
  const content = message?.content;
  if (typeof content === 'string') {
    if (content.trim()) chunks.push(content.trim());
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part) continue;
      if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        chunks.push(part.text.trim());
      } else if (part.type === 'tool-call') {
        chunks.push(formatToolPart(part));
      }
    }
  }
  const files = (message?.attachments || [])
    .map((a) => (a && a.name ? String(a.name) : ''))
    .filter(Boolean);
  if (files.length > 0) chunks.push('附件: ' + files.join(', '));
  return chunks.join('\n\n').trim();
}

/** 会话消息 → input 数组（每条消息一个元素，角色加前缀） */
export function buildCompressHistory(messages: CompressHistoryMessage[]): CompressInputPart[] {
  const out: CompressInputPart[] = [];
  for (const message of messages || []) {
    if (!message) continue;
    // 系统提示词单独由主进程补发，这里跳过，避免重复
    if (message.role === 'system') continue;
    const text = messageToCompressText(message);
    if (!text) continue;
    const role = message.role === 'user' ? '用户' : '助手';
    out.push({ type: 'text', text: role + ':\n' + text });
  }
  return out;
}

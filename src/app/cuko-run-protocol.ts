/**
 * [261109-8ms69z-cuko-api] Cuko 运行协议（纯函数，主进程与测试共用）
 * 此文件属于 Cuko API 独立工作窗口需求，详细设计见：
 * docs/requirements/261109-8ms69z-cuko-api.md
 *
 * 抽出来的原因：运行循环放主进程后，SSE 解析 / 代码块提取 / 提示词分段
 * 都需要脱离 React 与 Electron 单独测试。
 */

/** 从 AI 回复中提取 ```cuckoo 代码块 */
export function extractCuckooBlocks(text: string): string[] {
  const blocks: string[] = [];
  if (!text) return blocks;
  const lines = text.split('\n');
  let inBlock = false;
  let lang = '';
  let buf: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('```')) {
      if (!inBlock) {
        inBlock = true;
        lang = t.slice(3).trim().toLowerCase();
        buf = [];
      } else {
        inBlock = false;
        const code = buf.join('\n').trim();
        if (code && lang === 'cuckoo') blocks.push(code);
        buf = [];
        lang = '';
      }
      continue;
    }
    if (inBlock) buf.push(line);
  }
  return blocks;
}

/** 从代码块里提取所有被调用的工具名（去重） */
export function extractToolNames(code: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const re = /await\s+([a-zA-Z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const name = m[1];
    if (!seen.has(name)) { seen.add(name); names.push(name); }
  }
  return names;
}

const ERROR_MESSAGES: Record<string, string> = {
  authentication_required: '需要登录，请先在浏览器中打开并登录对应 AI 服务。',
  provider_unavailable: 'Provider 不可用，请检查服务端和浏览器扩展是否正常运行。',
  rate_limit_exceeded: '请求过于频繁，请稍后再试。',
  invalid_request: '请求参数不合法。',
  request_timeout: '请求超时，请重试。',
  internal_error: 'Provider 内部错误，请稍后重试。',
};

/** 把 Provider 的错误码翻成人话（未知码保留原文） */
export function friendlyError(code: string, message: string): string {
  const friendly = ERROR_MESSAGES[code];
  return friendly ? friendly + (message ? '（' + message + '）' : '') : (message || code);
}

/** 按 Markdown 一级标题（行首 "# "）把完整提示词切分成段 */
export function splitPromptByH1(prompt: string): string[] {
  if (!prompt) return [];
  const lines = prompt.split('\n');
  const segments: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^# /.test(line)) {
      const text = current.join('\n').trim();
      if (text) segments.push(text);
      current = [line];
    } else {
      current.push(line);
    }
  }
  const tail = current.join('\n').trim();
  if (tail) segments.push(tail);
  return segments;
}

export interface SseDecoder {
  /** 喂一段文本，凑满 `\n\n` 就回调一条事件 */
  push(chunk: string): void;
}

/**
 * 解析 Provider 的 SSE 流。
 * 只处理 `event:` / `data:` 两种行，空行分隔事件；同一事件的多个 data 行用换行拼接。
 */
export function createSseDecoder(onEvent: (eventName: string, data: string) => void): SseDecoder {
  let buffer = '';
  return {
    push(chunk: string) {
      if (!chunk) return;
      buffer += chunk.replace(/\r\n/g, '\n');
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let eventName = 'message';
        const dataLines: string[] = [];
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
        }
        if (dataLines.length) onEvent(eventName, dataLines.join('\n'));
      }
    },
  };
}

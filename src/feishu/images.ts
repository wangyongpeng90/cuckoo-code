/**
 * 飞书图片：纯函数助手（无 SDK 依赖，便于单测）
 *
 * 职责：
 *  - 从 AI 回复文本中提取本地图片文件路径（自动回传用）
 *  - 从飞书事件中提取 image_key（收图用）
 *  - 把 SDK 资源响应（流/Buffer）落盘，并按魔数嗅探扩展名
 */
import fs from 'node:fs';
import path from 'node:path';

/** 飞书图片消息支持的扩展名（官网：jpg/jpeg/png/bmp/gif/webp，≤10MB） */
export const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp'];

/** 飞书图片大小上限（10MB） */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** 是否是受支持的图片路径（只看扩展名） */
export function isImagePath(p: string): boolean {
  return IMG_EXTS.includes(path.extname(String(p || '')).toLowerCase());
}

/**
 * 从文本中提取"磁盘上真实存在"的图片文件路径（去重、保序）。
 * 两轮扫描：
 *  1) 引号包裹的路径（可含空格："C:\out\a b.png"、'…'、"…"）
 *  2) 裸路径（不含空白：C:\a.png、/x/y/a.png、~/a.png）
 */
export function findImagePaths(text: string): string[] {
  const t = String(text || '');
  if (!t) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  const tryPush = (raw: string): void => {
    const p = raw.trim();
    if (!p || p.length < 5) return;
    if (!isImagePath(p)) return;
    const key = p.toLowerCase(); // Windows 大小写不敏感去重
    if (seen.has(key)) return;
    try {
      const st = fs.statSync(p);
      if (!st.isFile() || st.size === 0 || st.size > MAX_IMAGE_BYTES) return;
    } catch (_) {
      return;
    }
    seen.add(key);
    found.push(p);
  };
  // 1) 引号包裹
  const quoted = t.match(/["'“”‘’]([^"'“”‘’]{5,600}?)["'“”‘’]/g) || [];
  for (const q of quoted) tryPush(q.slice(1, -1));
  // 2) 裸路径（排除已被引号命中的）
  const bare = t.match(/(?:[A-Za-z]:[\\/][^\s"'“”‘’<>|*?]+\.(?:jpg|jpeg|png|bmp|gif|webp))|(?:[~\/][^\s"'“”‘’<>|*?]+\.(?:jpg|jpeg|png|bmp|gif|webp))/gi) || [];
  for (const b of bare) tryPush(b);
  return found;
}

/** 从飞书消息事件中提取 image_key（仅 image 类型消息） */
export function extractImageKey(event: any): string {
  try {
    const msg = event && event.message;
    if (!msg || msg.message_type !== 'image') return '';
    const content = JSON.parse(msg.content || '{}');
    return typeof content.image_key === 'string' ? content.image_key : '';
  } catch (_) {
    return '';
  }
}

/** 按文件头魔数嗅探图片扩展名（未知回退 .png） */
export function sniffImageExt(head: Buffer): string {
  if (!head || head.length < 4) return '.png';
  if (head[0] === 0x89 && head[1] === 0x50) return '.png';               // \x89PNG
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return '.jpg';
  if (head.slice(0, 3).toString('ascii') === 'GIF') return '.gif';
  if (head[0] === 0x42 && head[1] === 0x4d) return '.bmp';               // 'BM'
  if (head.length >= 12 && head.slice(0, 4).toString('ascii') === 'RIFF'
    && head.slice(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return '.png';
}

/**
 * 把 SDK 资源响应落盘。
 * 兼容三种返回形态：Node 可读流（有 pipe）、Web ReadableStream（有 getReader）、Buffer/ArrayBuffer。
 * 先整体缓冲（图片 ≤10MB）→ 嗅探扩展名 → 写入 destBase + 正确扩展名。
 *
 * @param resource lark SDK 响应（数据在 .data）
 * @param destBase 目标基础路径（不含扩展名，如 …/inbox/img_20261015_120000_ab12）
 * @returns { success, path?, size?, error? }
 */
export async function saveResourceToFile(resource: any, destBase: string): Promise<{ success: boolean; path?: string; size?: number; error?: string }> {
  try {
    const data = resource && resource.data !== undefined ? resource.data : resource;
    let buf: Buffer | null = null;
    if (data && typeof data.pipe === 'function') {
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        data.on('data', (c: Buffer) => chunks.push(c));
        data.on('end', () => resolve());
        data.on('error', (e: Error) => reject(e));
      });
      buf = Buffer.concat(chunks);
    } else if (data && typeof data.getReader === 'function') {
      const reader = data.getReader();
      const chunks: Buffer[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }
      buf = Buffer.concat(chunks);
    } else if (Buffer.isBuffer(data)) {
      buf = data;
    } else if (data instanceof ArrayBuffer) {
      buf = Buffer.from(data);
    }
    if (!buf || buf.length === 0) return { success: false, error: '下载内容为空' };
    const ext = sniffImageExt(buf.subarray(0, 16));
    const dest = destBase + ext;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    return { success: true, path: dest, size: buf.length };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

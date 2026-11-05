/**
 * [261105-geaofb] 剪贴板借用（B 方案）：写入提示词 → 触发真实粘贴 → 立即恢复原内容。
 *
 * 为什么单独成模块：这段逻辑的失败路径最容易写错（用户在这几十毫秒内自己复制、
 * paste 抛错、原剪贴板为空），而 `renderer.ts` 依赖 electron，Node 环境下无法加载。
 * 这里把 clipboard 与 paste 作为参数注入（外部边界替身），纯逻辑即可单测。
 *
 * 不变式：
 *   1) paste() 是同步派发，Chromium 当即把剪贴板数据快照进渲染进程 —— 恢复可以紧随其后
 *   2) 恢复前比对内容：若已不等于我们写入的提示词，说明用户抢着复制了新东西，**不覆盖**
 *   3) 无论成功失败，只要写过剪贴板就必须尝试恢复（finally 兜底）
 */

export interface ClipboardLike {
  readText(): string;
  writeText(text: string): void;
  readHTML?(): string;
  readRTF?(): string;
  readImage?(): any;
  readBookmark?(): any;
  write(item: any): void;
  clear(): void;
}

export interface ClipboardSnapshot {
  text: string;
  html: string;
  rtf: string;
  image: any;
  bookmark: any;
}

export interface PasteOptions {
  /** paste() 后到恢复之间的让出时间（ms），默认 16（一个事件循环帧） */
  restoreDelayMs?: number;
  /** 注入 sleep 便于测试；默认 setTimeout */
  sleep?: (ms: number) => Promise<void>;
  /** 日志出口；默认 console */
  log?: { info(msg: string): void; error(msg: string): void };
}

export interface PasteResult {
  success: boolean;
  error?: string;
}

/** 读取剪贴板全格式快照（text/html/rtf/image/bookmark） */
export function readSnapshot(clipboard: ClipboardLike): ClipboardSnapshot {
  return {
    text: clipboard.readText(),
    html: clipboard.readHTML ? clipboard.readHTML() : '',
    rtf: clipboard.readRTF ? clipboard.readRTF() : '',
    image: clipboard.readImage ? clipboard.readImage() : null,
    bookmark: clipboard.readBookmark ? clipboard.readBookmark() : null,
  };
}

/** 把快照写回剪贴板；全空则 clear() */
export function restoreSnapshot(clipboard: ClipboardLike, snapshot: ClipboardSnapshot): void {
  const item: any = {};
  if (snapshot.text) item.text = snapshot.text;
  if (snapshot.html) item.html = snapshot.html;
  if (snapshot.rtf) item.rtf = snapshot.rtf;
  if (snapshot.image && typeof snapshot.image.isEmpty === 'function' && !snapshot.image.isEmpty()) {
    item.image = snapshot.image;
  }
  if (snapshot.bookmark && (snapshot.bookmark.url || snapshot.bookmark.title)) {
    item.bookmark = snapshot.bookmark.url || snapshot.bookmark.title;
  }
  if (Object.keys(item).length) clipboard.write(item);
  else clipboard.clear();
}

/**
 * 借用剪贴板做一次真实粘贴。
 * @param clipboard - electron clipboard 或其替身
 * @param paste - 触发粘贴的同步动作（主进程侧是 `webContents.paste()`）
 * @param text - 要粘贴的提示词
 */
export async function pasteText(
  clipboard: ClipboardLike,
  paste: () => void,
  text: string,
  options: PasteOptions = {}
): Promise<PasteResult> {
  const restoreDelayMs = options.restoreDelayMs ?? 16;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = options.log ?? {
    info: (msg: string) => console.log(msg),
    error: (msg: string) => console.error(msg),
  };

  const backup = readSnapshot(clipboard);
  // 占用计时起点：从写剪贴板算到恢复完成（真机验收要求 ≤ 30ms）
  const startedAt = Date.now();
  let wrote = false;
  try {
    clipboard.writeText(text);
    wrote = true;
    paste();
    // 让出事件循环，给 Chromium 投递粘贴事件留时间；随后立即恢复
    await sleep(restoreDelayMs);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: (err && err.message) || String(err) };
  } finally {
    if (wrote) {
      try {
        if (clipboard.readText() === text) {
          restoreSnapshot(clipboard, backup);
          log.info('[Cuckoo Code] 剪贴板借用占用 ' + (Date.now() - startedAt) + 'ms（已恢复原内容）');
        } else {
          log.info('[Cuckoo Code] 剪贴板已被用户更新，跳过恢复');
        }
      } catch (err: any) {
        log.error('[Cuckoo Code] 恢复剪贴板失败: ' + ((err && err.message) || err));
      }
    } else {
      log.info('[Cuckoo Code] 剪贴板未写入，占用 0ms');
    }
  }
}

/**
 * 剪贴板借用的全局串行锁：clipboard 是进程级全局资源，
 * 多窗口并发粘贴会交错备份/恢复，必须串行。
 */
export function createClipboardLock(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  return function runLocked<T>(fn: () => Promise<T>): Promise<T> {
    const prev = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    return prev.then(async () => {
      try {
        return await fn();
      } finally {
        release();
      }
    });
  };
}

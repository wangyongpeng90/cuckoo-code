/**
 * 附件上传公共通道（app/ipc 内共享）
 *
 * 从 harness 抽出，供「纯净模式 harness-attach」与「飞书图片转发」共用。
 * 两级策略：
 *   1. cdpAttach —— CDP 真实鼠标事件 + 拦截原生文件选择框（合成事件免疫站点首选，最稳）
 *   2. attachFn  —— 合成事件兜底；对图片关键：dispatch 成功即视为提交成功
 *                   （图片缩略图不含文件名，纯文本检测会误判失败）
 *
 * 依赖：仅 cdp-attach.js（provider 探测）。不依赖 window.js，ctx 由调用方传入。
 */
import { cdpAttach } from './cdp-attach.js';

/** 上传请求：文件名 / base64 / MIME */
export interface UploadFile { name: string; data: string; mime: string; }

/** 上传结果 */
export interface UploadResult { success: boolean; mode?: string; error?: string; }

/**
 * 注入到 AI 页面执行的合成事件上传函数（比官方 attachFile 更健壮）。
 * 先找 input[type=file]，找不到则尝试点击上传按钮再等（很多站点输入框是懒创建的）。
 * 用函数 toString 注入，避免多行字符串转义问题。
 *
 * 注意：本函数体在页面主世界执行，必须自包含，不得引用外部变量。
 */
function attachFn(doc: any, win: any, b64: any, fileName: any, mimeType: any, timeoutMs: any, waitMs: any) {
  return (async function () {
    try {
      var bin = win.atob(b64);
      var bytes = new win.Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var file = new win.File([bytes], fileName, { type: mimeType });
      function findInput() { return doc.querySelector('input[type=file]'); }
      var input = findInput();
      if (!input) {
        var keys = ['attach', 'upload', 'paperclip', 'file', 'image', '图片', '文件', '上传', '添加'];
        var cands = doc.querySelectorAll('button, [role=button], [class*=attach], [class*=upload], [class*=file], [class*=plus], [class*=add]');
        for (var ci = 0; ci < cands.length; ci++) {
          var b = cands[ci];
          if (!b || b.offsetWidth === 0) continue;
          var sig = String(b.className || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '');
          var low = sig.toLowerCase();
          for (var ki = 0; ki < keys.length; ki++) {
            if (low.indexOf(keys[ki].toLowerCase()) !== -1) { b.click(); break; }
          }
          input = findInput();
          if (input) break;
        }
        if (!input) {
          var dl = win.Date.now() + 2500;
          while (win.Date.now() < dl && !input) { await new Promise(function (r) { win.setTimeout(r, 120); }); input = findInput(); }
        }
      }
      if (!input) return { success: false, error: '未找到文件上传输入框（已尝试点击上传按钮）' };
      var dt = new win.DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      // dispatch 后立即判断：文件已写入 input 即视为提交成功（图片缩略图不含文件名，不能只靠文本检测）
      var submitted = false;
      try { input.dispatchEvent(new win.Event('change', { bubbles: true })); submitted = true; } catch (e) { /* ignore */ }
      var hasFiles = false;
      try { hasFiles = !!(input.files && input.files.length > 0); } catch (e) { /* ignore */ }
      // 站点可能在 change 后清空 input.files，但文件其实已被接收；派发成功即视为提交成功
      if (submitted) return { success: true, fileName: fileName };
      function fileVisible() {
        var node = input;
        for (var d = 0; d < 12 && node; d++) {
          if (node.innerText && node.innerText.indexOf(fileName) !== -1) return true;
          node = node.parentElement;
        }
        var bt = doc.body ? doc.body.innerText : '';
        return bt.indexOf(fileName) !== -1;
      }
      if (submitted && hasFiles) return { success: true, fileName: fileName };
      // 退化检测：等待附件 chip 出现
      await new Promise(function (r) { win.setTimeout(r, waitMs); });
      if (fileVisible()) return { success: true, fileName: fileName };
      var deadline = win.Date.now() + timeoutMs;
      while (win.Date.now() < deadline) {
        await new Promise(function (r) { win.setTimeout(r, 300); });
        if (fileVisible()) return { success: true, fileName: fileName };
      }
      return { success: false, error: '上传超时，未检测到附件出现' };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  })();
}

/** 上传通道的窗口上下文最小接口（与 cdpAttach 的 AttachCtx 兼容） */
export interface UploadCtx { providerId?: string; view: { webContents: any }; }

/**
 * 上传一个附件到 AI 页面输入框（CDP 优先，合成事件兜底）。
 * @param ctx  窗口上下文（需含 view.webContents；providerId 用于 CDP 探测）
 * @param file 文件名 / base64 / MIME
 */
async function uploadAttachment(ctx: UploadCtx, file: UploadFile): Promise<UploadResult> {
  const wc = ctx && ctx.view && ctx.view.webContents;
  if (!wc || wc.isDestroyed()) return { success: false, error: 'no-ai-view' };
  // 1) CDP 真实鼠标通道（合成事件免疫站点首选）
  try {
    const cr = await cdpAttach(ctx as any, { name: file.name, data: file.data, mime: file.mime });
    if (cr && cr.success) return { success: true, mode: cr.mode || 'cdp' };
    // CDP 明确失败（非 debugger-busy 等临时状态）也走兜底，尽量不丢消息
  } catch (_) { /* 落兜底 */ }
  // 2) 合成事件兜底
  try {
    const code = '(' + attachFn.toString() + ')(document, window, ' +
      JSON.stringify(file.data || '') + ', ' +
      JSON.stringify(file.name || 'file') + ', ' +
      JSON.stringify(file.mime || 'application/octet-stream') + ', 12000, 500)';
    const r = await wc.executeJavaScript(code, true);
    if (r && r.success) return { success: true, mode: 'synthetic' };
    return { success: false, error: (r && r.error) || '上传失败' };
  } catch (err: any) {
    return { success: false, error: (err && err.message) || 'inject-failed' };
  }
}

export { uploadAttachment, attachFn };

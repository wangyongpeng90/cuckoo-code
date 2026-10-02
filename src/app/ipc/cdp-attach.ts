/**
 * CDP 文件上传通道（纯净模式 harness 专用）
 *
 * 适用合成事件免疫站点（如智谱 chatglm.cn）：全程不派发任何合成 JS 事件，
 * 与人工操作等价：
 *   1. provider 探测源码（getAttachProbeSource，若有）在页内定位上传入口坐标；
 *   2. CDP Input.dispatchMouseEvent 派发真实鼠标事件点击入口；
 *   3. CDP Page.setInterceptFileChooserDialog 拦截原生文件选择框（不弹窗）；
 *   4. Page.fileChooserOpened 事件 → DOM.setFileInputFiles 注入临时文件；
 *   5. 站点走原生 change 流程，附件进入输入区。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getProvider } from '../../providers/registry.js';

/** 上传请求参数：文件名 / base64 数据 / MIME 类型 */
export interface AttachPayload { name: string; data: string; mime: string; }
export interface AttachResult { success: boolean; mode?: string; error?: string; probe?: any; }

/** 该 AI 视图对应窗口上下文的最小接口（避免循环依赖 window.js） */
export interface AttachCtx { providerId?: string; view: { webContents: any }; }

/**
 * CDP 上传主流程。临时文件落盘 → 探测入口坐标 → 真实点击 →
 * 拦截文件选择框 → setFileInputFiles → 清理。
 */
export async function cdpAttach(ctx: AttachCtx, file: AttachPayload): Promise<AttachResult> {
  const wc = ctx.view.webContents;
  let tmpPath: string | null = null;
  let attached = false;
  // 诊断镜像：主进程 console 不进 provider 日志，镜像到页面控制台以便落盘排查
  const pageLog = (msg: string) => {
    try {
      wc.executeJavaScript('console.log(' + JSON.stringify('[cuckoo-attach] ' + msg) + ')').catch(() => {});
    } catch (_) { /* ignore */ }
  };
  try {
    const bin = Buffer.from(file.data || '', 'base64');
    if (!bin.length) return { success: false, error: 'empty-file-data' };
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-attach-'));
    tmpPath = path.join(tmpDir, file.name || 'file.bin');
    fs.writeFileSync(tmpPath, bin);

    if (wc.debugger.isAttached()) return { success: false, error: 'debugger-busy' };
    wc.debugger.attach('1.3');
    attached = true;

    // Page 域必须显式启用：CDP 只对已启用的域派发事件，
    // 否则 Page.fileChooserOpened 永不触发，拦截形同虚设（只会等到超时）。
    await wc.debugger.sendCommand('Page.enable');
    // DOM 域：命中隐藏 file input 时需要 DOM.getDocument/querySelector 定位它再直接注入
    try { await wc.debugger.sendCommand('DOM.enable'); } catch (_) { /* ignore */ }

    // 页内探测上传入口坐标（provider 自定义源码优先，通用关键词兜底）。
    // 第三参传入文件信息，便于平台按类型选择不同入口（如智谱：图片走图片键、
    // 其它文件走工具菜单里的"本地文件选择"）。
    const provider = ctx.providerId ? getProvider(ctx.providerId) : null;
    const customSrc = provider && typeof (provider as any).getAttachProbeSource === 'function'
      ? (provider as any).getAttachProbeSource() : null;
    const probeSrc = customSrc || genericAttachProbe.toString();
    const fileInfo = JSON.stringify({ name: file.name, mime: file.mime });
    const runProbe = async () => {
      const code = '(' + probeSrc + ')(document, window, ' + fileInfo + ')';
      return await wc.executeJavaScript(code, true);
    };

    /**
     * 等待附件真正就绪（注入文件 ≠ 附件可用）。
     * 站点上传是异步的：文件写入 input 后要等上传接口返回 + 附件挂进输入区，
     * 此时立刻发送会被站点拒绝（智谱实机报"发送内容不能为空"）。
     * 判定依据（任一满足即就绪）：
     *   1. hook 暴露的上传状态变为 ok（__cuckooZhipuUpload__.state）；
     *   2. 输入区出现附件预览图/chip（上传成功后的视觉证据）。
     */
    const waitComposerReady = async (timeoutMs: number): Promise<boolean> => {
      const fn = function () {
        try {
          // 各 provider 自报的上传状态标记（provider 的 hook 在页内维护）。
          // 原实现只认 zhipu 的标记，mimo 等 provider 会整条落空，
          // 只能退回 DOM 启发式 —— 而 mimo 的附件卡片是 Tailwind 固定尺寸，
          // 不匹配 file-item/attach-item 类名，会误判为"未就绪"。
          var marks = [(window as any).__cuckooZhipuUpload__, (window as any).__cuckooMimoUpload__];
          for (var mi = 0; mi < marks.length; mi++) {
            var mk = marks[mi];
            if (!mk) continue;
            if (mk.state === 'ok') return { ready: true, via: 'upload-ok' };
            if (mk.state === 'fail' || mk.state === 'error') return { ready: false, via: 'upload-' + mk.state };
          }
          var vh = window.innerHeight || 800;
          var imgs = document.querySelectorAll('img');
          var preview = 0;
          for (var i = 0; i < imgs.length; i++) {
            var r = imgs[i].getBoundingClientRect();
            if (r.top > vh * 0.6 && r.width > 8 && r.height > 8) preview++;
          }
          // 附件卡片：zhipu 用 file-item/attach-item 语义类；
          // mimo 的附件卡片是固定尺寸 Tailwind 卡片，bundle 实证类名含 h-14 w-60
          // （240×56 的文件卡），故追加该签名。
          var chips = document.querySelectorAll('[class*="file-item"],[class*="attach-item"],[class*="upload-item"],[class*="file-list"],[class*="preview-item"],[class*="w-60"][class*="h-14"]');
          var chipVis = 0;
          for (var k = 0; k < chips.length; k++) {
            var cr = chips[k].getBoundingClientRect();
            if (cr.width > 0 && cr.height > 0 && cr.top > vh * 0.5) chipVis++;
          }
          return { ready: (preview > 0 || chipVis > 0), via: 'preview=' + preview + ',chip=' + chipVis };
        } catch (e: any) { return { ready: false, via: 'error:' + (e && e.message) }; }
      };
      const deadline = Date.now() + timeoutMs;
      let last: any = null;
      while (Date.now() < deadline) {
        try {
          last = await wc.executeJavaScript('(' + fn.toString() + ')()', true);
          if (last && last.ready) { pageLog('附件就绪: ' + last.via); return true; }
          if (last && last.via && last.via.indexOf('upload-fail') === 0) {
            pageLog('上传失败，不再等待: ' + last.via);
            return false;
          }
        } catch (_) { /* ignore */ }
        await new Promise((r) => setTimeout(r, 400));
      }
      pageLog('等待附件就绪超时，最后状态: ' + JSON.stringify(last));
      return false;
    };

    // 输入区状态探针：判定注入的文件是否真的变成了附件（预览图/chip/上传中）
    const dumpComposer = async (label: string) => {
      try {
        const fn = function () {
          try {
            var vh = window.innerHeight || 800;
            var imgs = document.querySelectorAll('img');
            var preview = 0;
            for (var i = 0; i < imgs.length; i++) {
              var r = imgs[i].getBoundingClientRect();
              if (r.top > vh * 0.6 && r.width > 0 && r.height > 0) preview++;
            }
            var box: any = document.querySelector('textarea, [contenteditable="true"]');
            var boxText = box ? String(box.value !== undefined ? box.value : box.textContent).slice(0, 40) : '(无输入框)';
            var chips = document.querySelectorAll('[class*="file-item"],[class*="attach"],[class*="upload-item"],[class*="preview"],[class*="file-list"]');
            var chipVis = 0;
            for (var k = 0; k < chips.length; k++) {
              var cr = chips[k].getBoundingClientRect();
              if (cr.width > 0 && cr.height > 0 && cr.top > vh * 0.5) chipVis++;
            }
            var prog = document.querySelectorAll('[class*="progress"],[class*="uploading"],[class*="loading"]');
            var progVis = 0;
            for (var j = 0; j < prog.length; j++) {
              var pr = prog[j].getBoundingClientRect();
              if (pr.width > 0 && pr.height > 0) progVis++;
            }
            return { previewImgs: preview, chipEls: chipVis, progressEls: progVis, inputText: boxText, totalImgs: imgs.length };
          } catch (e: any) { return { error: String(e && e.message) }; }
        };
        const r = await wc.executeJavaScript('(' + fn.toString() + ')()', true);
        pageLog('输入区状态(' + label + '): ' + JSON.stringify(r));
      } catch (_) { /* ignore */ }
    };

    // 文件选择框监听：跨多轮点击复用同一个 promise
    let chooserSettled = false;
    let resolveChooser: ((r: AttachResult) => void) | null = null;
    const chooserPromise = new Promise<AttachResult>((resolve) => { resolveChooser = resolve; });
    const onMessage = (_e: any, method: string, params: any) => {
      if (method !== 'Page.fileChooserOpened' || chooserSettled) return;
      chooserSettled = true;
      (async () => {
        try {
          wc.debugger.removeListener('message', onMessage);
          const bnid = params && params.backendNodeId;
          if (!bnid) { resolveChooser && resolveChooser({ success: false, error: 'no-backend-node' }); return; }
          await wc.debugger.sendCommand('DOM.setFileInputFiles', { files: [tmpPath], backendNodeId: bnid });
          console.log('[Cuckoo Attach] 文件已注入: ' + tmpPath);
          pageLog('文件已注入 ' + file.name);
          // 注入后立刻 + 3 秒后各看一次输入区状态：附件是否真的进去了
          await dumpComposer('注入后立即');
          setTimeout(() => { dumpComposer('注入后3s'); }, 3000);
          // 关键：等附件真正就绪再返回成功，否则 harness 立刻发送会被站点拒绝
          const ready = await waitComposerReady(12000);
          setTimeout(() => { dumpComposer('就绪等待后'); }, 500);
          resolveChooser && resolveChooser({ success: ready, mode: 'cdp', error: ready ? undefined : 'attachment-not-ready' });
        } catch (err: any) {
          pageLog('注入失败: ' + ((err && err.message) || 'setFileInputFiles-failed'));
          resolveChooser && resolveChooser({ success: false, error: (err && err.message) || 'setFileInputFiles-failed' });
        }
      })();
    };
    wc.debugger.on('message', onMessage);
    await wc.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });

    // 最多 3 轮「探测 → 真实点击 → 等文件选择框」：
    // 单步入口（如智谱图片键）一轮命中；两步流程（工具键弹菜单 → 菜单项）
    // 则每轮结束后重新探测，由 provider 按当前 DOM 状态给出下一步目标。
    for (let round = 1; round <= 3; round++) {
      let probe: any = null;
      try {
        probe = await runProbe();
      } catch (e: any) {
        pageLog('第' + round + '轮探测异常: ' + ((e && e.message) || e));
      }
      console.log('[Cuckoo Attach] 第' + round + '轮上传入口探测: ' + JSON.stringify(probe));
      pageLog('第' + round + '轮探测: ' + JSON.stringify(probe));
      if (!probe || !probe.found || typeof probe.x !== 'number') {
        if (round === 1) return { success: false, error: 'upload-entry-not-found', probe };
        break;
      }
      // provider 命中隐藏 <input type=file>（实机 mimo：bundle 渲染 display:none 的 file input）：
      // 它的坐标毫无意义——display:none 时 getBoundingClientRect() 是 0,0，
      // 照坐标点击只会打到视口左上角，永远等不到文件选择框（file-chooser-timeout）。
      // 正确做法：跳过点击，直接对该 input 注入（DOM.setFileInputFiles 不要求元素可见）。
      // provider 侧会给命中的 input 打上 data-cuckoo-attach-input 标记，避免选错元素。
      if (probe.isFileInput) {
        pageLog('命中隐藏 file input（坐标无意义），跳过点击，改为直接注入');
        try {
          const docNode: any = await wc.debugger.sendCommand('DOM.getDocument', { depth: 1 });
          const found: any = await wc.debugger.sendCommand('DOM.querySelector', {
            nodeId: docNode && docNode.root && docNode.root.nodeId,
            selector: 'input[data-cuckoo-attach-input]',
          });
          if (found && found.nodeId) {
            await wc.debugger.sendCommand('DOM.setFileInputFiles', { files: [tmpPath], nodeId: found.nodeId });
            console.log('[Cuckoo Attach] 已直接注入隐藏 file input: ' + tmpPath);
            pageLog('文件已注入（直接注入隐藏 file input）');
            await dumpComposer('直接注入后立即');
            const ready = await waitComposerReady(12000);
            setTimeout(() => { dumpComposer('就绪等待后'); }, 500);
            return { success: ready, mode: 'cdp-direct', error: ready ? undefined : 'attachment-not-ready', probe };
          }
          pageLog('未按标记定位到 file input，回退到点击流程');
        } catch (e: any) {
          pageLog('直接注入异常: ' + ((e && e.message) || e) + '，回退到点击流程');
        }
      }
      const cx = Math.round(probe.x), cy = Math.round(probe.y);
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none', clickCount: 0 });
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 });
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 });
      console.log('[Cuckoo Attach] CDP 已点击 (' + cx + ',' + cy + ') ' + (probe.tag || ''));
      pageLog('已点击 (' + cx + ',' + cy + ') ' + (probe.tag || ''));
      const hit = await Promise.race([
        chooserPromise,
        new Promise<AttachResult>((r) => setTimeout(() => r({ success: false, error: 'round-timeout' }), 2500)),
      ]);
      if (hit.success) return hit;
      if (hit.error && hit.error !== 'round-timeout') return hit;   // 真实失败（如注入异常）直接返回
      pageLog('本轮未出现文件选择框，重新探测下一步…');
    }
    return { success: false, error: 'file-chooser-timeout' };
  } catch (err: any) {
    return { success: false, error: (err && err.message) || 'cdp-attach-failed' };
  } finally {
    try { if (attached) await wc.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }); } catch (_) { /* ignore */ }
    try { if (attached) wc.debugger.detach(); } catch (_) { /* ignore */ }
    try { if (tmpPath) { fs.unlinkSync(tmpPath); fs.rmdirSync(path.dirname(tmpPath)); } } catch (_) { /* ignore */ }
  }
}

/**
 * 通用上传入口探测（provider 未提供自定义源码时的兜底）。
 * 主世界注入，必须自包含：关键词扫输入区附近的小尺寸可见元素，
 * 按标签/类名加权，返回最佳候选中心坐标 + 候选诊断。
 */
function genericAttachProbe(doc: any, win: any) {
  try {
    var vh = win.innerHeight || 800;
    var vw = win.innerWidth || 1200;
    var keys = /(attach|upload|paperclip|file|image|图片|文件|上传|添加|附件|相册)/i;
    var sel = 'button, [role=button], [class*=attach], [class*=upload], [class*=file], [class*=plus], [class*=add], span, div';
    var cands = doc.querySelectorAll(sel);
    var scored: any[] = [];
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      if (!el || !el.getBoundingClientRect) continue;
      var rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.left < 0 || rect.top < 0 || rect.left > vw || rect.top > vh) continue;
      // 排除 Cuckoo 自身覆盖层与聊天正文区：只看视口下半部的小元素
      try { if (el.closest && el.closest('[class*="cuckoo-"]')) continue; } catch (e) { /* ignore */ }
      if (rect.top < vh * 0.55) continue;
      if (rect.width > 80 || rect.height > 60) continue;
      var cls = (typeof el.className === 'string') ? el.className : '';
      if (/cuckoo/i.test(cls)) continue;
      var aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
      var title = (el.getAttribute && el.getAttribute('title')) || '';
      var sig = cls + ' ' + aria + ' ' + title;
      if (!keys.test(sig)) continue;
      var score = 10;
      if (el.tagName === 'BUTTON') score += 20;
      if (cls.length < 60) score += 5;
      scored.push({ score: score, rect: rect, sig: sig.slice(0, 80), tag: el.tagName });
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    if (scored.length) {
      var pick = scored[0];
      return {
        found: true,
        x: Math.round(pick.rect.left + pick.rect.width / 2),
        y: Math.round(pick.rect.top + pick.rect.height / 2),
        tag: pick.tag + ':' + pick.sig,
        candidates: scored.slice(0, 5).map(function (s: any) { return s.score + ':' + s.sig; }),
      };
    }
    return { found: false, reason: 'no-candidate' };
  } catch (e: any) {
    return { found: false, reason: 'error:' + (e && e.message) };
  }
}
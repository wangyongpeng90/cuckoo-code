/**
 * 语音输入：麦克风录音 → 本地 STT（faster-whisper）→ 填入对话输入框
 *
 * 真机验证（2026-10-15，Electron 44 / Chromium 152）：
 *  - navigator.mediaDevices.getUserMedia 可用（已实测拿到麦克流）
 *  - 浏览器原生 SpeechRecognition 在 Electron 里报 not-allowed（无 Google 云端凭证）→ 不可用
 *  - 本机 F:\\AI\\python 装了 faster-whisper，模型 faster-whisper-base 可直接解码 webm/opus
 *    → 走「录音 → 主进程 faster-whisper → 文字」离线方案
 *
 * 因此本模块：MediaRecorder 录音（webm/opus）→ electronAPI.transcribeAudio → appendTextToInput。
 */
import { showToast } from './panel.js';
import { appendTextToInput } from './chat-input.js';

let recording = false;
let mediaRecorder: any = null;
let mediaStream: any = null;
let chunks: any[] = [];

/** 更新麦克风按钮视觉状态 */
function setButtonState(active: boolean): void {
  const btn = document.getElementById('cuckoo-voice-btn');
  if (!btn) return;
  if (active) btn.classList.add('cuckoo-voice-recording');
  else btn.classList.remove('cuckoo-voice-recording');
}

/** 选取录音 MIME 类型（优先 webm/opus，退化到默认） */
function pickMimeType(): string {
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  try {
    for (const m of cands) {
      if ((window as any).MediaRecorder && (window as any).MediaRecorder.isTypeSupported(m)) return m;
    }
  } catch (_) {}
  return '';
}

/** 开始录音 */
async function startRecording(): Promise<void> {
  if (recording) return;
  const md = navigator.mediaDevices;
  if (!md || typeof md.getUserMedia !== 'function') {
    showToast('当前环境不支持麦克风采集', 3500);
    return;
  }
  try {
    mediaStream = await md.getUserMedia({ audio: true });
  } catch (err: any) {
    showToast('未获得麦克风权限: ' + (err && err.name ? err.name : err), 3500);
    return;
  }
  try {
    const mimeType = pickMimeType();
    mediaRecorder = mimeType ? new (window as any).MediaRecorder(mediaStream, { mimeType }) : new (window as any).MediaRecorder(mediaStream);
    chunks = [];
    mediaRecorder.ondataavailable = (e: any) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onerror = (e: any) => {
      console.warn('[Cuckoo Voice] MediaRecorder 错误:', e && e.error);
      stopRecording();
      showToast('录音出错', 3000);
    };
    mediaRecorder.start();
    recording = true;
    setButtonState(true);
    showToast('正在录音…再次点击结束', 2500);
  } catch (err: any) {
    releaseStream();
    showToast('启动录音失败: ' + (err && err.message ? err.message : err), 3500);
  }
}

/** 释放麦克流 */
function releaseStream(): void {
  try { if (mediaStream) mediaStream.getTracks().forEach((t: any) => t.stop()); } catch (_) {}
  mediaStream = null;
}

/** 停止录音 → 送本地识别 → 填入输入框 */
function stopRecording(): void {
  if (!recording || !mediaRecorder) { releaseStream(); return; }
  recording = false;
  const rec = mediaRecorder;
  rec.onstop = async () => {
    releaseStream();
    setButtonState(false);
    const blob = chunks.length ? new Blob(chunks, { type: rec.mimeType || 'audio/webm' }) : null;
    chunks = [];
    if (!blob || blob.size === 0) { showToast('没有录到音频', 3000); return; }
    showToast('识别中…', 2500);
    try {
      const buf = await blob.arrayBuffer();
      const api = (window as any).electronAPI;
      if (!api || typeof api.transcribeAudio !== 'function') {
        showToast('识别接口不可用', 3000);
        return;
      }
      let voiceCfg: any = {};
      try {
        voiceCfg = {
          pythonPath: localStorage.getItem('cuckoo-voice-python') || '',
          modelPath: localStorage.getItem('cuckoo-voice-model') || '',
          lang: localStorage.getItem('cuckoo-voice-lang') || 'zh',
        };
      } catch (_) {}
      const res = await api.transcribeAudio(Object.assign({ audio: new Uint8Array(buf) }, voiceCfg));
      if (!res || !res.success) {
        showToast('识别失败: ' + ((res && res.error) || '未知错误'), 4000);
        return;
      }
      const text = String(res.text || '').trim();
      if (!text) { showToast('未识别到语音内容', 3000); return; }
      const ok = await appendTextToInput(text);
      if (!ok) showToast('识别成功，但填入输入框失败', 3000);
    } catch (err: any) {
      showToast('识别异常: ' + (err && err.message ? err.message : err), 4000);
    }
  };
  try { rec.stop(); } catch (_) { releaseStream(); setButtonState(false); }
}

/** 切换开始/停止 */
function toggleVoiceInput(): void {
  if (recording) stopRecording();
  else void startRecording();
}

/** 当前是否正在录音 */
function isVoiceActive(): boolean {
  return recording;
}

export { startRecording, stopRecording, toggleVoiceInput, isVoiceActive };

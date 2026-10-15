/**
 * 本地语音识别（STT）IPC：录音 buffer → 文字
 *
 * 走本机 faster-whisper（离线，无需联网/云端凭证）。真机实测（2026-10-15）：
 *  - F:\\AI\\python\\python.exe 已装 faster-whisper 1.2.1 + ctranslate2
 *  - 模型 F:\\AI\\models\\whisper\\faster-whisper-base 可直接解码 webm/opus
 *  - base 模型 25s 音频 CPU int8 转录约 0.6s
 *
 * 命令/模型路径可经设置覆盖（localStorage → IPC 传入）；未配置时自动探测常见路径。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

/** 内置 STT 脚本（运行时写临时文件执行，避免打包路径问题） */
const STT_SCRIPT = String.raw`# -*- coding: utf-8 -*-
import sys, argparse, json
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--lang", default="zh")
    args = ap.parse_args()
    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        print(json.dumps({"ok": False, "error": "faster_whisper not installed: %s" % e}, ensure_ascii=False))
        return
    try:
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
        segments, info = model.transcribe(args.audio, language=args.lang, beam_size=5)
        text = "".join(s.text for s in segments).strip()
        print(json.dumps({"ok": True, "text": text, "lang": info.language}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
if __name__ == "__main__":
    main()
`;

/** 自动探测候选 python 与模型路径（本机常见落点） */
function detectPython(): string | null {
  const cands = [
    'F:\\AI\\python\\python.exe',
    'F:\\PERSIST\\env\\python\\python.exe',
  ];
  for (const p of cands) { try { if (fs.existsSync(p)) return p; } catch (_) {} }
  return null;
}
function detectModel(): string | null {
  const cands = [
    'F:\\AI\\models\\whisper\\faster-whisper-base',
    'F:\\AI\\models\\whisper\\onnx-base',
  ];
  for (const p of cands) { try { if (fs.existsSync(p)) return p; } catch (_) {} }
  return null;
}

/** 把内置脚本写到临时文件（幂等，只写一次） */
let scriptPath: string | null = null;
function ensureScript(): string {
  if (scriptPath && fs.existsSync(scriptPath)) return scriptPath;
  const p = path.join(os.tmpdir(), 'cuckoo-stt-transcribe.py');
  fs.writeFileSync(p, STT_SCRIPT, 'utf8');
  scriptPath = p;
  return p;
}

/** 执行一次转录 */
function runTranscribe(pythonExe: string, modelPath: string, audioPath: string, lang: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  return new Promise((resolve) => {
    let sp: any;
    try {
      sp = spawn(pythonExe, [ensureScript(), '--audio', audioPath, '--model', modelPath, '--lang', lang]);
    } catch (err: any) {
      resolve({ ok: false, error: 'spawn 失败: ' + (err && err.message) });
      return;
    }
    let out = '', errOut = '';
    sp.stdout.on('data', (d: any) => { out += d.toString(); });
    sp.stderr.on('data', (d: any) => { errOut += d.toString(); });
    sp.on('error', (err: any) => resolve({ ok: false, error: '进程错误: ' + err.message }));
    sp.on('close', () => {
      // 取最后一行 JSON（python 可能先打 warning）
      const lines = out.trim().split(/\r?\n/);
      const last = lines[lines.length - 1] || '';
      try {
        const j = JSON.parse(last);
        resolve(j);
      } catch (_) {
        resolve({ ok: false, error: '无法解析输出: ' + (out || errOut).slice(0, 300) });
      }
    });
  });
}

function registerSttIpc(): void {
  ipcMain.handle('transcribe-audio', async (_event: any, payload: any = {}) => {
    try {
      const buf: Buffer = payload && payload.audio ? Buffer.from(payload.audio) : Buffer.alloc(0);
      if (!buf.length) return { success: false, error: '空音频' };
      const pythonExe = (payload && payload.pythonPath) || detectPython();
      const modelPath = (payload && payload.modelPath) || detectModel();
      if (!pythonExe) return { success: false, error: '未找到 python（请在设置中配置）' };
      if (!modelPath) return { success: false, error: '未找到 whisper 模型（请在设置中配置）' };
      const lang = (payload && payload.lang) || 'zh';
      // 写临时音频文件
      const audioPath = path.join(os.tmpdir(), 'cuckoo-stt-' + Date.now() + '.webm');
      fs.writeFileSync(audioPath, buf);
      const result = await runTranscribe(pythonExe, modelPath, audioPath, lang);
      try { fs.unlinkSync(audioPath); } catch (_) {}
      if (!result.ok) return { success: false, error: result.error || '识别失败' };
      return { success: true, text: result.text || '' };
    } catch (err: any) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  });
}

export { registerSttIpc };

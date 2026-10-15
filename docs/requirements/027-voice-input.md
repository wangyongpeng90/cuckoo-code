---
id: 027
type: feature
title: 语音输入（录音 + 本地 faster-whisper 识别填入）
status: review
branch: feat/027-voice-input
created: 2026-10-15
updated: 2026-10-15
---

## 背景

受限/移动场景下，用户希望**用说话代替打字**向 AI 网页输入。
当前 overlay（注入 AI 网页的悬浮层）无任何语音能力。

真机实测（Electron 44 / Chromium 152，Cuckoo 内嵌 https 页面）：

| 能力 | 结果 |
|---|---|
| navigator.mediaDevices.getUserMedia | ✅ 可用（实测拿到麦克流） |
| webkitSpeechRecognition | ⚠️ 存在，但 start() 报 not-allowed（Electron 无 Google 云端凭证）→ **不可用** |
| MediaRecorder（webm/opus） | ✅ 可用 |
| 本机 faster-whisper | ✅ F:\\AI\\python 已装，模型 faster-whisper-base 直接解码 webm/opus |

结论：**浏览器原生识别不可用**；改走「录音 → 本机离线 faster-whisper → 文字」，
零云端依赖、零联网，复用本机已有模型与环境。

## 目标

- overlay 麦克风按钮：点击录音、再点停止；识别结果填入当前输入框（不自动发送）
- 识别走本机 faster-whisper（离线）
- 失败清晰提示，不静默

## 方案

### 一、媒体权限（主进程）
`src/app/entry.ts`：AI 页面 session 设 `setPermissionRequestHandler` /
`setPermissionCheckHandler`，仅放行 `media`/`audioCapture`，其余维持默认拒绝。
真机验证：授权后 getUserMedia 成功拿到麦克流。

### 二、本地 STT（主进程）
`src/app/ipc/stt.ts`（新增）：`transcribe-audio` IPC。
- 收渲染进程传来的音频 buffer → 写临时文件 → `spawn` 本机 python 跑 faster-whisper → 返回文字
- 内置 Python 转录脚本（String.raw 内嵌，运行时写临时文件，避免打包路径问题）
- python / 模型路径自动探测本机常见落点（F:\\AI\\python / F:\\AI\\models\\whisper）
- `registerSttIpc` 注册进 `app/ipc/index.ts`；`bridge/api.ts` 暴露 `transcribeAudio`

### 三、录音 + 填入（overlay）
- `src/overlay/voice.ts`：MediaRecorder 录音（webm/opus）→ `electronAPI.transcribeAudio`
  → `appendTextToInput(text)`（不自动发送）
- `src/overlay/template/overlay.html`：悬浮球左侧 `#cuckoo-voice-btn`（🎤）
- `src/overlay/template/overlay.css`：按钮样式 + 录音中脉冲动画
- `src/overlay/events.ts`：绑定按钮 → `toggleVoiceInput()`

## 验收标准

- [x] 媒体权限配置，getUserMedia 可拿到麦克流（真机实测通过）
- [x] 本地 faster-whisper 可解码 webm/opus 并出中文文本（真机实测通过：
      内嵌脚本输出 `{"ok": true, "text": "..."}`）
- [x] overlay 麦克风按钮：录音中/空闲状态可视
- [x] 识别文字填入输入框（不自动发送）
- [x] typecheck（0 错）/ lint（0 错）/ test（879 passed）/ compile 全绿
- [ ] 真机 npm start 端到端验证（点按钮 → 说话 → 出字）

## 遗留 / 后续

- **模型精度**：base 模型中文有错字，可在设置里换 larger 模型提升精度。
  （已在壳设置页提供「语音识别」配置：python 路径 / 模型目录 / 语言，均留空自动探测）
- **推理速度**：base 模型 25s 音频 CPU int8 约 0.6s；更大模型更慢，可考虑 GPU。
- **python/模型路径**：当前自动探测本机常见路径；跨机器部署需在设置中可配置。
- 若某环境未装 faster-whisper，IPC 会返回明确错误，前端提示，不静默失败。

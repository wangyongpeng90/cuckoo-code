/**
 * 会话-目录映射持久化存储 + URL 会话检测（每 profile 独立实例）
 * 由原 session-store.js 改造：从单例改为工厂函数，每个 profile 拥有独立存储文件和状态。
 */
const fs = require('fs');
const path = require('path');

/**
 * 创建 profile 专属的 session store 实例
 * @param {string} profileId profile id
 * @param {string} storeDir 存储目录（通常是 userData）
 * @param {object} windowState window 管理模块引用
 */
function createSessionStore(profileId, storeDir, windowState) {
  const STORE_FILE = path.join(storeDir, 'session-dir-map-' + profileId + '.json');

  function readSessionStore() {
    try {
      if (fs.existsSync(STORE_FILE)) {
        return JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
      }
    } catch (err) {
      console.error('[Cuckoo Code] 读取会话存储失败:', err.message);
    }
    return {};
  }

  function writeSessionStore(store) {
    try {
      fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
      console.log('[Cuckoo Code] 会话存储已保存:', STORE_FILE);
    } catch (err) {
      console.error('[Cuckoo Code] 写入会话存储失败:', err.message);
    }
  }

  function getProjectDirBySessionId(sessionId) {
    if (!sessionId) return null;
    const store = readSessionStore();
    return store[sessionId] || null;
  }

  function saveSessionDirMapping(sessionId, projectDir) {
    if (!sessionId) return;
    const store = readSessionStore();
    store[sessionId] = projectDir;
    writeSessionStore(store);
  }

  function extractSessionIdFromUrl(url) {
    if (!url) return null;
    // Claude: https://claude.ai/chat/xxx
    if (url.includes('claude.ai')) {
      const m = url.match(/\/chat\/([a-zA-Z0-9_-]+)/i);
      return m ? m[1] : null;
    }
    // ChatGPT: https://chatgpt.com/c/{uuid}
    // 注意：创建会话过程中 URL 会有中间态 /c/WEB:xxx，不能把 WEB 当会话 ID
    if (url.includes('chatgpt.com') || url.includes('chat.openai.com')) {
      const uuidMatch = url.match(/\/c\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
      if (uuidMatch) return uuidMatch[1];
      const genericMatch = url.match(/\/c\/([a-zA-Z0-9_-]+)/i);
      if (genericMatch && genericMatch[1] !== 'WEB') return genericMatch[1];
      return null;
    }
    // DeepSeek: https://chat.deepseek.com/a/chat/s/xxx
    const match = url.match(/\/chat\/s\/([a-f0-9-]+)/i);
    if (match) return match[1];
    const altMatch = url.match(/\/s\/([a-f0-9-]+)/i);
    return altMatch ? altMatch[1] : null;
  }

  const state = {
    currentSessionId: null,
    selectedProjectDir: null,
    pendingProjectDir: null,
  };

  function handleUrlChange(url, targetWindow) {
    const sessionId = extractSessionIdFromUrl(url);
    const win = targetWindow || (windowState && windowState.getMainWindow());

    if (sessionId) {
      state.currentSessionId = sessionId;
      console.log('[Cuckoo Code][' + profileId + '] 当前会话ID: ' + sessionId);

      if (state.pendingProjectDir) {
        saveSessionDirMapping(sessionId, state.pendingProjectDir);
        state.selectedProjectDir = state.pendingProjectDir;
        state.pendingProjectDir = null;
        if (win && !win.isDestroyed()) {
          win.webContents.send('project-dir-updated', state.selectedProjectDir);
          win.webContents.send('session-restored', { sessionId, projectDir: state.selectedProjectDir });
        }
        console.log('[Cuckoo Code][' + profileId + '] 暂存目录已绑定');
        return;
      }

      const restoredDir = getProjectDirBySessionId(sessionId);
      if (restoredDir) {
        state.selectedProjectDir = restoredDir;
        if (win && !win.isDestroyed()) {
          win.webContents.send('session-restored', { sessionId, projectDir: restoredDir });
          win.webContents.send('project-dir-updated', restoredDir);
        }
      } else {
        state.selectedProjectDir = null;
        if (win && !win.isDestroyed()) {
          win.webContents.send('project-dir-updated', null);
        }
      }
    } else {
      // 提取不到会话 ID（如 ChatGPT 首页 https://chatgpt.com/）：
      // 若有暂存目录（刚初始化但还没绑定会话），保留目录；否则清空（恢复原行为）。
      state.currentSessionId = null;
      if (!state.pendingProjectDir) {
        state.selectedProjectDir = null;
        if (win && !win.isDestroyed()) {
          win.webContents.send('project-dir-updated', null);
        }
      }
    }
  }

  function tryRestoreSessionFromUrl(targetWindow) {
    const win = targetWindow || (windowState && windowState.getMainWindow());
    if (!win || win.isDestroyed()) return;
    const url = win.webContents.getURL();
    handleUrlChange(url, win);
  }

  return {
    readSessionStore,
    writeSessionStore,
    getProjectDirBySessionId,
    saveSessionDirMapping,
    extractSessionIdFromUrl,
    handleUrlChange,
    tryRestoreSessionFromUrl,
    state,
  };
}

module.exports = { createSessionStore };

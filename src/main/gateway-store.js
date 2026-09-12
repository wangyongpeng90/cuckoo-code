/**
 * 网关（OpenAI 兼容）配置与会话持久化
 *
 * - 配置存 gateway.json：{ baseUrl, apiKey, model, temperature }
 *   apiKey 只存 userData（主进程），渲染进程/页面永远拿不到明文，仅能脱敏展示。
 * - 会话存 gateway-conversations.json：{ [sessionId]: [{role,content},...] }
 *   主进程持有消息历史，页面刷新/会话切换后可恢复。
 *
 * 工厂函数风格，与 session-store 一致，便于单测注入目录。
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

function normalizeBaseUrl(raw) {
  if (!raw || typeof raw !== 'string') return DEFAULT_BASE_URL;
  let url = raw.trim().replace(/\/+$/, '');
  return url || DEFAULT_BASE_URL;
}

/** 判断是否为看起来合理的网关地址（http/https），用于校验而非猜测。 */
function looksLikeHttpUrl(raw) {
  if (!raw || typeof raw !== 'string') return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

/** 脱敏：仅保留末 4 位，其余用星号。空值返回 ''。 */
function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '';
  const tail = key.slice(-4);
  if (key.length <= 4) return '****';
  return '****' + tail;
}

/**
 * 创建网关存储实例
 * @param {string} storeDir userData 目录
 */
/**
 * 超长裁剪：保留首条（初始提示/系统提示）+ 其余按 user→assistant 配对裁剪到上限内。
 * 直接 slice(-N) 会切断配对并丢失首轮提示，导致 agent 行为退化。
 * @param {Array} messages
 * @param {number} max
 */
function trimMessages(messages, max) {
  const arr = Array.isArray(messages) ? messages : [];
  if (arr.length <= max) return arr.slice();
  const head = arr[0] ? [arr[0]] : [];
  // 从尾部往前取成对消息（user+assistant），凑满 max - head.length 条
  const tailBudget = Math.max(0, max - head.length);
  const tail = arr.slice(arr.length - (tailBudget % 2 === 0 ? tailBudget : tailBudget - 1));
  return head.concat(tail);
}

function createGatewayStore(storeDir) {
  const CONFIG_FILE = path.join(storeDir, 'gateway.json');
  const CONV_FILE = path.join(storeDir, 'gateway-conversations.json');
  const MAX_MESSAGES = 60; // 每个会话最多保留的消息数，避免无限增长

  function readJson(file, fallback) {
    try {
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
      console.error('[Gateway] 读取失败 ' + file + ':', err.message);
    }
    return fallback;
  }

  function writeJson(file, data) {
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error('[Gateway] 写入失败 ' + file + ':', err.message);
      return false;
    }
  }

  function getConfig() {
    const cfg = readJson(CONFIG_FILE, {});
    return {
      baseUrl: normalizeBaseUrl(cfg.baseUrl),
      apiKey: typeof cfg.apiKey === 'string' ? cfg.apiKey : '',
      model: typeof cfg.model === 'string' && cfg.model ? cfg.model : 'gpt-4o-mini',
      temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.7,
    };
  }

  /** 返回脱敏配置（给渲染进程/页面展示用）。 */
  function getConfigSafe() {
    const cfg = getConfig();
    return {
      configured: !!(cfg.baseUrl && cfg.apiKey && cfg.model),
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      temperature: cfg.temperature,
      apiKeyMasked: maskApiKey(cfg.apiKey),
      hasKey: !!cfg.apiKey,
    };
  }

  /**
   * 保存配置；patch 中 undefined 字段保持原值，apiKey 传空串表示清除。
   * @returns {{success:boolean, error?:string, config:object}}
   */
  function saveConfig(patch) {
    if (!patch || typeof patch !== 'object') return { success: false, error: '无效配置', config: getConfigSafe() };
    const cur = getConfig();
    const next = {
      baseUrl: patch.baseUrl !== undefined ? normalizeBaseUrl(patch.baseUrl) : cur.baseUrl,
      apiKey: patch.apiKey !== undefined ? String(patch.apiKey) : cur.apiKey,
      model: patch.model !== undefined ? String(patch.model) : cur.model,
      temperature: patch.temperature !== undefined ? Number(patch.temperature) : cur.temperature,
    };
    if (!looksLikeHttpUrl(next.baseUrl)) {
      return { success: false, error: '网关地址需为 http(s) URL', config: getConfigSafe() };
    }
    if (!next.model) return { success: false, error: '模型名不能为空', config: getConfigSafe() };
    const ok = writeJson(CONFIG_FILE, next);
    if (!ok) return { success: false, error: '写入配置失败', config: getConfigSafe() };
    return { success: true, config: getConfigSafe() };
  }

  // ---------- 会话消息 ----------
  function readConversations() {
    return readJson(CONV_FILE, {});
  }

  function getHistory(sessionId) {
    if (!sessionId) return [];
    const all = readConversations();
    return Array.isArray(all[sessionId]) ? all[sessionId] : [];
  }

  function setHistory(sessionId, messages) {
    if (!sessionId) return false;
    const all = readConversations();
    const trimmed = Array.isArray(messages) ? trimMessages(messages, MAX_MESSAGES) : [];
    if (trimmed.length === 0) delete all[sessionId];
    else all[sessionId] = trimmed;
    return writeJson(CONV_FILE, all);
  }

  function appendMessages(sessionId, msgs) {
    const hist = getHistory(sessionId);
    for (const m of msgs) if (m && m.role) hist.push(m);
    return setHistory(sessionId, hist);
  }

  function clearHistory(sessionId) {
    if (!sessionId) return false;
    return setHistory(sessionId, []);
  }

  /** 回滚：移除最后一条指定角色的消息（补全失败时撤销悬挂的 user 消息） */
  function removeLastIfRole(sessionId, role) {
    const hist = getHistory(sessionId);
    if (hist.length === 0 || hist[hist.length - 1].role !== role) return false;
    return setHistory(sessionId, hist.slice(0, -1));
  }

  return {
    getConfig,
    getConfigSafe,
    saveConfig,
    getHistory,
    setHistory,
    appendMessages,
    clearHistory,
    removeLastIfRole,
  };
}

module.exports = {
  createGatewayStore,
  trimMessages,
  normalizeBaseUrl,
  looksLikeHttpUrl,
  maskApiKey,
  DEFAULT_BASE_URL,
};

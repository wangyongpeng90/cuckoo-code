/**
 * Agent 模板加载器 - 扫描 agents/ 目录，缓存纯 Markdown 子 Agent 模板。
 *
 * 设计要点：
 * - 扫描两处：① Cuckoo 内置（随包，只读）② 用户自定义（userData，可写）
 * - 缓存 Map<id, { fullText, summary }>，id 为 .md 文件名（不含扩展名）
 * - summary 取首个非空行，去掉 # 前缀和首尾空白
 * - 跳过下划线开头的文件（如 _README.md）、README.md 与空文件
 * - 用户自定义同 id 覆盖内置
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_AGENT_DIR_NAME = 'agents';

const LINE_SPLIT_RE = /\r?\n/;

function extractSummary(fullText) {
  const lines = String(fullText || '').split(LINE_SPLIT_RE);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // 去掉 Markdown 标题前缀
    const cleaned = line.replace(/^#+\s*/, '').trim();
    if (cleaned) return cleaned;
  }
  return '';
}

function scanDir(dir, map) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return; // 目录不存在，跳过
    throw err;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!name.endsWith('.md')) continue;
    if (name.startsWith('_')) continue; // 跳过特殊文件（如 _README.md）
    if (name.toUpperCase() === 'README.MD') continue; // 跳过目录说明文件

    const id = name.slice(0, -3); // 去掉 .md
    const filePath = path.join(dir, name);
    let fullText;
    try {
      fullText = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      console.warn('[agent-templates] 读取模板失败:', filePath, err.message);
      continue;
    }
    if (!fullText || !fullText.trim()) continue; // 跳过空文件

    map.set(id, {
      fullText,
      summary: extractSummary(fullText),
      source: filePath,
    });
  }
}

/**
 * Cuckoo 内置 agent 目录（随包携带，只读）。
 * 开发环境为仓库根目录 agents/，打包后为 asar 内 agents/。
 */
function getBuiltinAgentDir() {
  try {
    return path.join(app.getAppPath(), DEFAULT_AGENT_DIR_NAME);
  } catch (_) {
    return null;
  }
}

/**
 * 用户自定义 agent 目录（可写，主 Agent 创建的 agent 落于此）。
 */
function getUserAgentDir() {
  try {
    return path.join(app.getPath('userData'), DEFAULT_AGENT_DIR_NAME);
  } catch (_) {
    return null;
  }
}

/**
 * 加载所有 Agent 模板：内置（随包）+ 用户自定义（userData）合并。
 * 用户自定义同 id 覆盖内置。
 * @returns {Map<string, {fullText: string, summary: string, source: string}>}
 */
function load() {
  const map = new Map();

  const builtinDir = getBuiltinAgentDir();
  if (builtinDir) scanDir(builtinDir, map);

  const userDir = getUserAgentDir();
  if (userDir) scanDir(userDir, map);

  return map;
}

module.exports = { load, extractSummary, scanDir, getBuiltinAgentDir, getUserAgentDir };

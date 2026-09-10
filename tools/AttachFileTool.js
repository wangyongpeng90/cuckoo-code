const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');
const { Tool, ToolResult } = require('./ToolRegistry');

// 上传文件大小上限（30MB），避免超大文件拖垮内存与注入脚本
const MAX_FILE_SIZE = 30 * 1024 * 1024;

// 上传成功后等待附件 chip 出现的超时
const UPLOAD_TIMEOUT_MS = 15000;

// 常见扩展名 → MIME 映射（兜底 application/octet-stream）
const MIME_MAP = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.json5': 'application/json',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.jsx': 'text/javascript',
  '.py': 'text/x-python',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.h': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.cc': 'text/x-c++',
  '.hpp': 'text/x-c++',
  '.cs': 'text/x-csharp',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.php': 'text/x-php',
  '.rb': 'text/x-ruby',
  '.sh': 'text/x-sh',
  '.bat': 'text/x-bat',
  '.cmd': 'text/x-bat',
  '.sql': 'text/x-sql',
  '.log': 'text/plain',
  '.ini': 'text/plain',
  '.conf': 'text/plain',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
};

/**
 * 解析文件路径：绝对路径原样返回；相对路径基于 projectDir（无则基于 cwd）。
 * @param {string} filePath
 * @param {string|null} projectDir
 * @returns {string} 绝对路径
 */
function resolveFilePath(filePath, projectDir) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('filePath must be a non-empty string');
  }
  const normalized = filePath.replace(/\//g, path.sep);
  if (path.isAbsolute(normalized)) return normalized;
  if (projectDir) return path.join(projectDir, normalized);
  return path.resolve(normalized);
}

/**
 * 按扩展名推断 MIME 类型，未知扩展名返回 application/octet-stream。
 * @param {string} fileName
 * @returns {string}
 */
function guessMimeType(fileName) {
  const ext = path.extname(fileName || '').toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

/**
 * 生成注入到页面的上传脚本（在主 world 执行，使用标准 DOM API）。
 * @param {string} base64 文件内容的 base64
 * @param {string} fileName 文件名
 * @param {string} mimeType MIME 类型
 * @param {number} timeoutMs 等待附件出现的超时
 * @returns {string} IIFE 代码字符串
 */
function buildInjectCode(base64, fileName, mimeType, timeoutMs) {
  return (
    '(async () => {\n' +
    '  try {\n' +
    '    const b64 = ' + JSON.stringify(base64) + ';\n' +
    '    const fileName = ' + JSON.stringify(fileName) + ';\n' +
    '    const mimeType = ' + JSON.stringify(mimeType) + ';\n' +
    '    const timeoutMs = ' + JSON.stringify(timeoutMs) + ';\n' +
    '    const bin = atob(b64);\n' +
    '    const bytes = new Uint8Array(bin.length);\n' +
    '    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);\n' +
    '    const file = new File([bytes], fileName, { type: mimeType });\n' +
    '    const input = document.querySelector(\'input[type=file]\');\n' +
    '    if (!input) return { success: false, error: \'未找到文件上传输入框\' };\n' +
    '    const dt = new DataTransfer();\n' +
    '    dt.items.add(file);\n' +
    '    input.files = dt.files;\n' +
    '    input.dispatchEvent(new Event(\'change\', { bubbles: true }));\n' +
    '    function fileVisible() {\n' +
    '      let node = input;\n' +
    '      for (let d = 0; d < 12 && node; d++) {\n' +
    '        if (node.innerText && node.innerText.includes(fileName)) return true;\n' +
    '        node = node.parentElement;\n' +
    '      }\n' +
    '      return false;\n' +
    '    }\n' +
    '    const deadline = Date.now() + timeoutMs;\n' +
    '    while (Date.now() < deadline) {\n' +
    '      await new Promise((r) => setTimeout(r, 300));\n' +
    '      if (fileVisible()) {\n' +
    '        return { success: true, fileName: fileName };\n' +
    '      }\n' +
    '    }\n' +
    '    return { success: false, error: \'上传超时，未检测到附件出现\' };\n' +
    '  } catch (err) {\n' +
    '    return { success: false, error: err && err.message ? err.message : String(err) };\n' +
    '  }\n' +
    '})()'
  );
}

class AttachFileTool extends Tool {
  constructor() {
    super(
      'attach_file',
      '将本地项目文件作为附件上传到当前对话的输入框（不发送）。上传后附件会随下一条消息一起发出。需要当前窗口 id（由运行时自动注入）。',
      {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: '要上传的文件路径（相对项目根目录或绝对路径）' }
        },
        required: ['filePath'],
        additionalProperties: false
      },
      'attachFile(filePath)'
    );
  }

  getPromptSection() {
    return {
      name: 'tool:attach_file',
      order: 114,
      text: '使用 attachFile(filePath) 将本地项目文件作为附件上传到当前对话输入框。上传成功后附件会随下一条消息一起发送，无需额外操作。仅支持已存在的单个文件，大小上限 30MB。'
    };
  }

  async execute(params) {
    const { filePath, projectDir, currentWindowId, windowId } = params || {};
    let absPath;
    try {
      absPath = resolveFilePath(filePath, projectDir || null);
    } catch (err) {
      return ToolResult.error(err.message);
    }

    const targetWindowId = currentWindowId !== undefined && currentWindowId !== null ? currentWindowId : windowId;
    if (targetWindowId === undefined || targetWindowId === null) {
      return ToolResult.error('缺少窗口上下文，无法定位当前对话窗口');
    }
    const win = BrowserWindow.fromId(targetWindowId);
    if (!win || win.isDestroyed()) {
      return ToolResult.error('当前对话窗口不存在或已关闭');
    }

    let stat;
    try {
      stat = fs.statSync(absPath);
    } catch (err) {
      return ToolResult.error('文件不存在或无法访问: ' + absPath);
    }
    if (!stat.isFile()) {
      return ToolResult.error('目标不是文件: ' + absPath);
    }
    if (stat.size > MAX_FILE_SIZE) {
      return ToolResult.error('文件超过 ' + Math.round(MAX_FILE_SIZE / 1024 / 1024) + 'MB 上限: ' + absPath);
    }

    let buffer;
    try {
      buffer = fs.readFileSync(absPath);
    } catch (err) {
      return ToolResult.error('读取文件失败: ' + err.message);
    }

    const fileName = path.basename(absPath);
    const mimeType = guessMimeType(fileName);
    const base64 = buffer.toString('base64');
    const code = buildInjectCode(base64, fileName, mimeType, UPLOAD_TIMEOUT_MS);

    let result;
    try {
      result = await win.webContents.executeJavaScript(code, true);
    } catch (err) {
      return ToolResult.error('注入上传脚本失败: ' + (err.message || String(err)));
    }
    if (!result || result.success !== true) {
      return ToolResult.error((result && result.error) || '上传失败');
    }

    return ToolResult.success({
      fileName: result.fileName,
      size: stat.size,
      message: '附件已上传到输入框: ' + result.fileName
    });
  }
}

module.exports = { AttachFileTool, resolveFilePath, guessMimeType, buildInjectCode };

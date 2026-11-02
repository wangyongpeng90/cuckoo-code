/**
 * 命令输出智能解码
 * 中文 Windows 上控制台默认代码页是 GBK（cp936），而 Node 的 exec 默认按 UTF-8 解码，
 * 导致 PowerShell/cmd 输出的中文变成 "�"。
 * 策略：先按 UTF-8 解码；若出现替换符（U+FFFD），说明字节流不是合法 UTF-8，
 * 回退按 GBK 解码。
 */

/**
 * 解码 exec 输出的原始字节。
 * @param buf - exec 输出的原始字节（可能为空/null）
 * @returns 解码后的文本
 */
function decodeOutput(buf: Buffer | null | undefined): string {
  if (!buf || buf.length === 0) return '';
  const utf8 = buf.toString('utf8');
  if (utf8.includes('\uFFFD')) {
    try {
      const gbk = new TextDecoder('gbk').decode(buf);
      if (!gbk.includes('\uFFFD')) return gbk;
    } catch (e) {
      // TextDecoder 不支持 gbk 的环境，退回 UTF-8 结果
    }
  }
  return utf8;
}

/**
 * 会受 Windows PowerShell 5.1 默认 ANSI/GBK 编码影响的 cmdlet。
 * - 读：Get-Content 默认按 ANSI 读，UTF-8 文件中文乱码
 * - 写：Set-Content / Out-File / Add-Content 默认按 ANSI 写，我们自己的 read 工具读回来乱码
 */
const ENCODING_SENSITIVE_CMDLETS = ['Get-Content', 'Set-Content', 'Add-Content', 'Out-File'];

/**
 * 给命令体里的编码敏感 cmdlet 注入 -Encoding UTF8（已带 -Encoding 的命令不动）。
 * 用于「命令体」场景（如 pwsh 工具，传入的已是纯 PowerShell 代码，无 powershell 前缀）。
 * @param body 命令体
 * @returns 修正后的命令体
 */
function injectEncodingToBody(body: string): string {
  if (typeof body !== 'string' || !body) return body;
  // 已显式指定编码：整体不动（宁可漏注，不可覆盖用户的明确选择）
  if (/-Encoding\s+/i.test(body)) return body;
  let out = body;
  for (const cmd of ENCODING_SENSITIVE_CMDLETS) {
    out = out.replace(new RegExp('\\b' + cmd + '\\b(?!\\s+-Encoding)', 'g'), cmd + ' -Encoding UTF8');
  }
  return out;
}

/**
 * 修正 AI 生成的完整 PowerShell 命令行（含 powershell/pwsh 前缀）。
 * 非 powershell/pwsh 调用原样返回。
 * @param command - 原始命令
 * @returns 修正后的命令
 */
function normalizeCommand(command: string): string {
  if (typeof command !== 'string' || !command) return command;
  const trimmed = command.trim();
  // 仅处理 powershell / pwsh 调用
  if (!/^(powershell|pwsh)(\.exe)?(\s|$)/i.test(trimmed)) return command;
  return injectEncodingToBody(command);
}

/**
 * 剥离文本开头的 UTF-8 BOM（U+FEFF）。
 * Windows PowerShell 5.1 的 `-Encoding UTF8` 必定写 BOM（3 字节 EF BB BF），
 * 读回时它以 \uFEFF 形式出现在首字符，肉眼不可见但会干扰内容匹配与 JSON 解析。
 * 只影响返回给调用方的字符串，不修改磁盘文件。
 * @param text 原始文本
 * @returns 去掉开头 BOM 的文本
 */
function stripBom(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

export { decodeOutput, normalizeCommand, injectEncodingToBody, stripBom, ENCODING_SENSITIVE_CMDLETS };

/**
 * 危险命令检测（唯一真相源）
 *
 * 由原 main.js 拆分而来；原先 bash / pwsh / 覆盖层各维护一份不一致的列表，
 * 且正则全部用 ^ 锚定行首、只对整条命令做单次匹配，导致
 *   `echo hi && rm -rf /`、`cd /tmp & format c:` 之类的复合命令可轻易绕过。
 *
 * 现统一为：先按 shell 控制符（&& || ; | & 换行）把命令拆成独立段，
 * 剥除前导修饰词（sudo/env/nohup 等）后，再对每一段分别匹配危险模式。
 * bash / pwsh / 覆盖层均调用本模块。
 *
 * 局限（黑名单固有）：无法可靠拦截 `cmd /c "rm -rf /"`、变量展开、
 * 脚本文件等间接方式。生产环境应叠加白名单或强制用户确认。
 */

// 危险命令列表 —— 匹配到的命令会额外警告 / 被拒绝
const DANGEROUS_CMDS = [
  // —— Unix 风格 ——
  // rm 删除根目录或家目录本身：支持任意短/长选项、--no-preserve-root、通配符、前缀修饰词
  /^rm\s+(?:-[a-z-]+\s+)*(?:\/(?:\s|$|\*)|~(?:$|\s|\/(?:\s|$|\*)))/i,
  /^mkfs(?:\.\w+)?\b/i,
  /^dd\s+[^|]*\bof=\/dev\//i,
  // —— Windows cmd ——
  /^format\s+/i,
  /^del\s+\/[a-z]*[fsq]/i,
  /^(?:rd|rmdir)\s+\/[a-z]*s/i, // rd /s、rmdir /s
  /^shutdown\s+/i,
  /^taskkill\s+/i,
  /^diskpart\b/i,
  /^reg\s+delete\b/i,
  /^cipher\s+\/w/i,
  /^vssadmin\s+delete\b/i,
  /^bcdedit\b/i,
  // —— PowerShell ——
  /^stop-computer\b/i,
  /^restart-computer\b/i,
  /^clear-disk\b/i,
  /^format-volume\b/i,
  /^remove-item\s+.*-recurse\b.*-force\b/i,
];

// 前导修饰词：剥除后才对内部真实命令做危险判断（防 `sudo rm -rf /` 绕过）
// 覆盖常见提权/包装命令，允许其后跟短选项（如 `sudo -u user`）
const CMD_WRAPPERS = /^(?:sudo|doas|env|nohup|command|time|nice|setsid|stdbuf)(?:\s+-[ugpC]\s+\S+|\s+-\S+|\s+[A-Za-z_]\w*=\S+)*\s+/i;

/**
 * 把一条复合命令按 shell 控制符拆成独立段。
 * 覆盖 cmd / bash / PowerShell 常见连接符：&& || ; | & 及换行。
 * 注意 alternation 顺序：&& 与 || 必须先于单字符 & | 匹配。
 * @param cmd 原始命令
 * @returns 去空白后的非空片段
 */
function splitShellSegments(cmd: string): string[] {
  return cmd
    .split(/\r?\n|&&|\|\||[;|&]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 反复剥除前导修饰词（sudo/env/nohup...），返回内部真实命令。
 * 例：`sudo -u root rm -rf /` → `rm -rf /`
 * @param segment 单个命令片段
 * @returns 剥除修饰词后的命令
 */
function stripWrappers(segment: string): string {
  let s = segment;
  while (CMD_WRAPPERS.test(s)) {
    s = s.replace(CMD_WRAPPERS, '');
  }
  return s;
}

/**
 * 判断命令（或其任一分段）是否为危险命令。
 * @param cmd 原始命令（可为复合命令）
 * @returns 命中危险模式返回 true
 */
function isDangerous(cmd: string): boolean {
  if (!cmd || typeof cmd !== 'string') return false;
  const segments = splitShellSegments(cmd);
  for (const seg of segments) {
    const inner = stripWrappers(seg);
    if (DANGEROUS_CMDS.some((pattern) => pattern.test(inner))) return true;
  }
  return false;
}

export { DANGEROUS_CMDS, isDangerous, splitShellSegments, stripWrappers };

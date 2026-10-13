/**
 * 危险命令检测（唯一真相源）
 *
 * 由原 main.js 拆分而来；原先 bash / pwsh / 覆盖层各维护一份不一致的列表，
 * 且正则全部用 ^ 锚定行首、只对整条命令做单次匹配，导致
 *   `echo hi && rm -rf /`、`cd /tmp & format c:` 之类的复合命令可轻易绕过。
 *
 * 现统一为：先按 shell 控制符（&& || ; | & 换行）把命令拆成独立段，
 * 再对每一段分别匹配危险模式。bash / pwsh / 覆盖层均调用本模块。
 *
 * 局限（黑名单固有）：无法可靠拦截 `cmd /c "rm -rf /"`、变量展开、
 * 脚本文件等间接方式。生产环境应叠加白名单或强制用户确认。
 */

// 危险命令列表 —— 匹配到的命令会额外警告 / 被拒绝
const DANGEROUS_CMDS = [
  // —— Unix 风格 ——
  // rm 递归删根/家目录的检测在 isDangerousRm()（覆盖 -rf/-fr 任意 flag 顺序、
  // --recursive/--force 分离长选项、带不带尾斜杠、顶部通配 /* 等变体）
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

/**
 * rm 递归删除根/家目录检测（DANGEROUS_CMDS 中两条 rm 正则的结构化替代）。
 * 旧正则 `^rm\s+-[a-z]*r[a-z]*f[a-z]*\s+\/(?:\s|$)` 存在多个实测绕过：
 *   - `rm -fr /`（r/f 顺序颠倒不匹配）
 *   - `rm -rf ~`（无尾斜杠不匹配）
 *   - `rm --recursive --force /`（长选项不匹配）
 * 此函数按 token 解析 flag 段与目标段，语义为"rm 带 recursive 标志且目标为根/家目录"。
 */
function isDangerousRm(seg: string): boolean {
  const m = /^rm\s+((?:-{1,2}[\w][\w-]*\s+)*)(\S+)\s*$/i.exec(seg);
  if (!m) return false;
  const flags = m[1];
  const target = m[2];
  // 递归标志：短选项组合含 r（-r/-rf/-fr…），或显式 --recursive
  const hasRecursive = /(?:^|\s)-[a-z]*r[a-z]*\s*$/i.test(flags + ' ') || /(?:^|\s)--recursive\b/i.test(flags);
  if (!hasRecursive) return false;
  // 目标为根/家目录：/、~、带尾斜杠、或顶层通配 /* ~/*
  if (target === '/' || target === '/*') return true;
  if (target === '~' || target === '~/' || target === '~/*') return true;
  return false;
}

/**
 * 把一条复合命令按 shell 控制符拆成独立段。
 * 覆盖 cmd / bash / PowerShell 常见连接符：&& || ; | & 及换行。
 * 注意 alternation 顺序：&& 与 || 必须先于单字符 & | 匹配。
 * 段外层的成对包裹引号会被剥离（`"rm -rf /"` 与 `rm -rf /` 等同检测）。
 * @param cmd 原始命令
 * @returns 去空白、去包裹引号后的非空片段
 */
function splitShellSegments(cmd: string): string[] {
  return cmd
    .split(/\r?\n|&&|\|\||[;|&]/)
    .map((s) => s.trim())
    .map((s) => {
      // 剥掉整段成对包裹引号：否则 `"rm -rf /"` 段首带引号，^rm 锚定失效
      if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
        return s.slice(1, -1).trim();
      }
      return s;
    })
    .filter((s) => s.length > 0);
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
    if (isDangerousRm(seg)) return true;
    if (DANGEROUS_CMDS.some((pattern) => pattern.test(seg))) return true;
  }
  return false;
}

export { DANGEROUS_CMDS, isDangerous, splitShellSegments, isDangerousRm };

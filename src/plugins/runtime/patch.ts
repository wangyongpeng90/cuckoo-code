/**
 * Cuckoo 插件系统 - cordis.patch.yml 解析
 *
 * DSH 插件用 cordis.patch.yml 声明"往插件树里插入什么"：
 *   - insert: 插入条目（id + name + config）
 *   - 其他 patch 指令（后续扩展）
 *
 * 本模块**零依赖**解析这个 YAML 的子集（只解析 insert 列表），
 * 不做完整 YAML 解析（避免引入 yaml 依赖，且格式可控）。
 *
 * 支持的格式（对齐 DSH 约定）：
 * ```yaml
 * - insert:
 *     - id: my-plugin
 *       name: 'my-plugin-package'
 *       config:
 *         key: value
 * ```
 */

/** 一条 insert 声明 */
export interface PatchInsert {
  id: string;
  name?: string;
  config?: Record<string, any>;
}

/** 解析结果 */
export interface PatchParseResult {
  ok: boolean;
  inserts: PatchInsert[];
  error?: string;
}

/**
 * 极简 YAML 子集解析：只提取 `insert:` 下的条目。
 *
 * 策略：逐行扫描，识别 `- insert:` 块，然后收集其下缩进的 `- id:` / `name:` / `config:`。
 * 这不是通用 YAML 解析器，只覆盖 DSH 插件的常见写法。
 */
export function parseCordisPatch(text: string): PatchParseResult {
  if (typeof text !== 'string') return { ok: false, inserts: [], error: '输入必须是字符串' };

  const lines = text.split(/\r?\n/);
  const inserts: PatchInsert[] = [];

  let inInsert = false;
  let current: PatchInsert | null = null;
  let configIndent = -1;

  const indentOf = (s: string): number => {
    const m = s.match(/^( *)/);
    return m ? m[1].length : 0;
  };

  for (const raw of lines) {
    // 去注释（行内 # 前有空格才当注释，粗略处理）
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    const indent = indentOf(line);
    const t = line.trim();

    // 进入 insert 块
    if (/^-\s*insert:\s*$/.test(t)) {
      inInsert = true;
      current = null;
      configIndent = -1;
      continue;
    }

    if (!inInsert) continue;

    // 新条目：- id: xxx
    const idMatch = t.match(/^-\s*id:\s*(.+)$/);
    if (idMatch) {
      if (current) inserts.push(current);
      current = { id: cleanValue(idMatch[1]) };
      configIndent = -1;
      continue;
    }

    if (!current) continue;

    // name: xxx
    const nameMatch = t.match(/^name:\s*(.+)$/);
    if (nameMatch && configIndent < 0) {
      current.name = cleanValue(nameMatch[1]);
      continue;
    }

    // config: 开始
    if (/^config:\s*$/.test(t)) {
      configIndent = indent;
      current.config = {};
      continue;
    }

    // config 下的键值对
    if (configIndent >= 0 && indent > configIndent) {
      const kv = t.match(/^([\w.-]+):\s*(.*)$/);
      if (kv) {
        current.config = current.config || {};
        current.config[kv[1]] = parseScalar(kv[2]);
      }
      continue;
    }

    // 顶层出现新的非缩进块 → 结束 insert
    if (indent === 0 && /^-\s*[a-z]/.test(t) && !/^-\s*id:/.test(t)) {
      inInsert = false;
    }
  }

  if (current) inserts.push(current);

  return { ok: true, inserts };
}

/** 清理 YAML 标量值（去引号） */
function cleanValue(v: string): string {
  return v.trim().replace(/^['"]|['"]$/g, '');
}

/** 解析标量：数字/布尔/字符串 */
function parseScalar(v: string): any {
  const s = v.trim();
  if (s === '' ) return '';
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  const n = Number(s);
  if (s !== '' && !isNaN(n) && !/^0\d/.test(s)) return n;
  return cleanValue(s);
}

/**
 * 检查插件清单里声明的 patch 文件是否存在（供加载器用）
 */
export function hasPatchDeclared(pkgJson: any): boolean {
  return !!(pkgJson && pkgJson.dsh && pkgJson.dsh.bundle && typeof pkgJson.dsh.bundle.patch === 'string');
}

export { cleanValue, parseScalar };

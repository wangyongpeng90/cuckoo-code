/**
 * Profile 的 cordis.patch.yml 读写（纯 node，零依赖）
 *
 * 格式（对齐 DSH，YAML 数组）：
 *  - id: ui-settings-general
 *    name: "@deepseek-ai/dsh-client-ui-settings-general"
 *    config: { welcomeNoticeVersion: 2026-08-13.1 }
 *  - id: some-plugin
 *    disabled: true
 *
 * ⚠️ 不引入 YAML 库——DSH 用的格式很窄（顶层数组 + id/name/config/disabled），
 * 手写解析足够（且避免依赖）。格式不匹配时保守返回空数组（不猜）。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 一条补丁（对齐 DSH 的 loader patch entry） */
export interface PatchEntry {
  /** 目标 id */
  id: string;
  /** 包名（可选） */
  name?: string;
  /** 配置覆盖（可选） */
  config?: Record<string, any>;
  /** 是否禁用 */
  disabled?: boolean;
}

/**
 * 解析 cordis.patch.yml（窄格式）。
 * 支持：
 *   - id: xxx
 *     name: "yyy"
 *     disabled: true
 *     config:
 *       key: value
 * 不支持嵌套多层的复杂 YAML（DSH 的 patch 层用不到）。
 */
export function parsePatch(text: string): PatchEntry[] {
  const out: PatchEntry[] = [];
  if (!text) return out;
  const lines = text.split(/\r?\n/);
  let cur: PatchEntry | null = null;
  let inConfig = false;
  const pushCur = () => { if (cur && cur.id) out.push(cur); };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const t = line.trim();

    // ---- config 子项（缩进 > 2，且当前在 config 块里）----
    if (cur && inConfig && indent > 2) {
      const m = t.match(/^([\w.-]+):\s*(.*)$/);
      if (m) { cur.config = cur.config || {}; (cur.config as any)[m[1]] = unquote(m[2]); }
      continue;
    }

    // ---- 新数组项 "- id: xxx"（缩进 0 或 2）----
    if (t.startsWith('- ') && indent <= 2) {
      pushCur();
      cur = { id: '' };
      inConfig = false;
      const rest = t.slice(2);
      const m = rest.match(/^([\w-]+):\s*(.*)$/);
      if (m) {
        if (m[1] === 'id') cur.id = unquote(m[2]);
        else if (m[1] === 'name') cur.name = unquote(m[2]);
        else if (m[1] === 'disabled') cur.disabled = (m[2] === 'true' || m[2] === 'yes' || m[2] === '1');
      }
      continue;
    }

    if (!cur) continue;
    inConfig = false;

    // ---- 键值对（id/name/disabled/config）----
    const m = t.match(/^([\w-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2];
    if (key === 'id') cur.id = unquote(val);
    else if (key === 'name') cur.name = unquote(val);
    else if (key === 'disabled') cur.disabled = (val === 'true' || val === 'yes' || val === '1');
    else if (key === 'config' && val === '') { cur.config = cur.config || {}; inConfig = true; }
  }
  pushCur();
  return out;
}

function unquote(s: string): string {
  const t = String(s || '').trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

/** 序列化补丁为 YAML（窄格式） */
export function serializePatch(entries: PatchEntry[]): string {
  const lines: string[] = [
    '# Cuckoo profile patch layer（对齐 DSH cordis.patch.yml 格式）',
    '# 每条：id（必填）+ name/config/disabled（可选）',
    '',
  ];
  for (const e of entries) {
    if (!e || !e.id) continue;
    lines.push('- id: ' + yamlScalar(e.id));
    if (e.name) lines.push('  name: ' + yamlScalar(e.name));
    if (e.disabled !== undefined) lines.push('  disabled: ' + (e.disabled ? 'true' : 'false'));
    if (e.config && Object.keys(e.config).length > 0) {
      lines.push('  config:');
      for (const [k, v] of Object.entries(e.config)) lines.push('    ' + k + ': ' + yamlScalar(v));
    }
  }
  lines.push('');
  return lines.join('\n');
}

function yamlScalar(v: any): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  // 含特殊字符 → 双引号
  if (/[:#\n\r'"\[\]{}]/.test(s) || s.trim() !== s) return JSON.stringify(s);
  return s;
}

/** 读 profile 的 cordis.patch.yml */
export function readProfilePatch(dir: string): PatchEntry[] {
  try {
    const text = fs.readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf-8');
    return parsePatch(text);
  } catch {
    return [];
  }
}

/** 写 profile 的 cordis.patch.yml */
export function writeProfilePatch(dir: string, entries: PatchEntry[]): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), serializePatch(entries), 'utf-8');
}

/** 设置某 id 的 disabled（找不到则新增） */
export function setDisabled(entries: PatchEntry[], id: string, disabled: boolean): PatchEntry[] {
  const out = entries.slice();
  const hit = out.find((e) => e.id === id);
  if (hit) hit.disabled = disabled;
  else out.push({ id, disabled });
  return out;
}

/** bundle patch 的一行（bundle 的 cordis.patch.yml 的 insert 条目） */
export interface BundlePatchRow {
  rowId: string;
  moduleName: string;
}

/**
 * 解析 bundle 的 cordis.patch.yml（"insert" 格式）：
 *   - insert:
 *       - id: dsh-market
 *         name: 'dshmarket'
 * @returns 行列表（rowId = id, moduleName = name）
 */
export function parseBundlePatch(text: string): BundlePatchRow[] {
  const out: BundlePatchRow[] = [];
  if (!text) return out;
  const lines = text.split(/\r?\n/);
  let cur: { id?: string; name?: string } | null = null;
  const push = () => { if (cur && cur.id) out.push({ rowId: cur.id, moduleName: cur.name || cur.id }); cur = null; };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const t = line.trim();
    // 新行 "- id: xxx" 或 "- name: xxx"
    if (t.startsWith('- id:') || t.startsWith('- name:')) {
      // 遇到新的 id/name 前，先 push 旧的（如果完整）
      if (t.startsWith('- id:')) { push(); cur = { id: unquote(t.slice(5).trim()) }; }
      else if (cur) cur.name = unquote(t.slice(7).trim());
      continue;
    }
    // 缩进键值（id: / name:）
    const m = t.match(/^(id|name):\s*(.*)$/);
    if (m && cur) {
      if (m[1] === 'id') cur.id = unquote(m[2]);
      else cur.name = unquote(m[2]);
    }
  }
  push();
  return out;
}

/** 删除某 id 的 patch 条目（卸载时用） */
export function removePatchEntry(entries: PatchEntry[], id: string): PatchEntry[] {
  return entries.filter((e) => e.id !== id);
}

/** 取某 id 是否禁用 */
export function isDisabled(entries: PatchEntry[], id: string): boolean {
  const hit = entries.find((e) => e.id === id);
  return !!(hit && hit.disabled);
}

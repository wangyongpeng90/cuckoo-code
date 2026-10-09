/**
 * DSH ctx.fs 的简化实现（C4-B）。
 *
 * DSH 的 FileSystem 是"沙箱化、带 target/version/observe"的大服务；
 * Cuckoo 简化为：resolve → { path, key }；readText/writeText/listDir/editText 直接操作文件。
 *
 * 依赖：仅 node:fs（infra 级），项目根由宿主注入。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 简化的 FsTarget：就是路径 + key */
interface FsTarget {
  path: string;
  key: string;
}

/**
 * 创建一个"简化 ctx.fs"。
 * @param getProjectDir - 取当前项目目录（相对路径的基准）
 * @param getTool - 取 Cuckoo 工具（可选，用 read/write 的真实现）
 */
function createFs(getProjectDir: () => string | null): any {
  function abs(p: string): string {
    if (path.isAbsolute(p)) return p;
    const base = getProjectDir();
    return base ? path.join(base, p) : path.resolve(p);
  }

  return {
    /** 解析路径 → target */
    async resolve(p: string, _opts?: any): Promise<FsTarget> {
      if (typeof p !== 'string' || !p) throw new Error('fs.resolve: path 必须是非空字符串');
      const a = abs(p);
      return { path: a, key: a };
    },

    /** 读文本 */
    async readText(target: FsTarget, _signal?: any): Promise<string> {
      return fs.readFileSync(target.path, 'utf-8');
    },

    /** 流式读（简化：一次性读后逐块 yield） */
    async streamText(target: FsTarget, _signal?: any): Promise<AsyncIterable<string>> {
      const text = fs.readFileSync(target.path, 'utf-8');
      return (async function* () { yield text; })();
    },

    /** 列目录 */
    async listDir(target: FsTarget, _signal?: any): Promise<any[]> {
      const entries = fs.readdirSync(target.path, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        target: { path: path.join(target.path, e.name), key: path.join(target.path, e.name) },
      }));
    },

    /** 写文本（无条件覆盖） */
    async writeText(target: FsTarget, content: string, _expected?: any, _signal?: any, _policy?: any): Promise<any> {
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
      fs.writeFileSync(target.path, String(content), 'utf-8');
      const st = fs.statSync(target.path);
      return { version: String(st.mtimeMs), bytes: st.size };
    },

    /** 文本替换编辑 */
    async editText(target: FsTarget, edit: any, _expected?: any, _signal?: any, _policy?: any): Promise<any> {
      const oldText = edit && (edit.oldText || edit.old_string || edit.search);
      const newText = (edit && (edit.newText ?? edit.new_string ?? edit.replace)) || '';
      if (typeof oldText !== 'string') throw new Error('fs.editText: 缺少 oldText');
      let cur = fs.readFileSync(target.path, 'utf-8');
      if (!cur.includes(oldText)) throw new Error('fs.editText: 未找到要替换的文本');
      cur = cur.replace(oldText, newText);
      fs.writeFileSync(target.path, cur, 'utf-8');
      const st = fs.statSync(target.path);
      return { version: String(st.mtimeMs) };
    },
  };
}

export { createFs };
export type { FsTarget };

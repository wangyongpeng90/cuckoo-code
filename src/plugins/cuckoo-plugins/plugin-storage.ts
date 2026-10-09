/**
 * DSH 插件存储（C5-A1，最小版）。
 *
 * DSH 把持久化做成独立层（session 只管内存 + storage 插件订阅 session/event 落盘）。
 * Cuckoo 简化：每个插件一个 JSONL 文件，事件流追加写入；加载时读回重放。
 *
 * 目录：~/.cuckoo/cuckoo-plugins-data/<plugin-id>/session.jsonl
 * 依赖：仅 node:fs（infra 级）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** 用户根目录（与 plugins 一致） */
function getUserDir(): string {
  const override = process.env.CUCKOO_HOME;
  return override ? override : path.join(os.homedir(), '.cuckoo');
}

/** 某插件的数据目录 */
function getPluginDataDir(pluginId: string): string {
  return path.join(getUserDir(), 'cuckoo-plugins-data', pluginId);
}

/** 某插件的事件流文件 */
function getEventLogFile(pluginId: string): string {
  return path.join(getPluginDataDir(pluginId), 'session.jsonl');
}

/**
 * 插件存储：把内存会话的事件流落盘（JSONL），并支持读回。
 */
class PluginStorage {
  readonly pluginId: string;
  private readonly file: string;

  constructor(pluginId: string) {
    this.pluginId = pluginId;
    this.file = getEventLogFile(pluginId);
  }

  /** 追加一条事件（JSONL） */
  append(event: { type: string; data: any }): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, JSON.stringify(event) + '\n', 'utf-8');
    } catch (err: any) {
      console.error('[DSH存储] ' + this.pluginId + ' 写入失败:', err && err.message);
    }
  }

  /** 读回所有事件（用于重放） */
  readAll(): Array<{ type: string; data: any }> {
    try {
      if (!fs.existsSync(this.file)) return [];
      const text = fs.readFileSync(this.file, 'utf-8');
      return text
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
        .filter((e) => e && typeof e.type === 'string');
    } catch (_) { return []; }
  }

  /** 清空（卸载/测试用） */
  clear(): void {
    try { if (fs.existsSync(this.file)) fs.unlinkSync(this.file); } catch (_) { /* ignore */ }
  }
}

export { PluginStorage, getPluginDataDir, getEventLogFile };

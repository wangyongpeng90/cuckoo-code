/**
 * DSH storageDomain 兼容层（C9）：插件持久化 KV 表。
 *
 * DSH 契约：
 *   const domain = await ctx.storageDomain.open({ name, version, tables: { t1: { valueSchema }, ... } })
 *   const t = domain.table("t1")
 *   t.get(key) / t.put(key, value) / t.delete(key) / t.entries() / t.keys()
 *   domain.close()
 *
 * 实现：每个 domain 一个 JSON 文件（~/.cuckoo/storage/<pluginId>/<domain>.json），
 * 每次写操作同步落盘（简单可靠，符合插件低频读写场景）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface DomainSpec {
  name: string;
  version?: number;
  tables?: Record<string, { valueSchema?: any }>;
}

interface TableApi {
  get(key: string): any;
  put(key: string, value: any): Promise<void>;
  delete(key: string): Promise<void>;
  entries(): Array<[string, any]>;
  keys(): string[];
}

interface DomainApi {
  name: string;
  table(name: string): TableApi;
  close(): void;
}

/** 存储根目录：~/.cuckoo/storage/<pluginId>/ */
function domainDir(pluginId: string): string {
  return path.join(os.homedir(), '.cuckoo', 'storage', pluginId);
}

/** 读整个 domain 文件（不存在返回 {}） */
function readDomainFile(file: string): Record<string, Record<string, any>> {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return {}; }
}

/** 写整个 domain 文件 */
function writeDomainFile(file: string, data: Record<string, Record<string, any>>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

/** 创建 storageDomain 服务（按插件隔离） */
export function createStorageDomain(pluginId: string): any {
  return {
    /** 打开一个 domain（读已有数据；返回值带 table(name)/close） */
    async open(spec: DomainSpec): Promise<DomainApi> {
      const name = String((spec && spec.name) || 'default');
      const file = path.join(domainDir(pluginId), name + '.json');
      let data = readDomainFile(file);
      if (spec && spec.tables) {
        for (const tname of Object.keys(spec.tables)) {
          if (!data[tname] || typeof data[tname] !== 'object') data[tname] = {};
        }
      }
      writeDomainFile(file, data);
      return {
        name,
        table(tname: string): TableApi {
          if (!data[tname]) data[tname] = {};
          return {
            get(key: string): any { return data[tname][String(key)]; },
            async put(key: string, value: any): Promise<void> {
              data[tname][String(key)] = value;
              writeDomainFile(file, data);
            },
            async delete(key: string): Promise<void> {
              delete data[tname][String(key)];
              writeDomainFile(file, data);
            },
            entries(): Array<[string, any]> { return Object.entries(data[tname]); },
            keys(): string[] { return Object.keys(data[tname]); },
          };
        },
        close(): void { /* 已同步落盘 */ },
      };
    },
  };
}

// （agentDefaultModel 已移至 llm-service.ts：需要"当前窗口"信息）

/** 创建 connection 兼容层（requestRejection：Host/Origin 检查） */
export function createConnection(): any {
  return {
    /** DSH 契约：返回拒绝状态码（403/401）或 undefined（放行）。⚠️ 必须是 undefined，不是 null！ */
    requestRejection(_req: any): number | undefined {
      // Cuckoo 的 webServer 已有自己的"壳令牌"校验，这里放行（不重复检查）
      return undefined;
    },
    /** 连接状态（默认已连接） */
    getSnapshot() { return { status: 'connected', online: true }; },
    subscribe(_cb: any) { return () => {}; },
  };
}

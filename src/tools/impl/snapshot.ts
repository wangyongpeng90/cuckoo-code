import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';

// ========== D12：API 契约元数据 ==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 19,
    category: '快照',
    name: 'createSnapshot',
    doc: '为当前项目创建一份工作快照（复制项目文件到用户目录存档）。在大范围改动、重构、批量编辑前调用，万一改坏可回滚。',
    params: 'name: string, description?: string',
    returns: 'Promise<{ id: string, fileCount: number, message: string }>',
    paramDocs: {
      name: '快照名（简短，如"重构前"）',
      description: '可选描述',
    },
    returnsDoc: '{ id, fileCount, message }',
    throws: '项目目录未初始化、名为空或复制失败时抛出异常',
  },
  {
    order: 20,
    category: '快照',
    name: 'listSnapshots',
    doc: '列出当前项目的所有工作快照（含 id、名称、文件数、创建时间），用于选择要恢复的快照。',
    params: '',
    returns: 'Promise<string>',
    returnsDoc: '快照列表文本',
    throws: '无',
  },
  {
    order: 21,
    category: '快照',
    name: 'restoreSnapshot',
    doc: '把指定快照的文件恢复到当前项目目录（覆盖同名文件）。属破坏性操作，执行前应先向用户确认。',
    params: 'id: string',
    returns: 'Promise<{ restored: number, message: string }>',
    paramDocs: {
      id: '要恢复的快照 id（来自 listSnapshots 或 createSnapshot）',
    },
    returnsDoc: '{ restored, message }',
    throws: '快照不存在、原项目目录丢失或复制失败时抛出异常',
  },
];

/** 快照存储接口（由 app 层注入） */
export interface SnapshotStore {
  create: (projectDir: string, name: string, description?: string) => { id: string; fileCount: number; projectDir: string };
  list: (projectDir: string) => Array<{ id: string; name: string; description: string; fileCount: number; createdAt: number; projectDir: string }>;
  restore: (id: string) => { restored: number; projectDir: string };
}

let _store: SnapshotStore | null = null;

/** 由 app 层注入 */
export function injectSnapshotStore(store: SnapshotStore): void {
  _store = store;
}

class CreateSnapshotTool extends Tool {
  constructor() {
    super(
      'createSnapshot',
      '为当前项目创建一份工作快照，便于改坏后回滚。',
      {
        type: 'object',
        properties: {
          name: { type: 'string', description: '快照名（简短）' },
          description: { type: 'string', description: '可选描述' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      'createSnapshot(name, description?)'
    );
  }

  getPromptSection() {
    return {
      name: 'tool:createSnapshot',
      order: 116,
      text: [
        '**工作快照**：在执行**大范围改动、重构、批量编辑**之前，先存一份快照（如"重构前"），万一改坏可用 restoreSnapshot(id) 回滚。',
        '两种存法：① 调用 createSnapshot(name)（推荐，正文干净）；② 在回复里**单独一行**输出 `[快照]名称`（更轻，软件会自动捕获；注意标记会留在对话正文里）。标记必须在行首单独成行。',
        '小改动无需快照。快照会排除 .git/node_modules 等产物目录。',
      ].join('\n'),
    };
  }

  async execute(params: any): Promise<ToolResult> {
    const projectDir = params.projectDir;
    if (!projectDir) return ToolResult.error('项目目录未初始化');
    if (!_store) return ToolResult.error('快照存储未初始化');
    const name = String(params.name || '').trim();
    if (!name) return ToolResult.error('快照名不能为空');
    try {
      const r = _store.create(projectDir, name, params.description || '');
      return ToolResult.success({ id: r.id, fileCount: r.fileCount, message: '已创建快照「' + name + '」（' + r.fileCount + ' 个文件），id=' + r.id });
    } catch (err: any) {
      return ToolResult.error('创建快照失败: ' + err.message);
    }
  }
}

class ListSnapshotsTool extends Tool {
  constructor() {
    super(
      'listSnapshots',
      '列出当前项目的所有工作快照。',
      { type: 'object', properties: {}, additionalProperties: false },
      'listSnapshots()'
    );
  }

  async execute(params: any): Promise<ToolResult> {
    if (!_store) return ToolResult.error('快照存储未初始化');
    try {
      const list = _store.list(params.projectDir || '');
      if (!list.length) return ToolResult.success('当前项目暂无快照。');
      const lines = list.map((s) => {
        const d = new Date(s.createdAt).toLocaleString('zh-CN');
        return '- ' + s.id + ' | ' + s.name + ' | ' + s.fileCount + ' 个文件 | ' + d + (s.description ? ' | ' + s.description : '');
      });
      return ToolResult.success('共 ' + list.length + ' 个快照：\n' + lines.join('\n'));
    } catch (err: any) {
      return ToolResult.error('列出快照失败: ' + err.message);
    }
  }
}

class RestoreSnapshotTool extends Tool {
  constructor() {
    super(
      'restoreSnapshot',
      '把指定快照的文件恢复到当前项目目录（覆盖同名文件）。破坏性操作。',
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要恢复的快照 id' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      'restoreSnapshot(id)'
    );
  }

  async execute(params: any): Promise<ToolResult> {
    if (!_store) return ToolResult.error('快照存储未初始化');
    const id = String(params.id || '').trim();
    if (!id) return ToolResult.error('id 为空');
    try {
      const r = _store.restore(id);
      return ToolResult.success({ restored: r.restored, message: '已从快照 ' + id + ' 恢复 ' + r.restored + ' 个文件到 ' + r.projectDir });
    } catch (err: any) {
      return ToolResult.error('恢复快照失败: ' + err.message);
    }
  }
}

/** JsRunner 沙箱注入 */
export function bootstrap(__call: any): void {
  (globalThis as any).createSnapshot = async function (name: any, description: any) {
    return await __call('createSnapshot', { name: name, description: description });
  };
  (globalThis as any).listSnapshots = async function () {
    return await __call('listSnapshots', {});
  };
  (globalThis as any).restoreSnapshot = async function (id: any) {
    return await __call('restoreSnapshot', { id: id });
  };
}

export { CreateSnapshotTool, ListSnapshotsTool, RestoreSnapshotTool };

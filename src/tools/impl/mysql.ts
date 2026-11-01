import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';
import mysql from 'mysql2/promise';

// ========== D12：API 契约元数据（构建期生成 api.d.ts）==========
export const apiMetas: ToolApiMeta[] = [
  {
    order: 11,
    category: 'MySQL',
    name: 'mysql',
    usage: '使用 mysql 工具执行 MySQL SQL 语句。传入 host/port/user/password/database 和 sql。SELECT/SHOW/DESCRIBE/EXPLAIN 返回纯文本表格，写操作返回 affectedRows。',
    types: [
      '/** MySQL 连接与查询参数 */',
      'interface MySQLOptions {',
      '  /** MySQL 主机地址，默认 localhost */',
      '  host?: string;',
      '  /** MySQL 端口，默认 3306 */',
      '  port?: number;',
      '  /** 用户名 */',
      '  user: string;',
      '  /** 密码 */',
      '  password?: string;',
      '  /** 数据库名 */',
      '  database: string;',
      '  /** 要执行的 SQL 语句 */',
      '  sql: string;',
      '  /** SELECT 返回行数上限，默认 100，最大 1000 */',
      '  limit?: number;',
      '}',
    ].join('\n'),
    doc: [
      '执行 MySQL SQL 语句。',
      'SELECT/SHOW/DESCRIBE/EXPLAIN 等查询返回纯文本表格；',
      'INSERT/UPDATE/DELETE/DDL 返回 affectedRows 等执行统计。',
    ].join('\n'),
    params: 'options: MySQLOptions',
    returns: 'Promise<string>',
    paramDocs: {
      options: '连接参数 + sql',
    },
    returnsDoc: '纯文本表格（查询）或执行统计（写操作）',
    throws: '连接失败、SQL 错误时抛出异常',
  },
];

/**
 * MySQL 工具 - 执行 SQL 查询或写操作。
 * AI 直接传完整连接参数（host/port/user/password/database）+ SQL。
 * 返回纯文本表格（SELECT）或执行统计（INSERT/UPDATE/DELETE/DDL）。
 */
class MySQLTool extends Tool {
  constructor() {
    super(
      'mysql',
      '执行 MySQL SQL 语句。传入连接参数（host/port/user/password/database）和 sql。SELECT/SHOW/DESCRIBE/EXPLAIN 返回纯文本表格，写操作返回 affectedRows。',
      {
        type: 'object',
        properties: {
          host: { type: 'string', description: 'MySQL 主机地址，默认 localhost' },
          port: { type: 'number', description: 'MySQL 端口，默认 3306' },
          user: { type: 'string', description: '用户名' },
          password: { type: 'string', description: '密码' },
          database: { type: 'string', description: '数据库名' },
          sql: { type: 'string', description: '要执行的 SQL 语句' },
          limit: { type: 'number', description: 'SELECT 返回行数上限，默认 100，最大 1000' }
        },
        required: ['user', 'database', 'sql'],
        additionalProperties: false
      },
      'mysql(options)'
    );
  }

  async execute(params: any): Promise<ToolResult> {
    const {
      host = 'localhost',
      port = 3306,
      user,
      password = '',
      database,
      sql,
      limit = 100
    } = params;

    try {
      if (!user || typeof user !== 'string') {
        return ToolResult.error('user 不能为空');
      }
      if (!database || typeof database !== 'string') {
        return ToolResult.error('database 不能为空');
      }
      if (!sql || typeof sql !== 'string') {
        return ToolResult.error('sql 不能为空');
      }

      const safeLimit = Math.min(Math.max(1, limit || 100), 1000);
      const startTime = Date.now();

      const connection = await mysql.createConnection({
        host,
        port: Number(port) || 3306,
        user,
        password,
        database,
        connectTimeout: 10000
      });

      try {
        const trimmedSql = sql.trim();

        // 判断是否查询类语句
        const isQuery = /^(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i.test(trimmedSql);
        // 只有 SELECT 才自动加 LIMIT；SHOW/DESCRIBE/EXPLAIN 不支持 LIMIT
        const isSelect = /^SELECT\b/i.test(trimmedSql);

        if (isQuery) {
          let finalSql = trimmedSql;
          if (isSelect && !/\bLIMIT\b/i.test(finalSql)) {
            finalSql = finalSql.replace(/;?\s*$/, '') + ' LIMIT ' + safeLimit;
          }

          const [rows, fields] = await connection.query(finalSql);

          const elapsed = Date.now() - startTime;
          const actualRows = Array.isArray(rows) ? rows.length : 0;

          // 渲染表格
          let output = '# 查询成功（rows=' + actualRows + ', elapsed=' + elapsed + 'ms）\n\n';

          if (actualRows === 0) {
            output += '(no rows)';
          } else {
            const columns = Array.isArray(fields) ? fields.map((f: any) => f.name) : Object.keys((rows as any)[0]);
            output += renderTable(columns, rows as any[]);
          }

          return ToolResult.success(output);
        } else {
          // 写操作或 DDL
          const [result] = await connection.query(trimmedSql);

          const elapsed = Date.now() - startTime;
          const affectedRows = (result as any).affectedRows || 0;
          const insertId = (result as any).insertId || 0;
          const changedRows = (result as any).changedRows !== undefined ? (result as any).changedRows : affectedRows;

          let output = '# 执行成功（affectedRows=' + affectedRows + ', elapsed=' + elapsed + 'ms）';
          if (insertId > 0) {
            output += '\ninsertId: ' + insertId;
          }
          if (changedRows !== affectedRows) {
            output += '\nchangedRows: ' + changedRows;
          }

          return ToolResult.success(output);
        }
      } finally {
        await connection.end().catch(() => {});
      }
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      return ToolResult.error('MySQL 执行失败: ' + msg);
    }
  }
}

/**
 * 渲染纯文本表格
 */
function extractErrorMessage(err: any): string {
  if (!err) return '未知错误';
  if (err.errors && Array.isArray(err.errors) && err.errors.length > 0) {
    return err.errors.map((e: any) => e.message || String(e)).join('; ');
  }
  if (err.code && err.message) {
    return err.code + ': ' + err.message;
  }
  return err.message || String(err);
}

function renderTable(columns: string[], rows: any[]): string {
  const header = columns.map(String);
  const lines: string[] = [];
  lines.push('| ' + header.join(' | ') + ' |');
  lines.push('|' + header.map(() => '---').join('|') + '|');

  for (const row of rows) {
    const values = columns.map(col => {
      const v = row[col];
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    });
    lines.push('| ' + values.join(' | ') + ' |');
  }

  return lines.join('\n');
}

/** JsRunner 沙箱注入：定义 globalThis.mysql。 */
export function bootstrap(__call: any): void {
  (globalThis as any).mysql = async function (options: any) {
    options = options || {};
    return await __call('mysql', options);
  };
}

export { MySQLTool, renderTable };

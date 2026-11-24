/**
 * [261109-8ms69z-cuko-api] Cuko API IPC 处理器（整合 Provider、Session、工具执行）
 * 此文件属于 Cuko API 独立工作窗口需求，详细设计见：
 * docs/requirements/261109-8ms69z-cuko-api.md
 */

/**
 * Cuko API 独立窗口的 IPC 处理器。
 * 采用 Provider / Model 分离结构（类似 DSH 的工业级设计）。
 */
import { createRequire } from 'node:module';
import { searchPlugins, createElectronHttpGet } from '../../plugins/index.js';
import { buildPrompt } from '../../session/prompt-builder.js';
import { jsRunner } from '../../tools/index.js';
import { pickJsResultPhrase } from '../../overlay/js-result-phrases.js';
import { nowLocalIso } from '../../infra/time.js';
import { splitPromptByH1 } from '../cuko-run-protocol.js';
import { normalizeProtocol, joinApiUrl, parseJsonObjectParam, parseModelList, guessProtocolFromModelList, listedToApiMeta, effectiveModelMeta, resolveEffortAfterSwitch } from '../cuko-openai.js';
import type { ProtocolGuess } from '../cuko-openai.js';
import type { ListedModel } from '../cuko-openai.js';
import { getEncryptionStatus, encryptSecret, decryptSecret, isEncryptedSecret, readProviderSecret, maskSecret, migratePlaintextSecrets } from '../secrets.js';
import {
  startCukoRun,
  cancelCukoRun,
  cancelAllCukoRuns,
  listCukoRuns,
  subscribeCukoRuns,
  switchModelWithHistory,
  continueAfterSwitch,
  listCukoRequestLogs,
  getCukoRequestLogRaw,
  clearCukoRequestLogs,
} from '../cuko-runner.js';
const require = createRequire(import.meta.url);
const { ipcMain } = require('electron');

function getDb() {
  return (global as any).__globalDb;
}


// ================= [261123-q4h7tn-cuko-openai] Provider / 模型目录辅助 =================

function parseMetaText(text: unknown): any {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** 只保留有值的字段；空对象返回 null */
function cleanMeta(v: any): any {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, any> = {};
  for (const k of Object.keys(v)) {
    if (v[k] !== undefined && v[k] !== null && v[k] !== '') out[k] = v[k];
  }
  return Object.keys(out).length ? out : null;
}

function displayName(m: any, apiMeta: any, userMeta: any): string {
  return String((userMeta && userMeta.name) || (apiMeta && apiMeta.name) || m.name || m.id || '');
}

/** cuko_models 行 → 界面用的模型（id / name 保持旧字段，模型选择器不受影响） */
function modelRowToUi(m: any): any {
  const apiMeta = parseMetaText(m.api_meta) || {};
  const userMeta = parseMetaText(m.user_meta) || {};
  return {
    id: m.model_id,
    name: displayName({ name: m.name, id: m.model_id }, apiMeta, userMeta),
    apiMeta,
    userMeta,
    source: m.source === 'manual' ? 'manual' : 'api',
    listed: m.listed !== 0,
    meta: effectiveModelMeta(apiMeta, userMeta),
  };
}

/**
 * 请求 GET {baseUrl}/v1/models（地址末尾已有 /v1 时不重复），解析标准字段 + 扩展字段。
 * 顺带推断协议（只用于界面提示，猜错不影响任何配置）。
 */
async function requestModelList(baseUrl: string, apiKey: string | null): Promise<{ listed: ListedModel[]; protocolGuess: ProtocolGuess }> {
  const httpGet = createElectronHttpGet();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
  const res = await httpGet({ url: joinApiUrl(baseUrl, '/v1/models'), headers });
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  const text = res.body ? res.body.toString('utf-8') : '';
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('返回的不是 JSON');
  }
  return { listed: parseModelList(json), protocolGuess: guessProtocolFromModelList(json) };
}

/** 刷新：只更新接口信息；接口没返回的标 listed=0，不删除，不碰用户修改 */
function mergeListedModels(db: any, providerId: string, listed: ListedModel[]): void {
  const now = nowLocalIso();
  db.exec('BEGIN');
  try {
    const upsert = db.prepare('INSERT INTO cuko_models (provider_id, model_id, name, api_meta, source, listed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(provider_id, model_id) DO UPDATE SET api_meta = excluded.api_meta, listed = 1, updated_at = excluded.updated_at');
    const ids = new Set<string>();
    for (const m of listed) {
      ids.add(m.id);
      const apiMeta = cleanMeta(listedToApiMeta(m));
      upsert.run(providerId, m.id, m.name || m.id, apiMeta ? JSON.stringify(apiMeta) : null, 'api', now, now);
    }
    const rows = db.prepare('SELECT model_id FROM cuko_models WHERE provider_id = ?').all(providerId) as any[];
    const mark = db.prepare('UPDATE cuko_models SET listed = 0, updated_at = ? WHERE provider_id = ? AND model_id = ?');
    for (const r of rows) {
      if (!ids.has(r.model_id)) mark.run(now, providerId, r.model_id);
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

/** 表单里「获取可用模型」：已有模型保留用户修改、更新接口信息；新模型追加；接口没返回的标 listed=false（不写库） */
function mergeFetchedForForm(current: any[], listed: ListedModel[]): any[] {
  const byId = new Map<string, ListedModel>();
  for (const m of listed) byId.set(m.id, m);
  const out: any[] = [];
  const seen = new Set<string>();
  for (const m of current) {
    if (!m || typeof m.id !== 'string' || !m.id) continue;
    seen.add(m.id);
    const hit = byId.get(m.id);
    if (hit) out.push({ ...m, apiMeta: cleanMeta(listedToApiMeta(hit)) || {}, listed: true });
    else out.push({ ...m, listed: m.source === 'manual' ? m.listed !== false : false });
  }
  for (const l of listed) {
    if (!seen.has(l.id)) out.push({ id: l.id, name: l.name || l.id, apiMeta: cleanMeta(listedToApiMeta(l)) || {}, userMeta: {}, source: 'api', listed: true });
  }
  return out.map((m) => {
    const apiMeta = m.apiMeta || {};
    const userMeta = m.userMeta || {};
    return { ...m, apiMeta, userMeta, name: displayName(m, apiMeta, userMeta), meta: effectiveModelMeta(apiMeta, userMeta) };
  });
}

export function registerCukoIpc(): void {
  // ====== 市场 ======
  ipcMain.handle('cuko:market-list', async (_event: any, topic: string) => {
    try {
      const httpGet = createElectronHttpGet();
      const r = await searchPlugins({ httpGet, topic: topic || 'cuko-api', force: true });
      return { success: r.success, items: r.items, error: r.error };
    } catch (e: any) { return { success: false, items: [], error: e.message }; }
  });

  // ====== 杂项配置（保留） ======
  ipcMain.handle('cuko:get-config', () => {
    const db = getDb();
    if (!db) return {};
    try {
      const rows = db.prepare('SELECT key, value FROM cuko_config').all() as Array<{ key: string; value: string }>;
      const config: Record<string, string> = {};
      for (const row of rows) config[row.key] = row.value;
      return config;
    } catch { return {}; }
  });

  ipcMain.handle('cuko:save-config', (_event: any, config: Record<string, string>) => {
    const db = getDb();
    if (!db) return { success: false, error: 'Database unavailable' };
    try {
      const stmt = db.prepare('INSERT OR REPLACE INTO cuko_config (key, value) VALUES (?, ?)');
      for (const [key, value] of Object.entries(config)) stmt.run(key, String(value));
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  // ====== Provider 管理 ======
  // [261123-q4h7tn-cuko-openai] 协议 / 额外参数 / 模型设置；模型合并写入，刷新不删模型、不覆盖用户修改
  // [261123-q4h7tn-cuko-openai] 密钥一律不出主进程：这里只返回「是否已设置」与掩码，
  // 不再把 api_key 原文送到渲染进程（渲染进程加载插件 / Markdown，攻击面比主进程大得多）
  ipcMain.handle('cuko:list-providers', async () => {
    const db = getDb();
    if (!db) return [];
    try {
      const rows = db.prepare('SELECT * FROM cuko_providers').all() as any[];
      const out: any[] = [];
      for (const p of rows) {
        const models = db.prepare('SELECT * FROM cuko_models WHERE provider_id = ? ORDER BY rowid ASC').all(p.id) as any[];
        // 掩码需要解密后取后 4 位；解不开（换机器 / 密钥环变了）就当已设置但显示不可读
        let masked = '';
        let readable = true;
        if (p.api_key) {
          try {
            masked = maskSecret(await decryptSecret(p.api_key));
          } catch {
            readable = false;
            masked = '（无法解密）';
          }
        }
        out.push({
          id: p.id,
          name: p.name,
          baseUrl: p.base_url,
          // 不返回明文；界面据 apiKeySet 判断要不要显示「已设置」
          apiKeySet: !!p.api_key,
          apiKeyMask: masked,
          apiKeyReadable: readable,
          protocol: normalizeProtocol(p.protocol),
          extraParams: p.extra_params || '',
          reasoningField: p.reasoning_field || '',
          disableReasoningParams: p.disable_reasoning_params || '',
          models: models.map(modelRowToUi),
        });
      }
      return out;
    } catch { return []; }
  });

  ipcMain.handle('cuko:save-provider', async (_event: any, provider: any) => {
    const db = getDb();
    if (!db) return { success: false, error: 'Database unavailable' };
    if (!provider || !provider.id) return { success: false, error: '缺少 Provider ID' };
    const protocol = normalizeProtocol(provider.protocol);
    const extraText = String(provider.extraParams || '').trim();
    const disableText = String(provider.disableReasoningParams || '').trim();
    const fieldText = String(provider.reasoningField || '').trim();
    const extra = parseJsonObjectParam(extraText);
    if (!extra.ok) return { success: false, error: '额外请求参数：' + extra.error };
    const disable = parseJsonObjectParam(disableText);
    if (!disable.ok) return { success: false, error: '关闭思考参数：' + disable.error };
    const models: any[] | null = Array.isArray(provider.models)
      ? provider.models.filter((m: any) => m && typeof m.id === 'string' && m.id.trim())
      : null;
    if (models) {
      const ids = new Set<string>();
      for (const m of models) {
        const id = m.id.trim();
        if (ids.has(id)) return { success: false, error: '模型 ID 重复：' + id };
        ids.add(id);
      }
    }
    const now = nowLocalIso();
    // [261123-q4h7tn-cuko-openai] 密钥语义：
    //   apiKey 字段缺省 / null → 不修改（界面不再回显明文，编辑时不填就保持原密钥）
    //   apiKey 为空串          → 清除密钥
    //   其它                   → 加密后入库
    const rawKey = provider.apiKey;
    let storedKey: string | null | undefined; // undefined = 不改
    if (rawKey === undefined || rawKey === null) {
      storedKey = undefined;
    } else if (String(rawKey).trim() === '') {
      storedKey = null;
    } else {
      try {
        storedKey = await encryptSecret(String(rawKey));
      } catch (err: any) {
        // 加密不可用（如 Linux 无密钥环）：拒绝保存，绝不静默存明文
        return { success: false, error: '无法加密保存 API 密钥：' + String((err && err.message) || err) };
      }
    }
    try {
      db.exec('BEGIN');
      const existing = db.prepare('SELECT id FROM cuko_providers WHERE id = ?').get(provider.id);
      if (existing) {
        if (storedKey === undefined) {
          db.prepare('UPDATE cuko_providers SET name = ?, base_url = ?, protocol = ?, extra_params = ?, reasoning_field = ?, disable_reasoning_params = ?, updated_at = ? WHERE id = ?')
            .run(provider.name, provider.baseUrl, protocol, extraText || null, fieldText || null, disableText || null, now, provider.id);
        } else {
          db.prepare('UPDATE cuko_providers SET name = ?, base_url = ?, api_key = ?, protocol = ?, extra_params = ?, reasoning_field = ?, disable_reasoning_params = ?, updated_at = ? WHERE id = ?')
            .run(provider.name, provider.baseUrl, storedKey, protocol, extraText || null, fieldText || null, disableText || null, now, provider.id);
        }
      } else {
        db.prepare('INSERT INTO cuko_providers (id, name, base_url, api_key, protocol, extra_params, reasoning_field, disable_reasoning_params, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(provider.id, provider.name, provider.baseUrl, storedKey === undefined ? null : storedKey, protocol, extraText || null, fieldText || null, disableText || null, now, now);
      }
      if (models) {
        const keep = new Set<string>();
        const upsert = db.prepare('INSERT INTO cuko_models (provider_id, model_id, name, api_meta, user_meta, source, listed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(provider_id, model_id) DO UPDATE SET name = excluded.name, api_meta = excluded.api_meta, user_meta = excluded.user_meta, source = excluded.source, listed = excluded.listed, updated_at = excluded.updated_at');
        for (const m of models) {
          const id = m.id.trim();
          keep.add(id);
          const apiMeta = cleanMeta(m.apiMeta);
          const userMeta = cleanMeta(m.userMeta);
          upsert.run(provider.id, id, displayName({ name: m.name, id }, apiMeta, userMeta), apiMeta ? JSON.stringify(apiMeta) : null, userMeta ? JSON.stringify(userMeta) : null, m.source === 'manual' ? 'manual' : 'api', m.listed === false ? 0 : 1, now, now);
        }
        // 表单里删掉的模型，库里也删掉
        const rows = db.prepare('SELECT model_id FROM cuko_models WHERE provider_id = ?').all(provider.id) as any[];
        const del = db.prepare('DELETE FROM cuko_models WHERE provider_id = ? AND model_id = ?');
        for (const r of rows) {
          if (!keep.has(r.model_id)) del.run(provider.id, r.model_id);
        }
      }
      db.exec('COMMIT');
      return { success: true, ignoredKeys: [...extra.ignoredKeys, ...disable.ignoredKeys] };
    } catch (err: any) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      console.error('[cuko:save-provider]', err);
      return { success: false, error: err.message };
    }
  });

  // 侧边栏「刷新模型」：逐个 Provider 请求模型列表，只更新接口信息
  ipcMain.handle('cuko:refresh-models', async () => {
    const db = getDb();
    if (!db) return { success: false, error: 'Database unavailable' };
    try {
      const providers = db.prepare('SELECT * FROM cuko_providers').all() as any[];
      const errors: string[] = [];
      await Promise.all(providers.map(async (p: any) => {
        try {
          // [261123-q4h7tn-cuko-openai] 密钥在库里是密文，用前先解密
          let key: string | null = null;
          if (p.api_key) {
            try {
              key = (await decryptSecret(p.api_key)) || null;
            } catch (err: any) {
              errors.push(p.name + ': 无法解密密钥（' + String((err && err.message) || err) + '）');
              return;
            }
          }
          const fetched = await requestModelList(p.base_url, key);
          mergeListedModels(db, p.id, fetched.listed);
        } catch (err: any) {
          errors.push(p.name + ': ' + (err?.message || String(err)));
        }
      }));
      return { success: true, errors };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 表单里「获取可用模型」：按表单填的地址 / 密钥请求（Provider 未保存也能用），返回合并后的列表，不写库
  ipcMain.handle('cuko:fetch-models', async (_event: any, params: any) => {
    try {
      // [261123-q4h7tn-cuko-openai] 密钥来源优先级：表单里新填的 > 库里已存的（界面不再回显明文）
      let key: string | null = params?.apiKey ? String(params.apiKey) : null;
      const providerId = params?.providerId ? String(params.providerId) : '';
      if (!key && providerId) {
        const db = getDb();
        if (db) {
          try {
            key = (await readProviderSecret(db, providerId)) || null;
          } catch (err: any) {
            return { success: false, error: '无法解密已保存的 API 密钥：' + String((err && err.message) || err) };
          }
        }
      }
      const fetched = await requestModelList(String(params?.baseUrl || ''), key);
      const current: any[] = Array.isArray(params?.models) ? params.models : [];
      // protocolGuess 只给界面提示用（'openai' / 'cuko' / null = 判断不了）
      return { success: true, count: fetched.listed.length, models: mergeFetchedForForm(current, fetched.listed), protocolGuess: fetched.protocolGuess };
    } catch (err: any) {
      return { success: false, error: err?.message || '获取失败' };
    }
  });

  // [261123-q4h7tn-cuko-openai] 系统加密是否可用（设置页据此提示「本机无法安全保存密钥」）
  ipcMain.handle('cuko:get-encryption-status', async () => {
    try {
      return { success: true, ...(await getEncryptionStatus()) };
    } catch (err: any) {
      return { success: false, error: String((err && err.message) || err) };
    }
  });

  // [261123-q4h7tn-cuko-openai] 把库里已有的明文密钥迁移成密文（幂等；加密不可用时跳过）
  ipcMain.handle('cuko:migrate-secrets', async () => {
    const db = getDb();
    if (!db) return { success: false, error: 'Database unavailable' };
    try {
      const res = await migratePlaintextSecrets(db);
      return { success: true, ...res };
    } catch (err: any) {
      return { success: false, error: String((err && err.message) || err) };
    }
  });

  ipcMain.handle('cuko:delete-provider', (_event: any, id: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      db.prepare('DELETE FROM cuko_providers WHERE id = ?').run(id);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  // ====== 当前激活状态 ======
  ipcMain.handle('cuko:get-active', () => {
    const db = getDb();
    if (!db) return {};
    try {
      const rows = db.prepare("SELECT key, value FROM cuko_config WHERE key IN ('active_provider', 'active_model')").all() as any[];
      const res: Record<string, string> = {};
      for (const r of rows) res[r.key] = r.value;
      return { providerId: res.active_provider, modelId: res.active_model };
    } catch { return {}; }
  });

  ipcMain.handle('cuko:set-active', (_event: any, providerId: string, modelId: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      const stmt = db.prepare('INSERT OR REPLACE INTO cuko_config (key, value) VALUES (?, ?)');
      stmt.run('active_provider', providerId);
      stmt.run('active_model', modelId);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  // ====== 会话管理 ======
  ipcMain.handle('cuko:list-sessions', () => {
    const db = getDb();
    if (!db) return [];
    return db.prepare('SELECT * FROM cuko_sessions ORDER BY updated_at DESC').all();
  });

  // 首轮注入的系统提示词（留档在 cuko_sessions.system_prompt）
  ipcMain.handle('cuko:get-system-prompt', (_event: any, sessionId: string) => {
    const db = getDb();
    if (!db) return { success: false, error: '数据库未就绪' };
    try {
      const row = db.prepare('SELECT system_prompt FROM cuko_sessions WHERE id = ?').get(sessionId) as any;
      return { success: true, prompt: (row && row.system_prompt) || '' };
    } catch (err: any) {
      return { success: false, error: err?.message || '读取失败' };
    }
  });

  ipcMain.handle('cuko:create-session', (_event: any, sessionId: string, providerId?: string, modelId?: string, projectDir?: string) => {
    const db = getDb();
    if (!db) return { success: false };
    const now = nowLocalIso();
    db.prepare('INSERT INTO cuko_sessions (id, title, provider_id, model_id, project_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sessionId, 'New Chat', providerId || null, modelId || null, projectDir || null, now, now);
    return { success: true };
  });

  ipcMain.handle('cuko:rename-session', (_event: any, sessionId: string, title: string) => {
    const db = getDb();
    if (!db) return { success: false };
    const now = nowLocalIso();
    db.prepare('UPDATE cuko_sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, now, sessionId);
    return { success: true };
  });

  // 执行 cuckoo 代码块（复用主项目 JsRunner，projectDir 由调用方传入）
  ipcMain.handle('cuko:execute-js', async (event: any, code: string, projectDir: string) => {
    if (!code || typeof code !== 'string') {
      return { success: false, error: '无效的 JS 代码' };
    }
    try {
      const win = require('electron').BrowserWindow.fromWebContents(event.sender);
      const windowId = win && !win.isDestroyed() ? win.id : null;
      const result = await jsRunner.run(code, projectDir || null, windowId, {});
      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 从工具结果回复语池随机取一条
  ipcMain.handle('cuko:pick-result-phrase', (_event: any, n: number) => {
    try {
      return { success: true, phrase: pickJsResultPhrase(n || 1) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 组装完整系统提示词并按一级标题切分成段
  ipcMain.handle('cuko:build-system-prompt', (_event: any, projectDir: string) => {
    try {
      if (!projectDir) return { success: true, segments: [] };
      const built = buildPrompt({ providerId: 'cuko', selectedDir: projectDir });
      if (built.error) return { success: false, error: built.error };
      const segments = splitPromptByH1(built.prompt);
      return { success: true, segments };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ====== 工作区管理 ======
  ipcMain.handle('cuko:list-workspaces', () => {
    const db = getDb();
    if (!db) return [];
    try {
      return db.prepare('SELECT path, name, COALESCE(archived, 0) AS archived FROM cuko_workspaces ORDER BY created_at ASC').all();
    } catch { return []; }
  });

  ipcMain.handle('cuko:add-workspace', (_event: any, path: string, name: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      db.prepare('INSERT OR IGNORE INTO cuko_workspaces (path, name, created_at) VALUES (?, ?, ?)').run(path, name, nowLocalIso());
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:open-workspace-folder', async (_event: any, path: string) => {
    try {
      const err = await require('electron').shell.openPath(path);
      if (err) return { success: false, error: err };
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:rename-workspace', (_event: any, path: string, name: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      db.prepare('UPDATE cuko_workspaces SET name = ? WHERE path = ?').run(name, path);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:get-active-workspace', () => {
    const db = getDb();
    if (!db) return null;
    try {
      const row = db.prepare("SELECT value FROM cuko_config WHERE key = 'active_workspace'").get() as any;
      return row ? row.value : null;
    } catch { return null; }
  });

  ipcMain.handle('cuko:set-active-workspace', (_event: any, path: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      db.prepare('INSERT OR REPLACE INTO cuko_config (key, value) VALUES (?, ?)').run('active_workspace', path);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:select-directory', async (event: any) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    const result = require('electron').dialog.showOpenDialogSync(win, {
      properties: ['openDirectory'],
      title: '选择工作区目录',
      buttonLabel: '选择',
    });
    if (!result || result.length === 0) return { success: false, canceled: true };
    return { success: true, dir: result[0] };
  });

  ipcMain.handle('cuko:delete-session', (_event: any, sessionId: string) => {
    const db = getDb();
    if (!db) return { success: false };
    // 正在后台跑的会话先停掉，避免删完还在往库里写
    cancelCukoRun(sessionId);
    db.prepare('DELETE FROM cuko_sessions WHERE id = ?').run(sessionId);
    return { success: true };
  });

  ipcMain.handle('cuko:update-session-model', (_event: any, sessionId: string, providerId: string, modelId: string) => {
    const db = getDb();
    if (!db) return { success: false };
    const now = nowLocalIso();
    // [261123-q4h7tn-cuko-openai] 思考强度：新模型有同名档位就沿用，否则用新模型的默认档位（与 switchModelWithHistory 一致）
    let effort: string | null = null;
    try {
      const session = db.prepare('SELECT reasoning_effort FROM cuko_sessions WHERE id = ?').get(sessionId) as any;
      const model = db.prepare('SELECT api_meta, user_meta FROM cuko_models WHERE provider_id = ? AND model_id = ?').get(providerId, modelId) as any;
      const meta = effectiveModelMeta(parseMetaText(model && model.api_meta), parseMetaText(model && model.user_meta));
      effort = resolveEffortAfterSwitch((session && session.reasoning_effort) || null, meta) ?? null;
    } catch (err: any) {
      console.error('[Cuko] 读取模型档位失败:', (err && err.message) || err);
    }
    db.prepare('UPDATE cuko_sessions SET provider_id = ?, model_id = ?, reasoning_effort = ?, updated_at = ? WHERE id = ?').run(providerId, modelId, effort, now, sessionId);
    return { success: true, reasoningEffort: effort };
  });

  // [261123-q4h7tn-cuko-openai] 保存会话的推理等级（下一次请求生效；不改 updated_at，避免会话列表重新排序）
  ipcMain.handle('cuko:update-session-effort', (_event: any, sessionId: string, effort: string | null) => {
    const db = getDb();
    if (!db) return { success: false, error: '数据库未就绪' };
    try {
      const value = typeof effort === 'string' && effort.trim() ? effort.trim() : null;
      db.prepare('UPDATE cuko_sessions SET reasoning_effort = ? WHERE id = ?').run(value, sessionId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: (err && err.message) || '保存失败' };
    }
  });

  ipcMain.handle('cuko:archive-session', (_event: any, sessionId: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      db.prepare('UPDATE cuko_sessions SET archived = 1, updated_at = ? WHERE id = ?').run(nowLocalIso(), sessionId);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:unarchive-session', (_event: any, sessionId: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      db.prepare('UPDATE cuko_sessions SET archived = 0, updated_at = ? WHERE id = ?').run(nowLocalIso(), sessionId);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:archive-workspace', (_event: any, path: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      db.prepare('UPDATE cuko_workspaces SET archived = 1 WHERE path = ?').run(path);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:unarchive-workspace', (_event: any, path: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      db.prepare('UPDATE cuko_workspaces SET archived = 0 WHERE path = ?').run(path);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:update-session-project', (_event: any, sessionId: string, projectDir: string) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      const now = nowLocalIso();
      db.prepare('UPDATE cuko_sessions SET project_dir = ?, updated_at = ? WHERE id = ?').run(projectDir || null, now, sessionId);
      return { success: true };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:update-provider-id', (_event: any, sessionId: string, providerSessionId: string) => {
    const db = getDb();
    if (!db || !sessionId) return { success: false };
    // 前端允许留空（下次请求重新开始），这里只做去空白与长度兜底
    const value = String(providerSessionId ?? '').trim().slice(0, 512);
    const now = nowLocalIso();
    db.prepare('UPDATE cuko_sessions SET provider_session_id = ?, updated_at = ? WHERE id = ?').run(value, now, sessionId);
    return { success: true };
  });

  // ====== 附件管理 ======
  // 原文件落盘：<userData>/cuko-attachments/<sessionId>/<messageId>/<index>.<ext>
  // 消息里只存相对路径，换模型 / 换供应商后历史附件依然可读（见需求档案 261109-8ms69z）
  const attachmentsRoot = () => require('node:path').join(require('electron').app.getPath('userData'), 'cuko-attachments');
  const safeSegment = (v: string) => String(v || '').replace(/[^a-zA-Z0-9_-]/g, '');

  ipcMain.handle('cuko:save-attachments', async (_event: any, sessionId: string, messageId: string, files: Array<{ filename: string; mimeType: string; data: string }>) => {
    const fs = require('node:fs');
    const path = require('node:path');
    const sid = safeSegment(sessionId);
    const mid = safeSegment(messageId);
    if (!sid || !mid || !Array.isArray(files) || files.length === 0) {
      return { success: false, error: 'invalid arguments' };
    }
    const baseDir = path.join(attachmentsRoot(), sid, mid);
    try {
      fs.mkdirSync(baseDir, { recursive: true });
      const saved: Array<{ filename: string; mimeType: string; path: string }> = [];
      files.forEach((f, i) => {
        const ext = (/\.([a-zA-Z0-9]+)$/.exec(f.filename || '') || ['', ''])[1];
        const fileName = String(i) + (ext ? '.' + ext.toLowerCase() : '');
        fs.writeFileSync(path.join(baseDir, fileName), Buffer.from(String(f.data || ''), 'base64'));
        saved.push({
          filename: f.filename || fileName,
          mimeType: f.mimeType || 'application/octet-stream',
          path: sid + '/' + mid + '/' + fileName,
        });
      });
      return { success: true, attachments: saved };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('cuko:read-attachment', async (_event: any, relPath: string) => {
    const fs = require('node:fs');
    const path = require('node:path');
    try {
      const root = attachmentsRoot();
      const abs = path.resolve(root, String(relPath || ''));
      const rel = path.relative(root, abs);
      // 防止 ../ 越权读到附件目录之外的文件
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        return { success: false, error: 'invalid path' };
      }
      const buf = fs.readFileSync(abs);
      return { success: true, data: buf.toString('base64') };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  // ====== 消息管理 ======
  ipcMain.handle('cuko:get-messages', (_event: any, sessionId: string) => {
    const db = getDb();
    if (!db) return [];
    // 系统提示词（role=system）排最前；同毫秒插入的多条消息按 rowid 稳定排序
    return db.prepare(`SELECT * FROM cuko_messages WHERE session_id = ?
      ORDER BY CASE WHEN role = 'system' THEN 0 ELSE 1 END, created_at ASC, rowid ASC`).all(sessionId);
  });

  ipcMain.handle('cuko:save-message', (_event: any, msg: any) => {
    const db = getDb();
    if (!db) return { success: false };
    const now = nowLocalIso();
    db.prepare('INSERT INTO cuko_messages (id, session_id, role, content, think, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(msg.id, msg.sessionId, msg.role, msg.content, msg.think || null, msg.usage ? JSON.stringify(msg.usage) : null, now);
    
    db.prepare('UPDATE cuko_sessions SET updated_at = ? WHERE id = ?').run(now, msg.sessionId);
    return { success: true };
  });

  // ====== 后台运行（运行循环在主进程，关窗后继续；每个会话可并行） ======
  // 切换模型：把压缩后的历史发给新模型（type: "compress"），成功后才改绑定
  ipcMain.handle('cuko:switch-model', (_event: any, params: any) => switchModelWithHistory(params));

  // 切模型压缩的回复里带工具块：从这条回复继续执行工具 + 后续对话循环
  ipcMain.handle('cuko:continue-after-switch', (event: any, params: any) => {
    let windowId: number | null = null;
    try {
      const win = require('electron').BrowserWindow.fromWebContents(event.sender);
      windowId = win && !win.isDestroyed() ? win.id : null;
    } catch { /* ignore */ }
    return continueAfterSwitch({ ...(params || {}), windowId });
  });

  // 请求日志（请求由主进程发出，渲染进程 DevTools Network 看不到）
  ipcMain.handle('cuko:get-request-logs', () => listCukoRequestLogs());
  // [261123-q4h7tn-cuko-openai] 点开某一条时读取原始报文
  ipcMain.handle('cuko:get-request-log-raw', (_event: any, id: string) => getCukoRequestLogRaw(id));
  ipcMain.handle('cuko:clear-request-logs', () => {
    clearCukoRequestLogs();
    return { success: true };
  });

  ipcMain.handle('cuko:start-run', (event: any, params: any) => {
    // 把发起窗口的 id 传给运行器：nameConversation / runAgent 这类工具需要窗口上下文
    let windowId: number | null = null;
    try {
      const win = require('electron').BrowserWindow.fromWebContents(event.sender);
      windowId = win && !win.isDestroyed() ? win.id : null;
    } catch { /* ignore */ }
    return startCukoRun({ ...(params || {}), windowId });
  });
  ipcMain.handle('cuko:cancel-run', (_event: any, sessionId: string) => cancelCukoRun(sessionId));
  ipcMain.handle('cuko:get-runs', () => listCukoRuns());
  ipcMain.handle('cuko:subscribe-runs', (event: any) => {
    try {
      if (event && event.sender) subscribeCukoRuns(event.sender);
    } catch (err: any) {
      return { success: false, error: err?.message || 'subscribe failed', runs: listCukoRuns() };
    }
    return { success: true, runs: listCukoRuns() };
  });
  // 退出主进程前把仍在跑的请求 abort 掉，避免半截消息
  try { require('electron').app.once('before-quit', () => cancelAllCukoRuns()); } catch { /* ignore */ }
}

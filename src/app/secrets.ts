/**
 * [261123-q4h7tn-cuko-openai] API 密钥加密存储
 *
 * 用 Electron 内置的 safeStorage：
 * - Windows：DPAPI（密钥由系统托管，绑定当前用户账户，换用户 / 换机器都解不开）
 * - macOS：Keychain
 * - Linux：libsecret（GNOME Keyring / KWallet）
 *
 * Linux 的坑：没有可用密钥环时 Electron 会静默回退到 basic_text（用硬编码密钥），
 * 而 isEncryptionAvailable() 仍返回 true。这种状态等于假加密，我们一律当「不可用」处理，
 * 拒绝保存密钥并提示用户装密钥环。
 *
 * 存储格式：库里 api_key 以 SECRET_PREFIX 开头表示密文；没有前缀的旧数据按明文处理，
 * 启动时统一迁移。这样升级是幂等的，也不需要新列。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** 密文前缀：库里 api_key 以它开头表示已加密（enc = encrypted, 1 = 格式版本） */
export const SECRET_PREFIX = 'enc1$';

/** 是否已加密的存储值（供迁移与读取判断，纯函数） */
export function isEncryptedSecret(stored: unknown): boolean {
  return typeof stored === 'string' && stored.startsWith(SECRET_PREFIX);
}

/** 密文 buffer 的 base64 → 入库字符串（纯函数） */
export function packSecret(base64: string): string {
  return SECRET_PREFIX + base64;
}

/** 入库字符串 → 密文 base64；不是密文返回 null（纯函数） */
export function unpackSecret(stored: unknown): string | null {
  if (!isEncryptedSecret(stored)) return null;
  const rest = String(stored).slice(SECRET_PREFIX.length);
  return rest ? rest : null;
}

function safeStorageApi(): any {
  try {
    const electron = require('electron');
    return electron && electron.safeStorage ? electron.safeStorage : null;
  } catch {
    return null;
  }
}

export interface EncryptionStatus {
  /** 是否可用【真正的】系统加密 */
  available: boolean;
  /** 后端标识：dpapi / keychain / gnome_libsecret / kwallet / basic_text / none */
  backend: string;
  /** 不可用时的原因（给界面显示） */
  reason: string;
}

let cachedStatus: EncryptionStatus | null = null;

function backendName(ss: any): string {
  if (process.platform === 'win32') return 'dpapi';
  if (process.platform === 'darwin') return 'keychain';
  try {
    return String(ss.getSelectedStorageBackend() || 'unknown');
  } catch {
    return 'unknown';
  }
}

/**
 * 系统加密是否可用。结果缓存（同一次运行里后端不会变，避免每次读密钥都探测）。
 * Linux 上 basic_text / unknown 一律判为不可用——那是硬编码密钥，不是真加密。
 */
export async function getEncryptionStatus(): Promise<EncryptionStatus> {
  if (cachedStatus) return cachedStatus;
  const ss = safeStorageApi();
  if (!ss) {
    cachedStatus = { available: false, backend: 'none', reason: '当前环境没有 safeStorage（不在 Electron 主进程里）' };
    return cachedStatus;
  }
  const backend = backendName(ss);
  let ok = false;
  try {
    ok = await ss.isAsyncEncryptionAvailable();
  } catch (err: any) {
    cachedStatus = { available: false, backend, reason: '系统加密服务不可用：' + String((err && err.message) || err) };
    return cachedStatus;
  }
  if (!ok) {
    cachedStatus = { available: false, backend, reason: '系统加密服务不可用' };
    return cachedStatus;
  }
  if (process.platform === 'linux' && (backend === 'basic_text' || backend === 'unknown')) {
    cachedStatus = {
      available: false,
      backend,
      reason: backend === 'basic_text'
        ? '本机没有可用的密钥环（libsecret），Linux 下此时只能做「假加密」，已拒绝保存。请安装并启动 gnome-keyring 或 KWallet 后重试'
        : '无法确认 Linux 密钥环后端，已拒绝保存密钥。请确认 gnome-keyring 或 KWallet 已启动',
    };
    return cachedStatus;
  }
  cachedStatus = { available: true, backend, reason: '' };
  return cachedStatus;
}

/** 仅供测试或环境变化时清缓存 */
export function resetEncryptionStatusCache(): void {
  cachedStatus = null;
}

/** 加密：失败抛错（调用方决定是拒绝保存还是降级） */
export async function encryptSecret(plain: string): Promise<string> {
  const status = await getEncryptionStatus();
  if (!status.available) throw new Error(status.reason);
  const ss = safeStorageApi();
  const buf: Buffer = await ss.encryptStringAsync(plain);
  return packSecret(buf.toString('base64'));
}

/** 解密：不是密文按明文原样返回（兼容旧数据）；密文解不开抛错 */
export async function decryptSecret(stored: unknown): Promise<string> {
  if (stored === null || stored === undefined) return '';
  const b64 = unpackSecret(stored);
  if (!b64) return String(stored);
  const status = await getEncryptionStatus();
  if (!status.available) throw new Error('无法解密 API 密钥：' + status.reason);
  const ss = safeStorageApi();
  const out = await ss.decryptStringAsync(Buffer.from(b64, 'base64'));
  return String((out && out.result) || '');
}

/** 启动时迁移：把库里的明文密钥统一加密。已加密的跳过；加密不可用时整批跳过并返回 skipped */
export async function migratePlaintextSecrets(db: any): Promise<{ migrated: number; failed: number; skipped: boolean }> {
  const status = await getEncryptionStatus();
  if (!status.available) return { migrated: 0, failed: 0, skipped: true };
  let rows: any[] = [];
  try {
    rows = db.prepare("SELECT id, api_key FROM cuko_providers WHERE api_key IS NOT NULL AND api_key != ''").all() as any[];
  } catch {
    return { migrated: 0, failed: 0, skipped: true };
  }
  let migrated = 0;
  let failed = 0;
  const update = db.prepare('UPDATE cuko_providers SET api_key = ? WHERE id = ?');
  for (const row of rows) {
    const stored = row.api_key;
    if (isEncryptedSecret(stored)) continue;
    try {
      const encrypted = await encryptSecret(String(stored));
      update.run(encrypted, row.id);
      migrated++;
    } catch (err: any) {
      failed++;
      console.error('[secrets] 迁移明文密钥失败（provider=' + row.id + '）:', (err && err.message) || err);
    }
  }
  if (migrated > 0) console.log('[secrets] 已加密 ' + migrated + ' 个 Provider 的明文密钥');
  if (failed > 0) console.error('[secrets] 有 ' + failed + ' 个 Provider 密钥迁移失败，仍是明文');
  return { migrated, failed, skipped: false };
}

/** 读某个 Provider 的可用密钥（解密后）。库里没有返回空串 */
export async function readProviderSecret(db: any, providerId: string): Promise<string> {
  let row: any;
  try {
    row = db.prepare('SELECT api_key FROM cuko_providers WHERE id = ?').get(providerId) as any;
  } catch {
    return '';
  }
  if (!row || !row.api_key) return '';
  return await decryptSecret(row.api_key);
}

/** 打码显示：只给界面看，永远不把明文送到渲染进程。空值返回空串 */
export function maskSecret(plain: string): string {
  const s = String(plain || '');
  if (!s) return '';
  if (s.length <= 4) return '****';
  return '****' + s.slice(-4);
}

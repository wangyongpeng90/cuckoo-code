/**
 * 飞书同步：配置读写（用户级 ~/.cuckoo/feishu.json）
 *
 * 存储：{ appId, appSecret, enabled, pushUserMessage, pushAiReply,
 *         pushToolStatus, pushToolName, sendToActiveWindow }
 * 可用环境变量 CUCKOO_HOME 覆盖（测试隔离）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  /** 是否启用飞书同步 */
  enabled: boolean;
  /** 推送目标：用户 open_id（用户首次给机器人发消息时自动记录） */
  targetOpenId: string;
  /** 推送：用户消息（经 Cuckoo 发送的） */
  pushUserMessage: boolean;
  /** 推送：AI 文本回复 */
  pushAiReply: boolean;
  /** 推送：工具调用状态（仅"调用中/完成"） */
  pushToolStatus: boolean;
  /** 工具状态里是否带工具名（默认 false，保护隐私） */
  pushToolName: boolean;
  /** AI 回复里出现的本地图片文件是否自动作为图片消息发到飞书（默认 true） */
  pushImages: boolean;
}

function getUserDir(): string {
  const override = process.env.CUCKOO_HOME;
  return override ? override : path.join(os.homedir(), '.cuckoo');
}

function getConfigFile(): string {
  return path.join(getUserDir(), 'feishu.json');
}

/** 图片收发目录（收到的飞书图片存这里）：~/.cuckoo/feishu-images */
function getImagesDir(): string {
  return path.join(getUserDir(), 'feishu-images');
}

/** 默认配置（未启用） */
function defaultConfig(): FeishuConfig {
  return {
    appId: '',
    appSecret: '',
    enabled: false,
    targetOpenId: '',
    pushUserMessage: true,
    pushAiReply: true,
    pushToolStatus: true,
    pushToolName: false,
    pushImages: true,
  };
}

/** 读取配置（不存在则返回默认；字段类型清洗） */
function readConfig(): FeishuConfig {
  const dft = defaultConfig();
  try {
    const file = getConfigFile();
    if (!fs.existsSync(file)) return dft;
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!raw || typeof raw !== 'object') return dft;
    return {
      appId: typeof raw.appId === 'string' ? raw.appId : '',
      appSecret: typeof raw.appSecret === 'string' ? raw.appSecret : '',
      enabled: raw.enabled === true,
      targetOpenId: typeof raw.targetOpenId === 'string' ? raw.targetOpenId : '',
      pushUserMessage: raw.pushUserMessage !== false,
      pushAiReply: raw.pushAiReply !== false,
      pushToolStatus: raw.pushToolStatus !== false,
      pushToolName: raw.pushToolName === true,
      pushImages: raw.pushImages !== false,
    };
  } catch (err: any) {
    console.error('[Feishu] 读取配置失败:', err.message);
    return dft;
  }
}

/** 写入配置（整体覆盖） */
function writeConfig(data: any): boolean {
  try {
    const base = readConfig();
    const next: FeishuConfig = {
      appId: typeof (data && data.appId) === 'string' ? data.appId.trim() : base.appId,
      appSecret: typeof (data && data.appSecret) === 'string' ? data.appSecret.trim() : base.appSecret,
      enabled: data && typeof data.enabled === 'boolean' ? data.enabled : base.enabled,
      targetOpenId: typeof (data && data.targetOpenId) === 'string' ? data.targetOpenId : base.targetOpenId,
      pushUserMessage: data && typeof data.pushUserMessage === 'boolean' ? data.pushUserMessage : base.pushUserMessage,
      pushAiReply: data && typeof data.pushAiReply === 'boolean' ? data.pushAiReply : base.pushAiReply,
      pushToolStatus: data && typeof data.pushToolStatus === 'boolean' ? data.pushToolStatus : base.pushToolStatus,
      pushToolName: data && typeof data.pushToolName === 'boolean' ? data.pushToolName : base.pushToolName,
      pushImages: data && typeof data.pushImages === 'boolean' ? data.pushImages : base.pushImages,
    };
    const file = getConfigFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf-8');
    console.log('[Feishu] 配置已写入:', file);
    return true;
  } catch (err: any) {
    console.error('[Feishu] 写入配置失败:', err.message);
    return false;
  }
}

export { readConfig, writeConfig, getConfigFile, getImagesDir, defaultConfig };

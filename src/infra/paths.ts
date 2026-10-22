/**
 * 应用路径解析（D20：锚定应用根）
 *
 * 预编译后 import.meta.dirname 指向 dist/，而资源（assets/src/prompt/tools）
 * 不在其中。本模块用 app.getAppPath() 锚定"应用根"：
 *  - 开发时 = 项目根
 *  - 打包时 = asar 根
 * 从而与编译输出结构解耦。
 *
 * 注意：仅主进程可用（依赖 electron app）。preload 不用（它解析 dist 内产物）。
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { runtimePlatformDir } from './runtime-platform.js';

// electron 特殊：其 index.js 导出字符串，须用 createRequire（见 P3a 手册 1.5）
const require = createRequire(import.meta.url);
const { app } = require('electron');

/** 应用根目录：开发=项目根，打包=asar 根 */
export const APP_ROOT: string = app.getAppPath();

/** 解析项目根资源（如 assets/icon.png） */
export function resolveAsset(rel: string): string {
  return path.join(APP_ROOT, rel);
}

/** 解析 src/ 下的非 TS 资源（如 prompt/*.md、ui/*.html） */
export function resolveSrc(rel: string): string {
  return path.join(APP_ROOT, 'src', rel);
}

/**
 * 自带运行时（uv/node）的 bin 目录。
 * 打包后位于 resources/runtime/<platform>/bin/（asar 外）；
 * 开发时位于 <项目根>/resources/runtime/<platform>/bin/。
 * @returns bin 目录绝对路径（不存在返回 null）
 */
export function resolveRuntimeBinDir(): string | null {
  const platform = runtimePlatformDir();
  if (!platform) return null;
  const candidates = [
    path.join(process.resourcesPath || '', 'runtime', platform, 'bin'),
    path.join(APP_ROOT, 'resources', 'runtime', platform, 'bin'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * 解析工具 API 类型定义（契约文件）。
 * 打包后位于 resources/tools/（asar 外），开发时位于 src/tools/api.d.ts。
 */
export function resolveToolSpec(): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'tools', 'cuckoo-tools.d.ts'),
    path.join(APP_ROOT, 'src', 'tools', 'api.d.ts'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return candidates[candidates.length - 1];
}

/**
 * 解析某个 feature 的工具 API 类型定义（api.<feature>.d.ts）。
 * 打包后位于 resources/tools/cuckoo-tools.<feature>.d.ts，开发时 src/tools/api.<feature>.d.ts。
 * @returns 文件路径（不存在时返回候选中的最后一个，由调用方判空）
 */
export function resolveToolSpecFeature(feature: string): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'tools', 'cuckoo-tools.' + feature + '.d.ts'),
    path.join(APP_ROOT, 'src', 'tools', 'api.' + feature + '.d.ts'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return candidates[candidates.length - 1];
}

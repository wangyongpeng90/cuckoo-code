/**
 * 数据目录解析（便携 / 环境变量 / 默认 三级判定）
 *
 * 便携版（zip 解压后目录里有 portable.flag）：
 *   所有数据写入解压目录下的 data/，不在用户目录（%APPDATA%）留痕。
 * 环境变量 CUCKOO_DATA_DIR：
 *   显式覆盖，便于测试与高级用法。
 * 默认（NSIS 安装版 / 开发版）：
 *   维持原行为 %APPDATA%/cuckoo-ai-pro-session。
 *
 * 独立成纯函数模块：fs 依赖可注入，便于单测（不 require electron）。
 */
const path = require('path');
const fs = require('fs');

const PORTABLE_FLAG = 'portable.flag';
const PORTABLE_DATA_SUBDIR = 'data';

/**
 * exe 同级的便携标记文件路径
 * @param {string} exeDir 可执行文件所在目录
 */
function portableFlagPath(exeDir) {
  return path.join(exeDir, PORTABLE_FLAG);
}

/**
 * 是否处于便携模式（exe 同级存在 portable.flag）
 * @param {object} deps
 * @param {string} deps.exeDir
 * @param {(p: string) => boolean} [deps.existsSync]
 * @returns {boolean}
 */
function isPortableMode({ exeDir, existsSync = fs.existsSync }) {
  if (!exeDir) return false;
  return !!existsSync(portableFlagPath(exeDir));
}

/**
 * 解析数据目录
 * @param {object} deps
 * @param {string} deps.exeDir 可执行文件所在目录
 * @param {object} [deps.env] 环境变量，默认 process.env
 * @param {(p: string) => boolean} [deps.existsSync]
 * @param {string} deps.defaultDir 默认目录（安装版/开发版的 %APPDATA% 方案）
 * @returns {{ dir: string, portable: boolean, source: 'env'|'portable'|'default' }}
 */
function resolveDataDir({ exeDir, env = process.env, existsSync = fs.existsSync, defaultDir }) {
  const explicit = env && env.CUCKOO_DATA_DIR ? String(env.CUCKOO_DATA_DIR).trim() : '';
  if (explicit) {
    return { dir: path.resolve(explicit), portable: isPortableMode({ exeDir, existsSync }), source: 'env' };
  }
  if (isPortableMode({ exeDir, existsSync })) {
    return { dir: path.join(exeDir, PORTABLE_DATA_SUBDIR), portable: true, source: 'portable' };
  }
  return { dir: defaultDir, portable: false, source: 'default' };
}

module.exports = {
  PORTABLE_FLAG,
  PORTABLE_DATA_SUBDIR,
  portableFlagPath,
  isPortableMode,
  resolveDataDir,
};

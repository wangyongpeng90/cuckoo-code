/**
 * 自带运行时（uv/node）的平台目录名。
 *
 * 与 scripts/fetch-runtime.mjs 中的 currentPlatform() 保持一致：
 *  - win32/x64   → win-x64
 *  - darwin/x64  → mac-x64
 *  - darwin/arm64→ mac-arm64
 *  - linux/x64   → linux-x64
 *  - linux/arm64 → linux-arm64
 * 其他平台返回 null（表示没有预打包运行时，回退到系统 PATH）。
 *
 * 纯 node 模块：不依赖 electron，主进程与插件进程都可用。
 */
export function runtimePlatformDir(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  if (platform === 'win32' && arch === 'x64') return 'win-x64';
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  if (platform === 'linux') return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  return null;
}

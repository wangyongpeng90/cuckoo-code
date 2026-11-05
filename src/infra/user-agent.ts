/**
 * 动态生成"普通 Chrome" User-Agent。
 *
 * 背景：Electron 内嵌浏览器若 UA 与真实内核版本不一致（如写死 Chrome 130，
 * 实际内核是 Chrome 152），Google 等站点会因 UA/sec-ch-ua 矛盾判定"浏览器不安全"，
 * 拒绝登录。故改为从 process.versions.chrome 动态取真实版本。
 *
 * 主进程可用（依赖 process.versions）。preload 不用。
 */

/** 取主版本号（如 "152.0.7977.130" → "152"） */
function chromeMajor(): string {
  const v = (process.versions && process.versions.chrome) || '';
  const m = v.match(/^(\d+)/);
  return m ? m[1] : '0';
}

/** 平台档案：UA 平台串 / Client Hints 平台 / userAgentData 平台等 */
interface PlatformProfile {
  /** UA 括号内的平台串（对齐 Chromium 源码的编译期常量） */
  uaPlatform: string;
  /** sec-ch-ua-platform 的值（带引号） */
  chUaPlatform: string;
  /** navigator.userAgentData.platform */
  uadPlatform: string;
  /** getHighEntropyValues 的 platformVersion */
  platformVersion: string;
  /** getHighEntropyValues 的 architecture（"x86" | "arm"） */
  architecture: string;
  /** getHighEntropyValues 的 bitness（"64" | "32"） */
  bitness: string;
}

/**
 * 按当前平台返回 UA 档案。
 *
 * 平台串取自 Chromium 源码 components/embedder_support/user_agent_utils.cc
 * 的编译期常量（UA Reduction 后的冻结值）——Chrome 故意不把真实系统版本写进 UA：
 * Apple Silicon Mac 也报 "Intel Mac OS X 10_15_7"，Windows 11 也报 "Windows NT 10.0"。
 * 真实系统信息只出现在 Client Hints / getHighEntropyValues 里。
 *
 * @param platform 平台标识，默认 process.platform（测试时可注入）
 * @param arch 架构标识，默认 process.arch（测试时可注入）
 */
function getPlatformProfile(
  platform: string = (typeof process !== 'undefined' && process.platform) || 'win32',
  arch: string = (typeof process !== 'undefined' && process.arch) || 'x64'
): PlatformProfile {
  switch (platform) {
    case 'darwin':
      return {
        uaPlatform: 'Macintosh; Intel Mac OS X 10_15_7',
        chUaPlatform: '"macOS"',
        uadPlatform: 'macOS',
        // 真实 Chrome 会调系统 API 取 macOS 版本；此处给常见固定值（高熵值极少被严格校验）
        platformVersion: '13.6.0',
        architecture: arch === 'arm64' ? 'arm' : 'x86',
        bitness: '64',
      };
    case 'linux':
      return {
        uaPlatform: 'X11; Linux x86_64',
        chUaPlatform: '"Linux"',
        uadPlatform: 'Linux',
        // 真实 Chrome 在 Linux 上此项返回空串
        platformVersion: '',
        architecture: 'x86',
        bitness: '64',
      };
    default: // win32
      return {
        uaPlatform: 'Windows NT 10.0; Win64; x64',
        chUaPlatform: '"Windows"',
        uadPlatform: 'Windows',
        platformVersion: '10.0.0',
        architecture: 'x86',
        bitness: '64',
      };
  }
}

/**
 * 生成普通 Chrome UA（去掉 Electron 标识，内核版本与真实一致）。
 * 格式对齐真实 Chrome：Chrome/{主版本}.0.0.0
 */
function buildChromeUserAgent(platform?: string, arch?: string): string {
  const major = chromeMajor();
  const p = getPlatformProfile(platform, arch);
  return 'Mozilla/5.0 (' + p.uaPlatform + ') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + major + '.0.0.0 Safari/537.36';
}

/** 取完整内核版本（如 "152.0.7977.130"） */
function chromeFullVersion(): string {
  const v = (process.versions && process.versions.chrome) || '';
  return v || (chromeMajor() + '.0.0.0');
}

/** 运行时真实客户端提示（由主进程从页面侧读回，见 app/entry.ts） */
interface RuntimeClientHints {
  /** Electron/Chromium 真实品牌列表（含自家 GREASE 品牌名与版本，如 Not?A_Brand/24） */
  brands?: Array<{ brand: string; version: string }>;
  /** 完整内核版本，如 152.0.7977.130 */
  fullVersion?: string;
  /** 系统版本对应的值，如 Windows 11 的 19.0.0 */
  platformVersion?: string;
  architecture?: string;
  bitness?: string;
}

/** Emulation.setUserAgentOverride 的 userAgentMetadata 结构 */
interface UserAgentMetadata {
  brands: Array<{ brand: string; version: string }>;
  fullVersionList: Array<{ brand: string; version: string }>;
  fullVersion: string;
  platform: string;
  platformVersion: string;
  architecture: string;
  bitness: string;
  model: string;
  mobile: boolean;
  wow64: boolean;
}

/**
 * 生成与 UA 完全自洽的客户端提示元数据，供 `Emulation.setUserAgentOverride` 使用。
 *
 * 关键点：
 * 1. 品牌列表沿用**运行时真实值**（Electron 自己的 Chromium + GREASE 品牌），
 *    只在其前面补一个 "Google Chrome"——这样 sec-ch-ua 请求头才会真的带上 Chrome 品牌
 *    （webRequest 改 sec-ch-ua 在 Electron 里不生效，实测无效）。
 * 2. `platformVersion` 优先用运行时真实值（Windows 11 是 19.0.0 这类），
 *    不再写死 10.0.0 —— 写死会让"系统版本"指纹露馅。
 * 3. GREASE 品牌名（`Not?A_Brand` / `Not_A Brand`）随内核版本变化，
 *    所以一律以运行时值为准，不硬编码。
 */
function buildUserAgentMetadata(runtime?: RuntimeClientHints, platform?: string, arch?: string): UserAgentMetadata {
  const p = getPlatformProfile(platform, arch);
  const full = (runtime && runtime.fullVersion) || chromeFullVersion();
  const major = full.split('.')[0] || chromeMajor();

  const base = (runtime && Array.isArray(runtime.brands) && runtime.brands.length)
    ? runtime.brands.map((b) => ({ brand: String(b.brand), version: String(b.version) }))
    : [{ brand: 'Chromium', version: major }, { brand: 'Not_A Brand', version: '24' }];

  const brands = [{ brand: 'Google Chrome', version: major }]
    .concat(base.filter((b) => b.brand !== 'Google Chrome'));

  const fullVersionList = brands.map((b) => ({
    brand: b.brand,
    // Chrome / Chromium 用完整版本；GREASE 品牌固定 x.0.0.0（对齐真实 Chrome）
    version: (b.brand === 'Google Chrome' || b.brand === 'Chromium') ? full : (b.version + '.0.0.0'),
  }));

  return {
    brands,
    fullVersionList,
    fullVersion: full,
    platform: p.uadPlatform,
    platformVersion: (runtime && runtime.platformVersion) || p.platformVersion,
    architecture: (runtime && runtime.architecture) || p.architecture,
    bitness: (runtime && runtime.bitness) || p.bitness,
    model: '',
    mobile: false,
    wow64: false,
  };
}

export {
  buildChromeUserAgent,
  chromeMajor,
  chromeFullVersion,
  buildUserAgentMetadata,
  getPlatformProfile,
};
export type { RuntimeClientHints, UserAgentMetadata };

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

/**
 * 生成普通 Chrome UA（去掉 Electron 标识，内核版本与真实一致）。
 * 格式对齐真实 Chrome：Chrome/{主版本}.0.0.0
 */
function buildChromeUserAgent(): string {
  const major = chromeMajor();
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + major + '.0.0.0 Safari/537.36';
}

/** 取完整内核版本（如 "152.0.7977.130"） */
function chromeFullVersion(): string {
  const v = (process.versions && process.versions.chrome) || '';
  return v || (chromeMajor() + '.0.0.0');
}

/**
 * 生成与 UA 匹配的 Chrome 客户端提示请求头（Sec-CH-UA*）。
 *
 * 为什么需要：Electron 默认发的 sec-ch-ua 缺少 "Google Chrome" 品牌，
 * Google 据此判定"浏览器或应用不安全"而拒绝登录。按真实 Chrome 补齐。
 */
function buildClientHintsHeaders(): Record<string, string> {
  const m = chromeMajor();
  return {
    'sec-ch-ua': '"Google Chrome";v="' + m + '", "Chromium";v="' + m + '", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  };
}

/**
 * 生成修正 navigator.userAgentData / webdriver 的主世界脚本。
 * 必须在页面脚本之前注入（preload 阶段），否则会被页面抢先读到 Electron 默认值。
 */
function buildUserAgentDataFix(): string {
  const m = chromeMajor();
  const full = chromeFullVersion();
  return '(function(){try{' +
    'var brands=[{brand:"Google Chrome",version:"' + m + '"},{brand:"Chromium",version:"' + m + '"},{brand:"Not_A Brand",version:"24"}];' +
    'var fullList=[{brand:"Google Chrome",version:"' + full + '"},{brand:"Chromium",version:"' + full + '"},{brand:"Not_A Brand",version:"24.0.0.0"}];' +
    'var uad={brands:brands,mobile:false,platform:"Windows",' +
    'getHighEntropyValues:function(){return Promise.resolve({architecture:"x86",bitness:"64",brands:brands,fullVersionList:fullList,mobile:false,model:"",platform:"Windows",platformVersion:"10.0.0",uaFullVersion:"' + full + '",wow64:false});},' +
    'toJSON:function(){return{brands:brands,mobile:false,platform:"Windows"};}};' +
    'try{Object.defineProperty(navigator,"userAgentData",{get:function(){return uad;},configurable:true});}catch(e){}' +
    'try{Object.defineProperty(navigator,"webdriver",{get:function(){return false;},configurable:true});}catch(e){}' +
    '}catch(e){}})();';
}

export { buildChromeUserAgent, chromeMajor, buildClientHintsHeaders, buildUserAgentDataFix };

/**
 * SSRF 防护：拒绝 webFetch 访问内网 / 回环 / 链路本地 / 保留地址。
 *
 * 仅校验 URL 协议是不够的——http://127.0.0.1、http://169.254.169.254（云元数据）
 * 以及私网段都可被 AI 用来探测本机/内网服务。
 *
 * 策略：解析 hostname，若是 IP 字面量直接校验；否则 DNS 解析出全部地址后逐一校验
 * （fail-closed：解析失败即拒绝）。
 *
 * 局限：本模块在「解析校验」与「实际 fetch」之间存在 TOCTOU 窗口，DNS rebinding
 * 理论上可利用。彻底防御需将已解析 IP 固定到连接层（自定义 dispatcher），
 * 属于后续增强；当前实现对直接/内网访问已足够。
 */
import dns from 'node:dns';
import net from 'node:net';

/** IPv4 点分十进制 → 32 位无符号整数（非法返回 null） */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const v = Number(p);
    if (v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

/** 阻塞的 IPv4 CIDR 段 */
const BLOCKED_IPV4_CIDRS: Array<[string, number]> = [
  ['0.0.0.0', 8],        // 本机（"this host"）
  ['10.0.0.0', 8],       // 私网
  ['100.64.0.0', 10],    // CGNAT
  ['127.0.0.0', 8],      // 回环
  ['169.254.0.0', 16],   // 链路本地（含 169.254.169.254 云元数据）
  ['172.16.0.0', 12],    // 私网
  ['192.0.0.0', 24],     // IETF 协议分配
  ['192.0.2.0', 24],     // TEST-NET-1
  ['192.88.99.0', 24],   // 6to4 中继
  ['192.168.0.0', 16],   // 私网
  // 注：不拦 198.18.0.0/15（基准测试段）。它并非内网/危险地址，却是 Clash/V2Ray
  // 等代理「fake-ip 模式」的默认地址段——拦截会导致代理用户的所有公网域名
  // 被误判（DNS 全返回 198.18.x.x），网页抓取全面失效。
  ['198.51.100.0', 24],  // TEST-NET-2
  ['203.0.113.0', 24],   // TEST-NET-3
  ['224.0.0.0', 4],      // 组播
  ['240.0.0.0', 4],      // 保留（含 255.255.255.255）
];

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  for (const [base, prefix] of BLOCKED_IPV4_CIDRS) {
    const baseInt = ipv4ToInt(base) as number;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if ((n & mask) === (baseInt & mask)) return true;
  }
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const s = ip.toLowerCase();
  // 内嵌 IPv4 的 IPv6 形式 → 抽出 IPv4 部分递归校验。
  // 覆盖：::ffff:1.2.3.4（IPv4-mapped）、::ffff:0:1.2.3.4（翻译形式）、
  // ::1.2.3.4（IPv4-compatible，已弃用但解析器仍接受）、0:0:0:0:0:ffff:1.2.3.4（全展开）。
  // 此前只认 ::ffff: 一种，::127.0.0.1 / ::169.254.169.254 等直接放行。
  const embedded = s.match(/^(?:::ffff:(?:0:)?|::|(?:0:){5}ffff:)(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) return isBlockedIpv4(embedded[1]);
  if (s === '::1' || s === '::') return true;                 // 回环 / 未指定
  if (/^fe[89ab]/.test(s)) return true;                       // fe80::/10 链路本地
  if (/^f[cd]/.test(s)) return true;                          // fc00::/7 唯一本地
  if (/^ff/.test(s)) return true;                             // ff00::/8 组播
  if (s.startsWith('2001:db8')) return true;                  // 文档用
  if (s.startsWith('64:ff9b::')) return true;                 // NAT64（内嵌 IPv4）
  return false;
}

/** 判断某 IP 字面量是否属于被阻塞的地址段 */
export function isBlockedIp(ip: string): boolean {
  if (typeof ip !== 'string' || ip.length === 0) return false;
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return false;
}

/**
 * 校验 URL 是否可安全访问；命中内网/保留地址时抛错。
 * @throws 协议非法、hostname 缺失、解析失败（fail-closed）、命中阻塞地址
 */
export async function assertUrlAllowed(rawUrl: string): Promise<void> {
  const u = new URL(rawUrl);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('仅支持 http/https 协议');
  }
  const host = (u.hostname || '').replace(/^\[|\]$/g, '');
  if (!host) throw new Error('URL 缺少主机名');

  // IP 字面量（含 WHATWG 归一化后的 0x7f.0.0.1 / 十进制等）
  if (net.isIP(host)) {
    if (isBlockedIp(host)) {
      throw new Error('拒绝访问内网/保留地址: ' + host);
    }
    return;
  }

  // 域名：DNS 解析出全部地址后逐一校验（fail-closed）
  let addrs: dns.LookupAddress[];
  try {
    addrs = await dns.promises.lookup(host, { all: true });
  } catch (err: any) {
    throw new Error('无法解析主机名 ' + host + ': ' + (err.message || String(err)));
  }
  if (!addrs || addrs.length === 0) {
    throw new Error('无法解析主机名 ' + host);
  }
  for (const a of addrs) {
    if (isBlockedIp(a.address)) {
      throw new Error('拒绝访问内网/保留地址: ' + host + ' -> ' + a.address);
    }
  }
}

export { isBlockedIpv4, isBlockedIpv6 };

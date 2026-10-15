#!/usr/bin/env node
/**
 * pr_flow.mjs — GitHub 一键 PR 流程（零依赖，Node 18+，全局 fetch）
 *
 * 用法：
 *   node pr_flow.mjs auth                                # 设备码授权（弹出 github.com/login/device）
 *   node pr_flow.mjs whoami                              # 查看当前授权账号
 *   node pr_flow.mjs logout                              # 清除本地 token
 *   node pr_flow.mjs fork  --remote OWNER/REPO           # fork 上游仓库（等待就绪）
 *   node pr_flow.mjs push  --repo DIR --branch B [--remote OWNER/REPO]
 *   node pr_flow.mjs pr    --remote OWNER/REPO --branch B --title T [--body-file F] [--body "…"]
 *   node pr_flow.mjs run   --repo DIR --remote OWNER/REPO --branch B --title T [--body-file F]
 *                                                        # push + pr 一条龙（fork 按需）
 *
 * Token 存放：~/.cuckoo/pr-submit/github-token.json（仅本机）。
 * 输出永不回显 token；任何报错信息都会先脱敏。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CLIENT_ID = '178c6fc778ccc68e1d6a'; // GitHub CLI 公开 OAuth App（设备码流标准用法）
const HOME = os.homedir();
const TOKEN_DIR = path.join(HOME, '.cuckoo', 'pr-submit');
const TOKEN_FILE = path.join(TOKEN_DIR, 'github-token.json');
const API = 'https://api.github.com';

// ---------- 小工具 ----------
const die = (msg, code = 1) => { console.error('[pr-flow] 错误:', msg); process.exit(code); };
const redact = (s) => {
  try {
    const t = readToken()?.token;
    if (t) s = String(s).split(t).join('***TOKEN***');
  } catch (_) {}
  return s;
};
function readToken() {
  try {
    const raw = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
    return raw && raw.token ? raw : null;
  } catch (_) { return null; }
}
function saveToken(obj) {
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  try { fs.chmodSync(TOKEN_FILE, 0o600); } catch (_) {}
}
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) a[k.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else a._.push(k);
  }
  return a;
}
async function ghApi(method, urlPath, { token, body, raw = false } = {}) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'pr-submit-skill',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + urlPath, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch (_) { json = { message: text }; }
  return { status: res.status, ok: res.ok, data: json };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 带重试的 fetch（瞬时网络/代理 502 自动重试 2 次） */
async function fetchRetry(url, opts = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, opts); } catch (e) {
      lastErr = e;
      if (i < tries - 1) await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

// ---------- auth：设备码授权 ----------
async function cmdAuth(args) {
  const scopes = args.scopes || 'repo,workflow';
  const res = await fetchRetry('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: scopes }),
  });
  const d = await res.json();
  if (!d.device_code) die('获取 device_code 失败: ' + redact(JSON.stringify(d)));
  console.log('==========================================================');
  console.log('  需要授权：请打开下面页面并输入代码（已尝试自动打开浏览器）');
  console.log('');
  console.log('  页面:  https://github.com/login/device');
  console.log('  代码:  ' + d.user_code);
  console.log('==========================================================');
  try { spawnSync('cmd', ['/c', 'start', '', 'https://github.com/login/device'], { detached: false, stdio: 'ignore' }); } catch (_) {}
  const interval = (d.interval || 5) * 1000;
  const deadline = Date.now() + (d.expires_in || 900) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    let j;
    try {
      const r = await fetchRetry('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: CLIENT_ID, device_code: d.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
      j = await r.json();
    } catch (e) {
      // 瞬时网络/代理抖动：继续轮询，不中断授权等待
      process.stdout.write('?');
      continue;
    }
    if (j.access_token) {
      const me = await ghApi('GET', '/user', { token: j.access_token });
      const login = me.ok ? me.data.login : '';
      saveToken({ token: j.access_token, login, scopes, created: new Date().toISOString() });
      console.log('[pr-flow] 授权成功 ✓  账号: ' + (login || '(未知)') + '  token 已存 ' + TOKEN_FILE);
      return;
    }
    if (j.error === 'authorization_pending') { process.stdout.write('.'); continue; }
    if (j.error === 'slow_down') { await sleep(5000); continue; }
    die('授权失败: ' + (j.error_description || j.error || '未知'));
  }
  die('授权超时（15 分钟），请重跑 auth');
}

// ---------- 其他命令 ----------
async function cmdWhoami() {
  const t = readToken();
  if (!t) die('未授权：先运行 auth');
  const me = await ghApi('GET', '/user', { token: t.token });
  if (!me.ok) die(redact('token 校验失败: ' + JSON.stringify(me.data)));
  console.log(JSON.stringify({ login: me.data.login, id: me.data.id, html_url: me.data.html_url }, null, 2));
}
function cmdLogout() {
  try { fs.rmSync(TOKEN_FILE); console.log('[pr-flow] 已清除本地 token'); } catch (_) {}
}

async function ensureFork(remote, token, login) {
  const [owner, repo] = remote.split('/');
  // 已有同名 fork？
  const mine = await ghApi('GET', `/repos/${login}/${repo}`, { token });
  if (mine.ok && mine.data.fork && (mine.data.parent?.full_name === remote || mine.data.source?.full_name === remote)) {
    console.log('[pr-flow] fork 已存在: ' + mine.data.full_name);
    return mine.data;
  }
  console.log('[pr-flow] 创建 fork: ' + remote + ' → ' + login + '/' + repo + ' …');
  const f = await ghApi('POST', `/repos/${remote}/forks`, { token, body: {} });
  if (!f.ok && f.status !== 202) die(redact('fork 失败: ' + JSON.stringify(f.data)));
  // 等待 fork 就绪（GitHub 异步创建，最长 ~90s）
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    const chk = await ghApi('GET', `/repos/${login}/${repo}`, { token });
    if (chk.ok) { console.log('[pr-flow] fork 就绪: ' + chk.data.full_name); return chk.data; }
    process.stdout.write('.');
  }
  die('fork 超时未就绪，稍后重跑 push');
}

async function cmdPush(args) {
  const t = readToken();
  if (!t) die('未授权：先运行 auth');
  const repo = args.repo, branch = args.branch;
  const remote = args.remote || detectRemote(repo);
  if (!repo || !branch || !remote) die('用法: push --repo DIR --branch B [--remote OWNER/REPO]');
  const login = t.login || (await whoamiLogin(t.token));
  const forkRepo = await ensureFork(remote, t.token, login);
  const url = `https://x-access-token:${t.token}@github.com/${login}/${forkRepo.name}.git`;
  const r = spawnSync('git', ['-C', repo, 'push', url, `${branch}:${branch}`, '--set-upstream'], { encoding: 'utf-8' });
  const out = redact((r.stdout || '') + (r.stderr || ''));
  if (r.status !== 0) die('push 失败:\n' + out);
  console.log('[pr-flow] push 成功: ' + login + '/' + forkRepo.name + ' @ ' + branch);
  if (out.trim()) console.log(out.trim().split('\n').slice(-3).join('\n'));
}

async function cmdPr(args) {
  const t = readToken();
  if (!t) die('未授权：先运行 auth');
  const remote = args.remote, branch = args.branch;
  if (!remote || !branch || !args.title) die('用法: pr --remote OWNER/REPO --branch B --title T [--body-file F]');
  const body = args['body-file'] ? fs.readFileSync(args['body-file'], 'utf-8') : (args.body || '');
  const up = await ghApi('GET', `/repos/${remote}`, { token: t.token });
  if (!up.ok) die(redact('上游仓库读取失败: ' + JSON.stringify(up.data)));
  const base = up.data.default_branch || 'main';
  const login = t.login || (await whoamiLogin(t.token));
  const r = await ghApi('POST', `/repos/${remote}/pulls`, {
    token: t.token,
    body: { title: args.title, head: `${login}:${branch}`, base, body, maintainer_can_modify: true },
  });
  if (!r.ok) {
    if (r.status === 422 && String(r.data.message || '').includes('A pull request already exists')) {
      console.log('[pr-flow] PR 已存在，跳过创建。');
      return;
    }
    die(redact('创建 PR 失败: ' + JSON.stringify(r.data)));
  }
  console.log('[pr-flow] PR 创建成功 ✓  ' + r.data.html_url);
}

async function cmdRun(args) {
  // push + pr 一条龙（fork 按需）
  await cmdPush(args);
  await cmdPr(args);
}

// ---------- 辅助 ----------
async function whoamiLogin(token) {
  const me = await ghApi('GET', '/user', { token });
  if (!me.ok) die(redact('token 校验失败: ' + JSON.stringify(me.data)));
  return me.data.login;
}
function detectRemote(repoDir) {
  const r = spawnSync('git', ['-C', repoDir, 'remote', 'get-url', 'origin'], { encoding: 'utf-8' });
  const url = (r.stdout || '').trim();
  const m = url.match(/github\.com[/:](.+?)(?:\.git)?$/i);
  if (m) return m[1];
  return null;
}

// ---------- 入口 ----------
const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const handlers = { auth: cmdAuth, whoami: cmdWhoami, logout: cmdLogout, fork: async () => {
  const t = readToken(); if (!t) die('未授权：先运行 auth');
  if (!args.remote) die('用法: fork --remote OWNER/REPO');
  const login = t.login || (await whoamiLogin(t.token));
  await ensureFork(args.remote, t.token, login);
}, push: cmdPush, pr: cmdPr, run: cmdRun };
if (!handlers[cmd]) {
  console.log('用法: node pr_flow.mjs <auth|whoami|logout|fork|push|pr|run> [参数]\n  auth: 设备码授权（弹出 github.com/login/device）\n  run:  push + pr 一条龙 --repo DIR --remote OWNER/REPO --branch B --title T [--body-file F]');
  process.exit(cmd ? 1 : 0);
}
await handlers[cmd](args);

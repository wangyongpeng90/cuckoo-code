'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const Module = require('module');
const origLoad = Module._load;

function installMock() {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: { isPackaged: false, whenReady: () => Promise.resolve(), on: () => {}, quit: () => {} },
        dialog: { showMessageBox: async () => ({ response: 0 }) },
        Notification: { isSupported: () => false },
      };
    }
    if (request === 'electron-updater') {
      return {
        autoUpdater: {
          logger: null,
          autoDownload: true,
          autoInstallOnAppQuit: true,
          on: () => {},
          checkForUpdates: async () => {},
          downloadUpdate: async () => {},
          quitAndInstall: () => {},
        },
      };
    }
    if (request === 'electron-log') {
      return {
        transports: { file: { level: '' } },
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
      };
    }
    return origLoad.apply(this, arguments);
  };
}
function uninstallMock() {
  Module._load = origLoad;
}

beforeEach(() => {
  installMock();
  delete require.cache[require.resolve('../../src/main/updater')];
});

afterEach(() => {
  uninstallMock();
  delete require.cache[require.resolve('../../src/main/updater')];
});

test('isNetworkError 识别网络错误', () => {
  const updater = require('../../src/main/updater');
  assert.strictEqual(updater.isNetworkError({ message: 'net::ERR_CONNECTION_REFUSED' }), true);
  assert.strictEqual(updater.isNetworkError({ message: 'ECONNREFUSED' }), true);
  assert.strictEqual(updater.isNetworkError({ message: 'ETIMEDOUT' }), true);
  assert.strictEqual(updater.isNetworkError({ message: 'socket hang up' }), true);
});

test('isNetworkError 非网络错误返回 false', () => {
  const updater = require('../../src/main/updater');
  assert.strictEqual(updater.isNetworkError({ message: 'Cannot find latest.yml' }), false);
  assert.strictEqual(updater.isNetworkError({ message: 'unknown error' }), false);
  assert.strictEqual(updater.isNetworkError(null), false);
});

test('isGitHubAccessError 识别 GitHub 错误', () => {
  const updater = require('../../src/main/updater');
  assert.strictEqual(updater.isGitHubAccessError({ message: 'HttpError: 404' }), true);
  assert.strictEqual(updater.isGitHubAccessError({ message: 'api.github.com rate limit' }), true);
  assert.strictEqual(updater.isGitHubAccessError({ message: 'forbidden' }), true);
});

test('isGitHubAccessError 非 GitHub 错误返回 false', () => {
  const updater = require('../../src/main/updater');
  assert.strictEqual(updater.isGitHubAccessError({ message: 'ECONNREFUSED' }), false);
  assert.strictEqual(updater.isGitHubAccessError({ message: 'generic failure' }), false);
  assert.strictEqual(updater.isGitHubAccessError(null), false);
});

test('initAutoUpdater 开发环境不检查更新', () => {
  const updater = require('../../src/main/updater');
  // app.isPackaged 是 false，initAutoUpdater 应该直接返回，不抛异常
  assert.doesNotThrow(() => updater.initAutoUpdater({ isDestroyed: () => false }));
});

// ========== 回归：更新失败分类（禁止再出现"未知错误"却不给原因）==========
// 现场：便携 zip 缺少 resources/app-update.yml 时 checkForUpdates 抛 ENOENT，
// 旧代码把它归为"发生未知错误，请稍后重试。"，用户每次启动都收到无信息量的通知。

test('classifyUpdateError 识别 app-update.yml 缺失（打包缺陷）', () => {
  const updater = require('../../src/main/updater');
  const err = new Error("ENOENT: no such file or directory, open 'C:\\App\\resources\\app-update.yml'");
  err.code = 'ENOENT';
  const r = updater.classifyUpdateError(err);
  assert.strictEqual(r.kind, 'config');
  assert.match(r.detail, /app-update\.yml/);
  assert.strictEqual(updater.isMissingUpdateConfigError(err), true);
});

test('classifyUpdateError 识别证书类错误（代理/杀软 HTTPS 拦截）', () => {
  const updater = require('../../src/main/updater');
  const cases = [
    'unable to verify the first certificate',
    'unable to get local issuer certificate',
    'self signed certificate in certificate chain',
    'net::ERR_CERT_AUTHORITY_INVALID',
  ];
  for (const m of cases) {
    const r = updater.classifyUpdateError(new Error(m));
    assert.strictEqual(r.kind, 'cert', m);
    assert.strictEqual(updater.isCertificateError({ message: m }), true, m);
  }
});

test('classifyUpdateError 保留网络与 GitHub 两类原有分桶', () => {
  const updater = require('../../src/main/updater');
  assert.strictEqual(updater.classifyUpdateError(new Error('connect ETIMEDOUT')).kind, 'network');
  assert.strictEqual(updater.classifyUpdateError(new Error('HttpError: 404 Not Found')).kind, 'github');
});

test('classifyUpdateError 未知错误必须带上原始信息，不再只说"未知错误"', () => {
  const updater = require('../../src/main/updater');
  const r = updater.classifyUpdateError(new Error('Cannot read properties of undefined (reading x)'));
  assert.strictEqual(r.kind, 'unknown');
  assert.match(r.hint, /Cannot read properties of undefined/);
  assert.match(r.detail, /Cannot read properties of undefined/);
});

test('classifyUpdateError 容忍 null / 字符串 / 无 message 的错误', () => {
  const updater = require('../../src/main/updater');
  assert.strictEqual(updater.classifyUpdateError(null).kind, 'unknown');
  assert.strictEqual(updater.classifyUpdateError(undefined).kind, 'unknown');
  assert.strictEqual(updater.classifyUpdateError({}).kind, 'unknown');
  assert.match(updater.classifyUpdateError({}).hint, /无错误信息/);
});

test('证书错误优先于网络错误分桶（ERR_CERT 同时命中 net::err）', () => {
  const updater = require('../../src/main/updater');
  const err = new Error('net::ERR_CERT_DATE_INVALID');
  assert.strictEqual(updater.isNetworkError(err), true); // 旧的宽泛分桶也会命中
  assert.strictEqual(updater.classifyUpdateError(err).kind, 'cert'); // 但更具体的信息优先
});

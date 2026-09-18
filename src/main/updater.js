/**
 * Cuckoo Code 自动更新模块
 * 使用 electron-updater + generic provider（GitHub Releases）检查并下载更新。
 * 职责：检查更新、下载进度提示、下载完成提醒、网络错误友好提示。
 */
const { app, dialog, Notification, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// 便携模式：由 src/main/index.js 在数据目录解析后写入环境变量。
// zip 便携版无法自动安装更新（Windows 自动更新仅支持 NSIS），只提示并跳转下载页。
const IS_PORTABLE = process.env.CUCKOO_PORTABLE === '1';

// ========== 日志配置 ==========
// 打包版禁用文件日志持久化：不加载 electron-log，也不写文件
if (app.isPackaged) {
  autoUpdater.logger = console;
} else {
  const log = require('electron-log');
  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = 'info';
}
autoUpdater.autoDownload = false; // 检测到更新后不自动下载，等用户确认
autoUpdater.autoInstallOnAppQuit = !IS_PORTABLE; // 退出时自动安装（仅 NSIS 安装版支持）

/** 便携版跳转用的 Releases 页地址（读取 package.json 的 publish 配置，兼容数组/对象两种写法） */
function getReleasesUrl() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf-8'));
    const pub = pkg.build && (Array.isArray(pkg.build.publish) ? pkg.build.publish[0] : pkg.build.publish);
    if (pub && pub.owner && pub.repo) {
      return 'https://github.com/' + pub.owner + '/' + pub.repo + '/releases/latest';
    }
  } catch (err) {
    console.warn('[Updater] 读取 publish 配置失败:', err.message);
  }
  return 'https://github.com/wangyongpeng90/cuckoo-code/releases/latest';
}

// ========== 状态标志 ==========
let updateChecked = false;       // 是否已执行过检查
let updateDownloaded = false;    // 是否已下载完成
let isManualCheck = false;       // 是否是用户手动触发的检查
let mainWindowRef = null;        // 主窗口引用（用于弹出对话框）

/** 设置主窗口引用，用于对话框定位 */
function setMainWindow(win) {
  mainWindowRef = win;
}

/** 判断错误是否为网络连接类问题 */
function isNetworkError(error) {
  const msg = String(error && (error.message || error.stack) || '').toLowerCase();
  const networkKeywords = [
    'net::err',
    'err_connection',
    'err_name_not_resolved',
    'err_internet_disconnected',
    'err_network_changed',
    'err_proxy_connection_failed',
    'err_tunnel_connection_failed',
    'enotfound',
    'etimedout',
    'econnrefused',
    'econnreset',
    'cert_authority_invalid',
    'cert_common_name_invalid',
    'cert_date_invalid',
    'unable to resolve',
    'connect timeout',
    'network is unreachable',
    'socket hang up',
    'tls handshake',
  ];
  return networkKeywords.some((kw) => msg.includes(kw));
}

/** 判断错误是否为 GitHub 访问受限类问题 */
function isGitHubAccessError(error) {
  const msg = String(error && (error.message || error.stack) || '').toLowerCase();
  const githubKeywords = [
    '403',
    '404',
    'rate limit',
    'api.github.com',
    'github',
    'forbidden',
    'unauthorized',
  ];
  return githubKeywords.some((kw) => msg.includes(kw));
}

/**
 * 判断是否为 HTTPS 证书类错误
 * 代理 / VPN / 杀毒软件的 HTTPS 拦截会替换证书，之前这类错误全部落进"未知错误"。
 */
function isCertificateError(error) {
  const msg = String(error && (error.message || error.stack) || '').toLowerCase();
  const certKeywords = [
    'unable to verify the first certificate',
    'unable to get local issuer certificate',
    'unable_to_verify_leaf_signature',
    'self signed certificate',
    'self-signed certificate',
    'certificate has expired',
    'certificate is not yet valid',
    'err_cert',
    'err_ssl',
    'cert_',
    'schannel',
  ];
  return certKeywords.some((kw) => msg.includes(kw));
}

/** 判断是否为更新配置缺失（resources/app-update.yml 未随包分发） */
function isMissingUpdateConfigError(error) {
  const msg = String(error && (error.message || error.stack) || '').toLowerCase();
  return msg.includes('app-update.yml') && (msg.includes('enoent') || msg.includes('no such file'));
}

/** 从各种形态的 error 中取出可读文本（字符串 / Error / 无 message 的对象） */
function errorText(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error.message) return String(error.message);
  if (error.stack) return String(error.stack);
  return '';
}

/**
 * 归类更新错误，给出用户可读的标题、一句话提示与详情
 * @param {Error|string|null} error
 * @returns {{ kind: 'config'|'cert'|'network'|'github'|'unknown', message: string, hint: string, detail: string }}
 */
function classifyUpdateError(error) {
  const raw = errorText(error).slice(0, 300);

  if (isMissingUpdateConfigError(error)) {
    return {
      kind: 'config',
      message: '更新配置缺失',
      hint: '安装包缺少 app-update.yml（打包缺陷，非网络问题），请更新到修复版本',
      detail: '安装包内缺少 resources/app-update.yml，无法检查更新。这是打包缺陷，不是网络问题，请更新到修复版本。\n\n错误信息：' + raw,
    };
  }
  if (isCertificateError(error)) {
    return {
      kind: 'cert',
      message: 'HTTPS 证书校验失败',
      hint: '无法验证 GitHub 的 HTTPS 证书，请关闭代理 / VPN / 杀软 HTTPS 拦截后重试',
      detail: '无法验证 GitHub 的 HTTPS 证书，常见于代理、VPN 或杀毒软件的 HTTPS 拦截。请关闭后重试。\n\n错误信息：' + raw,
    };
  }
  if (isNetworkError(error)) {
    return {
      kind: 'network',
      message: '无法连接到更新服务器',
      hint: '无法连接 GitHub，请检查网络或代理',
      detail: '请检查网络连接。更新服务器位于 GitHub，可能需要代理或 VPN 才能访问。\n\n错误信息：' + raw,
    };
  }
  if (isGitHubAccessError(error)) {
    return {
      kind: 'github',
      message: '无法访问 GitHub 更新服务器',
      hint: 'GitHub 访问受限，请检查网络或代理',
      detail: 'GitHub 访问受限或更新资源不存在。请确认仓库名称和发布版本正确。\n\n错误信息：' + raw,
    };
  }
  return {
    kind: 'unknown',
    message: '检查更新失败',
    hint: '未预期错误：' + (raw || '（无错误信息）'),
    detail: '发生未预期错误。\n\n错误信息：' + (raw || '（无错误信息）'),
  };
}

// ========== 更新日志（打包版原本不落任何日志，更新失败无法排查）==========
const LOG_MAX_BYTES = 256 * 1024;

/** 追加一行更新日志到 <userData>/logs/updater.log，超过上限则重写 */
function logUpdaterEvent(line) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'updater.log');
    try {
      if (fs.statSync(file).size > LOG_MAX_BYTES) fs.writeFileSync(file, '', 'utf-8');
    } catch (_) { /* 首次写入时文件不存在 */ }
    fs.appendFileSync(file, '[' + new Date().toISOString() + '] ' + line + '\n', 'utf-8');
  } catch (err) {
    console.warn('[Updater] 写入更新日志失败:', err.message);
  }
}

/** 显示系统通知（不打断用户） */
function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

/** 弹出更新失败对话框，提供重试/取消选项 */
async function showUpdateErrorDialog(error, isManual) {
  const { kind, message, hint, detail } = classifyUpdateError(error);
  logUpdaterEvent((isManual ? 'manual' : 'auto') + ' check failed [' + kind + '] ' + errorText(error));

  // 自动检查失败时，静默提示即可，不弹对话框打扰用户
  if (!isManual) {
    showNotification('检查更新失败', hint);
    return false; // 自动检查失败不弹对话框
  }

  const options = {
    type: 'error',
    title: '更新失败',
    message,
    detail,
    buttons: ['重试', '取消'],
    defaultId: 0,
    cancelId: 1,
  };
  const parent = mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef : null;
  // dialog.showMessageBox 在 macOS 上必须使用 parent 参数，否则弹窗可能被隐藏

  const result = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  return result.response === 0; // 返回 true 表示用户点击了"重试"
}

/** 手动检查更新入口 */
async function checkForUpdates() {
  if (updateDownloaded) {
    // 已有下载完成的更新，直接提示安装
    const options = {
      type: 'info',
      title: '更新已就绪',
      message: '新版本已下载完成',
      detail: '是否立即重启应用并安装更新？',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
    };
    const parent = mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef : null;
    const result = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
    return;
  }

  isManualCheck = true;
  updateChecked = false;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.error('[Updater] 检查更新异常:', error);
    await showUpdateErrorDialog(error, true);
  }
}

// ========== 注册 autoUpdater 事件 ==========

autoUpdater.on('checking-for-update', () => {
  console.log('[Updater] 正在检查更新...');
  if (isManualCheck) {
    showNotification('检查更新', '正在检查是否有新版本...');
  }
});

autoUpdater.on('update-available', async (info) => {
  console.log('[Updater] 发现新版本:', info.version);
  logUpdaterEvent('update available: v' + info.version);

  // 便携版：zip 无法自动安装，提示用户去下载页手动覆盖升级
  if (IS_PORTABLE) {
    isManualCheck = false;
    const portableOptions = {
      type: 'info',
      title: '发现新版本',
      message: '发现新版本 v' + info.version,
      detail: '便携版不支持自动安装更新。\n\n升级方法：下载新版便携 zip，覆盖解压到当前目录即可（data 数据文件夹会保留）。',
      buttons: ['打开下载页', '暂不'],
      defaultId: 0,
      cancelId: 1,
    };
    const portableParent = mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef : null;
    const portableResult = portableParent
      ? await dialog.showMessageBox(portableParent, portableOptions)
      : await dialog.showMessageBox(portableOptions);
    if (portableResult.response === 0) {
      const url = getReleasesUrl();
      console.log('[Updater] 打开下载页:', url);
      if (shell && typeof shell.openExternal === 'function') {
        shell.openExternal(url);
      }
    }
    return;
  }

  const options = {
    type: 'info',
    title: '发现新版本',
    message: '发现新版本 v' + info.version,
    detail: '是否现在下载更新？下载完成后可在退出时自动安装。',
    buttons: ['立即下载', '暂不下载'],
    defaultId: 0,
    cancelId: 1,
  };
  const parent = mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef : null;
  const result = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  if (result.response === 0) {
    showNotification('开始下载', '正在下载 v' + info.version + '...');
    autoUpdater.downloadUpdate().catch((err) => {
      console.error('[Updater] 下载失败:', err);
    });
  } else {
    isManualCheck = false;
  }
});

autoUpdater.on('update-not-available', () => {
  console.log('[Updater] 已是最新版本');
  logUpdaterEvent('update not available (current v' + app.getVersion() + ')');
  if (isManualCheck) {
    showNotification('已是最新版本', '当前已是最新版本。');
  }
  isManualCheck = false;
});

autoUpdater.on('download-progress', (progressObj) => {
  const percent = Math.round(progressObj.percent);
  console.log('[Updater] 下载进度:', percent + '%');
  // 仅在手动检查时显示进度通知
  if (isManualCheck && percent % 10 === 0) {
    showNotification('下载更新中', '已下载 ' + percent + '%');
  }
});

autoUpdater.on('update-downloaded', (info) => {
  updateDownloaded = true;
  console.log('[Updater] 新版本已下载:', info.version);

  // 弹窗询问是否立即安装
  const options = {
    type: 'info',
    title: '更新已就绪',
    message: '新版本 v' + info.version + ' 已下载完成',
    detail: '是否立即重启应用并安装更新？',
    buttons: ['立即重启', '稍后'],
    defaultId: 0,
    cancelId: 1,
  };
  const parent = mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef : null;

  const dialogPromise = parent
    ? dialog.showMessageBox(parent, options)
    : dialog.showMessageBox(options);

  dialogPromise.then((result) => {
    isManualCheck = false;
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});

autoUpdater.on('error', async (error) => {
  console.error('[Updater] 更新错误:', error);
  const shouldRetry = await showUpdateErrorDialog(error, isManualCheck);
  if (shouldRetry) {
    // 用户点击重试
    isManualCheck = true;
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('[Updater] 重试检查更新失败:', err);
        isManualCheck = false;
      });
    }, 1000);
  } else {
    isManualCheck = false;
  }
});

// ========== 启动时自动检查 ==========
function initAutoUpdater(win) {
  setMainWindow(win);

  // 仅在生产环境（打包后）才检查更新
  if (!app.isPackaged) {
    console.log('[Updater] 开发环境，跳过自动检查更新');
    return;
  }

  // 应用启动后延迟 5 秒检查，避免影响启动速度
  setTimeout(() => {
    console.log('[Updater] 启动自动检查更新');
    autoUpdater.checkForUpdates().catch((error) => {
      console.error('[Updater] 启动检查更新失败:', error);
    });
  }, 5000);
}

module.exports = {
  initAutoUpdater,
  checkForUpdates,
  setMainWindow,
  isNetworkError,
  isGitHubAccessError,
  isCertificateError,
  isMissingUpdateConfigError,
  classifyUpdateError,
};

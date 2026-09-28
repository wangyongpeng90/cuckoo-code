/**
 * Cuckoo Code 自动更新模块
 * 使用 electron-updater + generic provider（GitHub Releases）检查并下载更新。
 * 职责：检查更新、下载进度提示、下载完成提醒、网络错误友好提示。
 */
import { createRequire } from 'node:module';
import updaterPkg from 'electron-updater';

// electron 特殊：其 index.js 导出字符串，须用 createRequire（见 P3a 手册 1.5）
const require = createRequire(import.meta.url);
const { app, dialog, Notification } = require('electron');
const { autoUpdater } = updaterPkg;

// ========== 日志配置 ==========
// 打包版禁用文件日志持久化：不加载 electron-log，也不写文件
if (app.isPackaged) {
  autoUpdater.logger = console;
} else {
  const { default: log } = await import('electron-log');
  autoUpdater.logger = log;
  (autoUpdater.logger as any).transports.file.level = 'info';
}
autoUpdater.autoDownload = false; // 检测到更新后不自动下载，等用户确认
autoUpdater.autoInstallOnAppQuit = true; // 退出时自动安装（支持 NSIS）

// ========== 状态标志 ==========
let updateChecked = false;       // 是否已执行过检查
let updateDownloaded = false;    // 是否已下载完成
let isManualCheck = false;       // 是否是用户手动触发的检查
let mainWindowRef: any = null;   // 主窗口引用（用于弹出对话框）

/** 设置主窗口引用，用于对话框定位 */
function setMainWindow(win: any): void {
  mainWindowRef = win;
}

/** 判断错误是否为网络连接类问题 */
function isNetworkError(error: any): boolean {
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
function isGitHubAccessError(error: any): boolean {
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

/** 显示系统通知（不打断用户） */
function showNotification(title: string, body: string): void {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

/** 弹出更新失败对话框，提供重试/取消选项 */
async function showUpdateErrorDialog(error: any, isManual: boolean): Promise<boolean> {
  // 自动检查失败时，静默提示即可，不弹对话框打扰用户
  if (!isManual) {
    const detail = isNetworkError(error) || isGitHubAccessError(error)
      ? '无法连接到更新服务器（GitHub），请检查网络连接。'
      : '发生未知错误，请稍后重试。';
    showNotification('检查更新失败', detail);
    return false; // 自动检查失败不弹对话框
  }

  // 手动检查失败时，弹出对话框并给出详细原因
  let message = '检查更新失败';
  let detail = '';
  if (isNetworkError(error)) {
    message = '无法连接到更新服务器';
    detail = '请检查网络连接。更新服务器位于 GitHub，可能需要代理或 VPN 才能访问。\n\n错误信息：' + (error.message || '');
  } else if (isGitHubAccessError(error)) {
    message = '无法访问 GitHub 更新服务器';
    detail = 'GitHub 访问受限或更新资源不存在。请确认仓库名称和发布版本正确。\n\n错误信息：' + (error.message || '');
  } else {
    detail = '发生未知错误。\n\n错误信息：' + (error.message || '');
  }

  const options: any = {
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
async function checkForUpdates(): Promise<void> {
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
  } catch (error: any) {
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

autoUpdater.on('update-available', async (info: any) => {
  console.log('[Updater] 发现新版本:', info.version);
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
  if (isManualCheck) {
    showNotification('已是最新版本', '当前已是最新版本。');
  }
  isManualCheck = false;
});

autoUpdater.on('download-progress', (progressObj: any) => {
  const percent = Math.round(progressObj.percent);
  console.log('[Updater] 下载进度:', percent + '%');
  // 仅在手动检查时显示进度通知
  if (isManualCheck && percent % 10 === 0) {
    showNotification('下载更新中', '已下载 ' + percent + '%');
  }
});

autoUpdater.on('update-downloaded', (info: any) => {
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

  dialogPromise.then((result: any) => {
    isManualCheck = false;
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});

autoUpdater.on('error', async (error: any) => {
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
// 已关闭：不再启动时自动检查更新（避免弹「发现新版本」提示打扰用户）。
// 如需更新，可通过菜单「检查更新」手动触发。
function initAutoUpdater(win: any): void {
  setMainWindow(win);
  console.log('[Updater] 启动自动检查已关闭（可经菜单手动检查）');
}

export {
  initAutoUpdater,
  checkForUpdates,
  setMainWindow,
  isNetworkError,
  isGitHubAccessError,
};

/**
 * 会话列表功能（渲染、导航、初始化项目按钮）
 * 由原 preload.js 拆分而来，逻辑保持不变。
 */
import { escapeHtml, showToast } from './panel.js';

// ========== 会话列表功能 ==========

/**
 * 渲染当前项目目录关联的会话列表
 */
async function renderSessions(): Promise<void> {
  const listContainer = document.getElementById('cuckoo-session-list');
  if (!listContainer) return;

  try {
    if (!(window as any).electronAPI || !(window as any).electronAPI.listSessions) {
      listContainer.innerHTML = '<div class="cuckoo-session-empty">API 不可用</div>';
      return;
    }

    const result = await (window as any).electronAPI.listSessions();
    if (!result.success) {
      listContainer.innerHTML = '<div class="cuckoo-session-empty">加载失败</div>';
      return;
    }

    // 兼容两种返回：字符串数组（旧）或 { sessionId, title, ... } 对象数组（新）
    const raw = result.sessions || [];
    const sessions = raw.map((s: any) => (typeof s === 'string' ? { sessionId: s, title: null } : s));
    if (sessions.length === 0) {
      listContainer.innerHTML = '<div class="cuckoo-session-empty">暂无会话</div>';
      return;
    }

    listContainer.innerHTML = sessions.map((s: any) => `
      <div class="cuckoo-session-item" data-session-id="${escapeHtml(s.sessionId)}">
        <span class="session-id">${escapeHtml(s.title || s.sessionId)}</span>
        <span class="session-action">▶ 跳转</span>
      </div>
    `).join('');

    // 绑定点击事件
    listContainer.querySelectorAll('.cuckoo-session-item').forEach((item) => {
      item.addEventListener('click', () => {
        const sessionId = (item as any).dataset.sessionId;
        if (sessionId) handleNavigateSession(sessionId);
      });
    });
  } catch (err) {
    console.error('[Cuckoo Code] 渲染会话列表失败:', err);
    listContainer.innerHTML = '<div class="cuckoo-session-empty">加载出错</div>';
  }
}

/**
 * 导航到指定会话
 */
async function handleNavigateSession(sessionId: string): Promise<void> {
  if (!sessionId) return;

  try {
    if (!(window as any).electronAPI || !(window as any).electronAPI.navigateSession) {
      showToast('导航 API 不可用', 3000);
      return;
    }

    const result = await (window as any).electronAPI.navigateSession(sessionId);
    if (result.success) {
      console.log('[Cuckoo Code] 已导航到会话:', sessionId);
      // 导航成功后，覆盖层可以保持打开，但用户可能会看到页面跳转
      // 小延迟后刷新会话列表
      setTimeout(renderSessions, 2000);
    } else {
      showToast('导航失败: ' + (result.error || '未知错误'), 3000);
    }
  } catch (err: any) {
    console.error('[Cuckoo Code] 导航到会话失败:', err);
    showToast('导航失败: ' + err.message, 3000);
  }
}

/**
 * 初始化项目按钮点击处理
 * 新逻辑：只选择目录，选完后弹出自定义的输入框，由用户输入后合并发送。
 */
async function handleInitProject(): Promise<void> {
  const initBtn = document.getElementById('cuckoo-btn-init') as any;
  if (initBtn) {
    initBtn.disabled = true;
    initBtn.textContent = '⏳ 选择目录中...';
  }

  try {
    if (!(window as any).electronAPI || !(window as any).electronAPI.selectProjectDir) {
      throw new Error('window.electronAPI.selectProjectDir 不存在');
    }
    const result = await (window as any).electronAPI.selectProjectDir();
    if (result && !result.success) {
      showToast(result.message || '目录选择失败', 3000);
    }
  } catch (err: any) {
    console.error('[Cuckoo Code] 选择目录失败:', err);
    showToast('选择目录失败: ' + err.message, 3000);
  } finally {
    if (initBtn) {
      initBtn.disabled = false;
      initBtn.textContent = '初始化项目';
    }
  }
}

export { renderSessions, handleNavigateSession, handleInitProject };

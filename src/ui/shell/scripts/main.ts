/**
 * 壳页面脚本入口。
 * 导入各模块（副作用：绑定事件），注册 tab 加载器，做预加载。
 */
import { api } from './shared.js';
import { registerTab } from './sidebar.js';
import './toolbar.js';
import './platform.js';

import { loadWorkspaces } from './pages/workspaces.js';
import { loadSnippets } from './pages/snippets.js';
import { loadSkills } from './pages/skills.js';
import { loadAgents } from './pages/agents.js';
import { loadMcpServers } from './pages/mcp.js';
import { loadAutoCompact } from './pages/token.js';
import { loadAbout } from './pages/about.js';
import { loadFeishu } from './pages/feishu.js';
import { renderWindowList } from './pages/windows.js';
import { loadSettings } from './pages/settings.js';
import { renderRecent } from './recent.js';
import { loadConversations } from './pages/conversations.js';
import { loadPlugins } from './pages/plugins.js';

// 注册 tab → 加载函数（sidebar 点击时调用）
registerTab('workspaces', loadWorkspaces);
registerTab('snippets', loadSnippets);
registerTab('skills', loadSkills);
registerTab('agents', loadAgents);
registerTab('mcp', loadMcpServers);
registerTab('token', loadAutoCompact);
registerTab('about', loadAbout);
registerTab('feishu', loadFeishu);
registerTab('windows', renderWindowList);
registerTab('settings', loadSettings);
registerTab('conversations', loadConversations);
registerTab('plugins', loadPlugins);

// 预加载：工作区（默认页）+ 提示词 + 自动压缩配置
try { loadWorkspaces(); } catch (_) { /* ignore */ }
try { loadSnippets(); } catch (_) { /* ignore */ }
try { loadAutoCompact(); } catch (_) { /* ignore */ }

// 渲染底部状态栏「最近使用」
try { renderRecent(); } catch (_) { /* ignore */ }

// 上报壳页面真实可视尺寸（主进程据此精确布局，避免菜单栏高度误差盖住状态栏）
function reportShellSize(): void {
  if (api.reportShellSize) api.reportShellSize(window.innerWidth, window.innerHeight);
}
reportShellSize();
window.addEventListener('resize', reportShellSize);

// 其他窗口改了提示词 → 本窗口同步刷新
if ((api as any).onSnippetsChanged) {
  (api as any).onSnippetsChanged(() => { try { loadSnippets(); } catch (_) { /* ignore */ } });
}

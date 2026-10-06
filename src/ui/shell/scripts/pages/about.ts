/**
 * 关于页：版本号、检查更新、开源地址、QQ 群。
 */
import { api, ckAlert } from '../shared.js';

export async function loadAbout(): Promise<void> {
  if (api.getAppInfo) {
    try {
      const r = await api.getAppInfo();
      const verEl = document.getElementById('about-version');
      if (r && r.success && verEl) verEl.textContent = r.version || '—';
    } catch (_) { /* ignore */ }
  }
  if (api.getAssetUrl) {
    try {
      const ru = await api.getAssetUrl('assets/qq-group.jpg');
      const img = document.getElementById('about-qq') as any;
      if (ru && ru.success && img) img.src = ru.url;
    } catch (_) { /* ignore */ }
  }
}

// 插件改造版：已删除「检查更新」按钮（禁用原版在线更新）
document.getElementById('about-github')?.addEventListener('click', () => {
  if (api.openExternal) api.openExternal('https://github.com/wangyongpeng90/cuckoo-code');
});

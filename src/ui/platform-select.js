// 平台选择页（首页）逻辑（ES Module，供 happy-dom 测试导入）。
// 安全约束：provider 的 name/id 来自用户导入的 JS 文件（不受信输入），
// 一律经 createElement/textContent 构建，禁止拼 innerHTML。
'use strict';

export function initPlatformSelect(api, doc) {
  api = api || {};

  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showStatus(message, isError) {
    const listEl = doc.getElementById('platform-list');
    listEl.textContent = '';
    listEl.appendChild(el('div', isError ? 'cuckoo-empty error' : 'cuckoo-empty', message));
  }

  // ===== 页内轻提示（浅色 toast，瞬态交互对照壳面板 showPanelToast） =====
  function showToast(text, isError, ms) {
    const toast = doc.getElementById('ps-toast');
    if (!toast) return;
    toast.textContent = text;
    toast.classList.toggle('error', !!isError);
    toast.hidden = false;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(function () {
      toast.hidden = true;
    }, ms || 2500);
  }

  // ===== 快速操作：当前项目目录展示 + 初始化项目 / 修改项目目录 =====

  const dirEl = doc.getElementById('ps-project-dir');
  const dirHintEl = doc.getElementById('ps-dir-hint');

  function renderProjectDir(dir) {
    if (dirEl) dirEl.textContent = dir || '未选择';
    if (dirHintEl) dirHintEl.hidden = !!dir;
  }

  async function loadProjectDir() {
    if (!api.getProjectDir) {
      renderProjectDir(null);
      return;
    }
    try {
      const res = await api.getProjectDir();
      renderProjectDir(res && res.success ? res.projectDir || null : null);
    } catch (err) {
      console.error('[Cuckoo Code] 获取项目目录失败:', err);
      renderProjectDir(null);
    }
  }

  /** 初始化项目（busy 态对照壳项目面板）；首页无聊天输入框，传 skipPrompt 不发初始提示 */
  const btnInitProject = doc.getElementById('ps-btn-init-project');
  if (btnInitProject) {
    btnInitProject.addEventListener('click', async function () {
      if (!api.initProject) {
        showToast('API 不可用', true, 3000);
        return;
      }
      btnInitProject.disabled = true;
      const prevText = btnInitProject.textContent;
      btnInitProject.textContent = '初始化中...';
      try {
        const result = await api.initProject(null, false, '', false, true);
        if (result && result.success) {
          showToast(result.message || '初始化完成');
          // 初始化可能改选了目录，重新拉取展示
          await loadProjectDir();
        } else if (result && result.canceled) {
          // 用户取消目录选择：中性提示，不算错误
          showToast(result.message || '已取消');
        } else {
          showToast((result && result.message) || '初始化失败', true, 3000);
        }
      } catch (err) {
        showToast('初始化失败: ' + (err && err.message ? err.message : err), true, 3000);
      } finally {
        btnInitProject.disabled = false;
        btnInitProject.textContent = prevText;
      }
    });
  }

  /** 修改目录：只更新目录映射，不重新发送初始提示（updateProjectDir = skipPrompt） */
  const btnChangeDir = doc.getElementById('ps-btn-change-dir');
  if (btnChangeDir) {
    btnChangeDir.addEventListener('click', async function () {
      if (!api.updateProjectDir) {
        showToast('API 不可用', true, 3000);
        return;
      }
      btnChangeDir.disabled = true;
      const prevText = btnChangeDir.textContent;
      btnChangeDir.textContent = '修改中...';
      try {
        const result = await api.updateProjectDir();
        if (result && result.success) {
          showToast(result.message || '项目目录已更新');
          await loadProjectDir();
        } else if (result && result.canceled) {
          // 用户取消目录选择：中性提示，不算错误
          showToast(result.message || '已取消');
        } else {
          showToast((result && result.message) || '修改目录失败', true, 3000);
        }
      } catch (err) {
        showToast('修改目录失败: ' + (err && err.message ? err.message : err), true, 3000);
      } finally {
        btnChangeDir.disabled = false;
        btnChangeDir.textContent = prevText;
      }
    });
  }

  // ===== 平台卡片 =====

  function buildLogoBox(p) {
    const box = el('div', 'platform-logo');
    box.dataset.name = p.name || '';
    const img = doc.createElement('img');
    img.src = 'logos/' + encodeURIComponent(p.id) + '.svg';
    img.alt = (p.name || '') + ' logo';
    img.addEventListener('error', function () {
      const name = box.dataset.name || '?';
      box.textContent = '';
      box.appendChild(el('span', 'logo-fallback', name.charAt(0).toUpperCase()));
    });
    box.appendChild(img);
    return box;
  }

  function buildProviderCard(p) {
    const card = el('div', 'platform-card');
    card.dataset.id = p.id;

    if (p.custom) {
      const replaceBtn = el('button', 'platform-replace', '↻');
      replaceBtn.dataset.id = p.id;
      replaceBtn.title = '替换';
      const deleteBtn = el('button', 'platform-delete', '×');
      deleteBtn.dataset.id = p.id;
      deleteBtn.dataset.path = p.path || '';
      deleteBtn.title = '删除';
      card.appendChild(replaceBtn);
      card.appendChild(deleteBtn);
    }

    card.appendChild(buildLogoBox(p));
    card.appendChild(el('div', 'platform-name', p.name || ''));
    card.appendChild(el('div', 'platform-desc', '点击进入'));
    return card;
  }

  function buildImportCard() {
    const card = el('div', 'platform-card');
    card.id = 'platform-import-card';
    const logo = el('div', 'platform-logo');
    logo.appendChild(el('span', 'logo-plus', '+'));
    card.appendChild(logo);
    card.appendChild(el('div', 'platform-name', '导入 Provider'));
    card.appendChild(el('div', 'platform-desc', '选择 JS 文件'));
    return card;
  }

  async function loadPlatforms() {
    if (!api.listProviders) {
      showStatus('API 未就绪，请重启应用', true);
      return;
    }
    try {
      const res = await api.listProviders();
      const providers = (res && res.success && res.providers) || [];
      const listEl = doc.getElementById('platform-list');
      if (!providers.length) {
        showStatus('暂无可用平台', false);
        return;
      }
      listEl.textContent = '';
      for (const p of providers) {
        listEl.appendChild(buildProviderCard(p));
      }
      listEl.appendChild(buildImportCard());

      listEl.querySelectorAll('.platform-card[data-id]').forEach(function (card) {
        card.addEventListener('click', async function () {
          const providerId = card.dataset.id;
          try {
            await api.selectPlatform(providerId);
          } catch (err) {
            // 失败提示
            showToast('进入平台失败: ' + (err && err.message ? err.message : err), true, 3000);
          }
        });
      });

      listEl.querySelectorAll('.platform-delete').forEach(function (btn) {
        btn.addEventListener('click', async function (e) {
          e.stopPropagation();
          const filePath = btn.dataset.path;
          const providerId = btn.dataset.id;
          if (!filePath) return;
          // 卡片内联二次确认：第一次点击变「确认删除？」，3 秒未确认自动还原
          if (!btn.classList.contains('confirming')) {
            btn.classList.add('confirming');
            btn.textContent = '确认删除？';
            clearTimeout(btn._confirmTimer);
            btn._confirmTimer = setTimeout(function () {
              btn.classList.remove('confirming');
              btn.textContent = '×';
            }, 3000);
            return;
          }
          clearTimeout(btn._confirmTimer);
          btn.classList.remove('confirming');
          btn.textContent = '×';
          try {
            const res = await api.removeProvider(filePath, providerId);
            if (res && res.success) {
              showToast('已删除 Provider');
              await loadPlatforms();
            } else {
              showToast('删除失败: ' + ((res && res.error) || '未知错误'), true, 3000);
            }
          } catch (err) {
            showToast('删除失败: ' + (err.message || err), true, 3000);
          }
        });
      });

      listEl.querySelectorAll('.platform-replace').forEach(function (btn) {
        btn.addEventListener('click', async function (e) {
          e.stopPropagation();
          const providerId = btn.dataset.id;
          try {
            const res = await api.replaceProvider(providerId);
            if (res && res.success) {
              showToast('替换成功');
              await loadPlatforms();
            } else if (res && res.canceled) {
              // 用户取消，不处理
            } else {
              showToast('替换失败: ' + ((res && res.error) || '未知错误'), true, 3000);
            }
          } catch (err) {
            showToast('替换失败: ' + (err.message || err), true, 3000);
          }
        });
      });

      const importCard = doc.getElementById('platform-import-card');
      if (importCard) {
        importCard.addEventListener('click', async function () {
          try {
            const res = await api.importProvider();
            if (res && res.success) {
              // 导入成功后刷新平台列表
              await loadPlatforms();
            } else if (res && res.canceled) {
              // 用户取消，不处理
            } else {
              showToast('导入失败: ' + ((res && res.error) || '未知错误'), true, 3000);
            }
          } catch (err) {
            showToast('导入失败: ' + (err.message || err), true, 3000);
          }
        });
      }
    } catch (err) {
      showStatus('加载失败: ' + (err && err.message ? err.message : err), true);
    }
  }

  loadProjectDir();
  loadPlatforms();
}

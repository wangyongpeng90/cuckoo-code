/**
 * 飞书同步页（React 版）
 *
 * 迁移自 pages/feishu.ts：
 * - 配置（App ID/Secret/启用）
 * - 本窗口绑定的飞书群
 * - 推送内容选项
 */
import { createElement, useState, useEffect, useCallback } from 'react';
import { api, ckAlert } from '../shared.js';

interface FeishuCfg { appId?: string; appSecret?: string; hasSecret?: boolean; enabled?: boolean; pushUserMessage?: boolean; pushAiReply?: boolean; pushToolStatus?: boolean; pushToolName?: boolean; }
interface Chat { chatId: string; name: string; }
interface Binding { chatId?: string; chatName?: string; }

/** 开关行（多个开关并列时用紧凑样式） */
function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return createElement('div', { className: 'ck-set-field ck-set-toggle' },
    createElement('span', { className: 'ck-set-key' }, label),
    createElement('label', { className: 'ck-switch' },
      createElement('input', { type: 'checkbox', checked, onChange: (e: any) => onChange(e.target.checked) }),
      createElement('span', { className: 'ck-switch-track' }),
    ),
  );
}

/** 飞书同步页 */
export function FeishuPage() {
  const [cfg, setCfg] = useState<FeishuCfg>({});
  const [status, setStatus] = useState<{ status: string; detail: string }>({ status: '', detail: '' });
  const [chats, setChats] = useState<Chat[]>([]);
  const [binding, setBinding] = useState<Binding>({});

  const loadBinding = useCallback(async () => {
    if (!api.getFeishuBinding) return;
    try {
      const b = await api.getFeishuBinding();
      if (api.listFeishuChats) {
        const lr = await api.listFeishuChats();
        setChats((lr && lr.success && lr.chats) || []);
      }
      setBinding(b || {});
    } catch (_) { /* ignore */ }
  }, []);

  const load = useCallback(async () => {
    if (!api.getFeishuConfig) return;
    try {
      const r = await api.getFeishuConfig();
      if (r && r.success) {
        setCfg(r.config || {});
        setStatus({ status: r.status || '', detail: r.statusDetail || '' });
      }
      await loadBinding();
    } catch (_) { /* ignore */ }
  }, [loadBinding]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async () => {
    if (!api.saveFeishuConfig) return;
    try {
      const r = await api.saveFeishuConfig(cfg as any);
      if (r && r.success) { await load(); } else { await ckAlert((r && r.error) || '保存失败'); }
    } catch (e: any) { await ckAlert('保存失败: ' + (e.message || e)); }
  }, [cfg, load]);

  const savePush = useCallback(async () => {
    if (!api.saveFeishuConfig) return;
    try {
      const r = await api.saveFeishuConfig({ pushUserMessage: !!cfg.pushUserMessage, pushAiReply: !!cfg.pushAiReply, pushToolStatus: !!cfg.pushToolStatus, pushToolName: !!cfg.pushToolName } as any);
      if (!(r && r.success)) await ckAlert((r && r.error) || '保存失败');
    } catch (e: any) { await ckAlert('保存失败: ' + (e.message || e)); }
  }, [cfg]);

  const onBind = useCallback(async (chatId: string) => {
    if (!api.bindFeishuChat) return;
    const chat = chats.find((c) => c.chatId === chatId);
    try { await api.bindFeishuChat(chatId, chat ? chat.name : ''); await loadBinding(); } catch (_) { /* ignore */ }
  }, [chats, loadBinding]);

  const onUnbind = useCallback(async () => {
    if (!api.bindFeishuChat) return;
    try { await api.bindFeishuChat('', ''); await loadBinding(); } catch (_) { /* ignore */ }
  }, [loadBinding]);

  const onDisconnect = useCallback(async () => {
    const anyApi = api as any;
    if (!anyApi.disconnectFeishu) return;
    try { await anyApi.disconnectFeishu(); } catch (_) { /* ignore */ }
    await load();
  }, [load]);

  const statusLabel = status.status === 'connected' ? '已连接' : status.status === 'connecting' ? '连接中…' : status.status === 'error' ? ('错误：' + (status.detail || '')) : '未连接';

  return createElement('div', { className: 'ck-tab ck-tab-active' },
    createElement('div', { className: 'ck-card' },
      createElement('div', { className: 'ck-set-group-title' }, '飞书同步'),
      createElement('p', { className: 'ck-about-tip' }, '还没配置过？',
        createElement('a', { href: '#', style: { color: 'var(--ck-primary)', cursor: 'pointer', textDecoration: 'underline' }, onClick: (e: any) => { e.preventDefault(); if (api.openFeishuSetup) api.openFeishuSetup(); } }, '查看图文配置教程 →')),
      createElement('div', { className: 'ck-set-field' },
        createElement('span', { className: 'ck-set-key' }, 'App ID'),
        createElement('input', { type: 'text', className: 'ck-set-input', placeholder: 'cli_xxxxxx', value: cfg.appId || '', onChange: (e: any) => setCfg({ ...cfg, appId: e.target.value }) }),
      ),
      createElement('div', { className: 'ck-set-field' },
        createElement('span', { className: 'ck-set-key' }, 'App Secret'),
        createElement('input', { type: 'password', className: 'ck-set-input', placeholder: cfg.hasSecret ? '（已保存，留空则不变）' : '填写应用的 App Secret', value: cfg.appSecret || '', onChange: (e: any) => setCfg({ ...cfg, appSecret: e.target.value }) }),
      ),
      createElement(ToggleRow, { label: '启用飞书同步', checked: !!cfg.enabled, onChange: (v) => setCfg({ ...cfg, enabled: v }) }),
      createElement('div', { className: 'ck-actions' },
        createElement('button', { className: 'ck-btn ck-btn-primary', onClick: save }, '保存并连接'),
        createElement('button', { className: 'ck-btn ck-btn-secondary', onClick: onDisconnect }, '断开'),
      ),
      createElement('div', { className: 'fs-status' },
        createElement('span', { className: 'fs-dot' + (status.status === 'connected' ? ' connected' : status.status === 'error' ? ' error' : status.status === 'connecting' ? ' connecting' : '') }),
        createElement('span', { className: 'ck-set-key' }, statusLabel),
      ),
    ),
    createElement('div', { className: 'ck-card' },
      createElement('div', { className: 'ck-set-group-title' }, '本窗口绑定的飞书群'),
      createElement('p', { className: 'ck-about-tip' }, '把机器人拉进一个飞书群，这里选它。', createElement('strong', null, '每个窗口绑定各自的群'), '，对话互不干扰。'),
      createElement('div', { className: 'ck-set-field' },
        createElement('span', { className: 'ck-set-key' }, '飞书群'),
        createElement('select', { className: 'ck-set-input', value: binding.chatId || '', onChange: (e: any) => onBind(e.target.value) },
          createElement('option', { value: '' }, '（未绑定 —— 该窗口飞书功能关闭）'),
          ...chats.map((c) => createElement('option', { key: c.chatId, value: c.chatId }, c.name)),
        ),
      ),
      createElement('div', { className: 'ck-actions' },
        createElement('button', { className: 'ck-btn ck-btn-secondary', onClick: loadBinding }, '刷新群列表'),
        createElement('button', { className: 'ck-btn ck-btn-secondary', onClick: onUnbind }, '解绑'),
      ),
      createElement('div', { className: 'fs-status' },
        createElement('span', { className: 'ck-set-key' }, (binding && binding.chatId) ? ('已绑定：' + (binding.chatName || binding.chatId)) : '未绑定'),
      ),
    ),
    createElement('div', { className: 'ck-card' },
      createElement('div', { className: 'ck-set-group-title' }, '推送内容（Cuckoo → 飞书）'),
      createElement(ToggleRow, { label: '用户消息', checked: cfg.pushUserMessage !== false, onChange: (v) => setCfg({ ...cfg, pushUserMessage: v }) }),
      createElement(ToggleRow, { label: 'AI 回复', checked: cfg.pushAiReply !== false, onChange: (v) => setCfg({ ...cfg, pushAiReply: v }) }),
      createElement(ToggleRow, { label: '工具调用状态', checked: cfg.pushToolStatus !== false, onChange: (v) => setCfg({ ...cfg, pushToolStatus: v }) }),
      createElement(ToggleRow, { label: '工具状态带工具名（默认关，隐私）', checked: cfg.pushToolName === true, onChange: (v) => setCfg({ ...cfg, pushToolName: v }) }),
      createElement('div', { className: 'ck-actions' }, createElement('button', { className: 'ck-btn ck-btn-primary', onClick: savePush }, '保存推送设置')),
    ),
    createElement('div', { className: 'ck-card' },
      createElement('div', { className: 'ck-set-group-title' }, '接收（飞书 → Cuckoo）'),
      createElement('p', { className: 'ck-about-tip' }, '在', createElement('strong', null, '绑定的群'), '里发消息（可 @ 或直接发），会送到', createElement('strong', null, '本窗口'), '发给 AI。', createElement('br'), '一个群只对应一个窗口；未绑定群的窗口不推也不收。'),
    ),
  );
}

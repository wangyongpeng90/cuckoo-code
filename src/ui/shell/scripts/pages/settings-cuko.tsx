import { createElement, useState, useEffect } from 'react';
import { Select } from '../components/select.js';
import { api } from '../shared.js';
import { CukoIntegrationDialog } from './cuko-integration.js';

export function CukoSettings() {
  const [cukoProviders, setCukoProviders] = useState<any[]>([]);
  const [cukoEditing, setCukoEditing] = useState(false);
  const [cukoLoading, setCukoLoading] = useState(false);
  const [cukoErr, setCukoErr] = useState('');
  const [tip, setTip] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  
  // 市场相关状态
  const [showMarket, setShowMarket] = useState(false);
  const [marketItems, setMarketItems] = useState<any[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);

  // 当前正在编辑的表单数据
  const [editProvider, setEditProvider] = useState<any>({
    id: '', name: '', baseUrl: 'http://127.0.0.1:3000', apiKey: '', protocol: 'cuko', models: []
  });

  const showTip = (msg: string) => {
    setTip(msg);
    setTimeout(() => setTip(''), 2000);
  };

  const loadMarket = async () => {
    setMarketLoading(true);
    try {
      if ((window as any).cukoAPI && (window as any).cukoAPI.marketList) {
        const res = await (window as any).cukoAPI.marketList('cuko-api');
        if (res.success) setMarketItems(res.items || []);
        else showTip(res.error || '搜索失败');
      } else {
        showTip('当前环境不支持市场');
      }
    } catch (e: any) { showTip('搜索失败: ' + e.message); }
    setMarketLoading(false);
  };

  const loadProviders = async () => {
    if (!(window as any).cukoAPI) return;
    try {
      const list = await (window as any).cukoAPI.listProviders();
      setCukoProviders(list);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    loadProviders();
  }, []);

  const fetchModels = async () => {
    setCukoLoading(true);
    setCukoErr('');
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (editProvider.apiKey) headers.Authorization = 'Bearer ' + editProvider.apiKey;
      const res = await fetch(editProvider.baseUrl.replace(/\/+$/, '') + '/v1/models', { headers });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (!json.data || !Array.isArray(json.data)) throw new Error('返回格式不正确');
      setEditProvider({ ...editProvider, models: json.data });
      showTip('已获取 ' + json.data.length + ' 个模型');
    } catch (e: any) {
      setCukoErr(e.message || '获取失败');
    } finally {
      setCukoLoading(false);
    }
  };

  const saveProvider = async () => {
    if (!editProvider.id || !editProvider.name || !editProvider.baseUrl) {
      setCukoErr('请填写完整的 Provider ID、名称和地址');
      return;
    }
    try {
      const res = await (window as any).cukoAPI.saveProvider(editProvider);
      if (!res.success) throw new Error(res.error || '未知错误');
      await loadProviders();
      setCukoEditing(false);
      showTip('配置已保存');
    } catch (e: any) {
      setCukoErr('保存失败: ' + e.message);
    }
  };

  const deleteProvider = async (id: string) => {
    try {
      await (window as any).cukoAPI.deleteProvider(id);
      await loadProviders();
    } catch (e) { console.error(e); }
  };

  const openEdit = (provider?: any) => {
    if (provider) {
      setEditProvider({ ...provider, models: provider.models || [] });
    } else {
      setEditProvider({
        id: 'cuko-provider-' + Date.now().toString(36),
        name: 'Stateful Provider',
        baseUrl: 'http://127.0.0.1:3000',
        apiKey: '',
        protocol: 'cuko',
        models: []
      });
    }
    setCukoErr('');
    setCukoEditing(true);
  };

  const cardStyle = {
    display: 'flex', flexDirection: 'column' as const, gap: 16,
    padding: '16px 20px', background: 'var(--ck-bg-2)', border: '1px solid var(--ck-border)',
    borderRadius: '12px', marginBottom: '16px'
  };

  // ===== 市场视图 =====
  // 这里只做「展示 + 跳转」：市场不替用户落任何配置，
  // 用户去仓库 README 自己看怎么部署、怎么填地址/密钥，再回来手动添加。
  if (showMarket) {
    return createElement('div', { style: { maxWidth: '640px' } },
      createElement('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '16px' } },
        createElement('button', { className: 'ck-btn ck-btn-ghost', onClick: () => setShowMarket(false) }, '< 返回'),
        createElement('div', { style: { marginLeft: '16px', fontSize: '16px', fontWeight: 500 } }, 'Cuko API 市场 (topic:cuko-api)')
      ),
      createElement('div', { style: { fontSize: '12px', color: 'var(--ck-text-2)', marginBottom: '12px' } },
        '点击仓库进入 GitHub 主页，按其 README 自行部署，再回到上一页点「添加模型提供商」填入地址。'),
      marketLoading ? createElement('div', { style: { textAlign: 'center', padding: '20px' } }, '加载中...') :
      marketItems.length === 0 ? createElement('div', { style: { textAlign: 'center', padding: '20px', color: 'var(--ck-text-2)' } }, '暂无匹配的仓库。给仓库打上 cuko-api topic 即可出现在这里。') :
      marketItems.map((it: any) => {
        const repoUrl = it.url || ('https://github.com/' + it.id);
        const openRepo = () => {
          if (typeof (api as any).openExternal === 'function') (api as any).openExternal(repoUrl);
          else window.open(repoUrl, '_blank');
        };
        return createElement('div', {
          key: it.id,
          style: { ...cardStyle, cursor: 'pointer' },
          title: '进入 GitHub 主页：' + repoUrl,
          onClick: openRepo,
        },
          createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 } },
            createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 } },
              createElement('div', { style: { fontSize: '14px', fontWeight: 500, color: 'var(--ck-text)' } }, it.id),
              createElement('div', { style: { fontSize: '12px', color: 'var(--ck-text-2)' } }, it.description || '无描述'),
              createElement('div', { style: { fontSize: '12px', color: 'var(--ck-text-2)' } }, 'Star: ' + (it.stars || 0) + ' · 更新: ' + (it.updatedAt || '').slice(0, 10))
            ),
            createElement('button', {
              className: 'ck-btn ck-btn-primary',
              style: { flexShrink: 0 },
              onClick: (e: any) => { e.stopPropagation(); openRepo(); }
            }, '进入 GitHub')
          )
        );
      })
    );
  }

  // ===== 列表视图 =====
  if (!cukoEditing) {
    return createElement('div', { style: { maxWidth: '640px' } },
      tip ? createElement('div', { style: { color: 'var(--ck-primary)', fontSize: 12, marginBottom: 8 } }, tip) : null,
      ...cukoProviders.map((p: any) =>
        createElement('div', { key: p.id, style: cardStyle },
          createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                createElement('span', { style: { fontSize: '14px', fontWeight: 500, color: 'var(--ck-text)' } }, p.name)
              ),
              createElement('div', { style: { fontSize: '12px', color: 'var(--ck-text-2)' } }, p.baseUrl)
            ),
            createElement('div', { style: { display: 'flex', gap: 8 } },
              createElement('button', { className: 'ck-btn ck-btn-ghost', style: { height: '32px', padding: '0 16px', fontSize: '13px' }, onClick: () => openEdit(p) }, '编辑'),
              createElement('button', { className: 'ck-btn ck-btn-ghost', style: { height: '32px', padding: '0 16px', fontSize: '13px', color: 'var(--ck-danger)' }, onClick: () => deleteProvider(p.id) }, '删除')
            )
          )
        )
      ),
      createElement('div', {
        style: { ...cardStyle, alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', cursor: 'pointer', color: 'var(--ck-text-2)', fontSize: '13px', background: 'transparent', marginBottom: 0 },
        onClick: () => openEdit()
      }, '+ 添加模型提供商'),
      createElement('button', {
        style: {
          width: '100%', height: '40px', marginTop: '16px', borderRadius: '10px',
          border: '1px solid var(--ck-border)', background: 'var(--ck-bg-2)',
          color: 'var(--ck-text)', fontSize: '13px', cursor: 'pointer'
        },
        onClick: () => { setShowMarket(true); loadMarket(); }
      }, '发现 Cuko API 市场'),
      createElement('button', {
        style: {
          width: '100%', height: '40px', marginTop: '8px', borderRadius: '10px',
          border: '1px solid var(--ck-border)', background: 'var(--ck-bg-2)',
          color: 'var(--ck-text)', fontSize: '13px', cursor: 'pointer'
        },
        onClick: () => setShowGuide(true)
      }, '如何接入 Cuko API'),
      showGuide ? createElement(CukoIntegrationDialog, { onClose: () => setShowGuide(false) }) : null
    );
  }

  // ===== 表单视图 =====
  return createElement('div', { style: { maxWidth: '640px' } },
    tip ? createElement('div', { style: { color: 'var(--ck-primary)', fontSize: 12, marginBottom: 8 } }, tip) : null,
    createElement('div', { style: { background: 'var(--ck-bg-2)', border: '1px solid var(--ck-border)', borderRadius: '12px', padding: '24px' } },
      createElement('div', { style: { display: 'flex', background: 'var(--ck-bg-3)', borderRadius: '8px', padding: '4px', marginBottom: '16px', width: 'fit-content' } },
        createElement('button', { style: { padding: '6px 16px', borderRadius: '6px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ck-text-2)', fontSize: '13px' }, onClick: () => showTip('该功能暂未开放') }, '第三方模型提供商'),
        createElement('button', { style: { padding: '6px 16px', borderRadius: '6px', border: 'none', background: 'var(--ck-bg)', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', cursor: 'default', fontWeight: 500, fontSize: '13px', color: 'var(--ck-text)' } }, '自定义模型 API')
      ),
      createElement('div', { style: { fontSize: '13px', color: 'var(--ck-text-2)', marginBottom: '20px' } }, '连接中转站、自部署服务或其他接口，需填写 API 地址、协议和模型。'),

      createElement('div', { style: { marginBottom: '16px' } },
        createElement('div', { style: { fontSize: '13px', marginBottom: '8px', color: 'var(--ck-text)' } }, 'Provider ID'),
        createElement('input', { className: 'ck-set-input', style: { width: '100%', boxSizing: 'border-box' as const }, placeholder: 'cuko-provider', value: editProvider.id, disabled: true })
      ),
      createElement('div', { style: { marginBottom: '16px' } },
        createElement('div', { style: { fontSize: '13px', marginBottom: '8px', color: 'var(--ck-text)' } }, '显示名称'),
        createElement('input', { className: 'ck-set-input', style: { width: '100%', boxSizing: 'border-box' as const }, placeholder: 'Stateful Provider', value: editProvider.name, onChange: (e: any) => setEditProvider({ ...editProvider, name: e.target.value }) })
      ),
      createElement('div', { style: { marginBottom: '16px' } },
        createElement('div', { style: { fontSize: '13px', marginBottom: '8px', color: 'var(--ck-text)' } }, 'API 地址'),
        createElement('input', { className: 'ck-set-input', style: { width: '100%', boxSizing: 'border-box' as const }, placeholder: 'http://127.0.0.1:3000', value: editProvider.baseUrl, onChange: (e: any) => setEditProvider({ ...editProvider, baseUrl: e.target.value }) })
      ),
      createElement('div', { style: { marginBottom: '16px' } },
        createElement('div', { style: { fontSize: '13px', marginBottom: '8px', color: 'var(--ck-text)' } }, 'API 协议'),
        createElement(Select, {
          value: 'cuko-api',
          options: [{ value: 'cuko-api', label: 'Cuko API (SSE)' }],
          onChange: () => {},
        })
      ),
      createElement('div', { style: { marginBottom: '24px' } },
        createElement('div', { style: { fontSize: '13px', marginBottom: '8px', color: 'var(--ck-text)' } }, 'API 密钥'),
        createElement('input', { className: 'ck-set-input', style: { width: '100%', boxSizing: 'border-box' as const }, type: 'password', placeholder: '输入 API 密钥', value: editProvider.apiKey || '', onChange: (e: any) => setEditProvider({ ...editProvider, apiKey: e.target.value }) })
      ),

      createElement('div', { style: { marginBottom: '24px' } },
        createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } },
          createElement('div', { style: { fontSize: '13px', color: 'var(--ck-text)' } }, '模型目录'),
          createElement('button', { style: { background: 'none', border: 'none', color: 'var(--ck-text-2)', fontSize: '12px', cursor: 'pointer' }, onClick: fetchModels, disabled: cukoLoading }, cukoLoading ? '获取中...' : '获取可用模型')
        ),
        cukoErr ? createElement('div', { style: { color: 'var(--ck-danger)', fontSize: 12, marginBottom: 8 } }, cukoErr) : null,
        createElement('div', { style: { border: '1px dashed var(--ck-border)', borderRadius: '8px', padding: '12px' } },
          (!editProvider.models || editProvider.models.length === 0) ? createElement('div', { style: { color: 'var(--ck-text-2)', fontSize: '12px', textAlign: 'center' as const } }, '暂无模型，请点击右上角获取') :
          editProvider.models.map((m: any) =>
            createElement('div', {
              key: m.id,
              style: { display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--ck-bg)', border: '1px solid var(--ck-border)', borderRadius: '8px', padding: '8px 12px', marginBottom: '8px' }
            },
              createElement('div', { style: { flex: 1, fontSize: '13px', color: 'var(--ck-text-2)' } }, m.id),
              createElement('div', { style: { flex: 1, fontSize: '13px', color: 'var(--ck-text)' } }, m.name || m.id)
            )
          )
        )
      ),

      createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '12px' } },
        createElement('button', { className: 'ck-btn ck-btn-ghost', onClick: () => setCukoEditing(false) }, '取消'),
        createElement('button', { className: 'ck-btn ck-btn-primary', style: { background: 'var(--ck-text)', color: 'var(--ck-bg)' }, onClick: saveProvider }, '保存配置')
      )
    )
  );
}

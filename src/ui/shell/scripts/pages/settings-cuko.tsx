import { createElement, useState, useEffect } from 'react';
import { Select } from '../components/select.js';
import { api, ckConfirm } from '../shared.js';
import { CukoIntegrationDialog } from './cuko-integration.js';

// ================= [261123-q4h7tn-cuko-openai] OpenAI 请求参数 + 模型卡片 =================

const DEEPSEEK_DISABLE_PARAMS = '{"thinking":{"type":"disabled"}}';
const PRESET_LEVELS = [
  { id: 'off', value: '' },
  { id: 'low', value: 'low' },
  { id: 'high', value: 'high' },
  { id: 'max', value: 'max' },
];
// [261123-q4h7tn-cuko-openai] 协议显示名（只在已知非空时调用）
const protocolLabel = (p: 'openai' | 'cuko' | null) => (p === 'openai' ? 'OpenAI Chat Completions' : 'Cuko API');
const linkBtnStyle = { background: 'none', border: 'none', color: 'var(--ck-text-2)', fontSize: '12px', cursor: 'pointer', padding: 0 };
const fullInput = { width: '100%', boxSizing: 'border-box' as const };
const fieldLabel = (text: string) => createElement('div', { style: { fontSize: '13px', marginBottom: '8px', color: 'var(--ck-text)' } }, text);
const fieldHint = (text: string) => createElement('div', { style: { fontSize: '12px', marginTop: '4px', color: 'var(--ck-text-2)' } }, text);
const errLine = (msg: string) => (msg ? createElement('div', { style: { color: 'var(--ck-danger)', fontSize: 12, marginTop: 4 } }, msg) : null);

function jsonError(text: any): string {
  const t = String(text || '').trim();
  if (!t) return '';
  try {
    const v = JSON.parse(t);
    return v && typeof v === 'object' && !Array.isArray(v) ? '' : '必须是 JSON 对象';
  } catch (e: any) {
    return 'JSON 格式不正确：' + (e?.message || '');
  }
}

function toPositiveInt(text: any): number | undefined {
  const n = Number(String(text || '').trim());
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function OpenAiParams({ provider, onChange }: { provider: any; onChange: (p: any) => void }) {
  const area = (key: string, placeholder: string) => createElement('textarea', {
    className: 'ck-set-textarea',
    style: { ...fullInput, minHeight: '64px', fontFamily: 'monospace', fontSize: '12px' },
    placeholder,
    value: provider[key] || '',
    onChange: (e: any) => onChange({ ...provider, [key]: e.target.value }),
  });
  return createElement('div', { style: { marginBottom: '24px', padding: '16px', border: '1px solid var(--ck-border)', borderRadius: '8px', background: 'var(--ck-bg)' } },
    createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' } },
      createElement('div', { style: { fontSize: '13px', fontWeight: 500, color: 'var(--ck-text)' } }, 'OpenAI 请求参数'),
      createElement('button', {
        style: linkBtnStyle,
        onClick: () => onChange({ ...provider, reasoningField: 'reasoning_effort', disableReasoningParams: DEEPSEEK_DISABLE_PARAMS }),
      }, '填入 DeepSeek 推荐配置'),
    ),
    createElement('div', { style: { marginBottom: '12px' } },
      fieldLabel('推理强度字段名'),
      createElement('input', { className: 'ck-set-input', style: fullInput, placeholder: 'reasoning_effort', value: provider.reasoningField || '', onChange: (e: any) => onChange({ ...provider, reasoningField: e.target.value }) }),
      fieldHint('选中的思考档位，会把它的 API 参数值写进这个字段；留空 = reasoning_effort'),
    ),
    createElement('div', { style: { marginBottom: '12px' } },
      fieldLabel('关闭思考参数（JSON）'),
      area('disableReasoningParams', DEEPSEEK_DISABLE_PARAMS),
      errLine(jsonError(provider.disableReasoningParams)),
      fieldHint('选 off 档位时合并进请求体。DeepSeek 默认会思考，要填这段才能关掉'),
    ),
    createElement('div', null,
      fieldLabel('额外请求参数（JSON）'),
      area('extraParams', '{"temperature": 0.3}'),
      errLine(jsonError(provider.extraParams)),
      fieldHint('每次请求都会合并进请求体；model / messages / stream 不能被覆盖'),
    ),
  );
}

function ModelCard({ model, onChange, onRemove }: { model: any; onChange: (m: any) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const apiMeta = model.apiMeta || {};
  const user = model.userMeta || {};
  const eff: any = { ...apiMeta };
  for (const k of Object.keys(user)) {
    if (user[k] !== undefined && user[k] !== null) eff[k] = user[k];
  }
  const setUser = (patch: any) => {
    const next: any = { ...user, ...patch };
    for (const k of Object.keys(next)) {
      if (next[k] === undefined || next[k] === '') delete next[k];
    }
    onChange({ ...model, userMeta: next, name: next.name || apiMeta.name || model.id });
  };
  const levels: any[] = Array.isArray(eff.reasoningLevels) ? eff.reasoningLevels : [];
  const enabled = !!eff.reasoningEnabled;
  const setLevels = (next: any[]) => setUser({ reasoningLevels: next });
  const toggleReasoning = (on: boolean) => {
    if (on && levels.length === 0) setUser({ reasoningEnabled: true, reasoningLevels: PRESET_LEVELS.map((l) => ({ ...l })), defaultEffort: 'high' });
    else setUser({ reasoningEnabled: on });
  };
  const mods: any[] = Array.isArray(eff.inputModalities) ? eff.inputModalities : ['text'];
  const badge = model.source === 'manual' ? '手动' : model.listed === false ? '接口未返回' : '';
  const numberInput = (key: string) => createElement('input', {
    className: 'ck-set-input',
    style: fullInput,
    type: 'number',
    value: user[key] ?? '',
    placeholder: apiMeta[key] ? String(apiMeta[key]) + '（接口值）' : '未设置',
    onChange: (e: any) => setUser({ [key]: toPositiveInt(e.target.value) }),
  });

  return createElement('div', { style: { background: 'var(--ck-bg)', border: '1px solid var(--ck-border)', borderRadius: '8px', padding: '8px 12px', marginBottom: '8px' } },
    createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
      createElement('button', { style: linkBtnStyle, title: open ? '收起' : '展开', onClick: () => setOpen(!open) }, open ? '▾' : '▸'),
      createElement('input', { className: 'ck-set-input', style: { flex: 1 }, placeholder: '模型 ID', value: model.id || '', disabled: !model._key, onChange: (e: any) => onChange({ ...model, id: e.target.value.trim() }) }),
      createElement('input', { className: 'ck-set-input', style: { flex: 1 }, placeholder: apiMeta.name || model.id || '显示名称', value: user.name || '', onChange: (e: any) => setUser({ name: e.target.value }) }),
      badge ? createElement('span', { style: { fontSize: '12px', color: 'var(--ck-text-2)', whiteSpace: 'nowrap' } }, badge) : null,
      createElement('button', { style: { ...linkBtnStyle, color: 'var(--ck-danger)' }, onClick: onRemove }, '删除'),
    ),
    open ? createElement('div', { style: { marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' } },
      createElement('div', { style: { display: 'flex', gap: '12px' } },
        createElement('div', { style: { flex: 1 } }, fieldLabel('上下文窗口'), numberInput('contextWindow')),
        createElement('div', { style: { flex: 1 } }, fieldLabel('最大输出 token 数'), numberInput('maxTokens')),
      ),
      createElement('div', null,
        fieldLabel('输入类型（暂未生效）'),
        createElement('div', { style: { display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--ck-text)' } },
          createElement('label', null, createElement('input', { type: 'checkbox', checked: true, disabled: true }), ' 文本'),
          createElement('label', null, createElement('input', { type: 'checkbox', checked: mods.includes('image'), onChange: (e: any) => setUser({ inputModalities: e.target.checked ? ['text', 'image'] : ['text'] }) }), ' 图片'),
        ),
      ),
      createElement('div', null,
        createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--ck-text)', marginBottom: '8px' } },
          createElement('input', { type: 'checkbox', checked: enabled, onChange: (e: any) => toggleReasoning(e.target.checked) }),
          '推理档位（思考强度）',
        ),
        enabled ? createElement('div', null,
          createElement('div', { style: { display: 'flex', gap: '8px', fontSize: '12px', color: 'var(--ck-text-2)', marginBottom: '4px' } },
            createElement('div', { style: { flex: 1 } }, '档位'),
            createElement('div', { style: { flex: 1 } }, 'API 参数值（留空 = 用档位名）'),
            createElement('div', { style: { width: '96px' } }, ''),
          ),
          ...levels.map((l: any, i: number) => createElement('div', { key: i, style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' } },
            createElement('input', { className: 'ck-set-input', style: { flex: 1 }, placeholder: '档位名', value: l.id || '', onChange: (e: any) => setLevels(levels.map((x: any, j: number) => (j === i ? { ...x, id: e.target.value.trim() } : x))) }),
            createElement('input', { className: 'ck-set-input', style: { flex: 1 }, disabled: l.id === 'off', placeholder: l.id === 'off' ? '关闭思考' : (l.id ? '留空则发 ' + l.id : 'API 参数值'), value: l.value || '', onChange: (e: any) => setLevels(levels.map((x: any, j: number) => (j === i ? { ...x, value: e.target.value } : x))) }),
            createElement('label', { style: { width: '48px', fontSize: '12px', color: 'var(--ck-text-2)', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' } },
              createElement('input', { type: 'radio', checked: eff.defaultEffort === l.id, onChange: () => setUser({ defaultEffort: l.id }) }),
              '默认',
            ),
            createElement('button', { style: { ...linkBtnStyle, width: '40px' }, onClick: () => setLevels(levels.filter((_: any, j: number) => j !== i)) }, '删除'),
          )),
          createElement('div', { style: { fontSize: '12px', color: 'var(--ck-text-2)', marginTop: '4px' } }, 'API 参数值留空时，实际发出去的就是档位名本身（如 low 档发 "reasoning_effort":"low"）。只有接口要求用别的值时（如档位叫 high、要发 "high-effort"）才需要填。'),
          createElement('button', { style: linkBtnStyle, onClick: () => setLevels([...levels, { id: '', value: '' }]) }, '+ 添加档位'),
        ) : null,
      ),
      Object.keys(user).length > 0
        ? createElement('button', { style: { ...linkBtnStyle, alignSelf: 'flex-start' }, onClick: () => onChange({ ...model, userMeta: {}, name: apiMeta.name || model.id }) }, '恢复默认（丢弃这个模型的修改）')
        : null,
    ) : null,
  );
}

export function CukoSettings() {
  const [cukoProviders, setCukoProviders] = useState<any[]>([]);
  const [cukoEditing, setCukoEditing] = useState(false);
  const [cukoLoading, setCukoLoading] = useState(false);
  const [cukoErr, setCukoErr] = useState('');
  // [261123-q4h7tn-cuko-openai] 「获取模型」时顺带推断的协议：只用来提示，不自动改用户的选择
  const [protocolGuess, setProtocolGuess] = useState<'openai' | 'cuko' | null>(null);
  // 当前地址 / 密钥是否已经探过协议（推断不出结果也算探过）；换地址或密钥时重置
  const [protocolProbed, setProtocolProbed] = useState(false);
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

  // [261123-q4h7tn-cuko-openai] 改走主进程：不受跨域限制；地址带不带 /v1 都行；保留已改过的模型设置
  const fetchModels = async () => {
    setCukoLoading(true);
    setCukoErr('');
    try {
      const res = await (window as any).cukoAPI.fetchModels({ baseUrl: editProvider.baseUrl, apiKey: editProvider.apiKey || '', models: editProvider.models || [] });
      if (!res || !res.success) throw new Error((res && res.error) || '获取失败');
      setEditProvider((prev: any) => ({ ...prev, models: res.models || [] }));
      setProtocolGuess(res.protocolGuess === 'openai' || res.protocolGuess === 'cuko' ? res.protocolGuess : null);
      setProtocolProbed(true);
      showTip('已获取 ' + res.count + ' 个模型');
    } catch (e: any) {
      setCukoErr(e.message || '获取失败');
      setProtocolGuess(null);
    } finally {
      setCukoLoading(false);
    }
  };

  // [261123-q4h7tn-cuko-openai] 当前所选协议（脏值一律按 cuko）与「接口返回更像哪个」的一致性
  const curProtocol: 'openai' | 'cuko' = editProvider.protocol === 'openai' ? 'openai' : 'cuko';
  const protocolGuessMismatch = !!protocolGuess && protocolGuess !== curProtocol;

  const saveProvider = async () => {
    if (!editProvider.id || !editProvider.name || !editProvider.baseUrl) {
      setCukoErr('请填写完整的 Provider ID、名称和地址');
      return;
    }
    // [261123-q4h7tn-cuko-openai] 保存前确认协议：
    // 1) 没点过「获取可用模型」就主动探一次接口（只为判断协议，不改模型列表、不弹「已获取 n 个模型」）
    // 2) 推断结果与所选不一致就弹窗问一次；只提示，最终以用户选择为准
    let guess: 'openai' | 'cuko' | null = protocolGuess;
    if (!protocolProbed) {
      try {
        const probe = await (window as any).cukoAPI.fetchModels({ baseUrl: editProvider.baseUrl, apiKey: editProvider.apiKey || '', models: [] });
        if (probe && probe.success) {
          guess = probe.protocolGuess === 'openai' || probe.protocolGuess === 'cuko' ? probe.protocolGuess : null;
        }
      } catch {
        // 探测失败不拦保存：用户可能只想先把地址和密钥存下来
        guess = null;
      }
      setProtocolProbed(true);
      setProtocolGuess(guess);
    }
    if (guess && guess !== curProtocol) {
      const ok = await ckConfirm(
        [
          '接口返回的格式更像「' + protocolLabel(guess) + '」协议，当前选的是「' + protocolLabel(curProtocol) + '」。',
          '',
          '选错协议的话，发消息会报错，且很难看出原因。',
          '· 点「取消」回去改协议',
          '· 确认没选错，点「确定」照常保存',
        ].join('\n'),
        '确认 API 协议',
      );
      if (!ok) return;
    }
    try {
      const res = await (window as any).cukoAPI.saveProvider(editProvider);
      if (!res.success) throw new Error(res.error || '未知错误');
      await loadProviders();
      setCukoEditing(false);
      setProtocolGuess(null);
      setProtocolProbed(false);
      const ignored = Array.isArray(res.ignoredKeys) && res.ignoredKeys.length ? '（已忽略不能覆盖的字段：' + res.ignoredKeys.join('、') + '）' : '';
      showTip('配置已保存' + ignored);
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

  // [261123-q4h7tn-cuko-openai] 模型目录编辑
  const updateModel = (idx: number, next: any) => {
    setEditProvider((prev: any) => ({ ...prev, models: (prev.models || []).map((m: any, i: number) => (i === idx ? next : m)) }));
  };
  const removeModel = (idx: number) => {
    setEditProvider((prev: any) => ({ ...prev, models: (prev.models || []).filter((_: any, i: number) => i !== idx) }));
  };
  const addManualModel = () => {
    setEditProvider((prev: any) => ({ ...prev, models: [...(prev.models || []), { id: '', name: '', apiMeta: {}, userMeta: {}, source: 'manual', listed: true, _key: 'manual-' + Date.now().toString(36) }] }));
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
            createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 } },
              createElement('div', { style: { fontSize: '14px', fontWeight: 500, color: 'var(--ck-text)' } }, it.id),
              createElement('div', { style: { fontSize: '12px', color: 'var(--ck-text-2)' } }, it.description || '无描述'),
              createElement('div', { style: { fontSize: '12px', color: 'var(--ck-text-2)' } }, 'Star: ' + (it.stars || 0) + ' · 更新: ' + (it.updatedAt || '').slice(0, 10))
            ),
            createElement('button', {
              className: 'ck-btn ck-btn-primary',
              style: {
                flex: '0 0 auto',        // .ck-btn 默认 flex:1 会撑满整行
                width: 'auto',
                padding: '5px 14px',
                fontSize: '12px',
                letterSpacing: 0,
                whiteSpace: 'nowrap' as const,
              },
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
        createElement('input', { className: 'ck-set-input', style: { width: '100%', boxSizing: 'border-box' as const }, placeholder: editProvider.protocol === 'openai' ? 'https://api.deepseek.com/v1' : 'http://127.0.0.1:3000', value: editProvider.baseUrl, onChange: (e: any) => { setEditProvider({ ...editProvider, baseUrl: e.target.value }); setProtocolGuess(null); setProtocolProbed(false); } })
      ),
      createElement('div', { style: { marginBottom: '16px' } },
        createElement('div', { style: { fontSize: '13px', marginBottom: '8px', color: 'var(--ck-text)' } }, 'API 协议'),
        createElement(Select, {
          value: editProvider.protocol === 'openai' ? 'openai' : 'cuko',
          options: [{ value: 'cuko', label: 'Cuko API (SSE)' }, { value: 'openai', label: 'OpenAI Chat Completions' }],
          onChange: (v: string) => setEditProvider({ ...editProvider, protocol: v }),
        }),
        // [261123-q4h7tn-cuko-openai] 接口返回与所选协议不一致时在下方提示（只提示，不自动改；判断不一定准）
        protocolGuessMismatch
          ? createElement('div', { style: { marginTop: '8px', padding: '8px 10px', borderRadius: '6px', background: 'rgba(255,193,7,.12)', border: '1px solid rgba(255,193,7,.4)', fontSize: '12px', lineHeight: 1.6, color: 'var(--ck-text)' } },
            createElement('div', null, '接口返回的模型列表更像「' + protocolLabel(protocolGuess) + '」协议，当前选的是「' + protocolLabel(curProtocol) + '」。'),
            createElement('div', { style: { color: 'var(--ck-text-2)', marginTop: '4px' } }, '如果发消息报错，多半是这里选错了。'),
            createElement('div', { style: { display: 'flex', gap: '12px', marginTop: '6px' } },
              createElement('button', { style: linkBtnStyle, onClick: () => setEditProvider({ ...editProvider, protocol: protocolGuess }) }, '改为 ' + protocolLabel(protocolGuess)),
              createElement('button', { style: linkBtnStyle, onClick: () => setProtocolGuess(null) }, '忽略'),
            ),
          )
          : null,
      ),
      createElement('div', { style: { marginBottom: '24px' } },
        createElement('div', { style: { fontSize: '13px', marginBottom: '8px', color: 'var(--ck-text)' } }, 'API 密钥'),
        createElement('input', { className: 'ck-set-input', style: { width: '100%', boxSizing: 'border-box' as const }, type: 'password', placeholder: '输入 API 密钥', value: editProvider.apiKey || '', onChange: (e: any) => { setEditProvider({ ...editProvider, apiKey: e.target.value }); setProtocolGuess(null); setProtocolProbed(false); } })
      ),

      editProvider.protocol === 'openai' ? createElement(OpenAiParams, { provider: editProvider, onChange: setEditProvider }) : null,
      createElement('div', { style: { marginBottom: '24px' } },
        createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } },
          createElement('div', { style: { fontSize: '13px', color: 'var(--ck-text)' } }, '模型目录'),
          createElement('div', { style: { display: 'flex', gap: '12px' } },
            createElement('button', { style: linkBtnStyle, onClick: addManualModel }, '+ 添加模型'),
            createElement('button', { style: linkBtnStyle, onClick: fetchModels, disabled: cukoLoading }, cukoLoading ? '获取中...' : '获取可用模型')
          )
        ),
        cukoErr ? createElement('div', { style: { color: 'var(--ck-danger)', fontSize: 12, marginBottom: 8 } }, cukoErr) : null,
        createElement('div', { style: { border: '1px dashed var(--ck-border)', borderRadius: '8px', padding: '12px' } },
          (!editProvider.models || editProvider.models.length === 0) ? createElement('div', { style: { color: 'var(--ck-text-2)', fontSize: '12px', textAlign: 'center' as const } }, '暂无模型，请点击右上角获取') :
          editProvider.models.map((m: any, idx: number) =>
            createElement(ModelCard, { key: m._key || m.id || 'idx-' + idx, model: m, onChange: (next: any) => updateModel(idx, next), onRemove: () => removeModel(idx) })
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

// ===== Cuko API 系统提示词（左侧导航独立页签，固定 providerId = 'cuko'）=====
const CUKO_PROMPT_KEY = 'cuckoo-system-prompt-template:cuko';

export function CukoPromptSettings() {
  const [text, setText] = useState('');
  const [builtin, setBuiltin] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tip, setTip] = useState('');

  const showTip = (msg: string) => {
    setTip(msg);
    setTimeout(() => setTip(''), 1800);
  };

  const load = async () => {
    const anyApi = api as any;
    if (typeof anyApi.getPromptTemplate !== 'function') return;
    try {
      const r = await anyApi.getPromptTemplate('cuko');
      if (r && r.success) {
        setBuiltin(r.builtin || '');
        // 有自定义就用自定义，否则展示内置模板供参考
        setText(r.custom || r.builtin || '');
        setDirty(false);
      }
    } catch (_) { /* ignore */ }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    const anyApi = api as any;
    if (typeof anyApi.saveSharedSettings !== 'function') return;
    setSaving(true);
    try {
      const r = await anyApi.saveSharedSettings({ [CUKO_PROMPT_KEY]: text });
      if (r && r.success) { setDirty(false); showTip('已保存'); }
      else showTip('保存失败');
    } catch (_) { showTip('保存失败'); }
    setSaving(false);
  };

  const reset = async () => {
    const anyApi = api as any;
    if (typeof anyApi.resetSharedSettings !== 'function') return;
    try {
      const r = await anyApi.resetSharedSettings([CUKO_PROMPT_KEY]);
      if (r && r.success) {
        setText(builtin);
        setDirty(false);
        showTip('已恢复内置');
      }
    } catch (_) { /* ignore */ }
  };

  return createElement('div', { className: 'ck-card' },
    createElement('div', { className: 'ck-set-row-col' },
      createElement('div', { className: 'ck-set-row-label' }, 'Cuko API 系统提示词'),
      createElement('div', { className: 'ck-set-row-desc' },
        'Cuko API 首次对话时发给 AI 的系统提示词。占位符（如 {{PLATFORM_INFO}}、{{TOOL_API_TYPES}}、{{MCP_SECTION}}、{{PROJECT_DIR}}）在发送时自动替换，请勿删除。留空或点「恢复内置」使用 src/prompt/cuko.md。'),
      createElement('textarea', {
        className: 'ck-set-textarea',
        style: { minHeight: '420px', fontFamily: 'monospace', fontSize: '12.5px', lineHeight: 1.5 },
        value: text,
        onChange: (e: any) => { setText(e.target.value); setDirty(true); },
      }),
      createElement('div', { className: 'ck-set-inline', style: { marginTop: '8px', justifyContent: 'flex-end', alignItems: 'center' } },
        tip ? createElement('span', { style: { color: 'var(--ck-text-dim)', fontSize: '12px', marginRight: '8px' } }, tip) : null,
        createElement('button', { className: 'ck-btn', onClick: () => { setText(builtin); setDirty(true); } }, '填入内置模板'),
        createElement('button', { className: 'ck-btn ck-btn-danger', onClick: reset }, '恢复内置'),
        createElement('button', { className: 'ck-btn ck-btn-primary', disabled: !dirty || saving, onClick: save }, saving ? '保存中…' : '保存'),
      )
    )
  );
}

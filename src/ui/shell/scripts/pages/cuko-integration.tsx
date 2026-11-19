/**
 * [261109-8ms69z-cuko-api] 「如何接入 Cuko API」说明弹窗
 * 此文件属于 Cuko API 独立工作窗口需求，详细设计见：
 * docs/requirements/261109-8ms69z-cuko-api.md
 *
 * 入口在 Cuko 设置页的 Provider 列表下方；内容包含协议速览、
 * 三步接入说明、可直接复制给 AI 的开发提示词，以及完整的
 * docs/protocols/cuko-api-v1.md（构建时以文本内联，随文档更新）。
 */
import { useEffect, useState } from 'react';
// @ts-expect-error .md 由 esbuild 的 text loader 处理（见 scripts/build-shell.mjs / build-cuko.mjs）
import CUKO_PROTOCOL_DOC from '../../../../../docs/protocols/cuko-api-v1.md';

export const CUKO_AI_PROMPT = [
  '你是 Stateful Provider 开发者。请实现一个兼容 Cuko API v1 的服务端（语言不限，推荐 Node.js + TypeScript 或 Python FastAPI），供 Cuckoo Code 的 Cuko 窗口连接。',
  '',
  '## 必须实现的接口',
  '1) GET /v1/models',
  '   - 返回 { "data": [{ "id": "...", "name": "..." }] }',
  '   - 可选 Bearer 鉴权：Authorization: Bearer <token>',
  '',
  '2) POST /v1/responses（SSE，Content-Type: text/event-stream）',
  '   请求体：',
  '   {',
  '     "cuckSessionId": "cuck_xxx",',
  '     "providerSessionId": "prov_xxx",   // 首次请求不带',
  '     "model": "...",',
  '     "requestId": "req_xxx",            // 幂等键',
  '     "type": "user",                    // 顶层：user / tool / compress',
  '     "input": [ ... ]',
  '   }',
  '',
  '   顶层 type 区分请求来源（与 input 元素无关）：',
  '   - "user"     用户自己输入',
  '   - "tool"     工具执行结果（回复语/脚本输出）',
  '   - "compress" 切换模型时的历史压缩',
  '',
  '   input 元素类型：',
  '   - { "type": "text", "text": "..." }      文本（用户输入/工具结果/系统提示词分段都是 text）',
  '   - { "type": "file", "filename", "mimeType", "data": "base64" } 附件',
  '',
  '## 会话与事件',
  '- 首次请求（没有 providerSessionId）创建会话；第一帧 event: message 里必须返回 providerSessionId。',
  '- 后续请求携带 providerSessionId 续接。',
  '- event: message  data: { "output": ["增量文本"], "think": "可选思考", "providerSessionId": "仅首帧/变化时" }',
  '- event: done     data: { "finishReason": "stop", "usage": { "input_tokens", "output_tokens", "total_tokens" } }',
  '- event: error    data: { "code": "...", "message": "..." }',
  '- 服务端要维护每个 cuckSessionId/providerSessionId 的模型上下文。',
  '',
  '## 历史压缩（type: "compress"）',
  '- 切换模型时 Cuckoo 会发一次 type: "compress" 请求，不携带 providerSessionId。',
  '- input 是压缩后的历史：每条消息一个 text 元素，文本以「用户:」「助手:」「工具:」开头。',
  '- 请用这些内容为新模型重建上下文，并返回新的 providerSessionId；返回的正文会展示给用户。',
  '- 涉及 edit/deleteFile 的工具结果会保留；其它工具结果会被替换成占位文案。',
  '',
  '## 其它要求',
  '- 幂等：记录 requestId，重复请求返回 idempotency_conflict。',
  '- 错误码：authentication_required / provider_unavailable / rate_limit_exceeded / invalid_request / request_timeout / idempotency_conflict / internal_error。',
  '- 支持多会话并发，状态按会话隔离。',
  '- 提供启动方式和一个 curl 自测脚本。',
  '',
  '协议完整定义见仓库 docs/protocols/cuko-api-v1.md。请直接输出完整可运行的代码与运行说明。',
].join('\n');

const panelStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '820px',
  maxHeight: '86vh',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  background: 'var(--ck-bg)',
  color: 'var(--ck-text)',
  border: '1px solid var(--ck-border)',
  borderRadius: '12px',
  padding: '20px',
  boxShadow: '0 12px 48px rgba(0,0,0,.35)',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--ck-text)',
  marginBottom: '6px',
};

const mutedStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--ck-text-2)',
  lineHeight: 1.7,
};

const codeBlockStyle: React.CSSProperties = {
  margin: 0,
  overflow: 'auto',
  padding: '12px',
  borderRadius: '8px',
  border: '1px solid var(--ck-border)',
  background: 'var(--ck-bg-2)',
  color: 'var(--ck-text-2)',
  fontSize: '11.5px',
  lineHeight: 1.65,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const copyButtonStyle: React.CSSProperties = {
  height: '28px',
  padding: '0 12px',
  fontSize: '12px',
  borderRadius: '6px',
  border: '1px solid var(--ck-border)',
  background: 'transparent',
  color: 'var(--ck-text)',
  cursor: 'pointer',
  flex: '0 0 auto',
};

export function CukoIntegrationDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'guide' | 'doc'>('guide');
  const [copied, setCopied] = useState(false);
  const [copiedDoc, setCopiedDoc] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copyText = async (text: string, onDone: (v: boolean) => void) => {
    setError('');
    try {
      await navigator.clipboard.writeText(text);
      onDone(true);
      setTimeout(() => onDone(false), 1500);
    } catch {
      setError('复制失败，请手动选择文本');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9500,
        background: 'rgba(0,0,0,.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="如何接入 Cuko API" style={panelStyle}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ck-text)' }}>如何接入 Cuko API</div>
          <div style={{ ...mutedStyle, marginTop: '4px' }}>
            Cuko 连接的是 <b>Stateful Provider</b>：上下文由你的服务端维护，Cuckoo 只负责发送增量输入和展示流式结果。
          </div>
        </div>

        <div style={{ display: 'flex', gap: '4px', background: 'var(--ck-bg-3)', borderRadius: '8px', padding: '4px', alignSelf: 'flex-start' }}>
          {[
            { key: 'guide' as const, label: '接入说明' },
            { key: 'doc' as const, label: '接口文档' },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12.5px',
                background: tab === item.key ? 'var(--ck-bg)' : 'transparent',
                color: tab === item.key ? 'var(--ck-text)' : 'var(--ck-text-2)',
                fontWeight: tab === item.key ? 600 : 400,
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '14px', paddingRight: '4px' }}>
          {tab === 'guide' ? (
            <>
              <div>
                <div style={sectionTitleStyle}>三步接入</div>
                <ol style={{ ...mutedStyle, margin: 0, paddingLeft: '18px' }}>
                  <li>实现 <code>GET /v1/models</code> 与 <code>POST /v1/responses</code>（SSE）两个接口；</li>
                  <li>启动服务，确认监听地址（示例：<code>http://127.0.0.1:3000</code>）；</li>
                  <li>回到本页 →「添加模型提供商」→ 填 API 地址 →「获取可用模型」→ 保存。</li>
                </ol>
              </div>

              <div>
                <div style={sectionTitleStyle}>接口速览</div>
                <div style={mutedStyle}>
                  <div>· 首次请求不带 <code>providerSessionId</code>，服务端要在第一帧返回它；后续请求带上以续接会话。</div>
                  <div>· 请求外层 <code>type</code> 区分来源：<code>user</code>（用户输入）、<code>tool</code>（工具结果）、<code>compress</code>（历史压缩）；<code>input</code> 元素统一是 <code>text</code> / <code>file</code>。</div>
                  <div>· 切换模型时会发一次 <code>type: "compress"</code> 的历史压缩请求，用它为新模型重建上下文。</div>
                  <div>· 事件：<code>event: message</code> / <code>event: done</code>（带 usage）/ <code>event: error</code>。</div>
                  <div>· 完整协议见「接口文档」页签（源文件 <code>docs/protocols/cuko-api-v1.md</code>）。</div>
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <div style={sectionTitleStyle}>给 AI 的开发提示词</div>
                  <button type="button" onClick={() => copyText(CUKO_AI_PROMPT, setCopied)} style={copyButtonStyle}>
                    {copied ? '已复制' : '复制提示词'}
                  </button>
                </div>
                <pre style={{ ...codeBlockStyle, maxHeight: '34vh' }}>{CUKO_AI_PROMPT}</pre>
                {error && <div style={{ color: 'var(--ck-danger)', fontSize: '12px', marginTop: '4px' }}>{error}</div>}
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={sectionTitleStyle}>Cuko API v1 接口文档</div>
                <button type="button" onClick={() => copyText(CUKO_PROTOCOL_DOC, setCopiedDoc)} style={copyButtonStyle}>
                  {copiedDoc ? '已复制' : '复制文档'}
                </button>
              </div>
              <div style={mutedStyle}>来自仓库 docs/protocols/cuko-api-v1.md（构建时内联，随文档更新）。</div>
              <pre style={{ ...codeBlockStyle, maxHeight: '52vh', minHeight: '38vh' }}>{CUKO_PROTOCOL_DOC}</pre>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            type="button"
            className="ck-btn ck-btn-ghost"
            style={{ flex: '0 0 auto', width: 'auto', height: '32px', padding: '0 16px', marginLeft: 'auto' }}
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

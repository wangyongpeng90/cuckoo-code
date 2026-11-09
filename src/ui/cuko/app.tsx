import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useEdgeRuntime,
} from '@assistant-ui/react';

function UserMessage() {
  return (
    <MessagePrimitive.Root style={{ display: 'flex', justifyContent: 'flex-end', margin: '8px 0' }}>
      <div style={{ maxWidth: '80%', background: '#0e639c', color: '#fff', borderRadius: 12, padding: '8px 14px' }}>
        <MessagePrimitive.Content />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root style={{ display: 'flex', justifyContent: 'flex-start', margin: '8px 0' }}>
      <div style={{ maxWidth: '80%', background: '#2d2d2d', color: '#e0e0e0', borderRadius: 12, padding: '8px 14px' }}>
        <MessagePrimitive.Content />
      </div>
    </MessagePrimitive.Root>
  );
}

function ChatApp() {
  const runtime = useEdgeRuntime({ api: '/v1/responses' });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div style={{ display: 'flex', height: '100vh', flexDirection: 'column' }}>
        <header style={{ padding: '10px 20px', borderBottom: '1px solid #333', background: '#252526', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '16px' }}>Cuko API 工作区</h2>
          <button style={{ background: 'transparent', border: '1px solid #555', color: '#ccc', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer' }}>
            设置
          </button>
        </header>
        <div style={{ flex: 1, overflow: 'hidden', background: '#1e1e1e' }}>
          <ThreadPrimitive.Root style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <ThreadPrimitive.Viewport style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
              <ThreadPrimitive.Empty>
                <p style={{ color: '#888', textAlign: 'center', marginTop: 40 }}>
                  欢迎使用 Cuko API，开始你的第一段对话。
                </p>
              </ThreadPrimitive.Empty>
              <ThreadPrimitive.Messages
                components={{
                  UserMessage: UserMessage,
                  AssistantMessage: AssistantMessage,
                }}
              />
            </ThreadPrimitive.Viewport>
            <div style={{ padding: '12px 16px', borderTop: '1px solid #333', background: '#252526' }}>
              <ComposerPrimitive.Root style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <ComposerPrimitive.Input
                  placeholder="输入消息，回车发送..."
                  style={{ flex: 1, background: '#1e1e1e', border: '1px solid #444', borderRadius: 8, padding: '10px 12px', color: '#e0e0e0', outline: 'none', fontSize: 14 }}
                  rows={1}
                />
                <ComposerPrimitive.Send
                  style={{ background: '#0e639c', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', cursor: 'pointer', fontSize: 14 }}
                >
                  发送
                </ComposerPrimitive.Send>
              </ComposerPrimitive.Root>
            </div>
          </ThreadPrimitive.Root>
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<ChatApp />);
}

/**
 * 鲸鱼娘桌宠 —— Cuckoo UI 插件参考实现
 *
 * 展示 Cuckoo DSH 兼容层的完整能力：
 *   - UI 插件入口契约（name + apply）
 *   - ctx.ui.mount / css（界面注入）
 *   - ctx.on 各事件（agent 状态联动）
 *   - ctx.effect（可逆副作用）
 *   - ctx.provide / inject（服务）
 *
 * 注意：这是"参考实现"，用简化的 emoji 代替真实 Live2D 渲染。
 * 真实桌宠需加载 Live2D 模型（见 dsh-whale-girl-live2d 的 assets/）。
 */
export const name = 'whale-pet-demo';

export function apply(ctx) {
  ctx.log('鲸鱼娘桌宠（演示版）已激活');

  // 注入样式
  ctx.ui.css(`
    #whale-pet-demo {
      position: fixed; right: 24px; bottom: 24px;
      width: 88px; height: 88px; border-radius: 50%;
      background: linear-gradient(135deg, #8b93ff, #6d76ff);
      display: flex; align-items: center; justify-content: center;
      font-size: 40px; cursor: pointer; user-select: none;
      box-shadow: 0 8px 24px rgba(109,118,255,0.35);
      transition: transform 0.2s, box-shadow 0.2s; z-index: 2147482500;
      pointer-events: auto;
    }
    #whale-pet-demo:hover { transform: scale(1.08); }
    #whale-pet-demo.thinking { animation: wp-pulse 1s infinite; }
    #whale-pet-demo.speaking { box-shadow: 0 0 0 4px rgba(139,147,255,0.3); }
    @keyframes wp-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
    #whale-pet-bubble {
      position: fixed; right: 120px; bottom: 40px; max-width: 240px;
      padding: 8px 12px; border-radius: 12px;
      background: rgba(22,24,44,0.95); color: #dde1ff; font-size: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.3); z-index: 2147482500;
      display: none; pointer-events: none;
    }
  `);

  // 创建桌宠元素
  const el = document.createElement('div');
  el.id = 'whale-pet-demo';
  el.textContent = '🐋';
  ctx.ui.mount(el);

  const bubble = document.createElement('div');
  bubble.id = 'whale-pet-bubble';
  ctx.ui.mount(bubble);

  let mood = 'idle';
  const setMood = (m) => {
    mood = m;
    el.classList.toggle('thinking', m === 'thinking');
    el.classList.toggle('speaking', m === 'speaking');
    el.textContent = m === 'thinking' ? '🤔' : m === 'speaking' ? '🐋' : m === 'happy' ? '😊' : '🐋';
  };

  const say = (text, ttl = 4000) => {
    bubble.textContent = text;
    bubble.style.display = 'block';
    clearTimeout(say._t);
    say._t = setTimeout(() => { bubble.style.display = 'none'; }, ttl);
  };

  // 点击：跟 agent 说话
  el.addEventListener('click', () => {
    ctx.agents.get()?.followup({ role: 'user', content: '你好呀，鲸鱼娘！' });
    say('主人好～');
  });

  // ===== 状态联动 =====
  ctx.on('agent/assistant-stream', ({ frame }) => {
    if (frame.think) setMood('thinking');
    if (frame.text) setMood('speaking');
  });

  ctx.on('session/event', (rec) => {
    if (rec && rec.type === 'assistant/message') {
      setMood('happy');
      const tokens = rec.tokenUsage && rec.tokenUsage.accumulatedTokens;
      if (tokens) say('搞定！本轮 ' + tokens + ' tokens');
      setTimeout(() => setMood('idle'), 3000);
    }
  });

  ctx.on('tool/call', (ev) => {
    setMood('thinking');
    say('在忙工具：' + String(ev.code || '').slice(0, 20));
  });

  ctx.on('agent/task-idle', () => setMood('idle'));

  // ===== 可逆副作用 =====
  ctx.effect(() => {
    const t = setInterval(() => {
      if (mood === 'idle') el.textContent = el.textContent === '🐋' ? '🐋' : '🐋';
    }, 5000);
    return () => clearInterval(t);
  });

  // ===== 提供服务（供其他插件用）=====
  ctx.provide('whale-pet', {
    say,
    setMood,
    isReady: () => true,
  });

  ctx.log('桌宠已挂载，可用 ctx.get("whale-pet") 控制');
}

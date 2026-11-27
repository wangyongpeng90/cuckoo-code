/**
 * dsh-slot-probe — 客户端探针（阶段 0 回归夹具）
 *
 * 验四环，每环独立状态灯：
 *   ① load     —— __ModuleLoader__ 被调用、require('react') 可用
 *   ② register —— ctx.slots.inject / register 契约（order / id 回退 / label 函数 / inject 派生 / disposer / entries 结构）
 *   ③ render   —— shell.overlay 挂载点存在、组件真的渲染进 DOM
 *   ④ dispose  —— ctx.effect 的 cleanup 在卸载时被调用
 *
 * 结果同时写到：
 *   - window.__dshProbe（Console 里可查）
 *   - 页面右下角状态灯（肉眼可看）
 *   - shellAPI.pluginDebugLog → plugin-debug.log（落盘，供脚本判定）
 *
 * 详见 docs/requirements/261125-bmsfsh-dsh-purge-compat.md 阶段 0
 */
window.__ModuleLoader__.load({
  id: 'dsh-slot-probe',
  factory: (require) => {
    const react = require('react');
    const h = react.createElement;

    // ===== 探针状态 =====
    const probe = {
      name: 'dsh-slot-probe',
      at: new Date().toISOString(),
      rings: {
        load: { ok: false, detail: '' },
        register: { ok: false, detail: '', asserts: [] },
        render: { ok: false, detail: '' },
        dispose: { ok: false, detail: '' },
      },
      ctx: null,
      registerReturnsDisposer: false,
      injectDerived: null,
      renderCount: 0,
      domNodeId: 'dsh-slot-probe-root',
    };
    window.__dshProbe = probe;

    const log = (m) => { try { window.shellAPI && window.shellAPI.pluginDebugLog && window.shellAPI.pluginDebugLog(m); } catch { /* ignore */ } };
    const report = () => { try { log('[dsh-slot-probe] ' + JSON.stringify(probe)); } catch { /* ignore */ } };
    const assert = (name, ok, detail) => { probe.rings.register.asserts.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) }); return !!ok; };

    // ===== ① load =====
    probe.rings.load.ok = !!react && typeof react.createElement === 'function';
    probe.rings.load.detail = 'require(react) 可用；ModuleLoader 已执行';

    // ===== ③ render：状态灯组件 =====
    const COLORS = { ok: '#16a34a', bad: '#dc2626', todo: '#9ca3af' };
    function Lamp({ label, ring }) {
      const r = ring || { ok: false, detail: '未执行' };
      const color = r.ok ? COLORS.ok : COLORS.bad;
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, lineHeight: 1.6 } },
        h('span', { style: { width: 8, height: 8, borderRadius: 4, background: color, flex: '0 0 auto' } }),
        h('span', { style: { fontWeight: 700, color } }, label),
        h('span', { style: { color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 } }, r.detail || ''),
      );
    }

    function ProbePanel() {
      react.useEffect(() => {
        // ③ render 的断言：DOM 里能找到自己的节点 + data-slot 挂载点
        const t = setTimeout(() => {
          const self = document.getElementById(probe.domNodeId);
          const host = document.querySelector('[data-slot="shell.overlay"]');
          probe.renderCount += 1;
          const ok = !!self && !!host;
          probe.rings.render.ok = ok;
          probe.rings.render.detail = ok
            ? 'shell.overlay 挂载点 + 组件节点均存在'
            : ('缺：' + (host ? '' : 'shell.overlay 挂载点 ') + (self ? '' : '组件节点'));
          report();
        }, 300);
        return () => clearTimeout(t);
      }, []);
      return h('div', {
        id: probe.domNodeId,
        style: {
          position: 'fixed', right: 12, bottom: 12, zIndex: 60,
          background: '#fff', color: '#111', border: '1px solid #d1d5db', borderRadius: 8,
          padding: '8px 10px', boxShadow: '0 4px 16px rgba(0,0,0,.12)', fontFamily: 'monospace',
          maxWidth: 360,
        },
      },
        h('div', { style: { fontSize: 12, fontWeight: 700, marginBottom: 4 } }, 'DSH 插槽探针'),
        h(Lamp, { label: '① load', ring: probe.rings.load }),
        h(Lamp, { label: '② register', ring: probe.rings.register }),
        h(Lamp, { label: '③ render', ring: probe.rings.render }),
        h(Lamp, { label: '④ dispose', ring: probe.rings.dispose }),
        h('div', { style: { fontSize: 10, color: '#888', marginTop: 4 } },
          'window.__dshProbe 查看详情'),
      );
    }

    // [阶段 1] 会话作用域槽位的探针组件：显示收到的 sessionId，验参数有没有传进来
    function HeaderProbe(props) {
      return h('span', {
        'data-probe': 'header',
        title: 'conversation.session.header.utilities 探针',
        style: { fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#eef2ff', color: '#3730a3', fontFamily: 'monospace' },
      }, 'HDR sid=' + String(props && props.gotSessionId));
    }
    function InputProbe(props) {
      return h('span', {
        'data-probe': 'inputright',
        title: 'conversation.input.right 探针',
        style: { fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#fef3c7', color: '#92400e', fontFamily: 'monospace' },
      }, 'IN sid=' + String(props && props.gotSessionId));
    }

    /**
     * [阶段 2] runtime 三洞的异步断言。
     * 完成后重新结算 register 环（因为断言是异步的）。
     */
    async function runPhase2Assertions(ctx) {
      // ① waterfall：模拟 dsh-purge 的 system-prompt/assemble 改写
      try {
        const order = [];
        ctx.on('probe/waterfall', async (val, next) => {
          order.push('A-in');
          const downstream = await next();
          order.push('A-out');
          return downstream + '+A';
        }, { global: true, prepend: true });
        ctx.on('probe/waterfall', async (val, next) => {
          order.push('B-in');
          const downstream = await next();
          order.push('B-out');
          return downstream + '+B';
        });
        const out = await ctx.waterfall('probe/waterfall', 'base', () => Promise.resolve('tail'));
        assert('waterfall 链式执行', out === 'tail+B+A', 'out=' + out + ' order=' + order.join(','));
        assert('waterfall prepend 排在前', order[0] === 'A-in', order.join(','));
      } catch (e) { assert('waterfall 可用', false, e && e.message); }

      // ② inject 延迟：服务未就绪 → 不立即执行；provide 后才执行
      try {
        let firedAfterProvide = false;
        ctx.inject(['probeLateService'], () => { firedAfterProvide = true; });
        assert('inject 服务未就绪时不执行', firedAfterProvide === false, 'firedEarly=' + firedAfterProvide);
        ctx.provide('probeLateService', { hello: 'ok' });
        assert('inject 在 provide 后执行', firedAfterProvide === true);
      } catch (e) { assert('inject 延迟可用', false, e && e.message); }

      // ③ agentPresets 存在且可读
      try {
        assert('agentPresets 存在', !!ctx.agentPresets);
        const r = ctx.agentPresets && ctx.agentPresets.list ? await ctx.agentPresets.list() : null;
        assert('agentPresets.list() 可调用', !!r && !!r.result, JSON.stringify(r));
      } catch (e) { assert('agentPresets 可用', false, e && e.message); }

      // ④ on 的第三参选项不再被当成函数
      try {
        let hit = 0;
        const off = ctx.on('probe/emit', () => { hit += 1; }, { prepend: true });
        ctx.emit('probe/emit');
        off();
        ctx.emit('probe/emit');
        assert('on(evt,fn,opts) 正常 + off 生效', hit === 1, 'hit=' + hit);
      } catch (e) { assert('on 选项可用', false, e && e.message); }

      // ===== 阶段 4：conversation 服务（dsh-purge 的 rewind 依赖）=====
      try {
        assert('conversation 存在', !!ctx.conversation);
        assert('conversation.input 存在', !!(ctx.conversation && ctx.conversation.input));

        // ① shell(sessionId) 返回输入面板
        const input = ctx.conversation && ctx.conversation.input;
        const s1 = input && typeof input.shell === 'function' ? input.shell('probe-session-1') : null;
        assert('input.shell(id) 返回面板', !!s1);

        // ② setDraft 写进草稿，state.getSnapshot().draft 读得回来
        let draftOk = false;
        if (s1 && typeof s1.setDraft === 'function' && s1.state && typeof s1.state.getSnapshot === 'function') {
          s1.setDraft('草稿内容-XYZ');
          draftOk = s1.state.getSnapshot().draft === '草稿内容-XYZ';
        }
        assert('setDraft → getSnapshot().draft 往返', draftOk);

        // ③ 会话隔离：不同 sessionId 不串味
        const s2 = input && typeof input.shell === 'function' ? input.shell('probe-session-2') : null;
        const iso = !!(s2 && s2.state && s2.state.getSnapshot && s2.state.getSnapshot().draft === '');
        assert('不同会话的草稿互相隔离', iso);

        // ④ for(actx) 也能拿到面板（DSH 原生签名）
        let forOk = false;
        try {
          const s3 = input && typeof input.for === 'function' ? input.for({ sessionId: 'probe-session-3' }) : null;
          forOk = !!s3;
        } catch { forOk = false; }
        assert('input.for(actx) 可用', forOk);
      } catch (e) { assert('conversation 服务可用', false, e && e.message); }

      // 重新结算 register 环（阶段 2 的断言是异步加的）
      const failed = probe.rings.register.asserts.filter((a) => !a.ok);
      probe.rings.register.ok = failed.length === 0;
      probe.rings.register.detail = failed.length === 0
        ? ('全部 ' + probe.rings.register.asserts.length + ' 项断言通过')
        : (failed.length + ' 项失败: ' + failed.map((x) => x.name).join(', '));
      report();
    }

    // ===== apply =====
    function apply(ctx) {
      probe.ctx = {
        hasSlots: !!ctx.slots,
        hasEffect: typeof ctx.effect === 'function',
        hasInject: typeof ctx.inject === 'function',
        hasLocale: !!ctx.locale,
        services: Object.keys(ctx).filter((k) => typeof ctx[k] !== 'function' && k !== 'slots').slice(0, 40),
      };

      // ===== ② register：深断言 =====
      try {
        // 用函数形式的 inject，验派生逻辑（dsh-purge 就是这么用的）
        const spec = {
          name: 'shell.overlay',
          id: 'dsh-slot-probe',
          order: 7,
          label: () => 'DSH 探针',
          inject: () => ({ probeInjected: 'yes' }),
        };
        const disposer = ctx.slots.inject('shell.overlay', () => ctx.slots.register(spec, ProbePanel));
        probe.registerReturnsDisposer = typeof disposer === 'function';

        // 断言 entries 结构（DSH 契约：{ component, options, inject, ... }）
        const entries = ctx.slots.entries ? ctx.slots.entries('shell.overlay') : [];
        const mine = (entries || []).find((e) => e && e.options && e.options.id === 'dsh-slot-probe');
        assert('register 返回 disposer', probe.registerReturnsDisposer);
        assert('entries() 含本条目', !!mine, mine ? 'ok' : '未找到');
        assert('order 被保留(7)', !!mine && mine.options.order === 7, mine && mine.options.order);
        assert('component 是函数', !!mine && typeof mine.component === 'function');
        assert('inject 面已派生', !!mine && typeof mine.inject === 'function');

        // 验 inject 函数被调用后拿到的 props
        try {
          const derived = mine && typeof mine.inject === 'function' ? mine.inject() : null;
          probe.injectDerived = derived;
          assert('inject() 返回 probeInjected=yes', !!derived && derived.probeInjected === 'yes', JSON.stringify(derived));
        } catch (e) { assert('inject() 可调用', false, e && e.message); }

        // ===== 阶段 1：会话作用域槽位（dsh-purge 的 header / rewind 按钮）=====
        // 这类槽位的 spec.inject 是 (sessionId) => ({...})，参数必须原样传进去
        try {
          ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
            { name: 'conversation.session.header.utilities', id: 'dsh-slot-probe-header', order: 3, inject: (sid) => ({ gotSessionId: sid }) },
            HeaderProbe,
          ));
          ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
            { name: 'conversation.input.right', id: 'dsh-slot-probe-input', order: 4, inject: (sid) => ({ gotSessionId: sid }) },
            InputProbe,
          ));
          for (const slotName of ['conversation.session.header.utilities', 'conversation.input.right']) {
            const es = ctx.slots.entries ? ctx.slots.entries(slotName) : [];
            const id = slotName.includes('header') ? 'dsh-slot-probe-header' : 'dsh-slot-probe-input';
            const me = (es || []).find((e) => e && e.options && e.options.id === id);
            assert('注册 ' + slotName, !!me);
            // 关键：inject 收得到 scope 目标（sessionId）
            if (me && typeof me.inject === 'function') {
              const got = me.inject('SCOPE-TARGET-1');
              assert(slotName + ' 的 inject 收到 scope 目标', !!got && got.gotSessionId === 'SCOPE-TARGET-1', JSON.stringify(got));
            }
          }
        } catch (e) { assert('会话作用域槽位注册', false, e && e.message); }

        // ===== 阶段 2：runtime 三洞（异步，见 runPhase2Assertions）=====
        void runPhase2Assertions(ctx);

        const failed = probe.rings.register.asserts.filter((a) => !a.ok);
        probe.rings.register.ok = failed.length === 0;
        probe.rings.register.detail = failed.length === 0
          ? ('全部 ' + probe.rings.register.asserts.length + ' 项断言通过')
          : (failed.length + ' 项失败: ' + failed.map((f) => f.name).join(', '));

        // ===== ④ dispose：注册 cleanup，验卸载时会执行 =====
        ctx.effect(() => {
          return () => {
            probe.rings.dispose.ok = true;
            probe.rings.dispose.detail = 'cleanup 已执行（插件卸载时）';
            report();
          };
        });
        // 卸载前的占位状态（真机点禁用/重载后应变绿）
        probe.rings.dispose.detail = '已注册 cleanup，等待卸载触发';
      } catch (e) {
        probe.rings.register.detail = '异常: ' + (e && e.message ? e.message : String(e));
        probe.rings.register.ok = false;
      }

      report();
    }

    return { name: 'dsh-slot-probe', apply };
  },
});

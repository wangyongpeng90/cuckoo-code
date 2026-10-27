/**
 * 插件插槽渲染的错误边界（单个插件组件崩溃不影响整个壳）。
 */
import { createElement, Component } from 'react';

export class SlotErrorBoundary extends Component<{ children?: any; label?: string }, { err: string | null }> {
  constructor(props: any) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(e: any) { return { err: (e && e.message) ? e.message : String(e) }; }
  componentDidCatch(e: any) { console.error('[dsh-slot] 组件崩溃', e); }
  render() {
    if (this.state.err) {
      return createElement('span', { title: '插件组件崩溃：' + this.state.err, style: { color: '#e55', fontSize: 11 } },
        '⚠ ' + (this.props.label || '插件出错'));
    }
    return (this as any).props.children;
  }
}

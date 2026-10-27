/**
 * React Hook：弹窗打开时隐藏 AI 视图（原生 WebContentsView 永远在网页之上）。
 *
 * 用法：在模态组件的顶层调用 useHideAiView()；卸载时自动恢复。
 */
import { useEffect } from 'react';
import { api } from './shared.js';

/** 弹窗挂载时藏 AI 视图，卸载时恢复 */
export function useHideAiView(): void {
  useEffect(() => {
    const anyApi = api as any;
    if (anyApi.setAiViewVisible) anyApi.setAiViewVisible(false).catch(() => {});
    return () => { if (anyApi.setAiViewVisible) anyApi.setAiViewVisible(true).catch(() => {}); };
  }, []);
}

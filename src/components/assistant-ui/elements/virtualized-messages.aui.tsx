"use client";

/**
 * [261109-8ms69z-cuko-api] 虚拟化消息列表
 * 此文件属于 Cuko API 独立工作窗口需求，详细设计见：
 * docs/requirements/261109-8ms69z-cuko-api.md
 *
 * assistant-ui 0.15.34 没有内置 VirtualizedThread，但提供了
 * `ThreadPrimitive.Unstable_MessageById` + `unstable_useThreadMessageIds`，
 * 就是给外部虚拟列表用的。这里接 @tanstack/react-virtual：
 * 只渲染视口附近的消息，消息高度靠 measureElement 动态测量。
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type FC,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ThreadPrimitive,
  unstable_useThreadMessageIds,
  useAuiState,
} from "@assistant-ui/react";

type MessageListComponents = ComponentProps<
  typeof ThreadPrimitive.Unstable_MessageById
>["components"];

export interface VirtualizedThreadMessagesProps {
  scrollRef: RefObject<HTMLDivElement | null>;
  components: MessageListComponents;
  /** 未测量前的估算高度 */
  estimateSize?: number;
  /** 视口上下各多渲染几条 */
  overscan?: number;
}

export const VirtualizedThreadMessages: FC<VirtualizedThreadMessagesProps> = ({
  scrollRef,
  components,
  estimateSize = 220,
  overscan = 6,
}) => {
  const messageIds = unstable_useThreadMessageIds();
  const messageCount = messageIds.length;
  const lastRole = useAuiState(
    (s) => s.thread.messages[s.thread.messages.length - 1]?.role,
  );

  // 用户是否停在底部（虚拟列表下 auto-scroll 依赖真实 DOM 高度，容易和测量打架）
  const stickToBottomRef = useRef(true);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onScroll = () => {
      stickToBottomRef.current =
        element.scrollHeight - element.scrollTop - element.clientHeight <= 120;
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => element.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  // 新消息追加后贴底：用户消息强制贴底，其他消息只在原本贴底时跟随
  useLayoutEffect(() => {
    if (lastRole !== "user" && !stickToBottomRef.current) return;
    const element = scrollRef.current;
    if (!element) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const viewport = scrollRef.current;
        if (!viewport) return;
        viewport.scrollTop = viewport.scrollHeight;
        stickToBottomRef.current = true;
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [messageCount, lastRole, scrollRef]);

  const virtualizer = useVirtualizer({
    count: messageIds.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (index) => messageIds[index] ?? index,
  });

  return (
    <div
      data-slot="aui_virtual_message_list"
      style={{
        height: virtualizer.getTotalSize(),
        position: "relative",
        width: "100%",
      }}
    >
      {virtualizer.getVirtualItems().map((item) => (
        <div
          key={item.key}
          data-index={item.index}
          ref={virtualizer.measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${item.start}px)`,
          }}
          className="pb-6"
        >
          <ThreadPrimitive.Unstable_MessageById
            messageId={messageIds[item.index]}
            components={components}
          />
        </div>
      ))}
    </div>
  );
};

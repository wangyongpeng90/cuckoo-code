"use client";

import { useEffect, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { useShallow } from "zustand/react/shallow";

const useFileSrc = (file: File | undefined) => {
  const [entry, setEntry] = useState<{ file: File; url: string } | undefined>(
    undefined,
  );

  useEffect(() => {
    // The object URL is a browser resource whose lifetime has to straddle
    // commit, so allocation, revocation, and clearing the entry that names a
    // revoked URL all belong to the effect.
    if (!file) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntry(undefined);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setEntry({ file, url: objectUrl });

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return entry !== undefined && entry.file === file ? entry.url : undefined;
};

/**
 * [261109-8ms69z-cuko-api] Cuko 附件持久化。
 *
 * 消息里的附件仍然是 assistant-ui 的 file part，但 `data` 存的是相对
 * `<userData>/cuko-attachments` 的路径（`会话id/消息id/0.png`），本 hook
 * 通过 `cukoAPI.readAttachment` 读回 base64 再拼成 data URL 给 <img> 用。
 *
 * 注意：assistant-ui 的 `partToCompleteAttachment` 会把 file part 映射成
 * type: "document"，所以判断图片只能看 `mimeType`，不能看 attachment.type。
 */
const DISK_CACHE_MAX = 40;
const diskSrcCache = new Map<string, string>();

const cacheGet = (key: string) => {
  const hit = diskSrcCache.get(key);
  if (hit === undefined) return undefined;
  // LRU：命中后移到队尾，避免大图把内存撑爆
  diskSrcCache.delete(key);
  diskSrcCache.set(key, hit);
  return hit;
};

const cachePut = (key: string, value: string) => {
  if (diskSrcCache.size >= DISK_CACHE_MAX) {
    const oldest = diskSrcCache.keys().next().value;
    if (oldest !== undefined) diskSrcCache.delete(oldest);
  }
  diskSrcCache.set(key, value);
};

/** data:/blob:/http(s) 都不是本地路径，只有 Cuko 存的相对路径才需要读盘 */
const isDiskPath = (data: string): boolean =>
  !/^(?:data|blob):/i.test(data) && !/^(?:https?:)?\/\//i.test(data);

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
};

const mimeOf = (relPath: string, mimeType: string | undefined): string => {
  if (mimeType && mimeType.startsWith("image/")) return mimeType;
  const ext = (/\.([a-z0-9]+)$/i.exec(relPath)?.[1] ?? "").toLowerCase();
  return EXT_MIME[ext] ?? "application/octet-stream";
};

const useDiskSrc = (
  relPath: string | undefined,
  mimeType: string | undefined,
) => {
  const [entry, setEntry] = useState<{ key: string; url: string } | undefined>(
    () => {
      if (!relPath) return undefined;
      const cached = cacheGet(relPath);
      return cached ? { key: relPath, url: cached } : undefined;
    },
  );

  useEffect(() => {
    if (!relPath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntry(undefined);
      return;
    }
    const cached = cacheGet(relPath);
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntry({ key: relPath, url: cached });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const api = (window as unknown as { cukoAPI?: { readAttachment?: (p: string) => Promise<{ success: boolean; data?: string }> } }).cukoAPI;
        if (!api?.readAttachment) return;
        const res = await api.readAttachment(relPath);
        if (cancelled || !res?.success || typeof res.data !== "string") return;
        const url = `data:${mimeOf(relPath, mimeType)};base64,${res.data}`;
        cachePut(relPath, url);
        setEntry({ key: relPath, url });
      } catch {
        /* 读盘失败静默降级为无图，文件卡片仍显示文件名 */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [relPath, mimeType]);

  return entry !== undefined && entry.key === relPath ? entry.url : undefined;
};

export const useAttachmentSrc = () => {
  const attachment = useAuiState(
    useShallow(
      (s): {
        file?: File;
        src?: string;
        diskPath?: string;
        diskMime?: string;
      } => {
        const parts = s.attachment.content ?? [];
        const file = s.attachment.file;
        const imagePart = parts.find(
          (c) => c.type === "image" && typeof (c as { image?: unknown }).image === "string",
        );
        const filePart = parts.find((c) => {
          if (c.type !== "file") return false;
          const part = c as { data?: unknown; mimeType?: unknown };
          return (
            typeof part.data === "string" &&
            isDiskPath(part.data) &&
            String(part.mimeType ?? "").startsWith("image/")
          );
        });
        const filePartData = filePart
          ? (filePart as unknown as { data: string; mimeType?: string })
          : undefined;
        return {
          file,
          src: imagePart
            ? ((imagePart as unknown as { image: string }).image as string)
            : undefined,
          diskPath: filePartData?.data,
          diskMime: filePartData?.mimeType,
        };
      },
    ),
  );

  const fileUrl = useFileSrc(attachment.file);
  const diskUrl = useDiskSrc(attachment.diskPath, attachment.diskMime);

  return fileUrl ?? attachment.src ?? diskUrl;
};

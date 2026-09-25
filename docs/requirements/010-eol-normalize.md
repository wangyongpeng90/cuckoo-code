---
id: 010
type: refactor
title: 换行符处理对齐 dsh（LF 归一化）
status: done
branch: refactor/010-eol-normalize
created: 2026-09-24
updated: 2026-09-25
---

## 背景

009 用"三级候选匹配 + 保留混合 + read/readLines 报告换行符"处理换行符，较复杂。
参考 DeepSeek Harness（dsh）的方案，其做法更简洁彻底：

- `normalizeLineEndings`：读入时把 CRLF 全转 LF（内存里只留 LF）
- `detectLineEndings`：前 4096 字符，多数决，判主导格式
- `restoreLineEndings`：写回前，把 LF 结果转回文件原本的风格

**核心：LF 归一 → 匹配 → 恢复。**

## 目标

完全按 dsh 模式重做换行符处理：

- **砍掉** `read`/`readLines` 的换行符报告（AI 不需要感知，工具兜底）
- `edit`：读入归一化 LF → 在 LF 世界匹配 → 写回恢复原风格
- **编辑即规整**：混合文件被统一成主导格式（dsh 的行为）
- `write`：已有文件跟随主导格式；新文件 LF

## 方案

### 1. 新建 `src/infra/eol.ts`

```ts
type LineEndings = 'LF' | 'CRLF';

// CRLF → LF（孤立 \r 不动）
function normalizeLineEndings(content: string): string {
  return content.replaceAll('\r\n', '\n');
}

// 前 4096 字符多数决
function detectLineEndings(raw: string): LineEndings {
  const sample = raw.slice(0, 4096);
  const crlfCount = sample.split('\r\n').length - 1;
  const lfCount = sample.split('\n').length - 1 - crlfCount;
  return crlfCount > lfCount ? 'CRLF' : 'LF';
}

// LF 结果 → 原风格（CRLF 先归一避免 \r\r\n）
function restoreLineEndings(content: string, le: LineEndings): string {
  return le === 'LF' ? content : normalizeLineEndings(content).split('\n').join('\r\n');
}
```

### 2. `edit.ts`

```
读文件 → raw
  lineEndings = detectLineEndings(raw)
  content = normalizeLineEndings(raw)
oldString → normalize → 匹配
newString → normalize
替换（在 LF 世界）
结果 → restoreLineEndings(result, lineEndings) → 写回
```

### 3. `write.ts`

- 已有文件：读原文件 → detectLineEndings → 内容归一后按该格式恢复
- 新文件：LF

### 4. 回退 009 的 read/readLines 改动

- `read.ts`：移除 `detectEol`、`eol` 字段、footer 换行符行
- `read-lines.ts`：移除 `eol` / `dominantEol`

## 验收标准

- [x] `infra/eol.ts` 三个函数 + 单元测试（18 例）
- [x] `edit`：纯 LF / 纯 CRLF / 混合 文件编辑后格式正确
- [x] `edit`：混合文件被规整成主导格式（dsh 行为）
- [x] `write`：已有文件跟随主导；新文件 LF
- [x] `read`/`readLines` 回到无换行符报告
- [x] typecheck / test / lint / compile 全绿

## 遗留

- 不加 `.gitattributes` / `.editorconfig`（保留混合状态，方便持续测试）
- 真机验证

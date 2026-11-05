---
id: 261105-uw877b
type: feature
title: 系统提示词模板可编辑（按平台，存 SQLite）
status: review
branch: feat/261105-geaofb-deepseek-clipboard-paste
created: 2026-11-05
updated: 2026-11-05
---

# 系统提示词模板可编辑（按平台，存 SQLite）

## 背景

系统提示词模板目前是**只读**的硬编码文件：

- 真源：`src/prompt/{providerId}.md`（deepseek / claude / chatgpt）+ `src/prompt/default.md`（兜底）
- 读取逻辑：`src/session/prompt-builder.ts` 的 `loadTemplate()`
- 优先级：`provider.getPromptTemplate()` → `src/prompt/{id}.md` → `src/prompt/default.md`

用户想自定义模板（改身份描述、增删规则、调整语气等），但只能改源码文件，重启才生效，且升级会被覆盖。需要在**壳页面设置页**里直接编辑。

## 目标

1. 壳页面设置页新增「系统提示词」分类，可编辑当前平台模板
2. **按平台分开存**（key：`cuckoo-system-prompt-template:{providerId}`）
3. 持久化到 **SQLite meta 表**（复用现有 `settings-store`，跨窗口共享）
4. 未自定义时回退内置文件；支持「填入内置模板」和「恢复默认」
5. 占位符（`{{PLATFORM_INFO}}` / `{{TOOL_API_TYPES}}` / `{{MCP_SECTION}}` 等）照常替换
6. 兼容内置 / 用户导入 / 插件贡献的 provider

## 方案

### 数据层

复用现有 `src/app/settings-store.ts`（SQLite meta 表，key 前缀 `setting:`）：

| key | 值 |
|---|---|
| `cuckoo-system-prompt-template:{providerId}` | 该平台的完整模板文本；不存在 = 用内置 |

不新增表、不新增存储模块。

### 读取（架构关键）

`prompt-builder` 在 **session 层**，`settings-store` 在 **app 层**，依赖铁律禁止 session → app。

采用**注入**（与 `injectSettingReader` 同套路）：

```ts
// src/session/prompt-builder.ts
let promptSettingReader: ((key: string) => string | undefined) | null = null;
function injectPromptSettingReader(fn) { promptSettingReader = fn; }

function getCustomTemplate(providerId) {
  if (!promptSettingReader || !providerId) return '';
  const v = promptSettingReader('cuckoo-system-prompt-template:' + providerId);
  return (v && v.trim()) ? v : '';
}
```

`loadTemplate()` 最前面插一级：

```
1) 自定义（SQLite）   ← 新增
2) provider.getPromptTemplate()
3) src/prompt/{id}.md
4) src/prompt/default.md
```

`app/entry.ts` 在 `initSettingsStore(globalDb)` 之后注入：`injectPromptSettingReader(getSetting)`。

### IPC

新增 `src/app/ipc/prompt-template.ts`：

- `get-prompt-template`，入参 `{ providerId }`
  - 返回 `{ success, providers: [{id,name}], builtin, custom }`
  - `providers`：动态取自 `getAllProviders()`（内置 + 用户导入 + 插件）
  - `builtin`：复刻 loadTemplate 优先级（provider.getPromptTemplate → prompt/{id}.md → default.md）
  - `custom`：读 settings-store，未设置返回 `''`

保存 / 恢复走现有 `save-shared-settings` / `reset-shared-settings` IPC，不新开接口。

### UI

`src/ui/shell/scripts/pages/settings-react.tsx` 加一个左导航分类「系统提示词」：

- 平台下拉（动态）
- textarea（大，等宽字体）
- 状态提示：有自定义 → 「已自定义」；无 → 「未自定义，当前使用内置模板」
- 按钮：「填入内置模板」「恢复默认」

保存：**手动点保存**（模板体量大，防抖保存过于频繁写 DB 不划算；且与现有 textarea 类设置项体验一致）。

### 依赖方向

```
app/entry.ts  ──注入──▶ session/prompt-builder.ts
app/ipc/prompt-template.ts  ──读──▶ settings-store / providers/registry / session/prompt-builder
ui/shell  ──IPC──▶ app/ipc
```

无反向依赖，铁律不破。

## 验收

### 自动化（已完成）

- [x] `npm run typecheck` ✅ 0 错误
- [x] `npx vitest run` ✅ 105 文件 / 1017 用例
- [x] `npm run compile` ✅
- [ ] `npm run lint`：`eslint.config.js` 只覆盖 `*.js`，TS/TSX 全部 "File ignored"，
      这道门禁对本次改动无覆盖（非本次引入）

### 接口冒烟（应用内 CDP 实测）

- [x] `getPromptTemplate('')` 返回 `deepseek / claude / chatgpt`
- [x] `deepseek` 内置模板 3545 字
- [x] 保存自定义 → 读回一致 → 恢复默认 → 自定义归 0、内置不变（SQLite 往返）

### 真机（作者验证后提交）

- [ ] 内置平台（deepseek）设置自定义模板 → 新建对话发送，实际用自定义模板
- [ ] 清空 / 恢复默认 → 回退内置
- [ ] 三个平台（deepseek/claude/chatgpt）各存各的
- [ ] 导入自定义 provider → 下拉出现、可编辑、可保存
- [ ] 占位符（`{{PLATFORM_INFO}}` 等）正常替换
- [ ] 重启应用模板保留（SQLite 持久化）

## 遗留

- 删除自定义 provider 后，SQLite 里的模板成为孤儿数据（无害，不再被读取）；暂不处理
- 内置模板文件更新时，已自定义的模板不会自动跟进（符合预期）

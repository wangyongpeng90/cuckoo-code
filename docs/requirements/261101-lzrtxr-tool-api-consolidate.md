---
id: 261101-lzrtxr
type: refactor
title: 工具描述收归 apiMetas（消除三处重复）
status: review
branch: feat/261101-lzrtxr-tool-api-consolidate
created: 2026-11-01
updated: 2026-11-01
---

# 工具描述收归 apiMetas

## 背景

同一个工具的说明在系统提示词里出现三次：

| 层 | 数据源 | 内容 |
|---|---|---|
| `{{TOOL_API_TYPES}}` | `apiMetas.doc` → `api.d.ts` | JSDoc + 签名 + @param/@throws |
| `{{TOOL_SECTIONS}}` | `getPromptSection().text` | 使用指导 |
| `{{TOOLS_LIST}}` | `getFormattedJsApiForPrompt()` | `1. `read(...)` — 描述` |

三者信息重叠但不一致：`apiMetas.doc` 与 `super()` 第二参 `description` 是两套字符串，AI 会看到同一工具的不同描述。且 `{{TOOLS_LIST}}` 只是 `{{TOOL_API_TYPES}}` 的摘要，纯冗余。

## 目标

1. 工具说明只在一处维护：`apiMetas`
2. 保留「是什么」与「怎么用」的语义分离
3. 删除 `{{TOOLS_LIST}}` 占位符（纯重复）
4. 内置工具的 `getPromptSection()` 全部移除（插件工具保留）

## 方案

### ToolApiMeta 加 usage 字段

```ts
export interface ToolApiMeta {
  doc: string;          // 这函数是什么、返回什么
  usage?: string;       // 什么时候该用、别用什么替代（新增）
}
```

### 生成器插入空行分段

`scripts/build-tool-api.mjs` 的 `render()`：doc 之后若 `usage` 存在，插一个 ` *` 空行再输出。

### 21 个内置工具

把 `getPromptSection().text` 的内容迁到 `apiMetas[0].usage`，删掉 `getPromptSection()` 方法。

### 插件工具保留基类方法

`src/plugins/cuckoo-plugins/index.ts` 等运行时注册的工具没有 `apiMetas`，继续用 `getPromptSection()`。`Tool` 基类方法保留，`ToolRegistry.getPromptSections()` 自然只返回插件工具的段。

### 模板清理

- `deepseek.md` / `default.md`：删除 `{{TOOLS_LIST}}` 整节及周边说明
- 4 个模板：`{{TOOL_SECTIONS}}` 前的写死标题 `## 工具使用指导` 删除，标题写进占位符值

## 验收标准

- [x] `api.d.ts` 中每个工具的 JSDoc 含 doc 段 + 空行 + usage 段
- [x] 21 个内置工具不再有 `getPromptSection()`
- [x] 插件工具的 `getPromptSection()` 仍生效（基类方法保留）
- [x] `{{TOOLS_LIST}}` 从模板与 `prompt-builder` 移除，方法本体保留（D4）
- [x] `{{TOOL_SECTIONS}}` 为空时不出现空标题
- [x] typecheck / test / compile 全绿

## 决策记录

### D1 usage 用独立字段，不并进 doc
doc 回答「是什么」，usage 回答「怎么用」，语义不同。并进 doc 会让 attachFile 这类长文档膨胀到 9 行。

### D2 基类 getPromptSection() 保留给插件工具
插件工具运行时注册，无 apiMetas，无法用 usage。保留方法让插件继续工作，内置工具只是不再 override。

### D3 删除 {{TOOLS_LIST}}
纯重复：{{TOOL_API_TYPES}} 已含签名 + 完整 doc + @param + @throws。且存在不一致风险：getFormattedJsApiForPrompt 用 description，api.d.ts 用 doc。

### D4 getFormattedJsApiForPrompt / getFormattedToolsForPrompt 方法保留
虽然无调用方，但留作插件/外部扩展 API。删测试则不如保留。

### D5 {{TOOL_SECTIONS}} 标题写进占位符值
与 {{MCP_SECTION}} / {{SKILLS_SECTION}} 等现有惯例一致：无内容时返回空串，避免出现空标题。

## 扩展一：write 输出去掉 XML 格式（2 个池）

### 背景
`write` 原本返回 `<path>..</path><type>file</type><content>Created file</content>`，是最后残留的 XML 格式输出。用户要求改为可配置模板。

### 两套池

| 键 | 场景 | 占位符 |
|---|---|---|
| `cuckoo-write-footer-create` | 新建文件 | `{path}` |
| `cuckoo-write-footer-update` | 覆盖已有文件 | `{path}` |

内置默认各 8 条，例如「已创建 {path}」「改好了：{path}」。

### 决策
- **D6 分两个池而非一个**：新建与更新语义不同（「写好了」vs「改好了」），且 `write` 内部本来就有 `operation` 区分。
- **D7 复用 `readSettingRaw`**：与 glob 一样复用 read.ts 导出的读取函数，不重复注入。
- **D8 设置页新开「文件写入格式」分类**：与「文件读取格式」「文件搜索格式」并列，按工具分区。

### 落地位置
| 文件 | 职责 |
|---|---|
| `src/infra/read-header-templates.ts` | 2 个 write 池 + 键名 |
| `src/tools/impl/write.ts` | `formatWriteOutput` 改走池；doc/usage 去掉 XML 描述 |
| `src/overlay/panels/settings.ts` | SettingsData + 读写 + 重置 |
| `src/ui/shell/scripts/pages/settings-react.tsx` | 新分类「文件写入格式」 |
| `src/prompt/*.md` | 4 个模板的系统返回示例去掉 XML 块 |
| `test/tools/WriteTool.test.js`、`FileTools.test.js` | 断言改为检查路径存在 + 无 XML 标签 |

## 遗留

1. 未真机验证：需 npm start 确认 AI 看到的新 prompt 结构
2. src/app/ipc/session.ts 有一处无关的未提交改动（文件树节点上限 5000→50000），不属本需求
3. edit 工具输出仍是英文（`The file ... has been updated`），本次未动

# 05 常见任务手册

> **做新需求时最先看这里**。每节给出：改哪些文件 + 注意事项。

---

## 任务 1：加一个新工具 ⭐

工具是**唯一真相源**：改一处，API 契约、沙箱注入、提示词章节**全自动同步**（D12）。

### 步骤

1. **新建** `src/tools/impl/<kebab-name>.ts`（推荐照 `read.ts` 简单、`bash.ts` 带选项）：

```ts
import { Tool } from '../core/Tool.js';
import type { ToolApiMeta } from '../core/Tool.js';
import { ToolResult } from '../core/ToolResult.js';

// ① API 契约元数据（构建期生成 api.d.ts）
export const apiMetas: ToolApiMeta[] = [
  {
    order: 30, category: '我的分类', name: 'myTool',
    types: 'interface MyOptions { ... }',
    doc: '这个工具做什么',
    params: 'arg1: string, arg2?: number',
    returns: 'Promise<string>',
    paramDocs: { arg1: '参数1说明', arg2: '参数2说明' },
  },
];

// ② 沙箱注入（构建期 .toString() 提取 → bootstrap.generated.ts）
export function bootstrap(__call: any): void {
  (globalThis as any).myTool = async function (arg1: any, arg2: any) {
    return await __call('myTool', { arg1: arg1, arg2: arg2 });
  };
}

// ③ 工具实现
class MyTool extends Tool {
  constructor() {
    super(
      'myTool',   // ← 必须与 bootstrap 里 __call 的首参一致
      '工具描述',
      { type: 'object', properties: { arg1: { type: 'string' } }, required: ['arg1'] },
      'myTool(arg1, arg2?)'
    );
  }
  getPromptSection() {
    return { name: 'tool:myTool', order: 130, text: '给 AI 的使用指导' };
  }
  async execute(params: any): Promise<ToolResult> {
    const { arg1, projectDir } = params;  // projectDir 由框架注入
    return ToolResult.success('结果');
  }
}
export { MyTool };
```

2. **注册**：`src/tools/index.ts` 加 import + `registry.register(new MyTool())`。
3. **重编译**：`npm run compile`。
4. **加测试**：`test/tools/MyTool.test.js`。

### 注意事项

- **名字四处一致**：`apiMetas.name` = `super()` 首参 = `bootstrap` 里 `__call` 首参 = `globalThis.xxx`。有 `bootstrap-consistency` 测试守护。
- **参数名用 camelCase**。
- `bootstrap` 里**只能引用 `__call`**（沙箱内自包含）。
- 别手改 `api.d.ts` / `bootstrap.generated.ts`。

---

## 任务 2：加一个新平台（Provider）

### 步骤

1. **新建** `src/providers/<id>.ts`，照 `deepseek.ts`：元数据（id/name/homeUrl/sessionUrlBase/useIntercept）+ 选择器方法（findInput/findSendButton/extractUserInfo/homeUrlPattern/extractSessionId/matchesUrl/isElementVisible）+ `getHookSource()`。

   - **可选** `getSessionListFn()`：侧栏「对话」分页的抓取实现。默认实现扫 `a[href]` 并按 `sessionUrlBase` 的 pathname 前缀过滤；若平台侧栏不是 `<a href>` 结构（SPA 用 div + 点击切换会话），在此返回自定义函数。该函数会被 `toString` 序列化后注入页面主世界，**必须自包含**（只用 `doc`/`win`/`base` 入参与浏览器全局），返回 `[{ title, href, active }]`。

2. **写 hook**（若 `useIntercept: true`）：新建 `src/providers/hooks/<id>.ts`，照 `hooks/deepseek.ts`。核心：
   - `install()` 猴补丁 `fetch`/`XHR`，判断 completion 请求
   - 解析 SSE 流 → 提取正文 → `dispatch(text, status, ...)`
   - 可 import `./shared/sse.js`
   - 末尾 `install(); export { install };`

3. **注册 hook 到构建**：`scripts/build-hooks.mjs` 的 `HOOKS` 数组加一行。
4. **注册 provider**：`src/providers/registry.ts` 加 import + 入内置列表。
5. **写提示词**（可选）：`src/prompt/<id>.md`。
6. **编译**：`npm run compile`。

### 注意事项
- hook **必须自包含**（打包成字符串注入主世界）；用正常 import，esbuild 会内联。
- hook 里**不要用复杂 TS 类型**（动态脚本，非 strict）。
- 自定义 provider 见 `custom/provider.template.js` 与 `custom/loader.ts`。

---

## 任务 3：改覆盖层 UI

### 改结构/样式
- HTML 真源：`src/overlay/template/overlay.html`
- CSS 真源：`src/overlay/template/overlay.css`
- 改完 `npm run compile`

### 加按钮/交互
1. `overlay.html` 加元素（带 id）
2. `overlay/events.ts` 的 `bindEvents()` 绑事件
3. 复杂逻辑放 `overlay/panels/*.ts`

### 注意事项
- overlay **不依赖 bridge/session**；需要下层能力 → 回调注入（见 02-依赖.md）。
- 状态放 `overlay/state.ts`（**只放 overlay 内部**）。

---

## 任务 4：加一个设置项

1. `overlay/panels/settings.ts`：`openSettings` / `saveSettings`（含校验）/ `resetSettings` 三处加
2. `overlay.html` 加输入框（id 如 `cuckoo-xxx`）
3. 消费方读 `localStorage.getItem('cuckoo-xxx')`（**每窗口独立**）

**约定**：时间类**存毫秒、显示秒**。

---

## 任务 5：加一个 IPC

1. **主进程**：`src/app/ipc/` 对应领域文件加 `ipcMain.handle('xxx', ...)`
2. **渲染侧封装**：`src/bridge/api.ts` 的 `electronAPI` 加方法
3. **调用**：`(window as any).electronAPI.xxx()`

### 注意事项
- 需要窗口上下文：`windowState.getContextByWebContents(event.sender)`（**能同时匹配壳与 view**）
- 操作 AI 页面 → `ctx.view.webContents`（**不是 `ctx.win.webContents`**）
- 操作壳页面 → `ctx.win.webContents.send(...)`

---

## 任务 6：改提示词

模板在 `src/prompt/{id}.md`，占位符：
- `{{TOOL_API_TYPES}}`：工具 API 类型（自动填 api.d.ts）
- `{{TOOLS_LIST}}` / `{{TOOL_SECTIONS}}`：工具列表 / 使用指导（registry 生成）
- `{{PLATFORM_INFO}}`：OS/命令差异（自动）
- `{{PROJECT_DIR}}` / `{{PROJECT_INTRO_SECTION}}` / `{{MCP_SECTION}}`（自动）

组装逻辑在 `src/session/prompt-builder.ts`。

---

## 任务 7：改 hook（网络拦截）

见任务 2 第 2 步。额外注意：
- **先确认拦截点**：F12 → Network → 找 completion 请求 URL 特征
- `dispatch`：正常完成发 `cuckoo-ai-response`（`finished: true`）；失败/中断发 `cuckoo-ai-error`
- `resolveStatus` 判定（deepseek 为例）：`finished` 优先；`INCOMPLETE`（服务端截断）归 error 触发重试；`userStopped` 归 stopped 忽略
- 改完**必须真机验证**

---

## 通用提交前检查

```bash
npm run typecheck   # 两套 tsconfig
npm test            # 210+ 测试
npm run lint        # 0 problems
npm run compile     # 构建 + 生成物
```

改到运行时行为 → **必须真机跑 `npm start`**。

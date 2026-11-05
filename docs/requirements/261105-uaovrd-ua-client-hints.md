---
id: 261105-uaovrd
type: fix
title: UA 与客户端提示（sec-ch-ua）不一致修正（改走 CDP override）
status: review
branch: feat/261105-geaofb-deepseek-clipboard-paste
created: 2026-11-05
updated: 2026-11-05
---

# UA / 客户端提示自相矛盾修正

## 背景

实测运行中的应用（CDP 抓真实请求头）：

| 维度 | 值 |
|---|---|
| `navigator.userAgent` | `... Chrome/152.0.0.0 Safari/537.36` ✅ |
| `navigator.userAgentData.brands` | `Google Chrome 152 / Chromium 152 / Not_A Brand 24`（JS 伪造） |
| **真实请求头 `sec-ch-ua`** | **`"Not?A_Brand";v="24", "Chromium";v="152"`（没有 Google Chrome）** |
| `platformVersion` | 写死 `10.0.0`（本机是 Win11，Chromium 实际报 `19.0.0`） |

即：JS 说自己是 Chrome，请求头说自己是 Chromium —— 任何做一致性校验的站点
（Google 登录 / Cloudflare / Akamai）一行代码即可判定"伪装"。

## 根因

1. `webRequest.onBeforeSendHeaders` 改写 `sec-ch-ua` **在 Electron 里不生效**：
   Chromium 在网络层按自己的品牌列表重算客户端提示，回调里删了也会被补回来（实测无效，且不报错）。
2. `buildUserAgentDataFix` 在页面里覆盖 `navigator.userAgentData`，只能骗 JS，
   骗不到请求头；且它硬编码的品牌名/GREASE 与运行时真实值不同（`Not_A Brand` vs `Not?A_Brand`）。

## 方案

改走 **CDP**：`webContents.debugger.attach()` + `Emulation.setUserAgentOverride`
（实测能真正改写 `sec-ch-ua` 请求头）。

- 元数据（brands / fullVersionList / platformVersion / architecture / bitness）取**运行时真实值**：
  启动后从壳页面（file://，安全上下文）读一次 `navigator.userAgentData`，进程内缓存；
- 在此基础上只补一个 `Google Chrome` 品牌（真实 Chrome 必有），排序沿用运行时顺序；
- `platformVersion` 用运行时真值（Win11 = `19.0.0`），不再写死；
- 删除 `buildUserAgentDataFix` 注入与 `buildClientHintsHeaders` / webRequest 改写（无效代码）；
- 不阻塞导航：先用兜底元数据下发，读到运行时真值后再重刷一次；
- 兜底开关：`CUCKOO_UA_OVERRIDE=off` 跳过 CDP（devtools 与 debugger 互斥，调试时可关）。

## 窗口覆盖审计（每个开窗口的地方）

| 位置 | 内容来源 | UA 字符串 | 客户端提示 `sec-ch-ua` |
|---|---|---|---|
| 主窗口 `mainWindow`（shell.html） | 本地 file:// | ✅ `app.userAgentFallback` | — 无远程请求；同时它是"真实值"取样源，**不能被覆盖** |
| AI 视图 `view` | 远端 | ✅ setUserAgent + CDP | ✅ |
| AI 视图内 `window.open` 弹窗（OAuth 等） | 远端 | ✅ 继承（`did-create-window`） | ✅ |
| `platform-select.html`（view 内） | 本地 | ✅ | ✅（同在 view 上） |
| overlay 窗口（data: URL） | 本地 | ✅ fallback | — |
| harness 视图（harness.html） | 本地 | ✅ fallback | — |
| 探测 / 窗口组切换 | 复用 `view.webContents` | ✅ | ✅ |
| 工具窗口 `openBrowserWindow` | 远端 | ✅ setUserAgent + 注入的 CDP | ✅ |
| 飞书配置教程窗口 | 本地；外链改为系统浏览器 | ✅ fallback | — |

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/infra/user-agent.ts` | 删 `buildClientHintsHeaders` / `buildUserAgentDataFix`；新增 `buildUserAgentMetadata()` |
| `src/app/entry.ts` | 新增 `applyChromeUserAgent` / `pushUaOverride` / `ensureRuntimeHints`；创建窗口时先 override 再导航；删除 webRequest 改写 |
| `src/bridge/entry.ts` | 删除 `buildUserAgentDataFix` 注入 |
| `src/tools/impl/browser-window-manager.ts` | 新增 `injectUaApplier`，工具窗口也下发客户端提示 |
| `src/app/ipc/shell.ts` | 飞书教程窗口的外链改走系统浏览器（避免开无补丁的 Electron 子窗口） |
| `test/infra/user-agent.test.js` | 改为覆盖 `buildUserAgentMetadata`（含运行时值优先、GREASE 不硬编码、平台映射） |

## 验收

- [x] `typecheck` / `compile` / `vitest`(1019) 全绿
- [x] 线上 `sec-ch-ua` = `"Google Chrome";v="152", "Not?A_Brand";v="24", "Chromium";v="152"`
- [x] `navigator.userAgentData.brands` 与请求头完全一致，`platformVersion=19.0.0`，`webdriver=false`
- [x] 重启后线上复测：`sec-ch-ua` = `"Google Chrome";v="152", "Not?A_Brand";v="24", "Chromium";v="152"`，
      `navigator.userAgentData` 同步，`platformVersion=19.0.0`
- [ ] 真机：Google 账号登录 / DeepSeek 正常对话（作者验证）

## 遗留

- **DevTools 互斥**：`webContents.debugger` 被占用后，该页面无法再打开 DevTools；
  需要调试时设 `CUCKOO_UA_OVERRIDE=off` 启动。
- 工具创建的浏览器窗口（`tools/impl/browser-window-manager.ts`）只设了 UA 串，
  没有 CDP override（tools 层不能依赖 app 层），其 `sec-ch-ua` 仍是 Electron 默认。
- 品牌顺序（Google Chrome 打头）与真实 Chrome 的 GREASE 顺序可能不同；
  但 JS 与请求头**内部自洽**，不再互相矛盾。

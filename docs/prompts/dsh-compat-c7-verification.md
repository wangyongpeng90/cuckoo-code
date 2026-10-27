# DSH 兼容 C7 真机验证流程

> 覆盖分支 `feat/022-dsh-compat-c7` 相对 master 的 **87 个提交**（其中本轮 TDD 会话 8 个提交）。
> 决策依据：`docs/dsh-compat-decisions.md` 第九章（9.1 ~ 9.8）
> 需求档案：`docs/requirements/022-dsh-plugin-compat.md` C4-D

## 0. 前置准备

### 0.1 确认代码版本

```bash
git branch --show-current          # 应为 feat/022-dsh-compat-c7
git log --oneline -1               # 应为 5c06709 或更新
npm run compile                    # 必须成功
npm test                           # 必须全绿（101 文件 / 957 用例）
```

### 0.2 数据路径

| 项 | 路径 |
|---|---|
| 用户数据目录 | `C:\Users\<用户名>\AppData\Roaming\cuckoo-ai-pro-session\` |
| 数据库 | `cuckoo.db`（+ `-wal` / `-shm`） |
| 老 JSON 文件 | `session-dir-map-*.json`（9 个） |
| 插件目录 | `C:\Users\<用户名>\.cuckoo\cuckoo-plugins\` |
| 日志 | `wyp/log/`（相对项目根） |

### 0.3 数据库查询准备

推荐用 Node 一行脚本（避免 Navicat 连接 WAL 锁）：

```bash
cd C:\d\SourceCode\2026\cuckoo-code
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('C:/Users/<用户名>/AppData/Roaming/cuckoo-ai-pro-session/cuckoo.db');console.log(db.prepare('<SQL>').all());db.close()"
```

或保存为 `_q.cjs` 反复用：

```js
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/<用户名>/AppData/Roaming/cuckoo-ai-pro-session/cuckoo.db');
console.log(JSON.stringify(db.prepare(process.argv[2]).all(), null, 2));
db.close();
```
用法：`node _q.cjs "SELECT COUNT(*) FROM workspaces"`

---

## 场景 A：数据库迁移与建表

### A-1 全新安装：JSON 迁移 + 表自动建出

**关联提交**：`0e3c7d6`（workspaces 建表）、`5c06709`（回填）

**前置**：
- 已关闭 Cuckoo
- `session-dir-map-*.json` 文件存在（9 个）

**步骤**：
1. 删除数据库：
   ```powershell
   del "$env:APPDATA\cuckoo-ai-pro-session\cuckoo.db*"
   ```
2. 确认 JSON 文件还在：`dir "$env:APPDATA\cuckoo-ai-pro-session\session-dir-map-*.json"`
3. `npm start`

**预期**：

| 检查项 | 预期 |
|---|---|
| 启动日志 | `[DB] 开始检查并迁移老 JSON 数据...` |
| 启动日志 | `[DB] workspaces 回填完成，共 N 条`（N 应 > 0） |
| 启动日志 | `[DB] 老数据迁移完成，已打上标记` |
| 表结构 | `meta` / `sessions` / `workspaces` 三张表都在 |
| `sessions` 条数 | > 0（从 JSON 迁移） |
| `workspaces` 条数 | **> 0**（从 sessions 回填，应与 sessions 的不同 project_dir 数一致） |
| `meta.legacy_migrated` | `1` |

**验证 SQL**：
```sql
-- 表清单
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
-- 数据量
SELECT
  (SELECT COUNT(*) FROM sessions) AS sessions,
  (SELECT COUNT(*) FROM workspaces) AS workspaces,
  (SELECT value FROM meta WHERE key='legacy_migrated') AS migrated;
-- workspaces 内容
SELECT id, path, title, session_ids FROM workspaces LIMIT 10;
```

**失败排查**：

| 现象 | 原因 | 处理 |
|---|---|---|
| 三张表缺 `workspaces` | `db.ts` 改动未生效 | 确认已 `npm start`（不是用旧进程）；确认 `0e3c7d6` 在 HEAD 历史中 |
| `workspaces` 为 0 | 回填逻辑未执行 | 日志搜 `workspaces 回填失败`；确认 `legacy_migrated` 是否为 1（若已是 1 则不会重跑迁移，需再删库） |
| `sessions` 为 0 | JSON 文件被删或格式坏 | 检查 JSON 文件内容是否合法 |

---

### A-2 老库升级：workspaces 表补建

**关联提交**：`0e3c7d6`

**前置**：
- 数据库已存在（`legacy_migrated = 1`）
- **但没有 `workspaces` 表**（模拟老版本升级）

**构造前置**（如果当前库已有 workspaces 表）：
```sql
DROP TABLE workspaces;
```

**步骤**：`npm start`

**预期**：

| 检查项 | 预期 |
|---|---|
| 启动日志 | **不出现** `[DB] 开始检查并迁移老 JSON`（因为已迁移过） |
| 表结构 | `workspaces` **被补建出来** |
| `sessions` 数据 | **完全保留**（不因补建表而丢失） |
| `workspaces` 数据 | **0 条**（老库不触发回填，回填只在 JSON 迁移时跑） |

**失败排查**：

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动报错 `no such table: workspaces` | 补建逻辑没执行到 | 检查 `db.ts` 的 `db.exec(WORKSPACES_DDL)` 是否在 `return db` 之前 |

---

## 场景 B：工作区（workspaceRegistry）

### B-1 侧栏工作区正常显示

**关联提交**：`8c3b478`、`0ddeb4b`、`5c06709`

**前置**：场景 A-1 已完成（workspaces 表有数据）

**步骤**：打开 Cuckoo，看左侧栏「工作区」

**预期**：
- 能看到多个项目分组（如 `cuckoo-code`、`agent-zhb` 等）
- 每个分组下面是该项目的会话列表
- 点击分组可展开/收起

**失败排查**：

| 现象 | 原因 | 处理 |
|---|---|---|
| 侧栏「工作区」完全空白 | `workspaces` 表空 | 回到 A-1 检查回填 |
| 只有部分工作区 | 回填时某些目录 realpath 失败 | 查日志 `workspaces 回填失败`，确认对应目录是否存在 |

---

### B-2 `ctx.get('workspaceRegistry')` 返回真实 registry

**关联提交**：`0ddeb4b`

**前置**：装一个能调用 `ctx.get('workspaceRegistry')` 的插件（dsh-tasks 即可）

**验证方式**（通过日志）：
1. 装 dsh-tasks
2. 在 dsh-tasks 里配置一个带 workspace 的定时任务
3. 触发后看日志

**预期**：
- 日志**不出现** `workspaceRegistry: host.db 缺失，返回空壳`
- dsh-tasks 能正常拿到 workspace 对象（`workspace.path` 有值）

**失败排查**：

| 现象 | 原因 | 处理 |
|---|---|---|
| 日志出现 `host.db 缺失` | `buildCuckooHost` 没传 db | 检查 `entry.ts` 的 `buildCuckooHost({ db: globalDb, ... })` |
| dsh-tasks 报 `workspace not found` | `ctx.workspaceRegistry.get(id)` 找不到 | 查 `workspaces` 表是否有该 id；dsh-tasks 传的 workspaceId 是否是 `workspaces.id`（uuid）而不是 path |

---

## 场景 C：新建对话（回归验证）

> 这部分是之前重构的，本轮改动可能影响，必须回归。

### C-1 点左上角「+」→ 弹窗出现 + 无垃圾数据

**步骤**：
1. 记录当前 `SELECT COUNT(*) FROM sessions` 的值
2. 连点左上角「+」3 次
3. 再查 `COUNT(*)`

**预期**：
- 每次点击都弹出初始化 Modal
- **数据库条数不变**（决策 9.1：首页不落库）
- `sessions` 表没有新增 `web_id IS NULL AND title = '新建对话'` 的记录

**验证 SQL**：
```sql
SELECT COUNT(*) FROM sessions WHERE web_id IS NULL AND title = '新建对话';
```

**失败排查**：

| 现象 | 原因 | 处理 |
|---|---|---|
| 弹窗没出现 | `handleUrlChange` 没触发弹窗 | 检查 `store.ts` 首页分支的 `shell-show-init-prompt` 发送 |
| 数据库出现垃圾数据 | 某个地方提前落库了 | 查 `create` / `saveSessionDirMapping` 调用点 |

---

### C-2 网页内点「新建对话」→ 弹窗出现

**步骤**：
1. 在 DeepSeek 网页里点它自带的「新建对话」按钮
2. 或在地址栏手动输入 `https://chat.deepseek.com/` 回车

**预期**：Cuckoo 的初始化弹窗出现（与 C-1 一致）

**失败排查**：同 C-1

---

### C-3 工作区「+」号 → 弹窗 + 目录回显

**步骤**：
1. 左侧栏找到某个工作区分组
2. 点分组标题旁的「+」号

**预期**：
- 弹窗出现
- **「项目目录」输入框自动填入该工作区的路径**
- 数据库条数不变（决策 9.1）

**失败排查**：

| 现象 | 原因 | 处理 |
|---|---|---|
| 目录没回显 | URL 参数 `cuckoo-project-dir` 解析失败 | 看日志 `handleUrlChange 触发! url=...cuckoo-project-dir=...` 是否带参数 |
| 弹窗没出现 | 同 C-1 | |

---

### C-4 弹窗发送 → 系统提示词合并

**步骤**：
1. 走 C-3 的流程（工作区「+」号）
2. 在弹窗里输入 `帮我看看这个项目的入口文件在哪里`
3. 点「发送」

**预期**：
- AI 回复中应体现「已了解项目目录」「会使用工具」等上下文
- 数据库里该会话的 `project_dir` 已写入

**验证 SQL**：
```sql
SELECT logic_id, web_id, project_dir, title FROM sessions
ORDER BY created_at DESC LIMIT 1;
```
预期：`project_dir` 是工作区路径，`web_id` 非空。

**失败排查**：

| 现象 | 原因 | 处理 |
|---|---|---|
| AI 不知道项目目录 | 系统提示词没合并 | 查 `send-init-message` 是否被调用；查 `buildPrompt` 是否返回了提示词 |
| `project_dir` 为空 | `meta.cwd` 没传或校验失败 | 看日志是否有 `meta.cwd must be an absolute path` |

---

## 场景 D：dsh-tasks 插件（核心验证）

### D-1 安装插件

**步骤**：
1. 壳页面 → 「插件」页（左侧栏齿轮图标）
2. 找到「DSH 插件（npm）」区块
3. 输入 `@weibaohui/dsh-tasks`
4. 点「安装」→ 等安装完成 → 点「启用」

**预期**：
- 安装成功后 `C:\Users\<用户名>\.cuckoo\cuckoo-plugins\` 下出现 dsh-tasks 目录
- 重启 Cuckoo 后日志显示 `[Cuckoo Plugin] 已加载: ... dsh-tasks ...`

**失败排查**：

| 现象 | 原因 | 处理 |
|---|---|---|
| 安装失败 | 网络 / npm 源 | 看插件页错误提示；确认 npm 能访问 |
| 启用后没加载 | `cuckoo-plugins-state.json` 未更新 | 查该文件是否含 dsh-tasks 且 `enabled: true` |

---

### D-2 配置定时任务（含 workspace）

**步骤**：
1. 打开 dsh-tasks 管理界面（插件页里的 dsh-tasks 卡片，或通过 `http://127.0.0.1:<port>/plugins/...` 访问）
2. 点「新建任务」

**配置**：

| 字段 | 值 |
|---|---|
| title | `验证测试任务` |
| prompt | `用 bash 执行 echo "hello from dsh-tasks"，把结果告诉我` |
| cron | `* * * * *`（每分钟） |
| enabled | ✅ |
| workspace | 选一个已有工作区（如 cuckoo-code） |
| provider / model | 留空（走默认） |

3. 保存

**预期**：任务列表出现该任务

---

### D-3 任务触发 → 完整链路

**关联提交**：`b346bd3`（create）、`0ddeb4b`（workspace）、`f8d77f6`（agentPresets）

**步骤**：等下一分钟（cron 触发）

**预期日志**（顺序大致）：

```
[Cuckoo AgentSession] create: session-<uuid>
[Cuckoo Code] 用项目新建对话 → C:\d\SourceCode\2026\cuckoo-code
[Cuckoo Code] 当前会话ID(逻辑): session-<uuid>
[Cuckoo Store] handleUrlChange 触发! url=...?cuckoo_logic_id=session-<uuid>, webId=null
[Cuckoo Code] 从 URL 缓存插件 LogicId: session-<uuid>
```

**预期数据库**（触发后 1-2 分钟内）：

```sql
-- 1) workspace 的 session_ids 应包含新 session
SELECT id, path, session_ids FROM workspaces WHERE path LIKE '%cuckoo-code%';

-- 2) 新 session 的各字段
SELECT logic_id, web_id, project_dir, title, created_at
FROM sessions
WHERE logic_id LIKE 'session-%'
ORDER BY created_at DESC LIMIT 1;
```

**预期结果**：

| 字段 | 预期值 |
|---|---|
| `logic_id` | `session-<uuid>`（dsh-tasks 生成的） |
| `web_id` | 真实网页 ID（如 `8fa29e47-...`） |
| `project_dir` | `C:\d\SourceCode\2026\cuckoo-code`（realpath 后） |
| `title` | `验证测试任务 · MM-DD HH:mm`（dsh-tasks 设的） |
| `workspaces.session_ids` | 包含该 `session-<uuid>` |

**预期 UI**：
- 左侧栏 `cuckoo-code` 工作区下出现新会话
- 点进会话能看到完整对话：用户任务 + AI 回复（含 `hello from dsh-tasks`）

**失败排查**：

| 现象 | 日志关键词 | 原因 | 处理 |
|---|---|---|---|
| 任务没触发 | 无 `create: session-` | cron 没到点 / 插件未加载 | 等下一分钟；查插件是否 `enabled` |
| create 报错 | `meta.cwd must be an absolute path` | dsh-tasks 传了相对路径 | 查 dsh-tasks 的 `defaultCwd`（可能是 `process.cwd()` 在某些启动方式下不是绝对路径） |
| create 报错 | `session already exists` | 上次未清理 | 重启 Cuckoo（`activeSessions` 是内存态） |
| 挂载失败 | `cannot attach session ... carries no cwd` | `create` 时 `meta.cwd` 没传 | 检查 dsh-tasks 配置是否选了 workspace |
| 挂载失败 | `its cwd ... does not resolve` | 目录不存在 | 确认 workspace 路径真实存在 |
| 挂载失败 | `its cwd ... is not a directory` | 路径是文件 | 查 workspace 配置 |
| 挂载失败 | `its cwd resolves to '...'` | **realpath 不一致** | 通常是 symlink 或大小写问题；比对 `sessions.project_dir` 和 `workspaces.path` |
| 挂载失败 | `workspace '...' not found` | `ctx.workspaceRegistry.get(id)` 找不到 | dsh-tasks 传的 `workspaceId` 必须是 `workspaces.id`（uuid），不是 path |
| 标题没设 | 无 `session/title` 相关 | `setSessionTitleForId` 失败 | 查日志 `title write failed` |
| AI 没工具 | AI 回复"我无法执行命令" | `agentPresets` 返回 undefined 或 setup 没调 | 查日志是否有 `setup 失败` |

---

## 场景 E：纯净模式

### E-1 背景不透明（不穿透）

**关联提交**：`5ea6489`（harness.html 背景修复）

**步骤**：
1. 进入纯净模式
2. 打开/关闭初始化弹窗
3. 观察背景

**预期**：背景始终不透明，**不会看到底下的原网页**

**失败排查**：

| 现象 | 原因 | 处理 |
|---|---|---|
| 关弹窗后能透出网页 | `harness.html` 的 `background: transparent` 未改成 `var(--bg)` | 检查 `src/ui/harness.html` 第 72-78 行 |

---

### E-2 纯净模式正常聊天

**步骤**：
1. 进入纯净模式
2. 在输入框发一条消息
3. 看 AI 回复

**预期**：
- 消息正常发出
- AI 回复显示
- 侧栏出现新会话

**失败排查**：

| 现象 | 原因 | 处理 |
|---|---|---|
| 消息发不出 | `harness-send` IPC 失败 | 查日志 `[Cuckoo Harness] 收到用户消息` |
| AI 回复不显示 | `harness-event` 没转发 | 查 `harness-event-report` 是否收到 |

---

## 场景 F：边界与异常

### F-1 `meta.cwd` 传相对路径 → throw

**关联提交**：`b346bd3`

**验证方式**：写一个临时插件（或用控制台），调用：
```js
await ctx.agents.create({ sessionId: 'test-rel', meta: { cwd: 'relative/path' } })
```

**预期**：抛错 `meta.cwd must be an absolute path`

**失败排查**：

| 现象 | 原因 |
|---|---|
| 静默成功 | 校验逻辑没生效 |

---

### F-2 `setup` 抛错 → create 回滚

**关联提交**：`b346bd3`

**验证方式**：
```js
try {
  await ctx.agents.create({
    sessionId: 'test-setup-fail',
    setup: async () => { throw new Error('boom'); }
  });
} catch (e) { console.log('got error:', e.message); }
// 再试一次同 sessionId，应该能成功（说明回滚了）
await ctx.agents.create({ sessionId: 'test-setup-fail' });
```

**预期**：第一次抛 `boom`，第二次正常创建（证明 `activeSessions` 已回滚）

---

## 验证清单（勾选用）

```
[ ] A-1 全新安装：表建出 + JSON 迁移 + workspaces 回填
[ ] A-2 老库升级：workspaces 表补建，sessions 保留
[ ] B-1 侧栏工作区正常显示
[ ] B-2 ctx.get('workspaceRegistry') 返回真实 registry
[ ] C-1 点「+」→ 弹窗 + 无垃圾数据
[ ] C-2 网页新建 → 弹窗
[ ] C-3 工作区「+」→ 弹窗 + 目录回显
[ ] C-4 弹窗发送 → 系统提示词合并
[ ] D-1 dsh-tasks 安装成功
[ ] D-2 定时任务配置成功
[ ] D-3 任务触发 → 完整链路（数据库 + UI）
[ ] E-1 纯净模式背景不透明
[ ] E-2 纯净模式正常聊天
[ ] F-1 meta.cwd 相对路径 → throw
[ ] F-2 setup 抛错 → create 回滚
```

---

## 附录：常见问题速查

### 数据被清空了怎么办

数据库路径：`C:\Users\<用户名>\AppData\Roaming\cuckoo-ai-pro-session\cuckoo.db`

- JSON 文件不会被删（迁移是只读的）
- 删库后重启会重新从 JSON 迁移
- 最坏情况：手动把 `cuckoo.db*` 删掉，重启重建

### 怎么清空测试数据从头来

```powershell
# 1. 关 Cuckoo
# 2. 删数据库
del "$env:APPDATA\cuckoo-ai-pro-session\cuckoo.db*"
# 3. 重启
npm start
```

### 日志在哪

- 终端直接输出（`npm start` 时）
- 文件：项目根 `wyp/log/` 下（按时间命名）

---

*最后更新：2026-10-22*

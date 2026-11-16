---
name: pr-submit
description: GitHub 一键提交流程。自动完成设备码授权 → fork 上游仓库 → push 功能分支 → 创建规范 PR，把改动"熔炼"成合格 Pull Request 并自动提交。当用户说"上传PR"、"提交PR"或要求向 GitHub 仓库提交 Pull Request 时使用。
when_to_use: 用户想把手头的功能 / 修复 / 技能提交为 GitHub PR 时；说"上传PR"、"提交PR"、"提成PR"时
allowed-tools: bash, read, grep
---

# pr-submit · GitHub 一键 PR 流程

把本地改动"熔炼"成规范 PR 并自动提交。核心脚本是本目录的 `scripts/pr_flow.mjs`（零依赖，Node 18+，全局 fetch）。

Token 走 **GitHub 设备码授权**：不需要手动创建 PAT，脚本打印授权页面地址和用户码，用户打开 `https://github.com/login/device` 输入代码点一次授权即可。授权成功后 token 存 `~/.cuckoo/pr-submit/github-token.json`（作用域 repo,workflow），后续流程全自动。

## 流程（六步）

### 1. 定位项目与上游

在项目目录跑 `git remote get-url origin` 提取 `OWNER/REPO`；无远端则询问用户目标仓库地址。fork 由脚本按需自动创建（`--remote` 传上游即可）。

### 2. 就绪改动

确认改动已完成并通过测试；创建功能分支（命名 `feat|fix|docs/简述`）。提交前用 `git status` 核对暂存区，不要把无关文件（lockfile 副作用、临时产物）带进去。

### 3. 授权（幂等）

```bash
node scripts/pr_flow.mjs whoami   # 先查是否已授权
node scripts/pr_flow.mjs auth     # 未授权才跑；打印授权页面 + 用户码，等待用户确认
```

脚本每 5 秒轮询（瞬时网络抖动自动重试，不中断等待）。已授权且 whoami 正常时静默跳过。

### 4. 提交（commit）

commit 署名用 GitHub noreply 身份（与授权账号一致，保护隐私）：

```bash
git config user.name "<login>"
git config user.email "<login>@users.noreply.github.com"
git add <改动文件> && git commit -m "feat: 简述（遵循上游 CONTRIBUTING 的 type 风格）"
```

### 5. push + 建 PR（一条龙）

```bash
node scripts/pr_flow.mjs run --repo <仓库路径> --remote OWNER/REPO --branch feat/xxx --title "PR标题" --body-file PR描述.md
```

脚本自动：fork 上游（已存在则复用，等待 fork 异步创建就绪）→ push 到 fork → 用 `head=<login>:branch` 创建 PR（base 取上游默认分支）→ 输出 PR URL。PR 描述写进临时 md 文件（动机 / 改动清单 / 测试情况三段式），标题遵循上游 CONTRIBUTING 约定（`feat:` / `fix:` / `docs:` + 简述）。

### 6. 交付

向用户报告 PR URL + 分支名 + 描述要点。返回 422 "A pull request already exists" 视为成功，把已有 PR 链接给用户。

## 子命令速查

| 命令 | 作用 |
|---|---|
| `auth` | 设备码授权（幂等） |
| `whoami` | 查看当前授权账号 |
| `logout` | 清除本地 token |
| `fork --remote O/R` | 只 fork |
| `push --repo D --branch B [--remote O/R]` | 只 push（fork 按需；remote 缺省从 origin 探测） |
| `pr --remote O/R --branch B --title T [--body-file F]` | 只建 PR |
| `run` | push + pr 一条龙（参数为上两项并集） |

## 注意事项

- **代理环境**：脚本走 HTTPS 代理时，Node 24+ 设 `NODE_USE_ENV_PROXY=1` 即可复用 `HTTPS_PROXY` 环境变量；Node 22 的 fetch 不认代理变量，需要换 Node 24+ 或让终端环境直连可达 github.com。
- PR 描述含反引号 / 特殊字符时必须用 `--body-file`，不要拼命令行。
- token 永不出现在输出 / 日志里（脚本已脱敏）；不要把 token 写进 remote 的持久配置，push 用一次性 URL。
- fork 创建是异步的，脚本已内置等待（最长 90s）；超时就重跑 push。
- push 前先 `git diff --cached` 自审一遍，确认没有敏感信息（密钥、内网地址、个人路径）。

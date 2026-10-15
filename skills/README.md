# Skills 技能合集

可直接复制安装的社区技能。每个子目录是一个完整技能（`SKILL.md` + 附带脚本），遵循 [docs/skills.md](../docs/skills.md) 的格式约定。

## 安装

把想要的技能目录复制到用户级技能目录即可（所有项目通用）：

```bash
# Windows (PowerShell)
Copy-Item -Recurse skills/pr-submit "$env:USERPROFILE\.cuckoo\skills\"

# macOS / Linux
cp -r skills/pr-submit ~/.cuckoo/skills/
```

复制后在 Cuckoo 里点覆盖层面板的「**发送 skill 信息**」重新扫描即可生效。

## 技能列表

| 技能 | 说明 |
|---|---|
| [pr-submit](./pr-submit/) | GitHub 一键提交流程：设备码授权 → fork → push → 创建规范 PR。把改动"熔炼"成合格 Pull Request 并自动提交，无需手动创建 PAT |

## 贡献新技能

欢迎 PR！要求：

1. 在本目录下建 `技能名/` 子目录，必须包含 `SKILL.md`（frontmatter 见 docs/skills.md）
2. 附带脚本放 `scripts/`，保持零依赖或只依赖 Node 标准库
3. 正文用祈使句写清流程、步骤与已知坑，让其他 AI 能照做
4. 更新上面的技能列表表格

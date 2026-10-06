# 我的插件

## 安装

推到 GitHub，打 `cuckoo-plugin` topic，然后在 Cuckoo 插件市场安装。

或手动放到 `~/.cuckoo/plugins/my-plugin/`。

## 结构

```
my-plugin/
├── plugin.json      # 清单
├── dsh/main.js      # DSH 风格插件（可选）
├── ui/widget.js     # UI 扩展（可选）
├── skills/          # 技能（可选）
├── agents/          # 子代理（可选）
├── rules/           # 规则（可选）
├── mcp.json         # MCP 配置（可选）
└── providers/       # 自定义平台（可选）
```

详见 Cuckoo 仓库 `docs/plugin-dev.md`。

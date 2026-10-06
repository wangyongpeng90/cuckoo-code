# DSH 风格插件示例

这是给 Cuckoo DSH 兼容层用的示例插件。

## 安装方式（手动）

把 `hello-dsh.js` 放到某个已启用插件的 `dsh/` 目录下：

```
~/.cuckoo/plugins/<插件id>/dsh/hello-dsh.js
```

然后启用该插件，重启 Cuckoo，控制台会看到 `[dsh-plugin:hello-dsh]` 的日志。

## 插件契约（对齐 DSH 标准）

```js
export const name = 'my-plugin'      // 必填
export const inject = ['agents']     // 可选：声明依赖的服务
export function apply(ctx, config) { // 必填：入口
  ctx.on('session/event', ...)       // 监听
  ctx.agents.get()?.followup(...)    // 调用服务
}
```

---
id: 006
type: refactor
title: hook 性能优化（消除高频写入与 O(n²)）
status: doing
branch: refactor/006-hook-perf
created: 2026-09-22
updated: 2026-09-22
---

## 背景

用户反馈"对话一多就很卡"。排查 hook（`src/providers/hooks/deepseek.ts`）发现几处随对话量/请求量增长的固定开销：

1. **`cacheHeaders` 高频写 localStorage**
   - fetch 拦截里**每次请求**调用
   - XHR 的 `setRequestHeader` 里**每设置一个头**调用（一次请求 5~10 次）
   - `localStorage.setItem` 是**同步**操作，可能触发磁盘 IO
   - 内容其实几乎不变（同一会话的认证头）

2. **`fragmentTypes = fragmentTypes.concat(types)`**
   - 每次 APPEND 都新建数组并**复制全部**已有元素 → **O(n²)**
   - 一条长回复有几十个 APPEND

3. **`response.clone()`**
   - 每次 completion 复制整个响应流
   - 经评估：这是"让页面正常消费 body + 我们自己看一份"的必要手段，浏览器原生优化，**保留**

## 目标

- `cacheHeaders`：内容未变则跳过写入（去重）
- `fragmentTypes`：改为原地 `push`（O(n)）
- `response.clone`：保留并加注释说明理由

## 方案

### 1. cacheHeaders 去重

保存上次写入的字符串，相同则跳过：

```js
var lastCachedHeaders = '';
function cacheHeaders(hdrs) {
  ...构造 lower...
  var s = JSON.stringify(lower);
  if (s === lastCachedHeaders) return;   // 内容未变，跳过写入
  lastCachedHeaders = s;
  localStorage.setItem('cuckoo-ds-headers', s);
}
```

### 2. fragmentTypes 改 push

```js
// 改前
fragmentTypes = fragmentTypes.concat(types);
// 改后
for (var ti = 0; ti < types.length; ti++) fragmentTypes.push(types[ti]);
```

### 3. response.clone 保留

加注释：必须让页面消费原 body，我们只能用 clone 看一份副本。

## 验收标准

- [ ] cacheHeaders 内容未变时不写 localStorage
- [ ] fragmentTypes 逻辑等价（类型序列正确）
- [ ] 现有测试全绿
- [ ] typecheck / lint / compile 通过
- [ ] 真机验证：对话多时卡顿缓解

## 遗留 / 后续

- 若仍卡，进一步排查：DeepSeek 页面自身渲染、console.log 累积
- 可选：`cacheHeaders` 加节流（如最多每 1s 写一次）

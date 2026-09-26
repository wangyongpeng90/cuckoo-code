import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Electron 主进程 / preload 测试运行在 Node 环境
    environment: 'node',
    // 每个测试文件在独立子进程中运行：这些测试会操作 process.argv / process.type /
    // console / 全局 mock，进程级隔离最干净
    pool: 'forks',
    include: ['test/**/*.test.js'],
    exclude: ['node_modules/**'],
    // 显式导入 vitest API，不用全局注入
    globals: false,
    // 放宽超时：coverage 插桩 + forks 隔离下首次 import/transform 较慢（本机曾达 50s），
    // 默认 5s/10s 易误报超时（flaky）
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      // 排除"强依赖 Electron / 浏览器运行时、在 Node 测试环境根本加载不了"的文件，
      // 否则它们永远 0%，把平均值拉低（口径失真）。这些文件靠真机验证。
      exclude: [
        // Electron 主进程 / preload（app 入口、IPC、窗口、壳页面）
        'src/app/**',
        // 渲染进程引导（需要 ipcRenderer / window）
        'src/bridge/entry.ts',
        'src/bridge/api.ts',
        // 注入主世界的 hook（IIFE，需浏览器 window/document；生成物 hook-sources.ts 另有覆盖）
        'src/providers/hooks/chatgpt.ts',
        'src/providers/hooks/claude.ts',
        'src/providers/hooks/deepseek.ts',
        // 自动更新（Electron autoUpdater）
        'src/updater/**',
        // 纯类型声明（无运行时代码）
        '**/*.d.ts',
      ],
    },
  },
});

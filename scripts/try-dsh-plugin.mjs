/**
 * P1-a 独立验证：DSH 插件 → 劫持 import → 转 Cuckoo 工具
 *
 * 用法：node scripts/try-dsh-plugin.mjs
 * 验证链路：DSH 插件源码（含 @deepseek-ai/* import）
 *   → esbuild 打包（把 @deepseek-ai/* 映射到我们的 shim）
 *   → 执行产物（得到插件对象）
 *   → 调 apply(ctx)（ctx.tools.register 收集工具）
 *   → 转成 Cuckoo 工具描述
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const require = createRequire(import.meta.url);
const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild', 'lib', 'main.js'));

// ===== 1) 模拟一个 DSH 插件源码（等价 scratch-plugin 的 greet-tool）=====
const DSH_PLUGIN_SOURCE = `
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'greet-tool'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet someone by name.',
    parameters: {
      name: { type: 'string', required: true, description: 'The name to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return \`Hello, \${args.name}!\`
    },
  }))
}
`;

// ===== 2) 用 esbuild 打包：把 @deepseek-ai/* 映射到我们的 shim =====
async function bundlePlugin(source) {
  const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dsh-try-'));
  const entry = path.join(tmpDir, 'plugin.js');
  fs.writeFileSync(entry, source, 'utf8');
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    plugins: [{
      name: 'dsh-shim',
      setup(build) {
        // 把 @deepseek-ai/dsh-tools → 我们的 shim（运行时替换）
        build.onResolve({ filter: /^@deepseek-ai\/dsh-tools$/ }, () => ({ path: path.join(ROOT, 'out', 'src', 'plugins', 'dsh-compat', 'shim.js') }));
        build.onResolve({ filter: /^@deepseek-ai\/cordis$/ }, () => ({ path: path.join(ROOT, 'out', 'src', 'plugins', 'dsh-compat', 'shim.js') }));
      },
    }],
  });
  return result.outputFiles[0].text;
}

// ===== 3) 执行产物（收集注册的工具）=====
function runPlugin(code) {
  const tools = [];
  const fakeCtx = {
    tools: {
      register(tool) { tools.push(tool); return () => {}; },
      list() { return tools.map(t => t.name); },
    },
  };
  const moduleObj = { exports: {} };
  const fn = new Function('module', 'exports', 'require', code + '\n;return module.exports;');
  const mod = fn(moduleObj, moduleObj.exports, require);
  const plugin = mod && mod.default && typeof mod.default === 'object' ? mod.default : mod;
  if (typeof plugin.apply === 'function') plugin.apply(fakeCtx);
  return { pluginName: plugin.name, tools };
}

(async () => {
  console.log('=== P1-a: DSH 插件兼容链路验证 ===\n');
  console.log('[1] DSH 插件源码（含 @deepseek-ai/dsh-tools import）已准备');
  console.log('[2] esbuild 打包（@deepseek-ai/* → 我们的 shim）...');
  const code = await bundlePlugin(DSH_PLUGIN_SOURCE);
  console.log('    打包成功，产物 ' + code.length + ' 字节');
  console.log('[3] 执行产物 + apply(ctx)...');
  const { pluginName, tools } = runPlugin(code);
  console.log('    插件名: ' + pluginName);
  console.log('    注册工具数: ' + tools.length);
  for (const t of tools) {
    console.log('    - ' + t.name + ': ' + t.description);
    console.log('      parameters(JSON Schema): ' + JSON.stringify(t.parameters));
    const out = await t.execute({ name: 'Cuckoo' });
    console.log('      调用 execute({name:"Cuckoo"}) => ' + JSON.stringify(out));
  }
  console.log('\n=== 验证' + (tools.length > 0 && tools[0].name === 'greet' ? '成功 ✅' : '失败 ❌') + ' ===');
})().catch(e => { console.error('失败:', e); process.exit(1); });

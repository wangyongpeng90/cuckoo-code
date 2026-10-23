/**
 * 生成工具 API 契约（D12）
 *
 * 真相源：各工具的 apiMetas 元数据（src/tools/impl/*.ts）。
 * 本脚本读取编译产物 out/src/tools/impl/*.js，汇总 apiMetas，生成 src/tools/api.d.ts。
 * 在 tsc 编译之后运行（见 package.json 的 compile 脚本）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const NL = String.fromCharCode(10);
const ROOT = path.resolve(import.meta.dirname, '..');
const IMPL_DIR = path.join(ROOT, 'out', 'src', 'tools', 'impl');
const OUT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'src', 'tools', 'api.d.ts');

async function collect() {
  const metas = [];
  const bootstraps = [];
  for (const f of fs.readdirSync(IMPL_DIR)) {
    if (!f.endsWith('.js')) continue;
    const mod = await import(pathToFileURL(path.join(IMPL_DIR, f)).href);
    if (Array.isArray(mod.apiMetas)) metas.push(...mod.apiMetas);
    if (typeof mod.bootstrap === 'function') bootstraps.push(mod.bootstrap);
  }
  metas.sort((a, b) => a.order - b.order);
  return { metas, bootstraps };
}

/**
 * 从 bootstrap 函数源码提取函数体（去掉 wrapper），保留相对缩进。
 * 例：function bootstrap(__call) {\n  globalThis.x = ...\n} → "  globalThis.x = ..."
 */
function extractBody(fn) {
  const src = fn.toString();
  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  const raw = src.slice(start + 1, end);
  const lines = raw.split(NL).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return '';
  const minIndent = Math.min(...lines.map((l) => l.match(/^ */)[0].length));
  return lines.map((l) => '  ' + l.slice(minIndent)).join(NL);
}

function render(metas, minimal) {
  const L = [];
  if (!minimal) {
  L.push('/**');
  L.push(' * Cuckoo Code 工具 API（TypeScript 声明）');
  L.push(' *');
  L.push(' * 本文件描述 cuckoo 代码块中可以调用的全部全局函数与数据类型。');
  L.push(' * 运行时由 JsRunner 在受限沙箱中注入这些函数；本声明用于帮助');
  L.push(' * AI 理解调用方式，与运行时行为保持一致。');
  L.push(' *');
  L.push(' * 使用规则速览：');
  L.push(' * - 所有工具函数都是异步的，调用时必须写 await');
  L.push(' * - 相对路径基于全局变量 projectDir（当前项目根目录）解析');
  L.push(' * - 多行文本使用反引号（\u0060）模板字符串，不需要任何转义');
  L.push(' * - 工具出错时抛出异常（Error.message 为错误描述），可用 try/catch 处理；');
  L.push(' *   唯一例外是 bash()/pwsh()：非零退出不抛异常，通过返回文本中的 [exit code] 标记报告');
  L.push(' * - 用 log() 输出中间过程；脚本最后可用 return 返回结果值');
  L.push(' *');
  L.push(' * ⚠️ 本文件由 scripts/build-tool-api.mjs 自动生成，请勿手动编辑。');
  L.push(' *    真相源：各工具的 apiMetas 元数据（src/tools/impl/*.ts）。');
  L.push(' */');
  L.push('');
  L.push('/** 当前项目根目录（初始化项目后由系统注入）。未初始化时为 null。 */');
  L.push('declare const projectDir: string | null;');
  L.push('');
  L.push('/**');
  L.push(' * 输出中间结果到执行日志（不中断脚本）。');
  L.push(' * 日志内容随执行结果一起回传给 AI。');
  L.push(' * 注意：log() 只在 cuckoo 代码块的 JS 层可用。不要在 bash()/pwsh() 的命令字符串内部调用它——那些命令是独立的 shell 脚本，无法访问 JS 函数。');
  L.push(' */');
  L.push('declare function log(...args: unknown[]): void;');
  } else {
    L.push('/**');
    L.push(' * Cuckoo Code 工具 API —— 功能分组声明（按需注入）');
    L.push(' *');
    L.push(' * 本文件仅在对应功能启用时，追加到基础契约（api.d.ts）之后。');
    L.push(' * 基础类型（projectDir / log 等）见 api.d.ts，本文件不重复声明。');
    L.push(' *');
    L.push(' * ⚠️ 本文件由 scripts/build-tool-api.mjs 自动生成，请勿手动编辑。');
    L.push(' */');
    L.push('');
  }

  let lastCat = null;
  for (const m of metas) {
    if (m.category !== lastCat) {
      L.push('');
      L.push('// ================= ' + m.category + ' =================');
      L.push('');
      lastCat = m.category;
    }
    if (m.types) {
      L.push(m.types);
      L.push('');
    }
    L.push('/**');
    for (const line of m.doc.split(NL)) {
      L.push(' * ' + line);
    }
    if (m.paramDocs) {
      for (const k of Object.keys(m.paramDocs)) {
        L.push(' * @param ' + k + ' ' + m.paramDocs[k]);
      }
    }
    if (m.returnsDoc) {
      L.push(' * @returns ' + m.returnsDoc);
    }
    if (m.throws) {
      L.push(' * @throws ' + m.throws);
    }
    L.push(' */');
    L.push('declare function ' + m.name + '(' + m.params + '): ' + m.returns + ';');
    L.push('');
  }
  return L.join(NL);
}

const { metas, bootstraps } = await collect();
if (metas.length === 0) {
  console.error('[build-tool-api] 未收集到任何 apiMetas');
  process.exit(1);
}
// 按 feature 分组：无 feature → 基础 api.d.ts（始终注入）；有 feature → api.<feature>.d.ts（仅该功能启用时注入）
const baseMetas = metas.filter((m) => !m.feature);
const byFeature = new Map();
for (const m of metas) {
  if (!m.feature) continue;
  if (!byFeature.has(m.feature)) byFeature.set(m.feature, []);
  byFeature.get(m.feature).push(m);
}
fs.writeFileSync(OUT, render(baseMetas, false), 'utf8');
console.log('[build-tool-api] 生成 ' + path.relative(ROOT, OUT) + '（' + baseMetas.length + ' 个基础工具）');
// 各 feature 独立文件（与 OUT 同目录，命名 api.<feature>.d.ts）
const outDir = path.dirname(OUT);
for (const [feat, fmetas] of byFeature) {
  const fout = path.join(outDir, 'api.' + feat + '.d.ts');
  fs.writeFileSync(fout, render(fmetas, true), 'utf8');
  console.log('[build-tool-api] 生成 ' + path.relative(ROOT, fout) + '（feature=' + feat + '，' + fmetas.length + ' 个工具）');
}

// ========== JsRunner 沙箱注入脚本（工具部分）==========
const BOOTSTRAP_OUT = path.join(ROOT, 'src', 'tools', 'runtime', 'bootstrap.generated.ts');
const b = [];
b.push('// 本文件由 scripts/build-tool-api.mjs 自动生成，请勿手动编辑。');
b.push('// 真相源：各工具的 bootstrap 函数（src/tools/impl/*.ts）。');
b.push('// JsRunner 用它组装沙箱注入脚本（工具函数的 globalThis 定义）。');
b.push('');
b.push('const TOOL_BOOTSTRAP = [');
for (const fn of bootstraps) {
  b.push('  ' + JSON.stringify(extractBody(fn)) + ',');
}
b.push("].join('\\n');");
b.push('');
b.push('export { TOOL_BOOTSTRAP };');
fs.writeFileSync(BOOTSTRAP_OUT, b.join(NL) + NL, 'utf8');
console.log('[build-tool-api] 生成 ' + path.relative(ROOT, BOOTSTRAP_OUT) + '（' + bootstraps.length + ' 个 bootstrap）');

// ========== 工具名清单（供 js-detector 构造检测正则）==========
// 真相源与 apiMetas 一致，避免 bridge/parser/js-detector.ts 手写白名单与注册表漂移。
const TOOL_NAMES_OUT = path.join(ROOT, 'src', 'bridge', 'generated', 'tool-names.generated.ts');
const toolNames = Array.from(new Set(metas.map((m) => m.name))).sort();
const tn = [];
tn.push('// 本文件由 scripts/build-tool-api.mjs 自动生成，请勿手动编辑。');
tn.push('// 真相源：各工具的 apiMetas.name（src/tools/impl/*.ts）。');
tn.push('// 供 bridge/parser/js-detector.ts 构造工具调用检测正则，避免手写白名单与注册表漂移。');
tn.push('');
tn.push('export const TOOL_NAMES: readonly string[] = [');
for (const n of toolNames) tn.push('  ' + JSON.stringify(n) + ',');
tn.push('];');
fs.mkdirSync(path.dirname(TOOL_NAMES_OUT), { recursive: true });
fs.writeFileSync(TOOL_NAMES_OUT, tn.join(NL) + NL, 'utf8');
console.log('[build-tool-api] 生成 ' + path.relative(ROOT, TOOL_NAMES_OUT) + '（' + toolNames.length + ' 个工具名）');

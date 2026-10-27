/**
 * 构建壳页面（shell.html）
 *
 * 把 src/ui/shell/ 下的源码（骨架 + 部分 HTML + CSS + TS）拼装成
 * 单个 src/ui/shell.html（内联 CSS/JS），供主进程 loadFile 加载。
 *
 * 源结构：
 *   src/ui/shell/
 *   ├── index.html         骨架（含 <!--@include:partials/xx.html--> 占位）
 *   ├── partials/*.html    HTML 片段
 *   ├── styles/*.css       CSS
 *   └── scripts/           TS 源码（esbuild 打包成单个 bundle）
 *
 * 输出：src/ui/shell.html（生成物，勿手改）
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(ROOT, 'src', 'ui', 'shell');
const OUT = path.join(ROOT, 'src', 'ui', 'shell.html');

/** 读取 src/ui/shell/ 下的文件 */
function readSrc(rel) {
  return fs.readFileSync(path.join(SRC_DIR, rel), 'utf8');
}

/** 展开 <!--@include:relative/path--> 为文件内容（支持嵌套） */
function expandIncludes(html, depth = 0) {
  if (depth > 10) throw new Error('@include 嵌套过深（可能有环）');
  return html.replace(/<!--@include:([^>]+?)-->/g, (_, rel) => {
    const content = readSrc(rel.trim());
    return expandIncludes(content, depth + 1);
  });
}

/** 展开 /*@include:relative/path* / 为 CSS 内容 */
function expandCssIncludes(css, depth = 0) {
  if (depth > 10) throw new Error('@include 嵌套过深（可能有环）');
  return css.replace(/\/\*@include:([^*]+?)\*\//g, (_, rel) => {
    const content = readSrc(rel.trim());
    return expandCssIncludes(content, depth + 1);
  });
}

async function main() {
  // 1. 骨架 + 展开 HTML include
  let html = expandIncludes(readSrc('index.html'));

  // 2. 展开 CSS include（index.html 里的 /*@include:styles/xxx.css*/）
  html = html.replace(/\/\*@include:styles\/([^*]+?)\*\//g, (_, rel) => {
    return expandCssIncludes(readSrc('styles/' + rel.trim()));
  });

  // 3. esbuild 打包 TS → 单个 IIFE bundle
  const bundle = await build({
    entryPoints: [path.join(SRC_DIR, 'scripts', 'main.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: false,
    legalComments: 'none',
    logLevel: 'warning',
    jsx: 'automatic',
    jsxImportSource: 'react',
    loader: { '.tsx': 'tsx' },
  });
  const js = bundle.outputFiles[0].text;

  // 4. 把 //@bundle 占位替换为打包后的 JS
  if (!html.includes('//@bundle')) throw new Error('index.html 缺少 //@bundle 占位');
  html = html.replace('//@bundle', () => js);

  // 5. 加生成物标记 + 写出
  const banner = '<!-- 本文件由 scripts/build-shell.mjs 自动生成，请勿手动编辑。 -->\n<!-- 真源：src/ui/shell/ -->\n';
  fs.writeFileSync(OUT, banner + html, 'utf8');
  console.log('[build-shell] 生成 src/ui/shell.html（' + (banner.length + html.length) + ' 字节）');
}

main().catch((err) => {
  console.error('[build-shell] 失败:', err);
  process.exit(1);
});

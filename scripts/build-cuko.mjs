import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(ROOT, 'src', 'ui', 'cuko');
const TEMPLATE = path.join(SRC_DIR, 'index.html');
const OUTPUT = path.join(SRC_DIR, 'built.html');
const TW_CSS = path.join(SRC_DIR, 'tailwind.css');
const TW_OUT = path.join(SRC_DIR, 'built.css');

async function main() {
  // 1. Tailwind CSS 编译
  if (fs.existsSync(TW_CSS)) {
    console.log('[build-cuko] 编译 Tailwind CSS...');
    try {
      execSync(
        `npx @tailwindcss/cli -i "${TW_CSS}" -o "${TW_OUT}" --minify`,
        { cwd: ROOT, stdio: 'inherit' }
      );
    } catch (e) {
      console.error('[build-cuko] Tailwind 编译失败，跳过 CSS 内联');
    }
  }
  const twCss = fs.existsSync(TW_OUT) ? fs.readFileSync(TW_OUT, 'utf8') : '';
  
  // 引入主界面的样式（含 --ck-* 变量和设置页布局）
  const baseCssPath = path.join(ROOT, 'src', 'ui', 'shell', 'styles', 'base.css');
  const compCssPath = path.join(ROOT, 'src', 'ui', 'shell', 'styles', 'components.css');
  const baseCss = fs.existsSync(baseCssPath) ? fs.readFileSync(baseCssPath, 'utf8') : '';
  const compCss = fs.existsSync(compCssPath) ? fs.readFileSync(compCssPath, 'utf8') : '';
  
  const css = baseCss + '\n' + compCss + '\n' + twCss;

  // 2. esbuild 打包 JS（加 @/ alias）
  console.log('[build-cuko] 打包 JS...');
  const bundle = await build({
    entryPoints: [path.join(SRC_DIR, 'app.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: false,
    jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.svg': 'dataurl', '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': path.join(ROOT, 'src') },
  });
  const js = bundle.outputFiles[0].text;

  // 3. 替换占位符
  let html = fs.readFileSync(TEMPLATE, 'utf8');
  if (!html.includes('<!--@bundle-->')) throw new Error('index.html 缺少 <!--@bundle--> 占位');
  if (html.includes('<!--@css-->')) {
    html = html.replace('<!--@css-->', () => `<style>${css}</style>`);
  }
  html = html.replace('<!--@bundle-->', () => '<script>' + js + '</script>');
  fs.writeFileSync(OUTPUT, html, 'utf8');
  console.log('[build-cuko] 生成 src/ui/cuko/built.html 成功');
}

main().catch(err => {
  console.error('[build-cuko] 失败:', err);
  process.exit(1);
});

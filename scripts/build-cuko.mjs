import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(ROOT, 'src', 'ui', 'cuko');
const TEMPLATE = path.join(SRC_DIR, 'index.html');
const OUTPUT = path.join(SRC_DIR, 'built.html');

async function main() {
  let html = fs.readFileSync(TEMPLATE, 'utf8');

  const bundle = await build({
    entryPoints: [path.join(SRC_DIR, 'app.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: false,
    jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.svg': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"' }
  });
  const js = bundle.outputFiles[0].text;

  if (!html.includes('<!--@bundle-->')) throw new Error('index.html 缺少 <!--@bundle--> 占位');
  html = html.replace('<!--@bundle-->', () => '<script>' + js + '</script>');
  fs.writeFileSync(OUTPUT, html, 'utf8');
  console.log('[build-cuko] 生成 src/ui/cuko/built.html 成功');
}

main().catch(err => {
  console.error('[build-cuko] 失败:', err);
  process.exit(1);
});

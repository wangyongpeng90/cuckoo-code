/**
 * Monaco Editor 集成（文件预览用）。
 * 通过 AMD loader 加载 vendor/monaco/vs；提供创建 / 更新 / 主题 / 语言。
 */

let monacoPromise: Promise<any> | null = null;
let editor: any = null;
/** 当前 editor 绑定的容器（容器换了要重建 editor）*/
let editorContainer: HTMLElement | null = null;

/** 扩展名 → Monaco 语言 id */
const LANG_MAP: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", json5: "json",
  md: "markdown", markdown: "markdown", mdx: "markdown",
  css: "css", scss: "scss", less: "less", sass: "scss",
  html: "html", htm: "html", vue: "html", svelte: "html",
  py: "python", pyw: "python",
  java: "java", kt: "kotlin", kts: "kotlin",
  go: "go", rs: "rust", rb: "ruby", php: "php",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", cxx: "cpp",
  cs: "csharp",
  sh: "shell", bash: "shell", zsh: "shell", bat: "bat", cmd: "bat", ps1: "powershell",
  yml: "yaml", yaml: "yaml",
  xml: "xml", svg: "xml",
  sql: "sql",
  txt: "plaintext", log: "plaintext", lock: "plaintext",
};

function langOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "plaintext";
  return LANG_MAP[name.slice(dot + 1).toLowerCase()] || "plaintext";
}

/** 加载 Monaco（AMD loader，全局只加载一次） */
export function loadMonaco(): Promise<any> {
  if (monacoPromise) return monacoPromise;
  monacoPromise = new Promise((resolve, reject) => {
    const req = (window as any).require;
    if (!req) { reject(new Error("Monaco loader 未加载")); return; }
    try {
      req.config({ paths: { vs: "vendor/monaco/vs" } });
      (window as any).MonacoEnvironment = {
        getWorkerUrl: function (moduleId: string, label: string) {
          const base = "vendor/monaco/vs/";
          if (label === "json") return base + "language/json/json.worker.js";
          if (label === "css" || label === "scss" || label === "less") return base + "language/css/css.worker.js";
          if (label === "html" || label === "handlebars" || label === "razor") return base + "language/html/html.worker.js";
          if (label === "typescript" || label === "javascript") return base + "language/typescript/ts.worker.js";
          return base + "editor/editor.worker.js";
        },
      };
      req(["vs/editor/editor.main"], () => {
        resolve((window as any).monaco);
      }, (err: any) => reject(err || new Error("加载失败")));
    } catch (e) { reject(e); }
  });
  return monacoPromise;
}

/** 当前深浅色主题名 */
function themeName(): string {
  return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "vs-dark" : "vs";
}

/** 在容器里创建（或复用）编辑器并设置内容 */
export async function showInMonaco(container: HTMLElement, fileName: string, content: string): Promise<void> {
  const monaco = await loadMonaco();
  const lang = langOf(fileName);
  // 容器换了（如从"侧栏预览"换成"弹窗"）→ 重建 editor
  if (!editor || editorContainer !== container) {
    if (editor) { try { editor.dispose(); } catch (_) { /* ignore */ } }
    editor = monaco.editor.create(container, {
      value: content,
      language: lang,
      theme: themeName(),
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 12.5,
      lineNumbers: "on",
      renderWhitespace: "none",
      wordWrap: "off",
    });
    editorContainer = container;
  } else {
    const model = monaco.editor.createModel(content, lang);
    const old = editor.getModel();
    editor.setModel(model);
    if (old) old.dispose();
  }
}

/** 主题跟随系统变化 */
export function syncMonacoTheme(): void {
  if (editor) { try { (window as any).monaco.editor.setTheme(themeName()); } catch (_) { /* ignore */ } }
}

if (window.matchMedia) {
  try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncMonacoTheme); } catch (_) { /* ignore */ }
}

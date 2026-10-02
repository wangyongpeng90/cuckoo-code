/**
 * GitHub 地址构造与校验（纯 node，零依赖）
 *
 * 单独成文件：安装器（下载 tarball）与市场（拉远端 plugin.json）都要用同一套
 * repo/branch 校验。若只放在 installer 里，市场为了复用就会把 `tar` 拖进模块图。
 *
 * 所有拼进 URL 的片段都必须先过校验 —— 这里是从外部输入到网络请求的唯一关口。
 */

/**
 * owner 校验：GitHub 用户名只允许字母数字与连字符，且首字符必须是字母数字。
 *
 * **不能**写成 `[A-Za-z0-9._-]+` —— 那样 `..` 会通过校验，`../evil` 就成了"合法仓库"，
 * 拼出的 URL 会被规范化成完全不同的路径。首字符限定字母数字即排除 `.` / `..`。
 */
const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

/** 仓库名校验：允许字母数字与 . _ - */
const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** 分支名分段：允许字母数字与 . _ - */
const BRANCH_SEG_RE = /^[A-Za-z0-9._-]+$/;

/** tarball 下载通道（不消耗 GitHub API 配额） */
const CODELOAD_BASE = 'https://codeload.github.com';

/** 原始文件通道（CDN，不消耗 API 配额） */
const RAW_BASE = 'https://raw.githubusercontent.com';

/** owner/repo 校验：两段，owner 严格、仓库名显式排除 `.` 与 `..` */
function isValidRepo(repo: unknown): repo is string {
  if (typeof repo !== 'string') return false;
  const parts = repo.split('/');
  if (parts.length !== 2) return false;
  const [owner, name] = parts;
  if (!OWNER_RE.test(owner)) return false;
  if (name === '.' || name === '..') return false;
  return REPO_NAME_RE.test(name);
}

/**
 * 分支名校验：逐段检查，拒绝空段与 `..`。
 * 分支名会被拼进 URL 路径，不能放任任意字符。
 */
function isValidBranch(branch: unknown): branch is string {
  if (typeof branch !== 'string' || !branch.trim()) return false;
  const segs = branch.split('/');
  for (const s of segs) {
    if (!s) return false;
    if (s === '.' || s === '..') return false;
    if (!BRANCH_SEG_RE.test(s)) return false;
  }
  return true;
}

/** tarball 下载地址（安装用） */
function buildTarballUrl(repo: string, branch: string): string {
  return CODELOAD_BASE + '/' + repo + '/tar.gz/refs/heads/' + branch;
}

/** 仓库根目录下某个文件的 raw 地址（读远端 plugin.json 用） */
function buildRawFileUrl(repo: string, branch: string, file: string): string {
  return RAW_BASE + '/' + repo + '/' + branch + '/' + file;
}

export {
  OWNER_RE,
  REPO_NAME_RE,
  BRANCH_SEG_RE,
  CODELOAD_BASE,
  RAW_BASE,
  isValidRepo,
  isValidBranch,
  buildTarballUrl,
  buildRawFileUrl,
};

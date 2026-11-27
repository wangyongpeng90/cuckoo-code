/**
 * [261125-bmsfsh] Cuckoo 的“DSH 用户目录”适配层
 *
 * DSH 插件普遍用 `process.env.DSH_HOME` / `~/.dsh` 存数据。Cuckoo 不是 DSH，
 * 这些数据必须落在 `~/.cuckoo`（CUCKOO_HOME 可覆盖），否则会和真正的 DSH 互相污染。
 *
 * 在加载 DSH 插件之前调用一次 applyCuckooDshHome()：
 *  - DSH_HOME 指向 Cuckoo 用户目录
 *
 * 注意：只改 Cuckoo 进程的环境变量，不影响同一台机器上的 DSH 进程。
 */
import os from 'node:os';
import path from 'node:path';

/** Cuckoo 提供给 DSH 插件的用户目录（默认 ~/.cuckoo）。 */
export function getCuckooDshHome(): string {
  return process.env.CUCKOO_DSH_HOME || process.env.CUCKOO_HOME || path.join(os.homedir(), '.cuckoo');
}

/** 在加载 DSH 插件前调用：把插件使用的 DSH 用户目录指到 Cuckoo。 */
export function applyCuckooDshHome(): void {
  process.env.DSH_HOME = getCuckooDshHome();
}

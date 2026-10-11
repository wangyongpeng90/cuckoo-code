/**
 * 共享状态（overlay 层）
 * 仅承载 overlay 内部共享；bridge/session 的数据经 onInterceptedResponse 回调推送，
 * 不放在这里（避免下层依赖上层）。
 */
interface PreloadState {
  initialPromptContent: string;
  // 是否有待发送的初始提示
  pendingInitialPrompt: boolean;
  // 发送延迟配置（毫秒）
  sendDelayMin: number;
  sendDelayMax: number;
  // 当前项目目录（null 表示未初始化）
  currentProjectDir: string | null;
  // 本窗口是否为子代理窗口（由 bridge 在初始化时置位；供"是否分批发送"等按窗口类型分流）
  isSubagent: boolean;
}

const state: PreloadState = {
  initialPromptContent: '',
  // 是否有待发送的初始提示
  pendingInitialPrompt: false,
  // 发送延迟配置（毫秒）
  sendDelayMin: 2000,
  sendDelayMax: 4000,
  // 当前项目目录（null 表示未初始化）
  currentProjectDir: null,
  // 是否子代理窗口（默认 false，bridge 初始化子代理时置 true）
  isSubagent: false,
};

export { state };
export type { PreloadState };

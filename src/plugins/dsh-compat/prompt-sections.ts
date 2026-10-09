/**
 * DSH ctx.systemPrompt 的提示词段注册表（C4）。
 *
 * DSH 插件用 ctx.systemPrompt.section({ name, order, text }) 注册提示词段，
 * 这些段要合并进 Cuckoo 的系统提示词（{{TOOL_SECTIONS}}）。
 *
 * 用模块级全局存储（prompt-builder 读取时用同一份）。
 */
interface DshPromptSection {
  name: string;
  order: number;
  text: string;
  /** 来源插件（便于排查） */
  plugin?: string;
}

const sections = new Map<string, DshPromptSection>();

/** 注册/覆盖一个提示词段（同名覆盖） */
function registerPromptSection(sec: DshPromptSection, pluginName?: string): () => void {
  if (!sec || typeof sec.name !== 'string') throw new Error('systemPrompt.section: name 必须是字符串');
  const entry: DshPromptSection = {
    name: sec.name,
    order: typeof sec.order === 'number' ? sec.order : 100,
    text: typeof sec.text === 'string' ? sec.text : '',
    plugin: pluginName,
  };
  sections.set(sec.name, entry);
  return () => { sections.delete(sec.name); };
}

/** 取所有提示词段（按 order 排序，再按 name） */
function getPromptSections(): DshPromptSection[] {
  return Array.from(sections.values()).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** 清空（测试/卸载用） */
function clearPromptSections(): void { sections.clear(); }

export { registerPromptSection, getPromptSections, clearPromptSections };
export type { DshPromptSection };

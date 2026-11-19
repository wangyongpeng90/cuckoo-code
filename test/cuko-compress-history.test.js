/**
 * 切换模型时的历史压缩规则测试
 * 覆盖：每条消息一个元素、think 不发送、非 edit/delete 工具结果被替换、写操作结果保留
 */
import { describe, it, expect } from 'vitest';
import {
  buildCompressHistory,
  messageToCompressText,
  toolTouchesEditOrDelete,
} from '../src/ui/cuko/compress-history.js';

const toolPart = (over = {}) => ({
  type: 'tool-call',
  toolCallId: 't1',
  toolName: 'read',
  argsText: 'await read({ filePath: "a.txt" });',
  result: 'SECRET_RESULT',
  ...over,
});

describe('toolTouchesEditOrDelete', () => {
  it('工具名含 edit / deleteFile 算涉及', () => {
    expect(toolTouchesEditOrDelete({ toolName: 'edit' })).toBe(true);
    expect(toolTouchesEditOrDelete({ toolName: 'deleteFile' })).toBe(true);
    expect(toolTouchesEditOrDelete({ toolName: 'read + edit' })).toBe(true);
    expect(toolTouchesEditOrDelete({ toolName: 'read' })).toBe(false);
  });

  it('工具名缺失时看代码', () => {
    expect(toolTouchesEditOrDelete({ argsText: 'await edit({ filePath: "a" });' })).toBe(true);
    expect(toolTouchesEditOrDelete({ argsText: 'await deleteFile({ filePath: "a" });' })).toBe(true);
    expect(toolTouchesEditOrDelete({ argsText: 'await read({ filePath: "a" });' })).toBe(false);
  });
});

describe('messageToCompressText', () => {
  it('think 不参与输出', () => {
    const text = messageToCompressText({ role: 'assistant', content: '正文', think: '内部思考' });
    expect(text).toBe('正文');
    expect(text).not.toContain('内部思考');
  });

  it('普通工具调用的执行结果被替换成提示语', () => {
    const text = messageToCompressText({ role: 'assistant', content: [toolPart()] });
    expect(text).toContain('await read({ filePath: "a.txt" });');
    expect(text).toContain('(该工具调用不涉及edit或delete,如需调用结果请重新调用)');
    expect(text).not.toContain('SECRET_RESULT');
  });

  it('edit / deleteFile 的结果保留', () => {
    const editText = messageToCompressText({
      role: 'assistant',
      content: [toolPart({ toolName: 'edit', argsText: 'await edit({ filePath: "a", content: "b" });' })],
    });
    expect(editText).toContain('SECRET_RESULT');

    const deleteText = messageToCompressText({
      role: 'assistant',
      content: [toolPart({ toolName: 'read', argsText: 'await deleteFile({ filePath: "a" });' })],
    });
    expect(deleteText).toContain('SECRET_RESULT');
  });

  it('写操作失败时保留错误文本', () => {
    const text = messageToCompressText({
      role: 'assistant',
      content: [toolPart({ toolName: 'edit', result: '权限不足', isError: true })],
    });
    expect(text).toContain('错误: 权限不足');
  });

  it('附件只带文件名', () => {
    const text = messageToCompressText({
      role: 'user',
      content: '看图',
      attachments: [{ name: 'shot.png' }, { name: 'a.md' }],
    });
    expect(text).toBe('看图\n\n附件: shot.png, a.md');
  });

  it('空消息返回空串', () => {
    expect(messageToCompressText({ role: 'assistant', content: [] })).toBe('');
  });
});

describe('buildCompressHistory', () => {
  it('每条消息一个元素，并按来源标记 user / assistant', () => {
    const input = buildCompressHistory([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好，有什么可以帮你？' },
    ]);
    expect(input).toEqual([
      { type: 'user', text: '用户:\n你好' },
      { type: 'assistant', text: '助手:\n你好，有什么可以帮你？' },
    ]);
  });

  it('工具消息标记 tool，结果按规则处理', () => {
    const input = buildCompressHistory([
      { role: 'assistant', content: [toolPart()] },
    ]);
    expect(input).toHaveLength(1);
    expect(input[0].type).toBe('tool');
    expect(input[0].text.startsWith('工具:')).toBe(true);
    expect(input[0].text).toContain('工具结果: (该工具调用不涉及edit或delete,如需调用结果请重新调用)');
  });

  it('空消息被跳过', () => {
    expect(buildCompressHistory([
      { role: 'user', content: '' },
      { role: 'assistant', content: '有内容' },
    ])).toHaveLength(1);
  });
});

/**
 * Cuko 用户消息附件的落库格式测试（附件持久化方案 C）
 * 覆盖：纯文本兼容、附件往返、纯附件、tool-call 数组、疑似 JSON 的普通文本、中间格式兼容
 */
import { describe, it, expect } from 'vitest';
import {
  isDiskAttachPath,
  parseStoredContent,
  serializeUserMessage,
  toUserAttachment,
} from '../src/ui/cuko/persisted-content.js';

const pngAtt = (data = 'sess-1/msg-1/0.png') =>
  toUserAttachment('msg-1', 0, { filename: 'shot.png', mimeType: 'image/png', data });

describe('isDiskAttachPath', () => {
  it('只把相对路径当本地文件', () => {
    expect(isDiskAttachPath('sess/msg/0.png')).toBe(true);
    expect(isDiskAttachPath('data:image/png;base64,AAA')).toBe(false);
    expect(isDiskAttachPath('blob:http://localhost/x')).toBe(false);
    expect(isDiskAttachPath('https://example.com/a.png')).toBe(false);
    expect(isDiskAttachPath('//cdn.example.com/a.png')).toBe(false);
    expect(isDiskAttachPath('')).toBe(false);
    expect(isDiskAttachPath(undefined)).toBe(false);
  });
});

describe('toUserAttachment', () => {
  it('图片看 mimeType 而不是 file part 的类型', () => {
    const att = pngAtt();
    expect(att.type).toBe('image');
    expect(att.content[0].type).toBe('file');
    expect(att.content[0].data).toBe('sess-1/msg-1/0.png');
    expect(att.name).toBe('shot.png');
  });

  it('非图片是 document，缺文件名时补默认名', () => {
    const att = toUserAttachment('m', 2, { mimeType: 'text/markdown', data: 'm/2/0.md' });
    expect(att.type).toBe('document');
    expect(att.name).toBe('attachment-3');
    expect(att.id).toBe('m-att-2');
  });
});

describe('serializeUserMessage / parseStoredContent 往返', () => {
  it('无附件时保持纯文本', () => {
    expect(serializeUserMessage('你好', [])).toBe('你好');
    expect(parseStoredContent('你好', 'm')).toEqual({ content: '你好' });
  });

  it('带文本 + 图片附件可往返', () => {
    const raw = serializeUserMessage('看这张图', [pngAtt()]);
    const parsed = parseStoredContent(raw, 'msg-1');
    expect(parsed.content).toBe('看这张图');
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].type).toBe('image');
    expect(parsed.attachments[0].content[0].data).toBe('sess-1/msg-1/0.png');
  });

  it('纯附件（无文本）content 为空数组，附件仍在', () => {
    const raw = serializeUserMessage('', [pngAtt(), toUserAttachment('msg-1', 1, { filename: 'a.md', mimeType: 'text/markdown', data: 'msg-1/1/0.md' })]);
    const parsed = parseStoredContent(raw, 'msg-1');
    expect(parsed.content).toEqual([]);
    expect(parsed.attachments.map((a) => a.type)).toEqual(['image', 'document']);
    expect(parsed.attachments.map((a) => a.name)).toEqual(['shot.png', 'a.md']);
  });

  it('tool-call 数组原样保留', () => {
    const parts = [{ type: 'tool-call', toolCallId: 't1', toolName: 'read', args: {} }];
    expect(parseStoredContent(JSON.stringify(parts), 'm')).toEqual({ content: parts });
  });

  it('普通文本即使长得像 JSON 也不解析', () => {
    expect(parseStoredContent('[1,2]', 'm')).toEqual({ content: '[1,2]' });
    expect(parseStoredContent('{"a":1}', 'm')).toEqual({ content: '{"a":1}' });
    expect(parseStoredContent('[not json', 'm')).toEqual({ content: '[not json' });
  });
});

describe('parseStoredContent 兼容早期中间格式', () => {
  it('把 content 里的 file part 拆成附件，content 只留文本', () => {
    const legacy = JSON.stringify([
      { type: 'text', text: '看图' },
      { type: 'file', filename: 'shot.png', mimeType: 'image/png', data: 's/1/0.png' },
    ]);
    const parsed = parseStoredContent(legacy, 's');
    expect(parsed.content).toEqual([{ type: 'text', text: '看图' }]);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].type).toBe('image');
  });

  it('data 是 data URL 的 file part 不当本地附件', () => {
    const legacy = JSON.stringify([
      { type: 'file', filename: 'x.png', mimeType: 'image/png', data: 'data:image/png;base64,AAA' },
    ]);
    const parsed = parseStoredContent(legacy, 's');
    expect(parsed.attachments).toBeUndefined();
  });
});

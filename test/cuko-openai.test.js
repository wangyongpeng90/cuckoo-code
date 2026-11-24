/**
 * [261123-q4h7tn-cuko-openai] Cuko OpenAI 兼容协议纯函数测试
 * 覆盖：协议归一、URL 拼接、原文生成 / 补齐 / 重放（前缀不变）、请求体合并、
 *      usage 与缓存命中、流式解析（[DONE]、缺末尾空行、流内错误、中途断开）、重试判定、
 *      模型列表解析、模型设置合并与思考档位、上下文提醒、SSE flush
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeProtocol,
  joinApiUrl,
  composeFirstUserText,
  FIRST_MESSAGE_SEPARATOR,
  buildToolSentText,
  TOOL_NOT_RUN_TEXT,
  stripCuckooNotices,
  assistantSentText,
  parseStoredUserContent,
  backfillSentRows,
  buildChatMessages,
  buildChatCompletionsBody,
  parseJsonObjectParam,
  normalizeUsage,
  cacheHitRatio,
  createChatStreamParser,
  classifyFailure,
  retryDelayMs,
  MAX_RETRIES,
  isContextOverflowError,
  parseModelList,
  listedToApiMeta,
  effectiveModelMeta,
  defaultEffortOf,
  resolveEffortAfterSwitch,
  reasoningRequestOf,
  DEFAULT_REASONING_LEVELS,
  contextUsageOf,
} from '../src/app/cuko-openai.js';
import { createSseDecoder } from '../src/app/cuko-run-protocol.js';

const FENCE = String.fromCharCode(96).repeat(3);
const sse = (obj) => 'data: ' + (typeof obj === 'string' ? obj : JSON.stringify(obj)) + '\n\n';
const chunk = (delta, finish = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] });

describe('normalizeProtocol / joinApiUrl', () => {
  it('只有 openai 识别为 openai', () => {
    expect(normalizeProtocol('openai')).toBe('openai');
    expect(normalizeProtocol(' OpenAI ')).toBe('openai');
    for (const v of ['cuko', 'cuko-api', '', null, undefined, 'xx']) expect(normalizeProtocol(v)).toBe('cuko');
  });
  it('地址末尾已有 /v1 时不重复', () => {
    expect(joinApiUrl('https://api.deepseek.com/v1', '/v1/chat/completions')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(joinApiUrl('https://api.deepseek.com/v1/', 'v1/models')).toBe('https://api.deepseek.com/v1/models');
    expect(joinApiUrl('https://api.deepseek.com', '/v1/models')).toBe('https://api.deepseek.com/v1/models');
    expect(joinApiUrl('http://127.0.0.1:3000/', '/v1/responses')).toBe('http://127.0.0.1:3000/v1/responses');
  });
  it('/v1beta 之类不误判', () => {
    expect(joinApiUrl('https://x.com/v1beta', '/v1/models')).toBe('https://x.com/v1beta/v1/models');
  });
});

describe('原文生成', () => {
  it('第一条 user = 提示词 + 分隔线 + 用户的话', () => {
    expect(composeFirstUserText('# 规则\n照做', '你好')).toBe('# 规则\n照做' + FIRST_MESSAGE_SEPARATOR + '你好');
    expect(composeFirstUserText('', '你好')).toBe('你好');
    expect(composeFirstUserText('提示词', '  ')).toBe('提示词');
  });
  it('工具结果：回复语 + 每个脚本标题与结果（成功 / 失败 / 未执行 / 无输出）', () => {
    const text = buildToolSentText('跑完了：', [
      { status: 'ok', text: 'A' },
      { status: 'error', text: 'boom' },
      { status: 'skipped' },
      { status: 'ok', text: '' },
    ]);
    expect(text).toBe([
      '跑完了：',
      '[脚本 1]\nA',
      '[脚本 2]\n错误原因: boom',
      '[脚本 3]\n' + TOOL_NOT_RUN_TEXT,
      '[脚本 4]\n(脚本执行完成，无输出)',
    ].join('\n\n'));
  });
  it('工具结果：自定义标题（成功与否传给标题函数）', () => {
    const text = buildToolSentText('', [{ status: 'ok', text: 'x' }, { status: 'error' }], (i, ok) => '#' + i + (ok ? '✓' : '✗'));
    expect(text).toBe('#1✓\nx\n\n#2✗\n错误原因: 未知错误');
  });
  it('去掉 Cuckoo 追加的提示，只留模型输出', () => {
    expect(stripCuckooNotices('半句话\n\n（已停止）')).toBe('半句话');
    expect(stripCuckooNotices('前面\n\n⚠️ HTTP 429: too many')).toBe('前面');
    expect(stripCuckooNotices('\n\n⚠️ 请求失败')).toBe('');
    expect(stripCuckooNotices('正常回复')).toBe('正常回复');
  });
  it('助手原文：空白返回 null', () => {
    expect(assistantSentText('  ok \n')).toBe('ok');
    expect(assistantSentText('   ')).toBeNull();
  });
  it('解析用户消息落库格式；长得像 JSON 的普通文本原样返回', () => {
    expect(parseStoredUserContent('你好')).toEqual({ text: '你好', attachmentNames: [] });
    expect(parseStoredUserContent('[1, 2]')).toEqual({ text: '[1, 2]', attachmentNames: [] });
    expect(parseStoredUserContent('{"a":1}')).toEqual({ text: '{"a":1}', attachmentNames: [] });
    expect(parseStoredUserContent(JSON.stringify({ v: 1, text: '看图', attachments: [{ filename: 'a.png', mimeType: 'image/png', path: 's/m/0.png' }] })))
      .toEqual({ text: '看图', attachmentNames: ['a.png'] });
    expect(parseStoredUserContent(JSON.stringify([{ type: 'text', text: 'hi' }, { type: 'file', filename: 'b.pdf', data: 's/m/1.pdf' }])))
      .toEqual({ text: 'hi', attachmentNames: ['b.pdf'] });
  });
});

describe('backfillSentRows（跨协议切到 OpenAI 时补原文）', () => {
  const tool = (parts) => JSON.stringify(parts.map((p, i) => ({ type: 'tool-call', toolCallId: String(i), toolName: 'read', argsText: 'x', ...p })));
  it('按规则补齐：首条拼提示词、跳过 system、去提示、纯错误不补、工具卡片转 user', () => {
    const rows = [
      { id: 's', role: 'system', content: '提示词' },
      { id: 'u1', role: 'user', content: '你好' },
      { id: 'a1', role: 'assistant', content: '先读文件' },
      { id: 't1', role: 'assistant', content: tool([{ result: '内容' }, { result: '没权限', isError: true }, {}]) },
      { id: 'a2', role: 'assistant', content: '\n\n⚠️ HTTP 500' },
      { id: 'u2', role: 'user', content: JSON.stringify({ v: 1, text: '再看', attachments: [{ filename: 'a.png', path: 'p' }] }) },
      { id: 'a3', role: 'assistant', content: '说到一半\n\n（已停止）' },
    ];
    const out = backfillSentRows(rows, '提示词');
    expect(out.map((r) => [r.id, r.sentRole])).toEqual([['u1', 'user'], ['a1', 'assistant'], ['t1', 'user'], ['u2', 'user'], ['a3', 'assistant']]);
    expect(out[0].sentText).toBe('提示词' + FIRST_MESSAGE_SEPARATOR + '你好');
    expect(out[2].sentText).toBe('执行了 3 个脚本，结果如下：\n\n[脚本 1]\n内容\n\n[脚本 2]\n错误原因: 没权限\n\n[脚本 3]\n' + TOOL_NOT_RUN_TEXT);
    expect(out[3].sentText).toBe('再看\n\n（附件：a.png）');
    expect(out[4].sentText).toBe('说到一半');
  });
  it('已有原文的行跳过；首条 user 已有原文时，后面的 user 不再拼提示词', () => {
    const out = backfillSentRows([
      { id: 'u1', role: 'user', content: '你好', sent_text: '提示词\n\n---\n\n你好' },
      { id: 'a1', role: 'assistant', content: '嗯', sent_text: '嗯' },
      { id: 'u2', role: 'user', content: '继续' },
    ], '提示词');
    expect(out).toEqual([{ id: 'u2', sentRole: 'user', sentText: '继续' }]);
  });
  it('自定义回复语与标题；非法行忽略', () => {
    const out = backfillSentRows([null, { id: 'x', role: 'user', content: 1 }, { id: 't', role: 'assistant', content: tool([{ result: 'ok' }]) }], '', {
      toolPhrase: (n) => 'N=' + n,
      toolTitle: (i) => 'T' + i,
    });
    expect(out).toEqual([{ id: 't', sentRole: 'user', sentText: 'N=1\n\nT1\nok' }]);
  });
});

describe('buildChatMessages（原文重放）', () => {
  it('跳过空原文，相邻同角色合并', () => {
    expect(buildChatMessages([
      { sent_role: 'user', sent_text: 'A' },
      { sent_role: 'assistant', sent_text: null },
      { sent_role: 'user', sent_text: 'B' },
      { sent_role: 'assistant', sent_text: 'C' },
      { sent_role: 'system', sent_text: 'X' },
      { sent_role: 'user', sent_text: '' },
    ])).toEqual([{ role: 'user', content: 'A\n\nB' }, { role: 'assistant', content: 'C' }]);
  });
  it('前缀不变：第 N+1 轮请求的 messages 序列化以第 N 轮为前缀（含合并场景）', () => {
    const r1 = [{ sent_role: 'user', sent_text: 'P\n\n---\n\nhi' }];
    const r2 = [...r1, { sent_role: 'assistant', sent_text: FENCE + 'cuckoo\nawait read("a")\n' + FENCE }, { sent_role: 'user', sent_text: '结果' }];
    const r3 = [...r2, { sent_role: 'user', sent_text: '出错后用户又说了一句' }];
    const r4 = [...r3, { sent_role: 'assistant', sent_text: '好' }, { sent_role: 'user', sent_text: '再见' }];
    const ser = (rows) => JSON.stringify(buildChatCompletionsBody({ model: 'm', messages: buildChatMessages(rows) }).messages);
    // 去掉结尾的 "}] 再比较：上一轮最后一条消息的正文只会在末尾被追加
    const prefix = (a, b) => b.startsWith(a.slice(0, a.length - 3));
    expect(prefix(ser(r1), ser(r2))).toBe(true);
    expect(prefix(ser(r2), ser(r3))).toBe(true);
    expect(prefix(ser(r3), ser(r4))).toBe(true);
  });
});

describe('buildChatCompletionsBody（参数优先级）', () => {
  const messages = [{ role: 'user', content: 'hi' }];
  it('必需字段总是存在且不能被覆盖', () => {
    const body = buildChatCompletionsBody({ model: 'm', messages, extraParams: { model: 'evil', stream: false, messages: [], stream_options: {}, temperature: 0.3 } });
    expect(body).toEqual({ temperature: 0.3, model: 'm', messages, stream: true, stream_options: { include_usage: true } });
  });
  it('最大输出覆盖额外参数里的 max_tokens；非法值忽略', () => {
    expect(buildChatCompletionsBody({ model: 'm', messages, extraParams: { max_tokens: 10 }, maxTokens: 8192 }).max_tokens).toBe(8192);
    expect(buildChatCompletionsBody({ model: 'm', messages, extraParams: { max_tokens: 10 }, maxTokens: 0 }).max_tokens).toBe(10);
    expect(buildChatCompletionsBody({ model: 'm', messages, maxTokens: 1.5 }).max_tokens).toBeUndefined();
  });
  it('思考强度覆盖额外参数；自定义字段名', () => {
    expect(buildChatCompletionsBody({ model: 'm', messages, extraParams: { reasoning_effort: 'low' }, reasoning: { value: 'high' } }).reasoning_effort).toBe('high');
    const body = buildChatCompletionsBody({ model: 'm', messages, reasoning: { field: 'effort', value: 'max' } });
    expect(body.effort).toBe('max');
    expect(body.reasoning_effort).toBeUndefined();
  });
  it('off：删掉推理强度字段，合并关闭思考参数（不能覆盖必需字段）', () => {
    const body = buildChatCompletionsBody({
      model: 'm', messages,
      extraParams: { reasoning_effort: 'high', thinking: { type: 'enabled' } },
      reasoning: { off: true, disableParams: { thinking: { type: 'disabled' }, model: 'evil' } },
    });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.model).toBe('m');
  });
  it('空的思考值不写字段', () => {
    expect(buildChatCompletionsBody({ model: 'm', messages, reasoning: { value: '  ' } }).reasoning_effort).toBeUndefined();
  });
});

describe('parseJsonObjectParam', () => {
  it('空串 = 不填', () => {
    expect(parseJsonObjectParam('  ')).toEqual({ ok: true, value: null, ignoredKeys: [] });
  });
  it('合法对象，列出会被忽略的必需字段', () => {
    expect(parseJsonObjectParam('{"max_tokens": 8192, "model": "x"}')).toEqual({ ok: true, value: { max_tokens: 8192, model: 'x' }, ignoredKeys: ['model'] });
  });
  it('格式错误 / 非对象', () => {
    const bad = parseJsonObjectParam('{max_tokens: 1}');
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('JSON 格式不正确');
    for (const t of ['[1]', '"x"', '1', 'null']) expect(parseJsonObjectParam(t).ok).toBe(false);
  });
});

describe('normalizeUsage / cacheHitRatio', () => {
  it('DeepSeek：命中与未命中', () => {
    const u = normalizeUsage({ prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20 });
    expect(u).toMatchObject({ prompt_tokens: 100, input_tokens: 100, output_tokens: 5, total_tokens: 105, cache_read_tokens: 80, cache_miss_tokens: 20 });
    expect(cacheHitRatio(u)).toBeCloseTo(0.8);
  });
  it('OpenAI 官方：cached_tokens，未命中 = 输入 - 命中', () => {
    const u = normalizeUsage({ prompt_tokens: 100, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 64 } });
    expect(u).toMatchObject({ total_tokens: 101, cache_read_tokens: 64, cache_miss_tokens: 36 });
    expect(cacheHitRatio(u)).toBeCloseTo(0.64);
  });
  it('没给命中数：不显示命中率；非对象原样返回', () => {
    const u = normalizeUsage({ prompt_tokens: 3, completion_tokens: 4 });
    expect(u.total_tokens).toBe(7);
    expect(u.cache_read_tokens).toBeUndefined();
    expect(cacheHitRatio(u)).toBeUndefined();
    expect(cacheHitRatio({ cache_read_tokens: 0, cache_miss_tokens: 0 })).toBeUndefined();
    expect(normalizeUsage(undefined)).toBeUndefined();
  });
});

describe('createChatStreamParser', () => {
  it('拼正文、思考与 usage，遇到 [DONE] 结束', () => {
    const deltas = [];
    const p = createChatStreamParser((d, t) => deltas.push([d, t]));
    p.push(sse(chunk({ role: 'assistant', content: null })));
    p.push(sse(chunk({ reasoning_content: '想' })));
    p.push(sse(chunk({ content: '你' })));
    p.push(sse(chunk({ content: '好' })));
    p.push(sse(chunk({}, 'stop')));
    p.push(sse({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10 } }));
    p.push(sse('[DONE]'));
    const r = p.finish();
    expect(r).toMatchObject({ content: '你好', think: '想', finishReason: 'stop', sawDone: true });
    expect(r.error).toBeUndefined();
    expect(r.usage).toMatchObject({ input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_miss_tokens: 10 });
    expect(deltas).toEqual([['', '想'], ['你', ''], ['好', '']]);
  });
  it('逐字符切分、CRLF 也能解析', () => {
    const p = createChatStreamParser();
    const raw = (sse(chunk({ content: 'abc' })) + sse('[DONE]')).replace(/\n/g, '\r\n');
    for (const ch of raw) p.push(ch);
    expect(p.finish()).toMatchObject({ content: 'abc', sawDone: true });
  });
  it('[DONE] 后面没有空行也能识别（flush）', () => {
    const p = createChatStreamParser();
    p.push(sse(chunk({ content: 'x' })) + 'data: [DONE]');
    expect(p.finish()).toMatchObject({ content: 'x', sawDone: true });
  });
  it('兼容 reasoning 字段', () => {
    const p = createChatStreamParser();
    p.push(sse(chunk({ reasoning: 'r' })) + sse('[DONE]'));
    expect(p.finish().think).toBe('r');
  });
  it('流内 error：记录错误、不算正常结束、后续帧忽略', () => {
    const p = createChatStreamParser();
    p.push(sse(chunk({ content: '半' })));
    p.push(sse({ error: { message: 'rate limited', code: 'rate_limit' } }));
    p.push(sse(chunk({ content: '不该出现' })));
    expect(p.finish()).toMatchObject({ error: 'rate limited', content: '半', sawDone: false });
  });
  it('event: error 命名事件', () => {
    const p = createChatStreamParser();
    p.push('event: error\ndata: {"message":"bad"}\n\n');
    expect(p.finish()).toMatchObject({ error: 'bad', sawDone: false });
  });
  it('没有 [DONE] 但有 finish_reason 也算正常结束', () => {
    const p = createChatStreamParser();
    p.push(sse(chunk({ content: 'ok' }, 'stop')));
    expect(p.finish()).toMatchObject({ content: 'ok', sawDone: true });
  });
  it('中途断开（无 [DONE]、无 finish_reason）→ sawDone=false', () => {
    const p = createChatStreamParser();
    p.push(sse(chunk({ content: '一半' })));
    expect(p.finish()).toMatchObject({ content: '一半', sawDone: false });
  });
  it('非 JSON 帧忽略', () => {
    const p = createChatStreamParser();
    p.push('data: hello\n\n' + sse(chunk({ content: 'ok' })) + sse('[DONE]'));
    expect(p.finish()).toMatchObject({ content: 'ok', sawDone: true });
  });
});

describe('classifyFailure / retryDelayMs', () => {
  it('用户停止优先', () => {
    expect(classifyFailure({ aborted: true, httpStatus: 500 })).toBe('aborted');
  });
  it('429 / 5xx 重试，其他 HTTP 错误不重试', () => {
    for (const s of [429, 500, 502, 503]) expect(classifyFailure({ httpStatus: s })).toBe('retry');
    for (const s of [400, 401, 403, 404]) expect(classifyFailure({ httpStatus: s })).toBe('fatal');
  });
  it('网络错误、中途断开重试；流内错误不重试；正常结束', () => {
    expect(classifyFailure({ networkError: true })).toBe('retry');
    expect(classifyFailure({ httpStatus: 200, sawDone: false })).toBe('retry');
    expect(classifyFailure({ httpStatus: 200, streamError: 'x' })).toBe('fatal');
    expect(classifyFailure({ httpStatus: 200, sawDone: true })).toBe('none');
  });
  it('间隔 2s / 4s / 8s，最多 3 次', () => {
    expect([1, 2, 3].map(retryDelayMs)).toEqual([2000, 4000, 8000]);
    expect(retryDelayMs(0)).toBe(2000);
    expect(MAX_RETRIES).toBe(3);
  });
  it('识别上下文超长错误', () => {
    expect(isContextOverflowError("This model's maximum context length is 131072 tokens")).toBe(true);
    expect(isContextOverflowError('context_length_exceeded')).toBe(true);
    expect(isContextOverflowError('上下文长度超出限制')).toBe(true);
    expect(isContextOverflowError('invalid api key')).toBe(false);
  });
});

describe('parseModelList / 模型设置', () => {
  it('标准字段 + 扩展字段；去重、忽略非法值', () => {
    const list = parseModelList({ data: [
      { id: 'deepseek-flash', object: 'model', name: 'DeepSeek-V4.1-Flash', context_window: 1048576, max_output_tokens: 256000, input_modalities: ['text', 'image', 'audio', 'text'] },
      { id: 'gpt-4o', object: 'model' },
      { id: 'gpt-4o' },
      { id: '' },
      'x',
      { id: 'bad', context_window: -1, max_output_tokens: 1.5, input_modalities: ['audio'], name: '  ' },
    ] });
    expect(list).toEqual([
      { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', contextWindow: 1048576, maxOutputTokens: 256000, inputModalities: ['text', 'image'] },
      { id: 'gpt-4o' },
      { id: 'bad' },
    ]);
    expect(listedToApiMeta(list[0])).toEqual({ name: 'DeepSeek-V4.1-Flash', contextWindow: 1048576, maxTokens: 256000, inputModalities: ['text', 'image'] });
  });
  it('没有 data 数组时报错', () => {
    expect(() => parseModelList({})).toThrow('返回格式不正确');
    expect(() => parseModelList(null)).toThrow('返回格式不正确');
  });
  // [261123-q4h7tn-cuko-openai] DeepSeek 实测：effort = { supported_levels: ["low","high","max"], default_level: "high" }
  it('读取接口返回的推理档位（effort 扩展字段）', () => {
    const list = parseModelList({ data: [
      { id: 'deepseek-flash', effort: { supported_levels: ['low', 'high', 'max', 'high', '  ', 3, null], default_level: 'high' } },
      { id: 'bad-default', effort: { supported_levels: ['low', 'max'], default_level: 'ultra' } },
      { id: 'levels-not-array', effort: { supported_levels: 'low', default_level: 'high' } },
      { id: 'effort-not-object', effort: ['low'] },
      { id: 'empty-levels', effort: { supported_levels: [], default_level: 'high' } },
      { id: 'no-effort' },
    ] });
    // 接口没给 off 也补一个，放最前面（模型能思考就要能关）
    expect(list[0].reasoningLevels).toEqual([{ id: 'off', value: '' }, { id: 'low' }, { id: 'high' }, { id: 'max' }]);
    expect(list[0].defaultEffort).toBe('high');
    // 默认档位不在档位表里就忽略，不写成不存在的档位
    expect(list[1].reasoningLevels).toEqual([{ id: 'off', value: '' }, { id: 'low' }, { id: 'max' }]);
    expect(list[1].defaultEffort).toBeUndefined();
    // 字段类型不对 / 空档位表：当作没返回，不影响其它字段
    expect(list[2].reasoningLevels).toBeUndefined();
    expect(list[3].reasoningLevels).toBeUndefined();
    expect(list[4].reasoningLevels).toBeUndefined();
    expect(list[5].reasoningLevels).toBeUndefined();
  });
  it('接口没给 off 也补一个；给了就不重复', () => {
    const list = parseModelList({ data: [
      { id: 'no-off', effort: { supported_levels: ['low', 'high'], default_level: 'low' } },
      { id: 'has-off', effort: { supported_levels: ['off', 'high'], default_level: 'off' } },
      { id: 'off-not-first', effort: { supported_levels: ['high', 'off'], default_level: 'high' } },
    ] });
    expect(list[0].reasoningLevels).toEqual([{ id: 'off', value: '' }, { id: 'low' }, { id: 'high' }]);
    expect(list[0].defaultEffort).toBe('low');
    // 接口自己给了 off：不重复，顺序也不动
    expect(list[1].reasoningLevels).toEqual([{ id: 'off' }, { id: 'high' }]);
    expect(list[1].defaultEffort).toBe('off');
    expect(list[2].reasoningLevels).toEqual([{ id: 'high' }, { id: 'off' }]);
    expect(list[2].defaultEffort).toBe('high');
  });
  it('接口档位写进 api_meta 并自动打开总开关', () => {
    const withEffort = parseModelList({ data: [{ id: 'deepseek-flash', effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' } }] });
    expect(listedToApiMeta(withEffort[0])).toEqual({
      reasoningEnabled: true,
      reasoningLevels: [{ id: 'off', value: '' }, { id: 'low' }, { id: 'high' }, { id: 'max' }],
      defaultEffort: 'high',
    });
    // 没返回档位的模型不凭空加总开关，避免界面显示「支持」但实际没档位
    expect(listedToApiMeta({ id: 'plain' })).toEqual({});
  });
  it('用户修改的档位优先于接口值', () => {
    const apiMeta = listedToApiMeta({ id: 'm', reasoningLevels: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'high' });
    // 用户在设置页关掉总开关：保留关闭，不被刷新覆盖
    expect(effectiveModelMeta(apiMeta, { reasoningEnabled: false }).reasoningEnabled).toBe(false);
    // 用户自己填的档位表 / 默认档位：优先
    const merged = effectiveModelMeta(apiMeta, { reasoningLevels: [{ id: 'off' }, { id: 'max' }], defaultEffort: 'max' });
    expect(merged.reasoningLevels).toEqual([{ id: 'off' }, { id: 'max' }]);
    expect(merged.defaultEffort).toBe('max');
  });
  it('user_meta 覆盖 api_meta，未定义的字段沿用接口值', () => {
    expect(effectiveModelMeta({ name: 'A', contextWindow: 100, maxTokens: 10 }, { contextWindow: 50, maxTokens: undefined })).toEqual({ name: 'A', contextWindow: 50, maxTokens: 10 });
    expect(effectiveModelMeta(null, null)).toEqual({});
  });
  const meta = { reasoningEnabled: true, reasoningLevels: DEFAULT_REASONING_LEVELS, defaultEffort: 'high' };
  it('默认档位 / 切模型时的档位', () => {
    expect(defaultEffortOf(meta)).toBe('high');
    // 默认档位无效时跳过 off，用第一个能思考的档位（避免默认把思考关掉）
    expect(defaultEffortOf({ ...meta, defaultEffort: 'nope' })).toBe('low');
    expect(defaultEffortOf({ reasoningEnabled: true, reasoningLevels: [{ id: 'off' }] })).toBe('off');
    expect(defaultEffortOf({ ...meta, reasoningEnabled: false })).toBeUndefined();
    expect(resolveEffortAfterSwitch('low', meta)).toBe('low');
    expect(resolveEffortAfterSwitch('medium', meta)).toBe('high');
    expect(resolveEffortAfterSwitch('low', {})).toBeUndefined();
  });
  it('思考强度 → 请求参数：参数值默认等于档位名，off 带上关闭参数', () => {
    const levels = { reasoningEnabled: true, reasoningLevels: [{ id: 'off' }, { id: 'medium', value: 'high' }, { id: 'max', value: '' }] };
    const provider = { field: '', disableParams: { thinking: { type: 'disabled' } } };
    expect(reasoningRequestOf(levels, 'medium', provider)).toEqual({ field: 'reasoning_effort', value: 'high' });
    expect(reasoningRequestOf(levels, 'max', provider)).toEqual({ field: 'reasoning_effort', value: 'max' });
    expect(reasoningRequestOf(levels, 'off', provider)).toEqual({ field: 'reasoning_effort', off: true, disableParams: { thinking: { type: 'disabled' } } });
    // 档位未知时兜到第一个「非 off」档位：不能因为认不出档位就悄悄把思考关掉
    expect(reasoningRequestOf(levels, 'unknown', { field: 'effort' })).toEqual({ field: 'effort', value: 'high' });
    // 但用户明确选了 off 仍然照旧关门
    expect(reasoningRequestOf(levels, 'off', { field: 'effort' })).toEqual({ field: 'effort', off: true, disableParams: null });
    expect(reasoningRequestOf({}, 'high', provider)).toBeNull();
  });
});

describe('contextUsageOf（60% 提醒）', () => {
  it('超过 60% 提醒；没填上限不提醒', () => {
    expect(contextUsageOf(59, 100)).toMatchObject({ used: 59, limit: 100, warn: false });
    expect(contextUsageOf(60, 100)).toMatchObject({ warn: true, ratio: 0.6 });
    expect(contextUsageOf(500, null)).toEqual({ used: 500, warn: false });
    expect(contextUsageOf(-1, 100)).toMatchObject({ used: 0, warn: false });
  });
});

describe('createSseDecoder.flush', () => {
  it('处理末尾没有空行的最后一帧', () => {
    const events = [];
    const d = createSseDecoder((e, data) => events.push([e, data]));
    d.push('event: done\ndata: {"x":1}');
    expect(events).toEqual([]);
    d.flush();
    expect(events).toEqual([['done', '{"x":1}']]);
  });
  it('缓冲为空时不触发事件，重复 flush 安全', () => {
    const events = [];
    const d = createSseDecoder((e, data) => events.push([e, data]));
    d.push('data: a\n\n');
    d.flush();
    d.flush();
    expect(events).toEqual([['message', 'a']]);
  });
});

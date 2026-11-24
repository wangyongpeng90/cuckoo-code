// [261123-q4h7tn-cuko-openai] 聊天输入框用量显示与推理等级纯函数测试
// 覆盖：会话累计缓存命中（两位小数、不假装 100%、缺字段）、token 紧凑格式（照 harness）、
//      最近一次输入用量、上下文 60% 提醒、推理档位生效规则 / 显示名 / 不支持原因、与 src/app 规则一致
import { describe, it, expect } from 'vitest';
import {
  CONTEXT_WARN_RATIO,
  sessionCacheTotals,
  formatHitPercent,
  formatTokenCount,
  lastPromptTokens,
  contextDisplay,
  reasoningLevelsOf,
  effectiveEffort,
  effortLabel,
  reasoningUnsupportedReason,
  sessionTokenTotals,
  formatExactCount,
  usageDetailRows,
} from '../src/ui/cuko/composer-stats.js';
import { CONTEXT_WARN_RATIO as APP_WARN_RATIO, resolveEffortAfterSwitch } from '../src/app/cuko-openai.js';

const META = {
  reasoningEnabled: true,
  reasoningLevels: [
    { id: 'off', value: '' },
    { id: 'low', value: 'low' },
    { id: 'high', value: 'high' },
    { id: 'max', value: 'max' },
  ],
  defaultEffort: 'high',
};

describe('sessionCacheTotals 会话累计', () => {
  it('只统计同时带命中 / 未命中字段的用量', () => {
    const totals = sessionCacheTotals([
      { cache_read_tokens: 0, cache_miss_tokens: 3677 },
      null,
      { total_tokens: 100 },
      { cache_read_tokens: 3600, cache_miss_tokens: 200 },
      { cache_read_tokens: 5 },
    ]);
    expect(totals).toEqual({ read: 3600, prompt: 7477 });
    expect(formatHitPercent(totals.read, totals.prompt)).toBe('48.15');
  });
  it('一条命中字段都没有返回 null', () => {
    expect(sessionCacheTotals([])).toBeNull();
    expect(sessionCacheTotals([{ prompt_tokens: 10 }, 'x', 3, undefined])).toBeNull();
  });
});

describe('formatHitPercent 两位小数', () => {
  it('固定两位小数', () => {
    expect(formatHitPercent(9735, 10000)).toBe('97.35');
    expect(formatHitPercent(1, 3)).toBe('33.33');
    expect(formatHitPercent(5, 100)).toBe('5.00');
    expect(formatHitPercent(0, 3677)).toBe('0.00');
  });
  it('没全部命中最多 99.99，全部命中才 100.00', () => {
    expect(formatHitPercent(999999, 1000000)).toBe('99.99');
    expect(formatHitPercent(1000, 1000)).toBe('100.00');
  });
  it('输入为 0 返回 null', () => {
    expect(formatHitPercent(0, 0)).toBeNull();
  });
});

describe('formatTokenCount 照 harness', () => {
  it('小于 1000 原样，小于 100K 一位小数，其余取整，百万用 M', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(1000)).toBe('1K');
    expect(formatTokenCount(3677)).toBe('3.7K');
    expect(formatTokenCount(8240)).toBe('8.2K');
    expect(formatTokenCount(82300)).toBe('82.3K');
    expect(formatTokenCount(128000)).toBe('128K');
    expect(formatTokenCount(350400)).toBe('350K');
    expect(formatTokenCount(1000000)).toBe('1M');
    expect(formatTokenCount(1048576)).toBe('1M');
  });
});

describe('lastPromptTokens 最近一次输入', () => {
  it('从后往前找，优先 prompt_tokens', () => {
    expect(lastPromptTokens([{ prompt_tokens: 100 }, { input_tokens: 200, prompt_tokens: 300 }, { total_tokens: 5 }, undefined])).toBe(300);
    expect(lastPromptTokens([{ input_tokens: 50 }])).toBe(50);
    expect(lastPromptTokens([])).toBeUndefined();
  });
});

describe('contextDisplay 上下文与 60% 提醒', () => {
  it('没有用量不显示', () => {
    expect(contextDisplay(undefined, 128000)).toBeNull();
  });
  it('没填窗口或不到 60% 只显示用量', () => {
    expect(contextDisplay(3677, undefined)).toEqual({ text: '上下文 3.7K', warn: false });
    expect(contextDisplay(3677, 1000000)).toEqual({ text: '上下文 3.7K', warn: false });
    expect(contextDisplay(100, 0)).toEqual({ text: '上下文 100', warn: false });
  });
  it('达到 60% 显示用量 / 窗口（百分比）并提醒', () => {
    expect(contextDisplay(82300, 128000)).toEqual({ text: '上下文 82.3K / 128K（64%）', warn: true });
    expect(contextDisplay(76800, 128000)).toEqual({ text: '上下文 76.8K / 128K（60%）', warn: true });
    expect(contextDisplay(200000, 128000)).toEqual({ text: '上下文 200K / 128K（100%）', warn: true });
  });
});

describe('推理等级', () => {
  it('档位表：没开总开关为空，过滤空 id', () => {
    expect(reasoningLevelsOf(META).map((l) => l.id)).toEqual(['off', 'low', 'high', 'max']);
    expect(reasoningLevelsOf({ ...META, reasoningEnabled: false })).toEqual([]);
    expect(reasoningLevelsOf({ reasoningEnabled: true, reasoningLevels: [{ id: ' ' }, { id: 'x' }] }).map((l) => l.id)).toEqual(['x']);
    expect(reasoningLevelsOf(null)).toEqual([]);
  });
  it('生效档位：存的有效就用，否则默认，再否则第一个', () => {
    expect(effectiveEffort(META, 'max')).toBe('max');
    expect(effectiveEffort(META, 'ultra')).toBe('high');
    expect(effectiveEffort(META, null)).toBe('high');
    // 默认档位无效时跳过 off（与 src/app 的 defaultEffortOf 一致）
    expect(effectiveEffort({ ...META, defaultEffort: 'nope' }, null)).toBe('low');
    expect(effectiveEffort({ reasoningEnabled: false }, 'max')).toBeUndefined();
  });
  it('显示名首字母大写', () => {
    expect(effortLabel('max')).toBe('Max');
    expect(effortLabel('off')).toBe('Off');
    expect(effortLabel('')).toBe('');
    expect(effortLabel(undefined)).toBe('');
  });
  it('不支持的原因', () => {
    expect(reasoningUnsupportedReason('cuko', META)).toBe('protocol');
    expect(reasoningUnsupportedReason('', META)).toBe('protocol');
    expect(reasoningUnsupportedReason('openai', META)).toBeNull();
    expect(reasoningUnsupportedReason('OpenAI', { reasoningEnabled: false })).toBe('model');
  });
});

describe('与 src/app/cuko-openai.ts 规则一致', () => {
  it('60% 阈值相同', () => {
    expect(CONTEXT_WARN_RATIO).toBe(APP_WARN_RATIO);
  });
  it('生效档位与切模型后的档位规则相同', () => {
    const metas = [META, { ...META, defaultEffort: 'nope' }, { ...META, reasoningEnabled: false }, null];
    const stored = ['max', 'ultra', '', null, undefined, 'off'];
    for (const m of metas) {
      for (const s of stored) {
        expect(effectiveEffort(m, s)).toBe(resolveEffortAfterSwitch(s, m));
      }
    }
  });
});


describe('sessionTokenTotals 会话累计用量（xxx tok）', () => {
  const U1 = { prompt_tokens: 3677, completion_tokens: 391, total_tokens: 4068, input_tokens: 3677, output_tokens: 391, cache_read_tokens: 0, cache_miss_tokens: 3677 };
  const U2 = { input_tokens: 3900, output_tokens: 200, total_tokens: 4100, cache_read_tokens: 3600, cache_miss_tokens: 300 };
  it('每条取输入 + 输出求和，拆出未缓存输入 / 缓存读取 / 输出', () => {
    const t = sessionTokenTotals([U1, null, 'x', U2]);
    expect(t).toEqual({ total: 8168, uncachedInput: 3977, cacheRead: 3600, output: 591 });
    expect(formatTokenCount(t.total) + ' tok').toBe('8.2K tok');
  });
  it('没有 input/output 时用 prompt/completion，再没有用 total_tokens', () => {
    expect(sessionTokenTotals([{ total_tokens: 500 }, { prompt_tokens: 100, completion_tokens: 20 }])).toEqual({ total: 620, uncachedInput: 100, cacheRead: 0, output: 20 });
  });
  it('命中数大于输入时按输入封顶', () => {
    expect(sessionTokenTotals([{ input_tokens: 10, output_tokens: 1, cache_read_tokens: 50 }])).toEqual({ total: 11, uncachedInput: 0, cacheRead: 10, output: 1 });
  });
  it('没有可用用量或累计为 0 返回 null', () => {
    expect(sessionTokenTotals([])).toBeNull();
    expect(sessionTokenTotals([undefined, 3, { cache_read_tokens: 5 }])).toBeNull();
    expect(sessionTokenTotals([{ input_tokens: 0, output_tokens: 0 }])).toBeNull();
  });
  it('明细用精确数字千分位', () => {
    expect(formatExactCount(12345678)).toBe('12,345,678');
    expect(formatExactCount(1000)).toBe('1,000');
    expect(formatExactCount(999)).toBe('999');
    expect(formatExactCount(0)).toBe('0');
    const grand = { total: 8168, uncachedInput: 3977, cacheRead: 3600, output: 591 };
    expect(usageDetailRows(grand, '97.35')).toEqual([
      { label: '缓存命中', value: '97.35%' },
      { label: '未缓存输入', value: '3,977' },
      { label: '缓存读取', value: '3,600' },
      { label: '输出', value: '591' },
    ]);
    // 从没返回命中字段的会话不显示缓存命中这一行
    expect(usageDetailRows(grand, null).map((row) => row.label)).toEqual(['未缓存输入', '缓存读取', '输出']);
  });
});
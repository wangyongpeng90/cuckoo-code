// [261123-q4h7tn-cuko-openai] API 密钥加密存储的纯函数测试
// 只测不依赖 Electron 的部分：前缀打包 / 拆包、密文判定、打码。
// 真正的加解密要 Electron 的 safeStorage，属外部分界，不在这里 mock。
import { describe, it, expect } from 'vitest';
import {
  SECRET_PREFIX,
  isEncryptedSecret,
  packSecret,
  unpackSecret,
  maskSecret,
} from '../src/app/secrets.js';

describe('凭据存储格式', () => {
  it('密文带固定前缀，能原样拆回来', () => {
    expect(packSecret('YWJj')).toBe(SECRET_PREFIX + 'YWJj');
    expect(unpackSecret(SECRET_PREFIX + 'YWJj')).toBe('YWJj');
    expect(isEncryptedSecret(SECRET_PREFIX + 'YWJj')).toBe(true);
  });
  it('旧数据（明文）一律不算密文', () => {
    expect(isEncryptedSecret('sk-plain-key')).toBe(false);
    expect(isEncryptedSecret('')).toBe(false);
    expect(isEncryptedSecret(null)).toBe(false);
    expect(isEncryptedSecret(undefined)).toBe(false);
    expect(isEncryptedSecret(123)).toBe(false);
    expect(unpackSecret('sk-plain-key')).toBeNull();
  });
  it('只有前缀没有内容算无效密文', () => {
    expect(isEncryptedSecret(SECRET_PREFIX)).toBe(true);
    expect(unpackSecret(SECRET_PREFIX)).toBeNull();
  });
});

describe('密钥打码（只给界面看）', () => {
  it('保留后 4 位，前面全遮住', () => {
    expect(maskSecret('sk-1234567890abcd')).toBe('****abcd');
    expect(maskSecret('abcdefgh')).toBe('****efgh');
  });
  it('太短的整个遮住，避免把短密钥暴露完', () => {
    expect(maskSecret('abc')).toBe('****');
    expect(maskSecret('abcd')).toBe('****');
  });
  it('空值返回空串', () => {
    expect(maskSecret('')).toBe('');
    expect(maskSecret(null)).toBe('');
    expect(maskSecret(undefined)).toBe('');
  });
});

/**
 * [261127-w3pd8n-cuko-default-workspace] 默认工作区：候选顺序与可写探测（真实文件系统）
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultWorkspaceCandidates, pickWritableDir, DEFAULT_WORKSPACE_DIRNAME } from '../src/app/cuko-default-workspace.js';

const D = DEFAULT_WORKSPACE_DIRNAME;
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cuko-defws-'));

afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('defaultWorkspaceCandidates', () => {
  it('目录名是 cuko-default-workspace', () => {
    expect(D).toBe('cuko-default-workspace');
  });

  it('打包版：便携目录 → 安装目录 → userData', () => {
    const c = defaultWorkspaceCandidates({ isPackaged: true, portableDir: 'P', exePath: path.join('I', 'Cuckoo-Code.exe'), userData: 'U' });
    expect(c).toEqual([path.join('P', D), path.join('I', D), path.join('U', D)]);
  });

  it('打包版没有便携目录：安装目录 → userData', () => {
    const c = defaultWorkspaceCandidates({ isPackaged: true, exePath: path.join('I', 'Cuckoo-Code.exe'), userData: 'U' });
    expect(c).toEqual([path.join('I', D), path.join('U', D)]);
  });

  it('开发版：不用 electron 所在目录，只用 userData', () => {
    const c = defaultWorkspaceCandidates({ isPackaged: false, exePath: path.join('node_modules', 'electron', 'dist', 'electron.exe'), userData: 'U' });
    expect(c).toEqual([path.join('U', D)]);
  });

  it('重复目录只保留一个；什么都没有返回空数组', () => {
    const c = defaultWorkspaceCandidates({ isPackaged: true, portableDir: 'I', exePath: path.join('I', 'x.exe'), userData: null });
    expect(c).toEqual([path.join('I', D)]);
    expect(defaultWorkspaceCandidates({ isPackaged: false })).toEqual([]);
  });
});

describe('pickWritableDir', () => {
  it('第一个可写就用它：目录被创建，探测文件不残留', () => {
    const dir = path.join(ROOT, 'a', D);
    expect(pickWritableDir([dir, path.join(ROOT, 'other', D)])).toBe(dir);
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('第一个写不进去（路径上是个文件）就退回下一个', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const blocker = path.join(ROOT, 'blocker');
      fs.writeFileSync(blocker, 'x');
      const good = path.join(ROOT, 'b', D);
      expect(pickWritableDir([path.join(blocker, D), good])).toBe(good);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('都写不进去 / 空列表返回 null', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const blocker = path.join(ROOT, 'blocker2');
      fs.writeFileSync(blocker, 'x');
      expect(pickWritableDir([path.join(blocker, D)])).toBeNull();
      expect(pickWritableDir([])).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

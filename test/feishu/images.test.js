'use strict';
/**
 * feishu/images 测试（图片双向通道·纯函数部分）
 *
 * 隔离：真实文件系统 + 临时目录（CUCKOO_HOME 指向临时目录）。
 * 覆盖：findImagePaths 提取/去重/过滤、extractImageKey、sniffImageExt、saveResourceToFile。
 */
import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const TMP = path.join(os.tmpdir(), 'cuckoo-feishu-images-test');
const FAKE_HOME = path.join(TMP, 'home');

let images;
let oldHome;

beforeEach(async () => {
  vi.resetModules();
  oldHome = process.env.CUCKOO_HOME;
  process.env.CUCKOO_HOME = FAKE_HOME;
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(FAKE_HOME, { recursive: true });
  images = await import('../../src/feishu/images.js');
});

afterEach(() => {
  if (oldHome === undefined) delete process.env.CUCKOO_HOME;
  else process.env.CUCKOO_HOME = oldHome;
  fs.rmSync(TMP, { recursive: true, force: true });
});

/** 建一张 1x1 PNG 测试图 */
function makePng(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // PNG 魔数 + 最小结构（嗅探只看头 16 字节，够用）
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  fs.writeFileSync(p, png);
  return p;
}

test('isImagePath：按扩展名判断（大小写不敏感）', () => {
  assert.strictEqual(images.isImagePath('C:\\a\\b.PNG'), true);
  assert.strictEqual(images.isImagePath('/x/y/a.jpeg'), true);
  assert.strictEqual(images.isImagePath('/x/y/a.webp'), true);
  assert.strictEqual(images.isImagePath('/x/y/a.txt'), false);
  assert.strictEqual(images.isImagePath(''), false);
  assert.strictEqual(images.isImagePath(undefined), false);
});

test('findImagePaths：提取真实存在的图片路径（Windows 盘符 / POSIX / ~）', () => {
  const a = makePng(path.join(TMP, 'a.png'));
  const b = makePng(path.join(TMP, 'b b.jpg')); // 含空格，只能靠引号路径命中
  const text = [
    '生成好了：' + a,
    '带空格的图："' + b + '"',
    '这张不存在：C:\\nope\\missing.png',
    '这不是图：' + path.join(TMP, 'a.txt'),
  ].join('\n');
  fs.writeFileSync(path.join(TMP, 'a.txt'), 'x');
  const got = images.findImagePaths(text);
  // 只验证集合语义（提取顺序：引号路径先于裸路径），不绑定顺序
  const norm = (arr) => arr.map((p) => p.toLowerCase()).sort();
  assert.deepStrictEqual(norm(got), norm([a, b]));
});

test('findImagePaths：去重（同图多次提及只返回一次，大小写不敏感）', () => {
  const a = makePng(path.join(TMP, 'dup.png'));
  const text = a + '\n' + a.toUpperCase() + '\n"' + a + '"';
  const got = images.findImagePaths(text);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].toLowerCase(), a.toLowerCase());
});

test('findImagePaths：0 字节与超 10MB 文件被过滤', () => {
  const zero = path.join(TMP, 'zero.png');
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(zero, Buffer.alloc(0));
  const big = path.join(TMP, 'big.png');
  const bigBuf = Buffer.alloc(images.MAX_IMAGE_BYTES + 1, 0x89);
  bigBuf.write('PNG', 1, 'ascii');
  fs.writeFileSync(big, bigBuf);
  const got = images.findImagePaths(zero + ' ' + big);
  assert.deepStrictEqual(got, []);
});

test('findImagePaths：空输入安全', () => {
  assert.deepStrictEqual(images.findImagePaths(''), []);
  assert.deepStrictEqual(images.findImagePaths(undefined), []);
});

test('extractImageKey：仅 image 消息返回 image_key', () => {
  const ev = { message: { message_type: 'image', content: '{"image_key":"img_v2_xxx"}' } };
  assert.strictEqual(images.extractImageKey(ev), 'img_v2_xxx');
  assert.strictEqual(images.extractImageKey({ message: { message_type: 'text', content: '{"text":"hi"}' } }), '');
  assert.strictEqual(images.extractImageKey({}), '');
  assert.strictEqual(images.extractImageKey(undefined), '');
  // 坏 JSON 容错
  assert.strictEqual(images.extractImageKey({ message: { message_type: 'image', content: '{bad' } }), '');
});

test('sniffImageExt：按魔数识别 png/jpg/gif/bmp/webp，未知回退 png', () => {
  assert.strictEqual(images.sniffImageExt(Buffer.from('89504e470d0a1a0a', 'hex')), '.png');
  assert.strictEqual(images.sniffImageExt(Buffer.from('ffd8ffe000104a46', 'hex')), '.jpg');
  assert.strictEqual(images.sniffImageExt(Buffer.from('474946383961', 'hex')), '.gif');
  assert.strictEqual(images.sniffImageExt(Buffer.from('424d00000000', 'hex')), '.bmp');
  assert.strictEqual(images.sniffImageExt(Buffer.from('524946460000000057454250', 'hex')), '.webp');
  assert.strictEqual(images.sniffImageExt(Buffer.from('0000000000', 'hex')), '.png');
  assert.strictEqual(images.sniffImageExt(Buffer.alloc(0)), '.png');
});

test('saveResourceToFile：Node 流形态落盘 + 魔数补扩展名', async () => {
  const { Readable } = await import('node:stream');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const res = { data: Readable.from([png.subarray(0, 8), png.subarray(8)]) };
  const base = path.join(FAKE_HOME, 'feishu-images', 'inbox', 'img_test_1');
  const r = await images.saveResourceToFile(res, base);
  assert.strictEqual(r.success, true);
  assert.strictEqual(path.extname(r.path), '.png');
  assert.ok(fs.existsSync(r.path));
  assert.strictEqual(r.size, png.length);
});

test('saveResourceToFile：Buffer 形态落盘', async () => {
  const jpg = Buffer.from('ffd8ffe100104a46494600', 'hex');
  const base = path.join(FAKE_HOME, 'feishu-images', 'inbox', 'img_test_2');
  const r = await images.saveResourceToFile({ data: jpg }, base);
  assert.strictEqual(r.success, true);
  assert.strictEqual(path.extname(r.path), '.jpg');
});

test('saveResourceToFile：Web ReadableStream 形态落盘', async () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const webStream = new ReadableStream({
    start(controller) {
      controller.enqueue(png);
      controller.close();
    },
  });
  const base = path.join(FAKE_HOME, 'feishu-images', 'inbox', 'img_test_3');
  const r = await images.saveResourceToFile({ data: webStream }, base);
  assert.strictEqual(r.success, true);
  assert.strictEqual(path.extname(r.path), '.png');
});

test('saveResourceToFile：空内容报错不写文件', async () => {
  const base = path.join(FAKE_HOME, 'feishu-images', 'inbox', 'img_test_empty');
  const r = await images.saveResourceToFile({ data: Buffer.alloc(0) }, base);
  assert.strictEqual(r.success, false);
  assert.ok(r.error);
});

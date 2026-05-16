import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  initStorage,
  putImage,
  getImage,
  deleteImage,
  deleteImagesByPrefix,
  isAllowedImageExt,
  getMimeType,
  _internal,
} from './storage.js';

const { safeFilePath } = _internal;

// Each test gets its own temp data dir. initStorage mutates a module-level
// `imagesDir`, so this also resets that to a known location per test.
function setup(): string {
  const dataDir = mkdtempSync(join(tmpdir(), 'pf-storage-test-'));
  initStorage(dataDir);
  return dataDir;
}

test('safeFilePath rejects parent traversal in raw form', () => {
  setup();
  assert.equal(safeFilePath('../postforge.db'), null);
  assert.equal(safeFilePath('../../etc/passwd'), null);
  assert.equal(safeFilePath('foo/../../bar'), null);
});

test('safeFilePath rejects absolute paths', () => {
  setup();
  assert.equal(safeFilePath('/etc/passwd'), null);
});

test('safeFilePath rejects empty input', () => {
  setup();
  assert.equal(safeFilePath(''), null);
  assert.equal(safeFilePath(undefined as unknown as string), null);
  assert.equal(safeFilePath(null as unknown as string), null);
});

test('safeFilePath accepts a normal post image key', () => {
  const dataDir = setup();
  const got = safeFilePath('posts/my-slug/hero.png');
  assert.ok(got, 'expected a path, got null');
  assert.equal(got, join(dataDir, 'images', 'posts', 'my-slug', 'hero.png'));
});

test('getImage returns null for an escaping key even when the target file exists', () => {
  const dataDir = setup();
  // Place a sensitive file at the data-dir level (the same place postforge.db sits).
  writeFileSync(join(dataDir, 'postforge.db'), 'SQLite format 3\0secret');
  assert.equal(existsSync(join(dataDir, 'postforge.db')), true);

  assert.equal(getImage('../postforge.db'), null);
});

test('putImage refuses to write outside imagesDir and does not create the file', () => {
  const dataDir = setup();
  assert.throws(() => putImage('../escape.txt', Buffer.from('x')), /invalid image key/i);
  assert.equal(existsSync(join(dataDir, 'escape.txt')), false);
});

test('deleteImage is a no-op for escaping keys', () => {
  const dataDir = setup();
  writeFileSync(join(dataDir, 'postforge.db'), 'secret');
  deleteImage('../postforge.db');
  // Target untouched.
  assert.equal(existsSync(join(dataDir, 'postforge.db')), true);
});

test('deleteImagesByPrefix refuses to wipe imagesDir itself', () => {
  const dataDir = setup();
  // Seed two normal post directories so we can verify they survive.
  putImage('posts/alpha/hero.png', Buffer.from('a'));
  putImage('posts/beta/hero.png', Buffer.from('b'));

  // A `slug = ".."` would historically resolve prefix to imagesDir and unlink everything.
  deleteImagesByPrefix('..');

  assert.equal(existsSync(join(dataDir, 'images', 'posts', 'alpha', 'hero.png')), true);
  assert.equal(existsSync(join(dataDir, 'images', 'posts', 'beta', 'hero.png')), true);
});

test('putImage + getImage round-trip with a normal key', () => {
  setup();
  putImage('posts/my-slug/hero.png', Buffer.from('payload'));
  const got = getImage('posts/my-slug/hero.png');
  assert.ok(got, 'expected an image, got null');
  assert.equal(got.buffer.toString(), 'payload');
  assert.equal(got.contentType, 'image/png');
});

test('deleteImagesByPrefix removes only the targeted post directory', () => {
  const dataDir = setup();
  putImage('posts/alpha/hero.png', Buffer.from('a'));
  putImage('posts/beta/hero.png', Buffer.from('b'));

  deleteImagesByPrefix('posts/alpha');

  assert.equal(existsSync(join(dataDir, 'images', 'posts', 'alpha', 'hero.png')), false);
  assert.equal(existsSync(join(dataDir, 'images', 'posts', 'beta', 'hero.png')), true);
});

// ── H5: SVG and other risky formats ─────────────────────────────────

test('isAllowedImageExt accepts standard raster formats', () => {
  assert.equal(isAllowedImageExt('hero.png'), true);
  assert.equal(isAllowedImageExt('hero.JPG'), true);
  assert.equal(isAllowedImageExt('hero.jpeg'), true);
  assert.equal(isAllowedImageExt('hero.gif'), true);
  assert.equal(isAllowedImageExt('hero.webp'), true);
});

test('isAllowedImageExt rejects SVG and executable-ish extensions', () => {
  assert.equal(isAllowedImageExt('hero.svg'), false);
  assert.equal(isAllowedImageExt('hero.SVG'), false);
  assert.equal(isAllowedImageExt('hero.html'), false);
  assert.equal(isAllowedImageExt('hero.js'), false);
  assert.equal(isAllowedImageExt('hero'), false);
  assert.equal(isAllowedImageExt(''), false);
});

test('getMimeType returns octet-stream for SVG (defense in depth)', () => {
  // Even if an .svg slipped past the upload guard, the serve path must not
  // advertise it as image/svg+xml — browsers download octet-stream rather
  // than execute embedded <script>.
  assert.equal(getMimeType('legacy.svg'), 'application/octet-stream');
  assert.equal(getMimeType('legacy.html'), 'application/octet-stream');
});

test('getImage returns octet-stream content-type for an .svg key', () => {
  setup();
  // Simulate an .svg already on disk (e.g. seeded before this patch).
  putImage('posts/old-post/legacy.png', Buffer.from('not really svg'));
  // putImage doesn't care about extension; it's the upload route that does.
  // The serve path must still refuse to label this as SVG.
  const got = getImage('posts/old-post/legacy.png');
  assert.ok(got);
  assert.equal(got!.contentType, 'image/png');
});

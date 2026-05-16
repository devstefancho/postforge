// Router-level integration tests. Build a self-contained Express app per
// test file (no network listening) and exercise it via supertest. Targets
// the exact route wiring that production uses, with a real (temporary)
// SQLite DB and a real images directory.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import cors from 'cors';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initDb } from './db.js';
import { initStorage } from './storage.js';
import { postsRouter } from './routes/posts.js';
import { tagsRouter } from './routes/tags.js';
import { imagesRouter } from './routes/images.js';

const API_KEY = 'this-is-a-long-enough-secret-key-32';
const AUTH_HEADER = `Bearer ${API_KEY}`;

let dataDir: string;
let app: express.Express;

before(() => {
  process.env.API_SECRET_KEY = API_KEY;
  dataDir = mkdtempSync(join(tmpdir(), 'pf-routes-test-'));
  initDb(dataDir);
  initStorage(dataDir);

  app = express();
  app.use(cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (origin === 'http://localhost:5173') return cb(null, true);
      return cb(null, false);
    },
  }));
  app.use('/api/posts', express.json({ limit: '2mb' }), tagsRouter);
  app.use('/api/posts', express.json({ limit: '2mb' }), postsRouter);
  app.use('/api/images', express.json({ limit: '20mb' }), imagesRouter);
});

after(() => {
  // SQLite WAL leaves background work; the temp dir is OS-managed so we
  // don't need explicit cleanup here.
});

// ── H1: GET /api/images traversal ────────────────────────────────────

test('H1: GET /api/images/../postforge.db is rejected (404)', async () => {
  writeFileSync(join(dataDir, 'postforge.db'), 'SECRET DB');
  const res = await request(app).get('/api/images/..%2fpostforge.db');
  assert.equal(res.status, 404);
  assert.notEqual(res.text, 'SECRET DB');
});

test('H1: GET /api/images with raw .. is rejected', async () => {
  const res = await request(app).get('/api/images/..%2f..%2fetc%2fpasswd');
  assert.equal(res.status, 404);
});

// ── H2: POST /api/images/upload with bad slug ────────────────────────

test('H2: upload with traversal slug → 400', async () => {
  const res = await request(app)
    .post('/api/images/upload')
    .set('Authorization', AUTH_HEADER)
    .send({ slug: '../etc', filename: 'hero.png', data: 'aGVsbG8=' });
  assert.equal(res.status, 400);
  assert.equal(existsSync(join(dataDir, 'etc')), false);
  assert.equal(existsSync(join(dataDir, 'hero.png')), false);
});

test('H2: upload with mixed-case bad slug → 400', async () => {
  const res = await request(app)
    .post('/api/images/upload')
    .set('Authorization', AUTH_HEADER)
    .send({ slug: 'My_Bad_Slug', filename: 'hero.png', data: 'aGVsbG8=' });
  assert.equal(res.status, 400);
});

test('H2: upload requires auth', async () => {
  const res = await request(app)
    .post('/api/images/upload')
    .send({ slug: 'my-post', filename: 'hero.png', data: 'aGVsbG8=' });
  assert.equal(res.status, 401);
});

// ── H3: DELETE /api/posts traversal ──────────────────────────────────

// Note: literal `..` is normalized away by the URL layer before the router
// even sees it, so the path-traversal vector that historically reached our
// handler now manifests as a slug that *passes* path-to-regexp but violates
// the slug shape (e.g. mixed-case or trailing dot). Those are what we
// actually need to reject.
test('H3: DELETE with mixed-case bad slug → 400', async () => {
  const res = await request(app)
    .delete('/api/posts/My_Bad_Slug')
    .set('Authorization', AUTH_HEADER);
  assert.equal(res.status, 400);
});

test('H3: DELETE with dotted slug → 400', async () => {
  const res = await request(app)
    .delete('/api/posts/has.dot')
    .set('Authorization', AUTH_HEADER);
  assert.equal(res.status, 400);
});

// ── H5: SVG upload refused ───────────────────────────────────────────

test('H5: SVG upload → 400 unsupported image type', async () => {
  const res = await request(app)
    .post('/api/images/upload')
    .set('Authorization', AUTH_HEADER)
    .send({ slug: 'my-post', filename: 'evil.svg', data: 'PHN2Zy8+' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /unsupported image type/i);
});

test('H5: PNG upload still works', async () => {
  const res = await request(app)
    .post('/api/images/upload')
    .set('Authorization', AUTH_HEADER)
    .send({ slug: 'my-post', filename: 'hero.png', data: 'aGVsbG8=' });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
});

// ── M1: drafts gated by auth ────────────────────────────────────────

test('M1: GET /api/posts?drafts=true without auth → 401', async () => {
  const res = await request(app).get('/api/posts?drafts=true');
  assert.equal(res.status, 401);
});

test('M1: GET /api/posts?drafts=true with auth → 200', async () => {
  const res = await request(app)
    .get('/api/posts?drafts=true')
    .set('Authorization', AUTH_HEADER);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.posts));
});

test('M1: GET /api/posts (no draft flag) is public', async () => {
  const res = await request(app).get('/api/posts');
  assert.equal(res.status, 200);
});

test('M1: GET /api/posts/<draft-slug> unauth → 404 (existence hidden)', async () => {
  // Seed a draft
  const seed = await request(app)
    .post('/api/posts')
    .set('Authorization', AUTH_HEADER)
    .send({ slug: 'hidden-draft', title: 'X', content: 'body', isDraft: 1 });
  assert.equal(seed.status, 201);

  const unauth = await request(app).get('/api/posts/hidden-draft');
  assert.equal(unauth.status, 404);
  assert.doesNotMatch(JSON.stringify(unauth.body), /body/);
});

test('M1: GET /api/posts/<draft-slug> auth → 200 with content', async () => {
  const auth = await request(app)
    .get('/api/posts/hidden-draft')
    .set('Authorization', AUTH_HEADER);
  assert.equal(auth.status, 200);
  assert.equal(auth.body.post.content, 'body');
  assert.equal(auth.body.post.isDraft, true);
});

test('M1: GET /api/posts/<published-slug> public', async () => {
  const seed = await request(app)
    .post('/api/posts')
    .set('Authorization', AUTH_HEADER)
    .send({ slug: 'public-post', title: 'Y', content: 'public body', isDraft: 0 });
  assert.equal(seed.status, 201);

  const res = await request(app).get('/api/posts/public-post');
  assert.equal(res.status, 200);
  assert.equal(res.body.post.content, 'public body');
});

// ── M2: CORS origin ─────────────────────────────────────────────────

test('M2: allowed origin gets ACAO header', async () => {
  const res = await request(app)
    .get('/api/posts')
    .set('Origin', 'http://localhost:5173');
  assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
});

test('M2: disallowed origin gets no ACAO header (browser blocks)', async () => {
  const res = await request(app)
    .get('/api/posts')
    .set('Origin', 'https://evil.example.com');
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  // Server still responds 200 — the defense is the missing header.
  assert.equal(res.status, 200);
});

// ── M3 / M4: auth edge cases at the router boundary ─────────────────

test('M3: wrong-length bearer → 401 (no crash)', async () => {
  const res = await request(app)
    .delete('/api/posts/anything')
    .set('Authorization', 'Bearer short');
  assert.equal(res.status, 401);
});

test('M3: empty bearer → 401', async () => {
  const res = await request(app)
    .delete('/api/posts/anything')
    .set('Authorization', 'Bearer ');
  assert.equal(res.status, 401);
});

// ── NEW-1: image route also hides draft hero ───────────────────────

test('NEW-1: draft hero image hidden from unauth callers', async () => {
  // Seed a draft and upload a hero image under its slug.
  const create = await request(app)
    .post('/api/posts')
    .set('Authorization', AUTH_HEADER)
    .send({ slug: 'draft-with-hero', title: 'D', content: 'b', isDraft: 1 });
  assert.equal(create.status, 201);

  const up = await request(app)
    .post('/api/images/upload')
    .set('Authorization', AUTH_HEADER)
    .send({ slug: 'draft-with-hero', filename: 'hero.png', data: 'aGVsbG8=' });
  assert.equal(up.status, 200);

  // Unauth caller: 404 (even though the file is on disk).
  const unauth = await request(app).get('/api/images/posts/draft-with-hero/hero.png');
  assert.equal(unauth.status, 404);

  // Auth caller: 200 with the bytes.
  const auth = await request(app)
    .get('/api/images/posts/draft-with-hero/hero.png')
    .set('Authorization', AUTH_HEADER);
  assert.equal(auth.status, 200);
  assert.equal(auth.body.toString(), 'hello');
});

test('NEW-1: published post hero stays public', async () => {
  const create = await request(app)
    .post('/api/posts')
    .set('Authorization', AUTH_HEADER)
    .send({ slug: 'public-with-hero', title: 'P', content: 'b', isDraft: 0 });
  assert.equal(create.status, 201);

  await request(app)
    .post('/api/images/upload')
    .set('Authorization', AUTH_HEADER)
    .send({ slug: 'public-with-hero', filename: 'hero.png', data: 'aGVsbG8=' });

  const res = await request(app).get('/api/images/posts/public-with-hero/hero.png');
  assert.equal(res.status, 200);
});

// ── Regression: normal upload + GET roundtrip ───────────────────────

test('Regression: normal slug round-trip (upload → GET)', async () => {
  const up = await request(app)
    .post('/api/images/upload')
    .set('Authorization', AUTH_HEADER)
    .send({ slug: 'roundtrip-post', filename: 'hero.png', data: 'aGVsbG8=' });
  assert.equal(up.status, 200);

  const dl = await request(app).get('/api/images/posts/roundtrip-post/hero.png');
  assert.equal(dl.status, 200);
  assert.equal(dl.headers['content-type'], 'image/png');
  assert.equal(dl.body.toString(), 'hello');
});

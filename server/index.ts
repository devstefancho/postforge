import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { resolve } from 'node:path';
import { initDb } from './db.js';
import { initStorage } from './storage.js';
import { postsRouter } from './routes/posts.js';
import { tagsRouter } from './routes/tags.js';
import { imagesRouter } from './routes/images.js';
import { assertApiKeyConfigured } from './auth.js';

const PORT = parseInt(process.env.PORT || '8788', 10);
const DATA_DIR = resolve(process.env.DATA_DIR || './data');

// M4: refuse to start with an unset / too-short API_SECRET_KEY. The auth
// middleware compares timing-safely against this; without a real key any
// `Authorization: Bearer ` (empty token) would have passed before.
assertApiKeyConfigured();

// Initialize database and storage
initDb(DATA_DIR);
initStorage(DATA_DIR);

const app = express();

// M2: restrict CORS to local origins. The Electron renderer loads editor.html
// via file:// (origin "null"), so we allow that plus localhost variants.
// Browsers will refuse any cross-origin fetch from arbitrary pages — closes
// the path where a malicious local dev page reads /api/posts?drafts=true.
const ALLOWED_ORIGINS = new Set([
  'http://localhost',
  'http://127.0.0.1',
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  'null', // file:// → Origin: null
]);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // same-origin / curl / Electron preload
    if (ALLOWED_ORIGINS.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      return cb(null, true);
    }
    // Don't throw — just omit the ACAO header. The browser refuses to expose
    // the response cross-origin, which is the actual defense.
    return cb(null, false);
  },
  credentials: false,
}));

// M5: route-scoped body limits. 50MB was a DoS surface for every endpoint;
// only the image upload route legitimately needs the headroom (base64 adds
// ~33% over the raw image), and posts/tags do not.
const postBodyLimit = express.json({ limit: '2mb' });
const imageBodyLimit = express.json({ limit: '20mb' });

// API routes — tags must come before posts (to avoid /tags matching /:slug)
app.use('/api/posts', postBodyLimit, tagsRouter);
app.use('/api/posts', postBodyLimit, postsRouter);
app.use('/api/images', imageBodyLimit, imagesRouter);

app.listen(PORT, () => {
  console.log(`PostForge server running at http://localhost:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});

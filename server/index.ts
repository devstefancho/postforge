import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { resolve } from 'node:path';
import { initDb } from './db.js';
import { initStorage } from './storage.js';
import { postsRouter } from './routes/posts.js';
import { tagsRouter } from './routes/tags.js';
import { imagesRouter } from './routes/images.js';

const PORT = parseInt(process.env.PORT || '8788', 10);
const DATA_DIR = resolve(process.env.DATA_DIR || './data');

// Initialize database and storage
initDb(DATA_DIR);
initStorage(DATA_DIR);

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// API routes — tags must come before posts (to avoid /tags matching /:slug)
app.use('/api/posts', tagsRouter);
app.use('/api/posts', postsRouter);
app.use('/api/images', imagesRouter);

app.listen(PORT, () => {
  console.log(`PostForge server running at http://localhost:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});

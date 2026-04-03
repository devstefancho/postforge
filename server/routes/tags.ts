import { Router } from 'express';
import { getDb } from '../db.js';

export const tagsRouter = Router();

// GET /api/posts/tags — List all unique tags
tagsRouter.get('/tags', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT tags FROM posts WHERE is_draft = 0').all() as { tags: string }[];

  const tagSet = new Set<string>();
  for (const row of rows) {
    const parsed = JSON.parse(row.tags || '[]');
    for (const tag of parsed) {
      tagSet.add(tag);
    }
  }

  res.json({ tags: [...tagSet].sort() });
});

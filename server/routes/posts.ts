import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../auth.js';
import { deleteImagesByPrefix } from '../storage.js';

export const postsRouter = Router();

// GET /api/posts — List posts
postsRouter.get('/', (req, res) => {
  const db = getDb();
  const category = req.query.category as string | undefined;
  const drafts = req.query.drafts === 'true';

  let query = 'SELECT id, slug, title, description, category, tags, hero_image, pub_date, is_draft FROM posts';
  const conditions: string[] = [];
  const binds: (string | number)[] = [];

  if (!drafts) {
    conditions.push('is_draft = 0');
  }
  if (category) {
    conditions.push('category = ?');
    binds.push(category);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY pub_date DESC';

  const rows = binds.length > 0
    ? db.prepare(query).all(...binds)
    : db.prepare(query).all();

  const posts = (rows as any[]).map(r => ({
    ...r,
    tags: JSON.parse(r.tags || '[]'),
    isDraft: r.is_draft === 1,
  }));

  res.json({ posts });
});

// GET /api/posts/:slug — Get single post
postsRouter.get('/:slug', (req, res) => {
  const db = getDb();
  const { slug } = req.params;

  const post = db.prepare('SELECT * FROM posts WHERE slug = ?').get(slug) as any;
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  res.json({
    post: {
      ...post,
      tags: JSON.parse(post.tags || '[]'),
      isDraft: post.is_draft === 1,
    },
  });
});

// POST /api/posts — Create or update post
postsRouter.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const { slug, title, description, content, category, tags, heroImage, isDraft } = req.body;

  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    res.status(400).json({ error: 'Invalid slug format' });
    return;
  }
  if (!title) {
    res.status(400).json({ error: 'Title is required' });
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const tagsJson = JSON.stringify(tags || []);
  const heroKey = heroImage || null;
  const draft = isDraft ? 1 : 0;

  const existing = db.prepare('SELECT id FROM posts WHERE slug = ?').get(slug);

  if (existing) {
    db.prepare(
      'UPDATE posts SET title = ?, description = ?, content = ?, category = ?, tags = ?, hero_image = ?, updated_date = ?, is_draft = ? WHERE slug = ?'
    ).run(title, description || '', content || '', category || 'blog', tagsJson, heroKey, today, draft, slug);

    res.json({ success: true, slug, isNew: false });
    return;
  }

  db.prepare(
    'INSERT INTO posts (slug, title, description, content, category, tags, hero_image, pub_date, is_draft) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(slug, title, description || '', content || '', category || 'blog', tagsJson, heroKey, today, draft);

  res.status(201).json({ success: true, slug, isNew: true });
});

// DELETE /api/posts/:slug — Delete post
postsRouter.delete('/:slug', requireAuth, (req, res) => {
  const db = getDb();
  const { slug } = req.params;

  const existing = db.prepare('SELECT id FROM posts WHERE slug = ?').get(slug);
  if (!existing) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  // Delete associated images
  deleteImagesByPrefix(`posts/${slug}`);

  // Delete revisions and post
  db.prepare('DELETE FROM post_revisions WHERE post_slug = ?').run(slug);
  db.prepare('DELETE FROM posts WHERE slug = ?').run(slug);

  res.json({ success: true });
});

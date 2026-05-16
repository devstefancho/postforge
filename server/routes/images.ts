import { Router } from 'express';
import { requireAuth, isAuthed } from '../auth.js';
import { putImage, getImage, isAllowedImageExt } from '../storage.js';
import { getDb } from '../db.js';

export const imagesRouter = Router();

// Must mirror the slug shape accepted by POST /api/posts so an upload can
// never produce a key the post writer cannot also produce.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// POST /api/images/upload — Upload image (base64)
imagesRouter.post('/upload', requireAuth, (req, res) => {
  const { slug, filename, data } = req.body;

  if (!slug || !filename || !data) {
    res.status(400).json({ error: 'slug, filename, data(base64) are required' });
    return;
  }

  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    res.status(400).json({ error: 'Invalid slug format' });
    return;
  }

  if (/[\/\\]|\.\./.test(filename)) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }

  // SVG and any other non-allowlisted format is rejected at the boundary —
  // SVG can carry executable script and there's no reason a blog hero needs
  // to be SVG.
  if (!isAllowedImageExt(filename)) {
    res.status(400).json({ error: 'Unsupported image type (png/jpg/jpeg/gif/webp only)' });
    return;
  }

  const key = `posts/${slug}/${filename}`;
  const buffer = Buffer.from(data, 'base64');
  putImage(key, buffer);

  res.json({
    success: true,
    key,
    url: `/api/images/${key}`,
  });
});

// GET /api/images/* — Serve image
imagesRouter.get('/*', (req, res) => {
  // Express's typed params don't expose the wildcard index cleanly; cast via
  // unknown to access the captured path tail.
  const key = (req.params as unknown as Record<string, string>)[0];
  if (!key) {
    res.status(404).send('Not found');
    return;
  }

  // NEW-1 / extends M1: hero images of draft posts live under
  // posts/<draft-slug>/hero.<ext>. Without this check, the same draft body
  // we gated in posts.ts would still leak its hero illustration through
  // the image route. Treat unauthed access to a draft's image directory as
  // 404 — same disclosure-hiding policy as the post body itself.
  const postMatch = key.match(/^posts\/([^/]+)\//);
  if (postMatch) {
    const slug = postMatch[1];
    const row = getDb()
      .prepare('SELECT is_draft FROM posts WHERE slug = ?')
      .get(slug) as { is_draft?: number } | undefined;
    if (row && row.is_draft === 1 && !isAuthed(req)) {
      res.status(404).send('Not found');
      return;
    }
  }

  const result = getImage(key);
  if (!result) {
    res.status(404).send('Not found');
    return;
  }

  res.set('Content-Type', result.contentType);
  res.set('Cache-Control', 'public, max-age=604800, immutable');
  res.send(result.buffer);
});

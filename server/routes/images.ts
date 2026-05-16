import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { putImage, getImage, isAllowedImageExt } from '../storage.js';

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
  const key = req.params[0] as string;
  if (!key) {
    res.status(404).send('Not found');
    return;
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

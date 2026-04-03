import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { putImage, getImage } from '../storage.js';

export const imagesRouter = Router();

// POST /api/images/upload — Upload image (base64)
imagesRouter.post('/upload', requireAuth, (req, res) => {
  const { slug, filename, data } = req.body;

  if (!slug || !filename || !data) {
    res.status(400).json({ error: 'slug, filename, data(base64) are required' });
    return;
  }

  if (/[\/\\]|\.\./.test(filename)) {
    res.status(400).json({ error: 'Invalid filename' });
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

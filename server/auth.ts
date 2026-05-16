import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';

const MIN_KEY_LEN = 16;

// M4: bail out at boot if the operator left API_SECRET_KEY empty or too
// short. Before this guard, the auth comparison would treat `Bearer `
// (empty token) as valid against an empty env var — silently turning the
// server into an open write API.
export function assertApiKeyConfigured(): void {
  const key = process.env.API_SECRET_KEY;
  if (typeof key !== 'string' || key.length < MIN_KEY_LEN) {
    throw new Error(
      `API_SECRET_KEY must be set to a value of at least ${MIN_KEY_LEN} characters before starting the server.`
    );
  }
}

// M3: timing-safe Bearer comparison so an attacker cannot extract the key
// one byte at a time from response latency.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = `Bearer ${process.env.API_SECRET_KEY ?? ''}`;
  const got = req.headers.authorization ?? '';

  // timingSafeEqual requires equal-length buffers (and would crash otherwise).
  // Length itself leaks via the early return, but the token length is fixed
  // per deployment so there's nothing to learn from it.
  if (typeof got !== 'string' || got.length !== expected.length) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (!timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// Side-effect-free check for handlers that branch on auth instead of
// short-circuiting (used by GET /api/posts/:slug to gate drafts without
// disclosing their existence to unauthenticated callers).
export function isAuthed(req: Request): boolean {
  const expected = `Bearer ${process.env.API_SECRET_KEY ?? ''}`;
  const got = req.headers.authorization ?? '';
  if (typeof got !== 'string' || got.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  } catch {
    return false;
  }
}

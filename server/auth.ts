import type { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.API_SECRET_KEY}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

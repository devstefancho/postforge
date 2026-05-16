import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth, isAuthed, assertApiKeyConfigured } from './auth.js';

function mockReq(authHeader?: string): Request {
  return { headers: { authorization: authHeader } } as unknown as Request;
}

function withEnv<T>(key: string, value: string | undefined, fn: () => T): T {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

// ── assertApiKeyConfigured ──────────────────────────────────────────

test('assertApiKeyConfigured throws when API_SECRET_KEY is unset', () => {
  withEnv('API_SECRET_KEY', undefined, () => {
    assert.throws(() => assertApiKeyConfigured(), /API_SECRET_KEY/);
  });
});

test('assertApiKeyConfigured throws on empty key', () => {
  withEnv('API_SECRET_KEY', '', () => {
    assert.throws(() => assertApiKeyConfigured(), /API_SECRET_KEY/);
  });
});

test('assertApiKeyConfigured throws on too-short key', () => {
  withEnv('API_SECRET_KEY', 'short', () => {
    assert.throws(() => assertApiKeyConfigured(), /at least/);
  });
});

test('assertApiKeyConfigured accepts a sufficient key', () => {
  withEnv('API_SECRET_KEY', 'a'.repeat(32), () => {
    assert.doesNotThrow(() => assertApiKeyConfigured());
  });
});

// ── requireAuth ─────────────────────────────────────────────────────

test('requireAuth rejects missing header', () => {
  withEnv('API_SECRET_KEY', 'a'.repeat(32), () => {
    const captured = { status: 0, body: undefined as unknown };
    const res = {
      status(c: number) { captured.status = c; return res; },
      json(b: unknown) { captured.body = b; return res; },
    } as unknown as Response;
    let nextCalled = false;
    requireAuth(mockReq(undefined), res, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(captured.status, 401);
    assert.equal(nextCalled, false);
  });
});

test('requireAuth rejects empty bearer when key is set', () => {
  withEnv('API_SECRET_KEY', 'a'.repeat(32), () => {
    const captured = { status: 0, body: undefined as unknown };
    const res = {
      status(c: number) { captured.status = c; return res; },
      json(b: unknown) { captured.body = b; return res; },
    } as unknown as Response;
    let nextCalled = false;
    requireAuth(mockReq('Bearer '), res, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(captured.status, 401);
    assert.equal(nextCalled, false);
  });
});

test('requireAuth rejects wrong key', () => {
  withEnv('API_SECRET_KEY', 'a'.repeat(32), () => {
    const captured = { status: 0, body: undefined as unknown };
    const res = {
      status(c: number) { captured.status = c; return res; },
      json(b: unknown) { captured.body = b; return res; },
    } as unknown as Response;
    let nextCalled = false;
    requireAuth(mockReq('Bearer ' + 'b'.repeat(32)), res, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(captured.status, 401);
    assert.equal(nextCalled, false);
  });
});

test('requireAuth accepts exact bearer match', () => {
  withEnv('API_SECRET_KEY', 'a'.repeat(32), () => {
    const captured = { status: 0 };
    const res = {
      status(c: number) { captured.status = c; return res; },
      json() { return res; },
    } as unknown as Response;
    let nextCalled = false;
    requireAuth(
      mockReq('Bearer ' + 'a'.repeat(32)),
      res,
      (() => { nextCalled = true; }) as NextFunction
    );
    assert.equal(nextCalled, true);
    assert.equal(captured.status, 0);
  });
});

test('requireAuth treats length-mismatched header as 401 (does not crash)', () => {
  withEnv('API_SECRET_KEY', 'a'.repeat(32), () => {
    const captured = { status: 0 };
    const res = {
      status(c: number) { captured.status = c; return res; },
      json() { return res; },
    } as unknown as Response;
    requireAuth(mockReq('Bearer short'), res, (() => {}) as NextFunction);
    assert.equal(captured.status, 401);
  });
});

// ── isAuthed (side-effect-free) ─────────────────────────────────────

test('isAuthed false when no header', () => {
  withEnv('API_SECRET_KEY', 'a'.repeat(32), () => {
    assert.equal(isAuthed(mockReq(undefined)), false);
  });
});

test('isAuthed true on exact match', () => {
  withEnv('API_SECRET_KEY', 'a'.repeat(32), () => {
    assert.equal(isAuthed(mockReq('Bearer ' + 'a'.repeat(32))), true);
  });
});

test('isAuthed false on wrong key', () => {
  withEnv('API_SECRET_KEY', 'a'.repeat(32), () => {
    assert.equal(isAuthed(mockReq('Bearer ' + 'b'.repeat(32))), false);
  });
});

test('isAuthed false on length mismatch (no crash)', () => {
  withEnv('API_SECRET_KEY', 'a'.repeat(32), () => {
    assert.equal(isAuthed(mockReq('Bearer short')), false);
  });
});

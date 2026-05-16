import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, rmdirSync } from 'node:fs';
import { join, dirname, extname, resolve, relative, isAbsolute } from 'node:path';

let imagesDir: string;

export function initStorage(dataDir: string) {
  imagesDir = join(dataDir, 'images');
  mkdirSync(imagesDir, { recursive: true });
}

// SVG is intentionally omitted. SVG payloads can carry <script> or `onload`
// handlers that execute when the image is opened directly or embedded in an
// <iframe>/<object>. Keeping it out of the served MIME map means even if a
// `.svg` lands on disk the server will not advertise it as renderable XML —
// it'll come back as application/octet-stream which browsers download
// instead of executing. The upload path (isAllowedImageExt) refuses the
// extension up-front so this is just a belt-and-braces layer.
const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

// Mirror MIME_TYPES so callers can validate before reaching storage.
const ALLOWED_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

export function isAllowedImageExt(filename: string): boolean {
  return ALLOWED_IMAGE_EXTS.has(extname(filename).toLowerCase());
}

// Resolve `key` to an absolute path inside imagesDir. Returns null when the
// resolved path escapes imagesDir — defends against `../` traversal in raw
// or URL-encoded form. Express decodes %2e%2e/%2f into `..`/`/` before
// handing params to handlers, so the literal `..` is what arrives here.
function safeFilePath(key: string): string | null {
  if (typeof key !== 'string' || key.length === 0) return null;
  const filePath = resolve(imagesDir, key);
  const rel = relative(imagesDir, filePath);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return filePath;
}

// Exposed only for unit tests — production code goes through the storage
// functions which apply the same guard.
export const _internal = { safeFilePath };

export function putImage(key: string, buffer: Buffer): void {
  const filePath = safeFilePath(key);
  if (!filePath) throw new Error(`invalid image key: ${JSON.stringify(key)}`);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, buffer);
}

export function getImage(key: string): { buffer: Buffer; contentType: string } | null {
  const filePath = safeFilePath(key);
  if (!filePath) return null;
  if (!existsSync(filePath)) return null;
  const buffer = readFileSync(filePath);
  const ext = extname(key).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  return { buffer, contentType };
}

export function listImages(prefix: string): string[] {
  const dir = safeFilePath(prefix);
  if (!dir) return [];
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter(f => statSync(join(dir, f)).isFile())
      .map(f => join(prefix, f));
  } catch {
    return [];
  }
}

export function deleteImage(key: string): void {
  const filePath = safeFilePath(key);
  if (!filePath) return;
  if (existsSync(filePath)) unlinkSync(filePath);
}

export function deleteImagesByPrefix(prefix: string): void {
  const dir = safeFilePath(prefix);
  if (!dir) return;
  const keys = listImages(prefix);
  for (const key of keys) {
    deleteImage(key);
  }
  if (existsSync(dir)) {
    try { rmdirSync(dir); } catch { /* not empty, ignore */ }
  }
}

export function getMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, rmdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';

let imagesDir: string;

export function initStorage(dataDir: string) {
  imagesDir = join(dataDir, 'images');
  mkdirSync(imagesDir, { recursive: true });
}

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export function putImage(key: string, buffer: Buffer): void {
  const filePath = join(imagesDir, key);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, buffer);
}

export function getImage(key: string): { buffer: Buffer; contentType: string } | null {
  const filePath = join(imagesDir, key);
  if (!existsSync(filePath)) return null;
  const buffer = readFileSync(filePath);
  const ext = extname(key).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  return { buffer, contentType };
}

export function listImages(prefix: string): string[] {
  const dir = join(imagesDir, prefix);
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
  const filePath = join(imagesDir, key);
  if (existsSync(filePath)) unlinkSync(filePath);
}

export function deleteImagesByPrefix(prefix: string): void {
  const keys = listImages(prefix);
  for (const key of keys) {
    deleteImage(key);
  }
  // Remove the directory if empty
  const dir = join(imagesDir, prefix);
  if (existsSync(dir)) {
    try { rmdirSync(dir); } catch { /* not empty, ignore */ }
  }
}

export function getMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

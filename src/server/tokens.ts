import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanAssetName } from '../shared/validate.js';
import type { AppDatabase, CatalogToken } from './db.js';
import { sniffImage } from './files.js';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

export function bundledTokenDir(): string {
  const beside = fileURLToPath(new URL('../../assets/tokens/', import.meta.url));
  if (existsSync(beside)) return beside;
  return join(process.cwd(), 'assets', 'tokens');
}

export function tokenDisplayName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/i, '');
  const spaced = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleanAssetName(spaced);
}

export function loadDefaultTokens(db: AppDatabase, filesDir: string, dir = bundledTokenDir()): CatalogToken[] {
  mkdirSync(filesDir, { recursive: true });
  if (existsSync(dir)) {
    const names = readdirSync(dir)
      .filter((name) => IMAGE_EXT.test(name))
      .sort();
    for (const filename of names) {
      const bytes = readFileSync(join(dir, filename));
      const mime = sniffImage(bytes);
      if (!mime) continue;
      const existing = db.findDefaultToken(filename);
      if (existing) {
        const stored = join(filesDir, existing.fileId);
        if (!existsSync(stored)) writeFileSync(stored, bytes);
        continue;
      }
      const fileId = randomUUID();
      if (!db.insertDefaultToken(filename, fileId, tokenDisplayName(filename), mime)) continue;
      writeFileSync(join(filesDir, fileId), bytes);
    }
  }
  return db.listDefaultTokens();
}

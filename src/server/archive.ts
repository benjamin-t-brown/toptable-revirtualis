import { strToU8, unzipSync, zipSync } from 'fflate';
import { MAX_ARCHIVE_BYTES, parseRoomArchive, type RoomArchive } from '../shared/archive.js';
import { isId } from '../shared/validate.js';
import { maxUploadBytes } from './files.js';

const FILE_ENTRY = /^files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function packRoom(archive: RoomArchive, files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    'room.json': strToU8(JSON.stringify(archive)),
  };
  for (const [id, bytes] of files) entries[`files/${id}`] = bytes;
  return zipSync(entries);
}

export function unpackRoom(bytes: Uint8Array): { ok: true; archive: RoomArchive; files: Map<string, Buffer> } | { ok: false; error: string } {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) return { ok: false, error: 'Archive is too large' };
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return { ok: false, error: 'Archive could not be read' };
  }
  const names = Object.keys(entries);
  if (names.length > 301) return { ok: false, error: 'Archive has too many files' };
  let total = 0;
  const files = new Map<string, Buffer>();
  let manifest: Uint8Array | null = null;
  for (const name of names) {
    const data = entries[name];
    if (!data) return { ok: false, error: 'Archive could not be read' };
    total += data.byteLength;
    if (total > MAX_ARCHIVE_BYTES) return { ok: false, error: 'Archive is too large' };
    if (name === 'room.json') {
      manifest = data;
      continue;
    }
    const match = FILE_ENTRY.exec(name);
    if (!match?.[1] || !isId(match[1])) return { ok: false, error: 'Archive entry is not allowed' };
    if (data.byteLength > maxUploadBytes()) return { ok: false, error: 'Archive file is larger than 8 MB' };
    files.set(match[1], Buffer.from(data));
  }
  if (!manifest) return { ok: false, error: 'Archive is missing room.json' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(manifest)) as unknown;
  } catch {
    return { ok: false, error: 'Archive could not be read' };
  }
  const archive = parseRoomArchive(parsed);
  if (!archive.ok) return archive;
  for (const asset of archive.archive.assets) {
    const file = files.get(asset.id);
    if (asset.source) {
      if (file) return { ok: false, error: 'Archive entry is not allowed' };
      continue;
    }
    if (!file) return { ok: false, error: 'Archive is missing an uploaded file' };
  }
  for (const id of files.keys()) {
    if (!archive.archive.assets.some((asset) => asset.id === id && !asset.source)) {
      return { ok: false, error: 'Archive entry is not allowed' };
    }
  }
  return { ok: true, archive: archive.archive, files };
}

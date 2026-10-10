import './warnings.js';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { sceneBoard, type Asset, type AssetClass, type FogShape, type ImageFrame, type Placement, type Role, type RoomState, type Scene } from '../shared/types.js';
import { parseImageFrame } from '../shared/validate.js';

export interface StoredSession {
  token: string;
  roomId: string;
  name: string;
  role: Role;
}

export interface StoredRoom {
  id: string;
  dmKeyHash: string;
  state: RoomState;
}

export interface AssetRecord {
  roomId: string;
  mime: string;
  fileId: string | null;
}

export interface CatalogToken {
  fileId: string;
  name: string;
  mime: string;
}

function text(value: SQLOutputValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: SQLOutputValue | undefined): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function nullableText(value: SQLOutputValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : null;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function parsePoints(value: string): { x: number; y: number }[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const points: { x: number; y: number }[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') return [];
      const point = item as { x?: unknown; y?: unknown };
      if (typeof point.x !== 'number' || typeof point.y !== 'number') return [];
      points.push({ x: point.x, y: point.y });
    }
    return points;
  } catch {
    return [];
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  dm_key_hash TEXT NOT NULL,
  active_scene_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  name TEXT NOT NULL,
  class TEXT NOT NULL,
  mime TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  file_id TEXT,
  folder TEXT
);
CREATE TABLE IF NOT EXISTS default_tokens (
  source TEXT PRIMARY KEY,
  file_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  name TEXT NOT NULL,
  map_asset_id TEXT,
  background_asset_id TEXT,
  background_color TEXT NOT NULL,
  fog_enabled INTEGER NOT NULL,
  sort_index INTEGER NOT NULL,
  width REAL NOT NULL DEFAULT 5000,
  height REAL NOT NULL DEFAULT 5000,
  map_frame TEXT,
  background_frame TEXT
);
CREATE TABLE IF NOT EXISTS placements (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  w REAL NOT NULL,
  h REAL NOT NULL,
  rotation REAL NOT NULL,
  layer INTEGER NOT NULL,
  owners TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS fog_shapes (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  mode TEXT NOT NULL,
  points TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  w REAL NOT NULL,
  h REAL NOT NULL,
  sort_index INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_room ON sessions(room_id);
CREATE INDEX IF NOT EXISTS idx_assets_room ON assets(room_id);
CREATE INDEX IF NOT EXISTS idx_scenes_room ON scenes(room_id);
CREATE INDEX IF NOT EXISTS idx_placements_scene ON placements(scene_id);
CREATE INDEX IF NOT EXISTS idx_fog_scene ON fog_shapes(scene_id);
`;

function frameText(frame: ImageFrame | null): string | null {
  return frame ? JSON.stringify(frame) : null;
}

function readFrame(value: SQLOutputValue | undefined): ImageFrame | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const parsed = parseImageFrame(JSON.parse(value));
    return parsed ?? null;
  } catch {
    return null;
  }
}

function ensureSceneBoardColumns(db: DatabaseSync): void {
  const names = new Set(db.prepare('PRAGMA table_info(scenes)').all().map((row) => text(row.name)));
  if (!names.has('width')) db.exec('ALTER TABLE scenes ADD COLUMN width REAL NOT NULL DEFAULT 5000');
  if (!names.has('height')) db.exec('ALTER TABLE scenes ADD COLUMN height REAL NOT NULL DEFAULT 5000');
  if (!names.has('map_frame')) db.exec('ALTER TABLE scenes ADD COLUMN map_frame TEXT');
  if (!names.has('background_frame')) db.exec('ALTER TABLE scenes ADD COLUMN background_frame TEXT');
}

function ensurePlacementLabelColumn(db: DatabaseSync): void {
  const names = new Set(db.prepare('PRAGMA table_info(placements)').all().map((row) => text(row.name)));
  if (!names.has('label')) db.exec("ALTER TABLE placements ADD COLUMN label TEXT NOT NULL DEFAULT ''");
}

function ensureAssetFileColumn(db: DatabaseSync): void {
  const names = new Set(db.prepare('PRAGMA table_info(assets)').all().map((row) => text(row.name)));
  if (!names.has('file_id')) db.exec('ALTER TABLE assets ADD COLUMN file_id TEXT');
  if (!names.has('folder')) db.exec('ALTER TABLE assets ADD COLUMN folder TEXT');
}

export class AppDatabase {
  readonly raw: DatabaseSync;

  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA busy_timeout = 3000');
    this.raw.exec(SCHEMA);
    ensureSceneBoardColumns(this.raw);
    ensurePlacementLabelColumn(this.raw);
    ensureAssetFileColumn(this.raw);
  }

  close(): void {
    this.raw.close();
  }

  transaction(fn: () => void): void {
    this.raw.exec('BEGIN');
    try {
      fn();
      this.raw.exec('COMMIT');
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }

  codeTaken(code: string): boolean {
    const row = this.raw.prepare('SELECT 1 AS hit FROM rooms WHERE code = ?').get(code);
    return row !== undefined;
  }

  insertRoom(room: StoredRoom, scene: Scene): void {
    const now = Date.now();
    this.transaction(() => {
      this.raw
        .prepare('INSERT INTO rooms (id, code, dm_key_hash, active_scene_id, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(room.id, room.state.code, room.dmKeyHash, scene.id, now);
      this.insertScene(room.id, scene);
    });
  }

  insertScene(roomId: string, scene: Scene): void {
    this.raw
      .prepare(
        `INSERT INTO scenes (id, room_id, name, map_asset_id, background_asset_id, background_color, fog_enabled, sort_index, width, height, map_frame, background_frame)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        scene.id,
        roomId,
        scene.name,
        scene.mapAssetId,
        scene.backgroundAssetId,
        scene.backgroundColor,
        scene.fogEnabled ? 1 : 0,
        scene.sortIndex,
        scene.width,
        scene.height,
        frameText(scene.mapFrame),
        frameText(scene.backgroundFrame),
      );
  }

  insertSession(session: StoredSession): void {
    this.raw
      .prepare('INSERT INTO sessions (token, room_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(session.token, session.roomId, session.name, session.role, Date.now());
  }

  getSession(token: string): StoredSession | null {
    const row = this.raw.prepare('SELECT token, room_id, name, role FROM sessions WHERE token = ?').get(token);
    if (!row) return null;
    const role = text(row.role);
    if (role !== 'dm' && role !== 'player') return null;
    return { token: text(row.token), roomId: text(row.room_id), name: text(row.name), role };
  }

  deleteSession(token: string): void {
    this.raw.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  deleteRole(roomId: string, role: Role): void {
    this.raw.prepare('DELETE FROM sessions WHERE room_id = ? AND role = ?').run(roomId, role);
  }

  deletePlayerNamed(roomId: string, name: string): void {
    this.raw.prepare('DELETE FROM sessions WHERE room_id = ? AND role = ? AND name = ?').run(roomId, 'player', name);
  }

  dmNames(roomId: string): string[] {
    const rows = this.raw.prepare('SELECT name FROM sessions WHERE room_id = ? AND role = ?').all(roomId, 'dm');
    return rows.map((row) => text(row.name));
  }

  loadRoom(code: string): StoredRoom | null {
    const room = this.raw
      .prepare('SELECT id, code, dm_key_hash, active_scene_id FROM rooms WHERE code = ?')
      .get(code);
    if (!room) return null;
    return this.hydrate(text(room.id), text(room.code), text(room.dm_key_hash), nullableText(room.active_scene_id));
  }

  loadRoomById(id: string): StoredRoom | null {
    const room = this.raw.prepare('SELECT id, code, dm_key_hash, active_scene_id FROM rooms WHERE id = ?').get(id);
    if (!room) return null;
    return this.hydrate(text(room.id), text(room.code), text(room.dm_key_hash), nullableText(room.active_scene_id));
  }

  private hydrate(id: string, code: string, dmKeyHash: string, activeSceneId: string | null): StoredRoom {
    const assets = this.raw
      .prepare('SELECT id, name, class, mime, folder FROM assets WHERE room_id = ?')
      .all(id)
      .map((row) => this.assetRow(row));
    const scenes = this.raw
      .prepare(
        'SELECT id, name, map_asset_id, background_asset_id, background_color, fog_enabled, sort_index, width, height, map_frame, background_frame FROM scenes WHERE room_id = ?',
      )
      .all(id)
      .map((row) => this.sceneRow(row));
    const placements = this.raw
      .prepare(
        `SELECT id, scene_id, asset_id, x, y, w, h, rotation, layer, owners, label FROM placements
         WHERE scene_id IN (SELECT id FROM scenes WHERE room_id = ?)`,
      )
      .all(id)
      .map((row) => this.placementRow(row));
    const fog = this.raw
      .prepare(
        `SELECT id, scene_id, kind, mode, points, x, y, w, h, sort_index FROM fog_shapes
         WHERE scene_id IN (SELECT id FROM scenes WHERE room_id = ?)`,
      )
      .all(id)
      .map((row) => this.fogRow(row));
    const state: RoomState = { code, activeSceneId, assets, scenes, placements, fog };
    return { id, dmKeyHash, state };
  }

  private assetRow(row: Record<string, SQLOutputValue>): Asset {
    const assetClass = text(row.class);
    const known: AssetClass[] = ['map', 'token', 'background', 'prop', 'sound'];
    const cls = known.find((item) => item === assetClass) ?? 'prop';
    const folder = nullableText(row.folder);
    return folder
      ? { id: text(row.id), name: text(row.name), class: cls, mime: text(row.mime), folder }
      : { id: text(row.id), name: text(row.name), class: cls, mime: text(row.mime) };
  }

  private sceneRow(row: Record<string, SQLOutputValue>): Scene {
    const board = sceneBoard({ width: numberValue(row.width), height: numberValue(row.height) });
    return {
      id: text(row.id),
      name: text(row.name),
      mapAssetId: nullableText(row.map_asset_id),
      backgroundAssetId: nullableText(row.background_asset_id),
      backgroundColor: text(row.background_color) || '#000000',
      fogEnabled: numberValue(row.fog_enabled) === 1,
      width: board.width,
      height: board.height,
      sortIndex: numberValue(row.sort_index),
      mapFrame: readFrame(row.map_frame),
      backgroundFrame: readFrame(row.background_frame),
    };
  }

  private placementRow(row: Record<string, SQLOutputValue>): Placement {
    return {
      id: text(row.id),
      sceneId: text(row.scene_id),
      assetId: text(row.asset_id),
      x: numberValue(row.x),
      y: numberValue(row.y),
      w: numberValue(row.w),
      h: numberValue(row.h),
      rotation: numberValue(row.rotation),
      layer: numberValue(row.layer),
      label: text(row.label),
      owners: parseStringArray(text(row.owners)),
    };
  }

  private fogRow(row: Record<string, SQLOutputValue>): FogShape {
    const kind = text(row.kind);
    const mode = text(row.mode);
    return {
      id: text(row.id),
      sceneId: text(row.scene_id),
      kind: kind === 'polygon' || kind === 'ellipse' ? kind : 'rect',
      mode: mode === 'cover' ? 'cover' : 'reveal',
      points: parsePoints(text(row.points)),
      x: numberValue(row.x),
      y: numberValue(row.y),
      w: numberValue(row.w),
      h: numberValue(row.h),
      sortIndex: numberValue(row.sort_index),
    };
  }

  getAsset(id: string): (AssetRecord & { id: string }) | null {
    const row = this.raw.prepare('SELECT id, room_id, mime, file_id FROM assets WHERE id = ?').get(id);
    if (!row) return null;
    return { id: text(row.id), roomId: text(row.room_id), mime: text(row.mime), fileId: nullableText(row.file_id) };
  }

  findDefaultToken(source: string): { fileId: string } | null {
    const row = this.raw.prepare('SELECT file_id FROM default_tokens WHERE source = ?').get(source);
    if (!row) return null;
    return { fileId: text(row.file_id) };
  }

  insertDefaultToken(source: string, fileId: string, name: string, mime: string): boolean {
    const result = this.raw
      .prepare(
        `INSERT INTO default_tokens (source, file_id, name, mime) VALUES (?, ?, ?, ?)
         ON CONFLICT(source) DO NOTHING`,
      )
      .run(source, fileId, name, mime);
    return result.changes > 0;
  }

  listDefaultTokens(): CatalogToken[] {
    return this.raw
      .prepare('SELECT file_id, name, mime FROM default_tokens ORDER BY name')
      .all()
      .map((row) => ({ fileId: text(row.file_id), name: text(row.name), mime: text(row.mime) }));
  }

  sharedAssetIds(roomId: string): string[] {
    return this.raw
      .prepare('SELECT id FROM assets WHERE room_id = ? AND file_id IS NOT NULL')
      .all(roomId)
      .map((row) => text(row.id));
  }

  seedDefaultTokens(roomId: string, tokens: readonly CatalogToken[]): Asset[] {
    const insert = this.raw.prepare(
      `INSERT INTO assets (id, room_id, name, class, mime, created_at, file_id) VALUES (?, ?, ?, 'token', ?, ?, ?)`,
    );
    const now = Date.now();
    const assets: Asset[] = [];
    this.transaction(() => {
      for (const token of tokens) {
        const id = randomUUID();
        insert.run(id, roomId, token.name, token.mime, now, token.fileId);
        assets.push({ id, name: token.name, class: 'token', mime: token.mime });
      }
    });
    assets.sort((a, b) => a.name.localeCompare(b.name));
    return assets;
  }

  deleteRoom(roomId: string): void {
    this.transaction(() => {
      this.raw
        .prepare('DELETE FROM placements WHERE scene_id IN (SELECT id FROM scenes WHERE room_id = ?)')
        .run(roomId);
      this.raw
        .prepare('DELETE FROM fog_shapes WHERE scene_id IN (SELECT id FROM scenes WHERE room_id = ?)')
        .run(roomId);
      this.raw.prepare('DELETE FROM scenes WHERE room_id = ?').run(roomId);
      this.raw.prepare('DELETE FROM assets WHERE room_id = ?').run(roomId);
      this.raw.prepare('DELETE FROM sessions WHERE room_id = ?').run(roomId);
      this.raw.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
    });
  }
}

export function openDatabase(file: string): AppDatabase {
  return new AppDatabase(file);
}

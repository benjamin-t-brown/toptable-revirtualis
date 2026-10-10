import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../src/server/db.js';
import { persistOps } from '../src/server/persist.js';
import { blankScene } from '../src/shared/reduce.js';

const dirs: string[] = [];

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'toptable-db-'));
  dirs.push(dir);
  return join(dir, 'room.sqlite');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('scene board persistence', () => {
  it('loads a scene saved before board size existed as 5000 by 5000', () => {
    const file = tempFile();
    const raw = new DatabaseSync(file);
    raw.exec(`
      CREATE TABLE rooms (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        dm_key_hash TEXT NOT NULL,
        active_scene_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE scenes (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        name TEXT NOT NULL,
        map_asset_id TEXT,
        background_asset_id TEXT,
        background_color TEXT NOT NULL,
        fog_enabled INTEGER NOT NULL,
        sort_index INTEGER NOT NULL
      );
    `);
    raw
      .prepare('INSERT INTO rooms (id, code, dm_key_hash, active_scene_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('room', 'ROOM12', 'hash', 'scene-1', 1);
    raw
      .prepare(
        `INSERT INTO scenes (id, room_id, name, map_asset_id, background_asset_id, background_color, fog_enabled, sort_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('scene-1', 'room', 'Scene 1', null, null, '#2a3824', 0, 0);
    raw.close();

    const db = openDatabase(file);
    const loaded = db.loadRoom('ROOM12');
    expect(loaded?.state.scenes[0]).toMatchObject({ width: 5000, height: 5000 });
    db.close();
  });

  it('persists a custom board size', () => {
    const db: AppDatabase = openDatabase(tempFile());
    const scene = { ...blankScene('scene-1', 'Scene 1', 0), width: 800, height: 600 };
    db.insertRoom(
      {
        id: 'room',
        dmKeyHash: 'hash',
        state: { code: 'ROOM12', activeSceneId: scene.id, assets: [], scenes: [scene], placements: [], fog: [] },
      },
      scene,
    );
    expect(db.loadRoom('ROOM12')?.state.scenes[0]).toMatchObject({
      width: 800,
      height: 600,
      backgroundColor: '#000000',
    });
    const nextScene = { ...scene, width: 1500, height: 900 };
    persistOps(
      db.raw,
      'room',
      [{ type: 'scene.upsert', scene: nextScene }],
      { code: 'ROOM12', activeSceneId: scene.id, assets: [], scenes: [nextScene], placements: [], fog: [] },
    );
    expect(db.loadRoom('ROOM12')?.state.scenes[0]).toMatchObject({ width: 1500, height: 900 });
    const framed = {
      ...nextScene,
      mapFrame: { x: 5, y: 6, w: 700, h: 400, rotation: 1 },
      backgroundFrame: null,
    };
    persistOps(
      db.raw,
      'room',
      [{ type: 'scene.upsert', scene: framed }],
      { code: 'ROOM12', activeSceneId: scene.id, assets: [], scenes: [framed], placements: [], fog: [] },
    );
    expect(db.loadRoom('ROOM12')?.state.scenes[0]?.mapFrame).toEqual(framed.mapFrame);
    db.close();
  });
});

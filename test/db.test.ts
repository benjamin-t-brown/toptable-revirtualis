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
    expect(loaded?.state.scenes[0]).toMatchObject({ width: 5000, height: 5000, rulerUnit: 'ft', rulerScale: 1 });
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
    const measured = { ...framed, rulerUnit: 'm' as const, rulerScale: 25 };
    persistOps(
      db.raw,
      'room',
      [{ type: 'scene.upsert', scene: measured }],
      { code: 'ROOM12', activeSceneId: scene.id, assets: [], scenes: [measured], placements: [], fog: [] },
    );
    expect(db.loadRoom('ROOM12')?.state.scenes[0]).toMatchObject({ rulerUnit: 'm', rulerScale: 25 });
    db.close();
  });

  it('persists a token label and fills a blank one on older rows', () => {
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
      CREATE TABLE placements (
        id TEXT PRIMARY KEY,
        scene_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        w REAL NOT NULL,
        h REAL NOT NULL,
        rotation REAL NOT NULL,
        layer INTEGER NOT NULL,
        owners TEXT NOT NULL
      );
    `);
    raw.prepare('INSERT INTO rooms (id, code, dm_key_hash, active_scene_id, created_at) VALUES (?, ?, ?, ?, ?)').run('room', 'ROOM12', 'hash', 'scene-1', 1);
    raw
      .prepare(
        `INSERT INTO scenes (id, room_id, name, map_asset_id, background_asset_id, background_color, fog_enabled, sort_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('scene-1', 'room', 'Scene 1', null, null, '#000000', 0, 0);
    raw
      .prepare(
        `INSERT INTO placements (id, scene_id, asset_id, x, y, w, h, rotation, layer, owners)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('old', 'scene-1', 'asset', 0, 0, 64, 64, 0, 1, '[]');
    raw.close();

    const db = openDatabase(file);
    expect(db.loadRoom('ROOM12')?.state.placements[0]?.label).toBe('');
    const scene = blankScene('scene-1', 'Scene 1', 0);
    const placement = {
      id: 'old',
      sceneId: scene.id,
      assetId: 'asset',
      x: 0,
      y: 0,
      w: 64,
      h: 64,
      rotation: 0,
      layer: 1,
      label: 'Goblin',
      owners: [] as string[],
    };
    persistOps(
      db.raw,
      'room',
      [{ type: 'place.upsert', placement }],
      { code: 'ROOM12', activeSceneId: scene.id, assets: [], scenes: [scene], placements: [placement], fog: [] },
    );
    expect(db.loadRoom('ROOM12')?.state.placements[0]?.label).toBe('Goblin');
    db.close();
  });

  it('skips the active-scene write when that id did not change', () => {
    const db = openDatabase(tempFile());
    const scene = blankScene('scene-1', 'Scene 1', 0);
    db.insertRoom(
      {
        id: 'room',
        dmKeyHash: 'hash',
        state: { code: 'ROOM12', activeSceneId: scene.id, assets: [], scenes: [scene], placements: [], fog: [] },
      },
      scene,
    );
    const previous = db.loadRoom('ROOM12')?.state;
    expect(previous?.activeSceneId).toBe(scene.id);
    if (!previous) return;
    db.raw.prepare('UPDATE rooms SET active_scene_id = ? WHERE id = ?').run('other', 'room');
    persistOps(
      db.raw,
      'room',
      [{ type: 'ping', id: '11111111-1111-1111-1111-111111111111', sceneId: scene.id, x: 1, y: 2, name: 'DM' }],
      previous,
      previous,
    );
    const skipped = db.raw.prepare('SELECT active_scene_id FROM rooms WHERE id = ?').get('room') as { active_scene_id: string };
    expect(skipped.active_scene_id).toBe('other');
    persistOps(db.raw, 'room', [{ type: 'scene.activate', sceneId: scene.id }], { ...previous, activeSceneId: 'scene-2' }, previous);
    const written = db.raw.prepare('SELECT active_scene_id FROM rooms WHERE id = ?').get('room') as { active_scene_id: string };
    expect(written.active_scene_id).toBe('scene-2');
    db.close();
  });
});

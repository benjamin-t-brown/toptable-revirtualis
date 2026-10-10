import { describe, expect, it } from 'vitest';
import { applyServerOp, blankScene, emptyRoom, materialize } from '../src/shared/reduce.js';
import type { Asset, RoomState } from '../src/shared/types.js';

function ids() {
  let n = 0;
  return { next: () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}` };
}

function base(): RoomState {
  const scene = blankScene('scene-1', 'Scene 1', 0);
  const token: Asset = { id: 'token-1', name: 'Hero', class: 'token', mime: 'image/png' };
  const map: Asset = { id: 'map-1', name: 'Cave', class: 'map', mime: 'image/png' };
  return {
    ...emptyRoom('ROOM12'),
    activeSceneId: scene.id,
    scenes: [{ ...scene, mapAssetId: map.id }],
    assets: [token, map],
    placements: [
      {
        id: 'place-1',
        sceneId: scene.id,
        assetId: token.id,
        x: 10,
        y: 20,
        w: 64,
        h: 64,
        rotation: 0,
        layer: 1,
        owners: ['Ada'],
      },
    ],
    fog: [
      {
        id: 'fog-1',
        sceneId: scene.id,
        kind: 'rect',
        mode: 'reveal',
        points: [],
        x: 0,
        y: 0,
        w: 30,
        h: 40,
        sortIndex: 0,
      },
    ],
  };
}

describe('room reducer', () => {
  it('copies a token to the cursor with its size and rotation', () => {
    const state = base();
    const source = state.placements[0];
    if (!source) return;
    source.w = 120;
    source.h = 80;
    source.rotation = 0.4;
    const made = materialize(state, { type: 'place.copy', placementId: 'place-1', x: 200, y: 150 }, ids());
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const op = made.ops[0];
    expect(op?.type).toBe('place.upsert');
    if (op?.type !== 'place.upsert') return;
    expect(op.placement).toMatchObject({
      assetId: 'token-1',
      x: 140,
      y: 110,
      w: 120,
      h: 80,
      rotation: 0.4,
      layer: 2,
      owners: ['Ada'],
    });
    op.placement.owners.push('Bea');
    expect(source.owners).toEqual(['Ada']);
  });

  it('places a token centered on the click', () => {
    const made = materialize(base(), { type: 'place.add', sceneId: 'scene-1', assetId: 'token-1', x: 100, y: 80 }, ids());
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const op = made.ops[0];
    expect(op?.type).toBe('place.upsert');
    if (op?.type !== 'place.upsert') return;
    expect(op.placement.x).toBe(68);
    expect(op.placement.y).toBe(48);
    expect(op.placement.w).toBe(64);
    expect(op.placement.owners).toEqual([]);
  });

  it('turns fog on and normalizes a dragged rectangle', () => {
    const state = base();
    state.scenes[0]!.fogEnabled = false;
    const made = materialize(
      state,
      { type: 'fog.add', sceneId: 'scene-1', kind: 'rect', mode: 'reveal', points: [], x: 20, y: 10, w: -12, h: 8 },
      ids(),
    );
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.ops[0]).toMatchObject({ type: 'scene.upsert', scene: { fogEnabled: true } });
    expect(made.ops[1]).toMatchObject({ type: 'fog.upsert', shape: { x: 8, y: 10, w: 12, h: 8, mode: 'reveal' } });
  });

  it('deletes a scene and the pieces on it', () => {
    let state = base();
    const extra = blankScene('scene-2', 'Scene 2', 1);
    state = { ...state, scenes: state.scenes.concat(extra) };
    const made = materialize(state, { type: 'scene.delete', sceneId: 'scene-1' }, ids());
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const next = made.ops.reduce(applyServerOp, state);
    expect(next.scenes.map((scene) => scene.id)).toEqual(['scene-2']);
    expect(next.activeSceneId).toBe('scene-2');
    expect(next.placements).toEqual([]);
    expect(next.fog).toEqual([]);
  });

  it('removes an asset from the map and from placements', () => {
    const next = applyServerOp(base(), { type: 'asset.remove', assetId: 'map-1' });
    expect(next.assets.map((asset) => asset.id)).toEqual(['token-1']);
    expect(next.scenes[0]?.mapAssetId).toBeNull();
    const cleared = applyServerOp(base(), { type: 'asset.remove', assetId: 'token-1' });
    expect(cleared.placements).toEqual([]);
  });

  it('starts each scene as a 5000 by 5000 black board', () => {
    const scene = blankScene('scene-1', 'Scene 1', 0);
    expect(scene).toMatchObject({ width: 5000, height: 5000, backgroundColor: '#000000' });
  });

  it('stores board size on the scene and clamps it into range', () => {
    const state = base();
    const made = materialize(state, { type: 'scene.update', sceneId: 'scene-1', width: 12000, height: 10 }, ids());
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const next = made.ops.reduce(applyServerOp, state);
    expect(next.scenes[0]).toMatchObject({ width: 12000, height: 256 });
    const high = materialize(next, { type: 'scene.update', sceneId: 'scene-1', width: 999999, height: 4000.4 }, ids());
    expect(high.ok).toBe(true);
    if (!high.ok) return;
    const sized = high.ops.reduce(applyServerOp, next);
    expect(sized.scenes[0]).toMatchObject({ width: 20000, height: 4000 });
  });

  it('keeps board size when another scene field changes and when the scene is copied', () => {
    const state = base();
    state.scenes[0]!.width = 4000;
    state.scenes[0]!.height = 3000;
    const renamed = materialize(state, { type: 'scene.update', sceneId: 'scene-1', name: 'Cave' }, ids());
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.ops[0]).toMatchObject({ type: 'scene.upsert', scene: { name: 'Cave', width: 4000, height: 3000 } });
    const made = materialize(state, { type: 'scene.duplicate', sceneId: 'scene-1' }, ids());
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const next = made.ops.reduce(applyServerOp, state);
    const copy = next.scenes.find((scene) => scene.id !== 'scene-1');
    expect(copy).toMatchObject({ width: 4000, height: 3000 });
  });

  it('copies a scene without sharing owner arrays', () => {
    const state = base();
    const made = materialize(state, { type: 'scene.duplicate', sceneId: 'scene-1' }, ids());
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const next = made.ops.reduce(applyServerOp, state);
    expect(next.scenes).toHaveLength(2);
    expect(next.placements).toHaveLength(2);
    expect(next.fog).toHaveLength(2);
    expect(next.activeSceneId).not.toBe('scene-1');
    const copy = next.placements.find((placement) => placement.id !== 'place-1');
    expect(copy?.owners).toEqual(['Ada']);
    copy?.owners.push('Bea');
    expect(next.placements.find((placement) => placement.id === 'place-1')?.owners).toEqual(['Ada']);
  });

  it('stores a map frame and clears it when the map changes', () => {
    const state = base();
    const frame = { x: 12, y: 24, w: 800, h: 600, rotation: 0.2 };
    const moved = materialize(state, { type: 'scene.update', sceneId: 'scene-1', mapFrame: frame }, ids());
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const next = moved.ops.reduce(applyServerOp, state);
    expect(next.scenes[0]?.mapFrame).toEqual(frame);
    const cleared = materialize(next, { type: 'scene.update', sceneId: 'scene-1', mapAssetId: null }, ids());
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.ops.reduce(applyServerOp, next).scenes[0]?.mapFrame).toBeNull();
  });

  it('files a token into a folder', () => {
    const state = base();
    const made = materialize(state, { type: 'asset.move', assetId: 'token-1', folder: 'People/Humans' }, ids());
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const next = made.ops.reduce(applyServerOp, state);
    expect(next.assets.find((asset) => asset.id === 'token-1')?.folder).toBe('People/Humans');
    expect(materialize(state, { type: 'asset.move', assetId: 'map-1', folder: 'People' }, ids()).ok).toBe(false);
  });
});

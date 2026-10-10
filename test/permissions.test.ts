import { describe, expect, it } from 'vitest';
import { canPerform } from '../src/shared/permissions.js';
import type { ClientOp } from '../src/shared/protocol.js';
import { blankScene, emptyRoom } from '../src/shared/reduce.js';
import type { Placement, RoomState } from '../src/shared/types.js';

const scene = blankScene('scene-1', 'Scene 1', 0);
const own: Placement = {
  id: 'own',
  sceneId: scene.id,
  assetId: 'asset',
  x: 0,
  y: 0,
  w: 64,
  h: 64,
  rotation: 0,
  layer: 1,
  owners: ['Ada'],
};
const other: Placement = { ...own, id: 'other', owners: ['Bea'] };

function room(): RoomState {
  return { ...emptyRoom('ROOM12'), activeSceneId: scene.id, scenes: [scene], placements: [own, other] };
}

describe('permissions', () => {
  it('lets a player move and rotate only their own token', () => {
    const state = room();
    const ada = { role: 'player' as const, name: 'Ada' };
    expect(canPerform(ada, state, { type: 'place.update', placementId: 'own', x: 3, y: 4 })).toBe(true);
    expect(canPerform(ada, state, { type: 'place.update', placementId: 'own', rotation: 1 })).toBe(true);
    expect(canPerform(ada, state, { type: 'place.update', placementId: 'own', w: 20 })).toBe(false);
    expect(canPerform(ada, state, { type: 'place.update', placementId: 'own', x: 1, layer: 2 })).toBe(false);
    expect(canPerform(ada, state, { type: 'place.update', placementId: 'other', x: 1 })).toBe(false);
    expect(canPerform(ada, state, { type: 'place.update', placementId: 'missing', x: 1 })).toBe(false);
  });

  it('blocks players from fog, scenes, and sounds', () => {
    const state = room();
    const ada = { role: 'player' as const, name: 'Ada' };
    const blocked: ClientOp[] = [
      { type: 'fog.add', sceneId: scene.id, kind: 'rect', mode: 'reveal', points: [], x: 0, y: 0, w: 10, h: 10 },
      { type: 'fog.clear', sceneId: scene.id },
      { type: 'scene.activate', sceneId: scene.id },
      { type: 'scene.create', name: 'Next' },
      { type: 'sound.play', assetId: '00000000-0000-4000-8000-000000000001' },
      { type: 'asset.delete', assetId: '00000000-0000-4000-8000-000000000001' },
      { type: 'place.grant', placementId: 'own', owners: ['Ada'] },
    ];
    for (const op of blocked) expect(canPerform(ada, state, op)).toBe(false);
  });

  it('lets the DM do all of those', () => {
    const state = room();
    const dm = { role: 'dm' as const, name: 'DM' };
    expect(canPerform(dm, state, { type: 'place.update', placementId: 'other', x: 1, w: 30, layer: 4 })).toBe(true);
    expect(canPerform(dm, state, { type: 'fog.clear', sceneId: scene.id })).toBe(true);
    expect(canPerform(dm, state, { type: 'scene.delete', sceneId: scene.id })).toBe(true);
    expect(canPerform(dm, state, { type: 'sound.play', assetId: '00000000-0000-4000-8000-000000000001' })).toBe(true);
    expect(canPerform(dm, state, { type: 'place.update', placementId: 'missing', x: 1 })).toBe(false);
  });
});

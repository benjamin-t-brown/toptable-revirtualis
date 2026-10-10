import { describe, expect, it } from 'vitest';
import { parseClientOp } from '../src/shared/protocol.js';

const sceneId = '00000000-0000-4000-8000-000000000001';

describe('scene size protocol', () => {
  it('accepts a finite positive board size', () => {
    expect(parseClientOp({ type: 'scene.update', sceneId, width: 800, height: 600.5 })).toEqual({
      type: 'scene.update',
      sceneId,
      width: 800,
      height: 600.5,
    });
  });

  it('leaves size off an update that does not set it', () => {
    expect(parseClientOp({ type: 'scene.update', sceneId, name: 'Hall' })).toEqual({
      type: 'scene.update',
      sceneId,
      name: 'Hall',
    });
  });

  it('accepts a map frame and rejects one that is too small', () => {
    const frame = { x: 10, y: 20, w: 400, h: 300, rotation: 0.5 };
    expect(parseClientOp({ type: 'scene.update', sceneId, mapFrame: frame })).toEqual({
      type: 'scene.update',
      sceneId,
      mapFrame: frame,
    });
    expect(parseClientOp({ type: 'scene.update', sceneId, backgroundFrame: { x: 0, y: 0, w: 4, h: 4, rotation: 0 } })).toBeNull();
  });

  it('accepts a copy at the cursor', () => {
    const placementId = '00000000-0000-4000-8000-000000000003';
    expect(parseClientOp({ type: 'place.copy', placementId, x: 12, y: 40 })).toEqual({
      type: 'place.copy',
      placementId,
      x: 12,
      y: 40,
    });
    expect(parseClientOp({ type: 'place.copy', placementId, x: '12', y: 40 })).toBeNull();
  });

  it('trims a token label and rejects a non-string', () => {
    const placementId = '00000000-0000-4000-8000-000000000003';
    expect(parseClientOp({ type: 'place.update', placementId, label: '  Goblin  ' })).toEqual({
      type: 'place.update',
      placementId,
      label: 'Goblin',
    });
    expect(parseClientOp({ type: 'place.update', placementId, label: '' })).toEqual({
      type: 'place.update',
      placementId,
      label: '',
    });
    expect(parseClientOp({ type: 'place.update', placementId, label: 4 })).toBeNull();
    expect(parseClientOp({ type: 'place.update', placementId })).toBeNull();
  });

  it('accepts a token folder and rejects a path that walks upward', () => {
    const assetId = '00000000-0000-4000-8000-000000000002';
    expect(parseClientOp({ type: 'asset.move', assetId, folder: 'Animals/Sea life' })).toEqual({
      type: 'asset.move',
      assetId,
      folder: 'Animals/Sea life',
    });
    expect(parseClientOp({ type: 'asset.move', assetId, folder: '../secrets' })).toBeNull();
    expect(parseClientOp({ type: 'asset.move', assetId, folder: '' })).toBeNull();
  });

  it('rejects a board size that is not a finite positive number', () => {
    expect(parseClientOp({ type: 'scene.update', sceneId, width: 0 })).toBeNull();
    expect(parseClientOp({ type: 'scene.update', sceneId, width: -10 })).toBeNull();
    expect(parseClientOp({ type: 'scene.update', sceneId, height: Number.NaN })).toBeNull();
    expect(parseClientOp({ type: 'scene.update', sceneId, height: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parseClientOp({ type: 'scene.update', sceneId, width: '5000' })).toBeNull();
  });
});

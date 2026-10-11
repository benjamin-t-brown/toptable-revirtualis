import { describe, expect, it } from 'vitest';
import { hitPlacement, topPlacement } from '../src/shared/hit.js';
import { resizedPlacement } from '../src/shared/resize.js';
import type { Placement } from '../src/shared/types.js';

function piece(partial: Partial<Placement> = {}): Placement {
  return {
    id: 'p',
    sceneId: 's',
    assetId: 'a',
    x: 0,
    y: 0,
    w: 100,
    h: 40,
    rotation: 0,
    layer: 1,
    label: '',
    owners: [],
    ...partial,
  };
}

describe('placement hit testing and resize', () => {
  it('respects rotation and stacking', () => {
    const flat = piece();
    expect(hitPlacement(flat, 50, 20)).toBe(true);
    expect(hitPlacement(flat, 120, 20)).toBe(false);
    const turned = piece({ rotation: Math.PI / 2 });
    expect(hitPlacement(turned, 50, 20)).toBe(true);
    expect(hitPlacement(turned, 10, 20)).toBe(false);
    const low = piece({ id: 'low', layer: 1 });
    const high = piece({ id: 'high', layer: 2, x: 10 });
    expect(topPlacement([low, high], 20, 10)?.id).toBe('high');
  });

  it('keeps the opposite corner fixed while resizing', () => {
    const next = resizedPlacement(piece(), 'se', { x: 150, y: 80 }, false);
    expect(next).toEqual({ x: 0, y: 0, w: 150, h: 80 });
  });

  it('locks shift-resize to the image aspect, not the current box', () => {
    const stretched = piece({ w: 100, h: 100 });
    const next = resizedPlacement(stretched, 'se', { x: 200, y: 80 }, true, 8000, 2);
    expect(next.w / next.h).toBeCloseTo(2);
    expect(next).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });

  it('keeps the locked aspect when the drag hits the size cap', () => {
    const next = resizedPlacement(piece({ w: 100, h: 50 }), 'se', { x: 9000, y: 9000 }, true, 800, 2);
    expect(next.w).toBe(800);
    expect(next.h).toBe(400);
  });
});

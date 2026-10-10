import { describe, expect, it } from 'vitest';
import { dragBox, pointInEllipse, pointInFog, pointInPolygon, pointInRect } from '../src/shared/fog.js';
import type { FogShape } from '../src/shared/types.js';

function shape(partial: Partial<FogShape> & Pick<FogShape, 'kind'>): FogShape {
  return {
    id: 's',
    sceneId: 'scene',
    mode: 'reveal',
    points: [],
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    sortIndex: 0,
    ...partial,
  };
}

describe('fog geometry', () => {
  it('hits the inside of a rectangle and misses the outside', () => {
    const rect = shape({ kind: 'rect', w: 10, h: 10 });
    expect(pointInRect(5, 5, rect)).toBe(true);
    expect(pointInRect(0, 0, rect)).toBe(true);
    expect(pointInRect(10, 10, rect)).toBe(true);
    expect(pointInRect(15, 5, rect)).toBe(false);
    expect(pointInRect(5, -1, rect)).toBe(false);
  });

  it('hits an ellipse by its bounding box', () => {
    const ellipse = shape({ kind: 'ellipse', x: 0, y: 0, w: 10, h: 20 });
    expect(pointInEllipse(5, 10, ellipse)).toBe(true);
    expect(pointInEllipse(0, 10, ellipse)).toBe(true);
    expect(pointInEllipse(11, 10, ellipse)).toBe(false);
    expect(pointInEllipse(5, 0, ellipse)).toBe(true);
  });

  it('hits a polygon and its boundary', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon(5, 5, points)).toBe(true);
    expect(pointInPolygon(1, 1, points)).toBe(true);
    expect(pointInPolygon(15, 5, points)).toBe(false);
    expect(pointInPolygon(1, 1, points.slice(0, 2))).toBe(false);
    expect(pointInFog(shape({ kind: 'polygon', points }), 5, 5)).toBe(true);
  });

  it('constrains a drag to a square', () => {
    expect(dragBox(0, 0, 10, 4, false)).toEqual({ x: 0, y: 0, w: 10, h: 4 });
    expect(dragBox(0, 0, 10, 4, true)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(dragBox(5, 5, 1, 2, true)).toEqual({ x: 1, y: 1, w: 4, h: 4 });
  });
});

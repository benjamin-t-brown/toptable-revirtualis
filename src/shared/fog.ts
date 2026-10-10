import type { FogShape, Point } from './types.js';

export function pointInPolygon(x: number, y: number, points: readonly Point[]): boolean {
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const pi = points[i];
    const pj = points[j];
    if (!pi || !pj) continue;
    const crosses = pi.y > y !== pj.y > y;
    if (!crosses) continue;
    const xCross = ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (x <= xCross) inside = !inside;
  }
  return inside;
}

export function pointInRect(x: number, y: number, shape: Pick<FogShape, 'x' | 'y' | 'w' | 'h'>): boolean {
  if (shape.w <= 0 || shape.h <= 0) return false;
  return x >= shape.x && y >= shape.y && x <= shape.x + shape.w && y <= shape.y + shape.h;
}

export function pointInEllipse(x: number, y: number, shape: Pick<FogShape, 'x' | 'y' | 'w' | 'h'>): boolean {
  if (shape.w <= 0 || shape.h <= 0) return false;
  const rx = shape.w / 2;
  const ry = shape.h / 2;
  const dx = x - (shape.x + rx);
  const dy = y - (shape.y + ry);
  return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
}

export function pointInFog(shape: FogShape, x: number, y: number): boolean {
  if (shape.kind === 'polygon') return pointInPolygon(x, y, shape.points);
  if (shape.kind === 'ellipse') return pointInEllipse(x, y, shape);
  return pointInRect(x, y, shape);
}

export function dragBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  constrain: boolean,
): { x: number; y: number; w: number; h: number } {
  let dx = x1 - x0;
  let dy = y1 - y0;
  if (constrain) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * size;
    dy = Math.sign(dy || 1) * size;
  }
  return {
    x: dx < 0 ? x0 + dx : x0,
    y: dy < 0 ? y0 + dy : y0,
    w: Math.abs(dx),
    h: Math.abs(dy),
  };
}

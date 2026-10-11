import type { Point, RulerUnit } from './types.js';
import { DEFAULT_RULER_SCALE, MAX_RULER_SCALE, MIN_RULER_SCALE } from './types.js';
import { clamp } from './validate.js';

export const RULER_SPANS = [5, 10, 50] as const;
export type RulerSpan = (typeof RULER_SPANS)[number];

export interface LiveRuler {
  id: string;
  sceneId: string;
  x: number;
  y: number;
  x2: number;
  y2: number;
  name: string;
}

/** Pixels per unit when `sidePixels` is one side of a square `span` units across. */
export function rulerScaleFromSquare(sidePixels: number, span: number): number | null {
  if (!(sidePixels > 0) || !(span > 0) || !Number.isFinite(sidePixels) || !Number.isFinite(span)) return null;
  const scale = Math.round((sidePixels / span) * 1000) / 1000;
  return clamp(scale, MIN_RULER_SCALE, MAX_RULER_SCALE);
}

/** Table pixels that equal one foot or one meter. */
export function rulerLength(a: Point, b: Point, scale: number): number {
  const per = scale > 0 && Number.isFinite(scale) ? scale : DEFAULT_RULER_SCALE;
  return Math.hypot(b.x - a.x, b.y - a.y) / per;
}

export function formatRuler(a: Point, b: Point, scale: number, unit: RulerUnit): string {
  const amount = rulerLength(a, b, scale);
  const rounded = Math.round(amount * 10) / 10;
  const text = Math.abs(rounded - Math.round(rounded)) < 0.001 ? String(Math.round(rounded)) : rounded.toFixed(1);
  return `${text} ${unit}`;
}

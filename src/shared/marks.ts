import type { Point } from './types.js';

export const PING_HOLD_MS = 2000;
export const PING_LIFE_MS = 3000;
export const MARK_HOLD_MS = 3000;
export const MARK_LIFE_MS = 5000;
export const MAX_STROKE_POINTS = 256;

export interface LivePing {
  id: string;
  sceneId: string;
  x: number;
  y: number;
  name: string;
  at: number;
}

export interface LiveStroke {
  id: string;
  sceneId: string;
  points: Point[];
  at: number;
}

function fadeOpacity(ageMs: number, holdMs: number, lifeMs: number): number {
  if (ageMs <= holdMs) return 1;
  if (ageMs >= lifeMs) return 0;
  return (lifeMs - ageMs) / (lifeMs - holdMs);
}

/** Fully visible until 2s, then fades to nothing at 3s. */
export function pingOpacity(ageMs: number): number {
  return fadeOpacity(ageMs, PING_HOLD_MS, PING_LIFE_MS);
}

/** Fully visible until 3s, then fades to nothing at 5s. */
export function markOpacity(ageMs: number): number {
  return fadeOpacity(ageMs, MARK_HOLD_MS, MARK_LIFE_MS);
}

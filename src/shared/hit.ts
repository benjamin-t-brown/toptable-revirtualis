import type { Placement, Point } from './types.js';

export type CornerHandle = 'nw' | 'ne' | 'sw' | 'se';
export type HandleKind = CornerHandle | 'rotate';

export interface Handle {
  kind: HandleKind;
  x: number;
  y: number;
}

export function placementCenter(placement: Placement): Point {
  return { x: placement.x + placement.w / 2, y: placement.y + placement.h / 2 };
}

export function localToWorld(placement: Placement, lx: number, ly: number): Point {
  const center = placementCenter(placement);
  const cos = Math.cos(placement.rotation);
  const sin = Math.sin(placement.rotation);
  return {
    x: center.x + lx * cos - ly * sin,
    y: center.y + lx * sin + ly * cos,
  };
}

export function hitPlacement(placement: Placement, wx: number, wy: number): boolean {
  const center = placementCenter(placement);
  const dx = wx - center.x;
  const dy = wy - center.y;
  const cos = Math.cos(-placement.rotation);
  const sin = Math.sin(-placement.rotation);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return Math.abs(lx) <= placement.w / 2 && Math.abs(ly) <= placement.h / 2;
}

export function topPlacement(placements: readonly Placement[], wx: number, wy: number): Placement | null {
  const ordered = placements.slice().sort((a, b) => b.layer - a.layer || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  for (const placement of ordered) {
    if (hitPlacement(placement, wx, wy)) return placement;
  }
  return null;
}

export function handlesFor(placement: Placement, zoom: number): Handle[] {
  const corners: { kind: CornerHandle; lx: number; ly: number }[] = [
    { kind: 'nw', lx: -placement.w / 2, ly: -placement.h / 2 },
    { kind: 'ne', lx: placement.w / 2, ly: -placement.h / 2 },
    { kind: 'se', lx: placement.w / 2, ly: placement.h / 2 },
    { kind: 'sw', lx: -placement.w / 2, ly: placement.h / 2 },
  ];
  const handles: Handle[] = corners.map((corner) => ({
    kind: corner.kind,
    ...localToWorld(placement, corner.lx, corner.ly),
  }));
  const rotate = localToWorld(placement, 0, -placement.h / 2 - 22 / zoom);
  handles.push({ kind: 'rotate', ...rotate });
  return handles;
}

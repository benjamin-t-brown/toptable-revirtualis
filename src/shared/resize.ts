import type { Placement, Point } from './types.js';
import type { CornerHandle } from './hit.js';
import { clamp } from './validate.js';

const MIN_SIZE = 16;

function signFor(handle: CornerHandle): { x: number; y: number } {
  return {
    x: handle === 'ne' || handle === 'se' ? 1 : -1,
    y: handle === 'sw' || handle === 'se' ? 1 : -1,
  };
}

export function resizedPlacement(
  placement: Placement,
  handle: CornerHandle,
  pointer: Point,
  shift: boolean,
  max = 8000,
  aspect?: number,
): Pick<Placement, 'x' | 'y' | 'w' | 'h'> {
  const sign = signFor(handle);
  const cos = Math.cos(placement.rotation);
  const sin = Math.sin(placement.rotation);
  const ux = { x: cos, y: sin };
  const uy = { x: -sin, y: cos };
  const cx = placement.x + placement.w / 2;
  const cy = placement.y + placement.h / 2;
  const opp = {
    x: cx + ux.x * (-sign.x * placement.w / 2) + uy.x * (-sign.y * placement.h / 2),
    y: cy + ux.y * (-sign.x * placement.w / 2) + uy.y * (-sign.y * placement.h / 2),
  };
  const vx = pointer.x - opp.x;
  const vy = pointer.y - opp.y;
  let newW = sign.x * (vx * ux.x + vy * ux.y);
  let newH = sign.y * (vx * uy.x + vy * uy.y);
  const ratio = lockedRatio(placement, shift, aspect);
  if (ratio !== null) {
    if (Math.abs(newW) / placement.w >= Math.abs(newH) / placement.h) {
      newH = Math.sign(newH || 1) * (Math.abs(newW) / ratio);
    } else {
      newW = Math.sign(newW || 1) * (Math.abs(newH) * ratio);
    }
    const fitted = fitAspect(Math.abs(newW), Math.abs(newH), max);
    newW = fitted.w;
    newH = fitted.h;
  } else {
    newW = clamp(newW, MIN_SIZE, max);
    newH = clamp(newH, MIN_SIZE, max);
  }
  const ncx = opp.x + ux.x * (sign.x * newW / 2) + uy.x * (sign.y * newH / 2);
  const ncy = opp.y + ux.y * (sign.x * newW / 2) + uy.y * (sign.y * newH / 2);
  return { x: ncx - newW / 2, y: ncy - newH / 2, w: newW, h: newH };
}

function lockedRatio(placement: Placement, shift: boolean, aspect: number | undefined): number | null {
  if (!shift || placement.w <= 0 || placement.h <= 0) return null;
  if (aspect !== undefined && Number.isFinite(aspect) && aspect > 0) return aspect;
  return placement.w / placement.h;
}

function fitAspect(width: number, height: number, max: number): { w: number; h: number } {
  let w = width;
  let h = height;
  if (!(w > 0) || !(h > 0)) return { w: MIN_SIZE, h: MIN_SIZE };
  const shrink = Math.min(1, max / w, max / h);
  w *= shrink;
  h *= shrink;
  const grow = Math.max(1, MIN_SIZE / w, MIN_SIZE / h);
  w *= grow;
  h *= grow;
  if (w > max || h > max) {
    const again = Math.min(max / w, max / h);
    w *= again;
    h *= again;
  }
  return { w, h };
}

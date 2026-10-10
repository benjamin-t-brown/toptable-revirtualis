import type { Point } from '../../shared/types.js';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 6;

export function screenToWorld(camera: Camera, width: number, height: number, sx: number, sy: number): Point {
  return {
    x: (sx - width / 2) / camera.zoom + camera.x,
    y: (sy - height / 2) / camera.zoom + camera.y,
  };
}

export function worldToScreen(camera: Camera, width: number, height: number, wx: number, wy: number): Point {
  return {
    x: (wx - camera.x) * camera.zoom + width / 2,
    y: (wy - camera.y) * camera.zoom + height / 2,
  };
}

export function applyWorldTransform(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  dpr: number,
): void {
  ctx.setTransform(
    dpr * camera.zoom,
    0,
    0,
    dpr * camera.zoom,
    dpr * (width / 2 - camera.x * camera.zoom),
    dpr * (height / 2 - camera.y * camera.zoom),
  );
}

export function zoomAt(
  camera: Camera,
  width: number,
  height: number,
  sx: number,
  sy: number,
  factor: number,
): Camera {
  const before = screenToWorld(camera, width, height, sx, sy);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));
  return {
    zoom,
    x: before.x - (sx - width / 2) / zoom,
    y: before.y - (sy - height / 2) / zoom,
  };
}

export function fitBoard(viewWidth: number, viewHeight: number, boardWidth: number, boardHeight: number): Camera {
  const margin = 32;
  const innerW = Math.max(1, viewWidth - margin * 2);
  const innerH = Math.max(1, viewHeight - margin * 2);
  const spanW = Math.max(1, boardWidth);
  const spanH = Math.max(1, boardHeight);
  const zoom = Math.min(innerW / spanW, innerH / spanH, 1);
  return {
    x: spanW / 2,
    y: spanH / 2,
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)),
  };
}

export function visibleWorld(camera: Camera, width: number, height: number): { x: number; y: number; w: number; h: number } {
  return {
    x: camera.x - width / 2 / camera.zoom,
    y: camera.y - height / 2 / camera.zoom,
    w: width / camera.zoom,
    h: height / camera.zoom,
  };
}

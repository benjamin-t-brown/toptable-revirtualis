import { handlesFor, localToWorld } from '../../shared/hit.js';
import {
  DEFAULT_TABLE_COLOR,
  TABLE_BACKDROP,
  sceneBoard,
  type FogShape,
  type Placement,
  type Point,
  type Role,
  type RoomState,
} from '../../shared/types.js';
import { activeScene } from '../../shared/reduce.js';
import { applyWorldTransform, visibleWorld, type Camera } from './camera.js';
import { sceneryKind, sceneryPlacement } from './scenery.js';

export type Tool = 'select' | 'pan' | 'polygon' | 'rect' | 'ellipse';

export interface DraftBox {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'rect' | 'ellipse';
}

export interface DrawModel {
  room: RoomState;
  role: Role;
  selfName: string;
  camera: Camera;
  images: ReadonlyMap<string, CanvasImageSource>;
  selectionId: string | null;
  tool: Tool;
  polygon: Point[];
  polygonCursor: Point | null;
  draft: DraftBox | null;
  width: number;
  height: number;
  dpr: number;
}

const FOG = '#10180e';

function traceShape(ctx: CanvasRenderingContext2D, shape: FogShape): void {
  ctx.beginPath();
  if (shape.kind === 'polygon') {
    const first = shape.points[0];
    if (!first) return;
    ctx.moveTo(first.x, first.y);
    for (const point of shape.points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    return;
  }
  if (shape.kind === 'ellipse') {
    const rx = Math.abs(shape.w) / 2;
    const ry = Math.abs(shape.h) / 2;
    if (rx < 1 || ry < 1) return;
    ctx.ellipse(shape.x + shape.w / 2, shape.y + shape.h / 2, rx, ry, 0, 0, Math.PI * 2);
    return;
  }
  ctx.rect(shape.x, shape.y, shape.w, shape.h);
}

function drawFog(
  fog: CanvasRenderingContext2D,
  fogCanvas: HTMLCanvasElement,
  model: DrawModel,
): boolean {
  fog.setTransform(1, 0, 0, 1, 0, 0);
  fog.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
  const scene = activeScene(model.room);
  if (!scene?.fogEnabled) return false;
  applyWorldTransform(fog, model.camera, model.width, model.height, model.dpr);
  const view = visibleWorld(model.camera, model.width, model.height);
  fog.fillStyle = FOG;
  fog.fillRect(view.x - 8, view.y - 8, view.w + 16, view.h + 16);
  const shapes = model.room.fog
    .filter((shape) => shape.sceneId === scene.id)
    .sort((a, b) => a.sortIndex - b.sortIndex);
  for (const shape of shapes) {
    fog.globalCompositeOperation = shape.mode === 'reveal' ? 'destination-out' : 'source-over';
    fog.fillStyle = FOG;
    traceShape(fog, shape);
    fog.fill();
  }
  fog.globalCompositeOperation = 'source-over';
  return true;
}

function drawFramedImage(ctx: CanvasRenderingContext2D, model: DrawModel, placement: Placement): void {
  const image = model.images.get(placement.assetId);
  if (!image) return;
  ctx.save();
  ctx.translate(placement.x + placement.w / 2, placement.y + placement.h / 2);
  ctx.rotate(placement.rotation);
  ctx.drawImage(image, -placement.w / 2, -placement.h / 2, placement.w, placement.h);
  if (placement.id === model.selectionId && model.role === 'dm') {
    ctx.strokeStyle = '#A1CA0C';
    ctx.lineWidth = 2 / model.camera.zoom;
    ctx.strokeRect(-placement.w / 2, -placement.h / 2, placement.w, placement.h);
  }
  ctx.restore();
}

function drawPlacement(ctx: CanvasRenderingContext2D, model: DrawModel, placement: Placement): void {
  const image = model.images.get(placement.assetId);
  const asset = model.room.assets.find((item) => item.id === placement.assetId);
  ctx.save();
  ctx.translate(placement.x + placement.w / 2, placement.y + placement.h / 2);
  ctx.rotate(placement.rotation);
  if (image) {
    ctx.drawImage(image, -placement.w / 2, -placement.h / 2, placement.w, placement.h);
  } else {
    ctx.fillStyle = '#579047';
    ctx.fillRect(-placement.w / 2, -placement.h / 2, placement.w, placement.h);
    ctx.fillStyle = '#E7D5B1';
    ctx.font = `${14 / model.camera.zoom}px Verdana, sans-serif`;
    ctx.fillText(asset?.name ?? '...', -placement.w / 2 + 4 / model.camera.zoom, 4 / model.camera.zoom, placement.w);
  }
  const selected = placement.id === model.selectionId;
  const owned = placement.owners.includes(model.selfName);
  if (selected || (owned && model.role === 'player')) {
    ctx.strokeStyle = selected ? '#A1CA0C' : '#70D285';
    ctx.lineWidth = 2 / model.camera.zoom;
    ctx.strokeRect(-placement.w / 2, -placement.h / 2, placement.w, placement.h);
  }
  ctx.restore();
  if (asset?.class === 'token') drawTokenLabel(ctx, model, placement);
}

function drawTokenLabel(ctx: CanvasRenderingContext2D, model: DrawModel, placement: Placement): void {
  const label = placement.label.trim();
  if (!label) return;
  const zoom = model.camera.zoom;
  const cos = Math.abs(Math.cos(placement.rotation));
  const sin = Math.abs(Math.sin(placement.rotation));
  const halfH = (placement.h * cos + placement.w * sin) / 2;
  const centerX = placement.x + placement.w / 2;
  const top = placement.y + placement.h / 2 - halfH;
  const fontPx = 13 / zoom;
  const pad = 3 / zoom;
  const gap = 5 / zoom;
  ctx.save();
  ctx.font = `${fontPx}px Verdana, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const width = Math.min(ctx.measureText(label).width, 220 / zoom);
  const textY = top - gap;
  ctx.fillStyle = 'rgba(14, 20, 12, 0.82)';
  ctx.fillRect(centerX - width / 2 - pad, textY - fontPx - pad, width + pad * 2, fontPx + pad * 2);
  ctx.fillStyle = '#E7D5B1';
  ctx.fillText(label, centerX, textY, 220 / zoom);
  ctx.restore();
}

function drawHandles(ctx: CanvasRenderingContext2D, model: DrawModel, placement: Placement): void {
  const zoom = model.camera.zoom;
  const size = 8 / zoom;
  const canResize = model.role === 'dm';
  const canRotate = model.role === 'dm' || placement.owners.includes(model.selfName);
  if (canRotate) {
    const top = localToWorld(placement, 0, -placement.h / 2);
    const knob = localToWorld(placement, 0, -placement.h / 2 - 22 / zoom);
    ctx.strokeStyle = '#70D285';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(knob.x, knob.y);
    ctx.stroke();
  }
  for (const handle of handlesFor(placement, zoom)) {
    if (handle.kind === 'rotate' && !canRotate) continue;
    if (handle.kind !== 'rotate' && !canResize) continue;
    ctx.fillStyle = handle.kind === 'rotate' ? '#70D285' : '#A1CA0C';
    ctx.fillRect(handle.x - size / 2, handle.y - size / 2, size, size);
  }
}

export function drawTable(
  ctx: CanvasRenderingContext2D,
  fogCtx: CanvasRenderingContext2D,
  fogCanvas: HTMLCanvasElement,
  model: DrawModel,
): void {
  if (model.width < 1 || model.height < 1) return;
  const scene = activeScene(model.room);
  ctx.setTransform(model.dpr, 0, 0, model.dpr, 0, 0);
  ctx.fillStyle = TABLE_BACKDROP;
  ctx.fillRect(0, 0, model.width, model.height);
  applyWorldTransform(ctx, model.camera, model.width, model.height, model.dpr);
  if (scene) {
    const board = sceneBoard(scene);
    ctx.fillStyle = scene.backgroundColor || DEFAULT_TABLE_COLOR;
    ctx.fillRect(0, 0, board.width, board.height);
  }
  if (scene) {
    const background = sceneryPlacement(scene, 'background', model.images);
    if (background) drawFramedImage(ctx, model, background);
    const map = sceneryPlacement(scene, 'map', model.images);
    if (map) drawFramedImage(ctx, model, map);
  }
  if (scene) {
    const pieces = model.room.placements
      .filter((placement) => placement.sceneId === scene.id)
      .sort((a, b) => a.layer - b.layer);
    for (const placement of pieces) drawPlacement(ctx, model, placement);
  }
  const fogOn = drawFog(fogCtx, fogCanvas, model);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (fogOn) {
    ctx.globalAlpha = model.role === 'dm' ? 0.45 : 1;
    ctx.drawImage(fogCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }
  applyWorldTransform(ctx, model.camera, model.width, model.height, model.dpr);
  if (scene && model.role === 'dm' && (model.tool === 'polygon' || model.tool === 'rect' || model.tool === 'ellipse')) {
    const shapes = model.room.fog.filter((shape) => shape.sceneId === scene.id);
    ctx.lineWidth = 1 / model.camera.zoom;
    for (const shape of shapes) {
      ctx.strokeStyle = shape.mode === 'cover' ? '#E7D5B1' : '#A1CA0C';
      traceShape(ctx, shape);
      ctx.stroke();
    }
  }
  if (model.polygon.length > 0) {
    ctx.strokeStyle = '#A1CA0C';
    ctx.fillStyle = 'rgba(161, 202, 12, 0.3)';
    ctx.lineWidth = 2 / model.camera.zoom;
    ctx.beginPath();
    const first = model.polygon[0];
    if (first) {
      ctx.moveTo(first.x, first.y);
      for (const point of model.polygon.slice(1)) ctx.lineTo(point.x, point.y);
      if (model.polygonCursor) ctx.lineTo(model.polygonCursor.x, model.polygonCursor.y);
      ctx.stroke();
    }
  }
  if (model.draft && model.draft.w > 0 && model.draft.h > 0) {
    ctx.strokeStyle = '#A1CA0C';
    ctx.lineWidth = 2 / model.camera.zoom;
    traceShape(ctx, {
      id: 'draft',
      sceneId: '',
      kind: model.draft.kind,
      mode: 'reveal',
      points: [],
      x: model.draft.x,
      y: model.draft.y,
      w: model.draft.w,
      h: model.draft.h,
      sortIndex: 0,
    });
    ctx.stroke();
  }
  if (scene && model.selectionId) {
    const kind = sceneryKind(model.selectionId);
    const selected = kind
      ? sceneryPlacement(scene, kind, model.images)
      : model.room.placements.find((placement) => placement.id === model.selectionId);
    if (selected && selected.sceneId === scene.id) drawHandles(ctx, model, selected);
  }
}

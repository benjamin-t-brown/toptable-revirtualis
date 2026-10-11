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
  type RulerUnit,
  type Scene,
} from '../../shared/types.js';
import { applyWorldTransform, visibleWorld, type Camera } from './camera.js';
import { markOpacity, pingOpacity, type LivePing, type LiveStroke } from '../../shared/marks.js';
import { formatRuler, type LiveRuler } from '../../shared/ruler.js';
import { sceneryKind, sceneryPlacement } from './scenery.js';

export type Tool = 'select' | 'pan' | 'ping' | 'draw' | 'ruler' | 'polygon' | 'rect' | 'ellipse';

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
  pings: LivePing[];
  marks: LiveStroke[];
  rulers: LiveRuler[];
  calibrate: { span: number; unit: RulerUnit; x: number; y: number; w: number; h: number } | null;
  ink: Point[] | null;
  now: number;
  sceneId: string | null;
  width: number;
  height: number;
  dpr: number;
}

const FOG = '#10180e';

function shownScene(model: DrawModel): Scene | null {
  if (!model.sceneId) return null;
  return model.room.scenes.find((scene) => scene.id === model.sceneId) ?? null;
}

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
  const scene = shownScene(model);
  if (!scene?.fogEnabled) return false;
  applyWorldTransform(fog, model.camera, model.width, model.height, model.dpr);
  const view = visibleWorld(model.camera, model.width, model.height);
  fog.fillStyle = FOG;
  fog.fillRect(view.x - 8, view.y - 8, view.w + 16, view.h + 16);
  const shapes = model.room.fog
    .filter((shape) => shape.sceneId === scene.id)
    .sort((a, b) => a.sortIndex - b.sortIndex);
  for (const shape of shapes) {
    fog.globalCompositeOperation = 'destination-out';
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
  const scene = shownScene(model);
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
      ctx.strokeStyle = '#A1CA0C';
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
  if (scene) drawIndicators(ctx, model, scene);
  if (model.calibrate && model.calibrate.w > 0 && model.calibrate.h > 0) drawCalibrate(ctx, model);
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

function drawIndicators(ctx: CanvasRenderingContext2D, model: DrawModel, scene: Scene): void {
  const zoom = model.camera.zoom;
  for (const mark of model.marks) {
    if (mark.sceneId !== scene.id) continue;
    drawStroke(ctx, mark.points, zoom, markOpacity(model.now - mark.at));
  }
  if (model.ink && model.ink.length > 1) drawStroke(ctx, model.ink, zoom, 1);
  for (const ping of model.pings) {
    if (ping.sceneId !== scene.id) continue;
    drawPing(ctx, zoom, ping, pingOpacity(model.now - ping.at));
  }
  for (const ruler of model.rulers) {
    if (ruler.sceneId !== scene.id) continue;
    drawRuler(ctx, zoom, ruler, scene);
  }
}

function drawStroke(ctx: CanvasRenderingContext2D, points: Point[], zoom: number, alpha: number): void {
  const first = points[0];
  if (!first || points.length < 2 || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.strokeStyle = 'rgba(14, 20, 12, 0.9)';
  ctx.lineWidth = 6 / zoom;
  ctx.stroke();
  ctx.strokeStyle = '#F2E27A';
  ctx.lineWidth = 2.5 / zoom;
  ctx.stroke();
  ctx.restore();
}

function drawCalibrate(ctx: CanvasRenderingContext2D, model: DrawModel): void {
  const box = model.calibrate;
  if (!box) return;
  const zoom = model.camera.zoom;
  const label = `${box.span}×${box.span} ${box.unit}`;
  ctx.save();
  ctx.strokeStyle = 'rgba(14, 20, 12, 0.85)';
  ctx.lineWidth = 5 / zoom;
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = '#D7E7F5';
  ctx.lineWidth = 2 / zoom;
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.restore();
  const fontPx = 14 / zoom;
  const pad = 4 / zoom;
  const textX = box.x + box.w / 2;
  const textY = box.y - 12 / zoom;
  ctx.save();
  ctx.font = `${fontPx}px Verdana, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const width = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(14, 20, 12, 0.88)';
  ctx.fillRect(textX - width / 2 - pad, textY - fontPx - pad, width + pad * 2, fontPx + pad * 2);
  ctx.fillStyle = '#F4F7FB';
  ctx.fillText(label, textX, textY);
  ctx.restore();
}

function drawRuler(ctx: CanvasRenderingContext2D, zoom: number, ruler: LiveRuler, scene: Scene): void {
  const unit = scene.rulerUnit === 'm' ? 'm' : 'ft';
  const scale = scene.rulerScale > 0 && Number.isFinite(scene.rulerScale) ? scene.rulerScale : 1;
  const label = formatRuler({ x: ruler.x, y: ruler.y }, { x: ruler.x2, y: ruler.y2 }, scale, unit);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ruler.x, ruler.y);
  ctx.lineTo(ruler.x2, ruler.y2);
  ctx.strokeStyle = 'rgba(14, 20, 12, 0.85)';
  ctx.lineWidth = 5 / zoom;
  ctx.stroke();
  ctx.strokeStyle = '#D7E7F5';
  ctx.lineWidth = 2 / zoom;
  ctx.stroke();
  ctx.fillStyle = '#D7E7F5';
  const cap = 3.5 / zoom;
  ctx.beginPath();
  ctx.arc(ruler.x, ruler.y, cap, 0, Math.PI * 2);
  ctx.arc(ruler.x2, ruler.y2, cap, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const dx = ruler.x2 - ruler.x;
  const dy = ruler.y2 - ruler.y;
  const len = Math.hypot(dx, dy);
  const nx = len < 0.001 ? 0 : -dy / len;
  const ny = len < 0.001 ? -1 : dx / len;
  const lift = 16 / zoom;
  const textX = (ruler.x + ruler.x2) / 2 + nx * lift;
  const textY = (ruler.y + ruler.y2) / 2 + ny * lift;
  const fontPx = 14 / zoom;
  const pad = 4 / zoom;
  ctx.save();
  ctx.font = `${fontPx}px Verdana, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(14, 20, 12, 0.88)';
  ctx.fillRect(textX - width / 2 - pad, textY - fontPx / 2 - pad, width + pad * 2, fontPx + pad * 2);
  ctx.fillStyle = '#F4F7FB';
  ctx.fillText(label, textX, textY);
  ctx.restore();
}

function drawPing(ctx: CanvasRenderingContext2D, zoom: number, ping: LivePing, alpha: number): void {
  if (alpha <= 0) return;
  const arm = 7 / zoom;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ping.x - arm, ping.y - arm);
  ctx.lineTo(ping.x + arm, ping.y + arm);
  ctx.moveTo(ping.x + arm, ping.y - arm);
  ctx.lineTo(ping.x - arm, ping.y + arm);
  ctx.lineWidth = 3 / zoom;
  ctx.strokeStyle = '#1a2a12';
  ctx.stroke();
  ctx.lineWidth = 1.25 / zoom;
  ctx.strokeStyle = '#a1ca0c';
  ctx.stroke();

  const fontPx = 13 / zoom;
  const pad = 3 / zoom;
  const gap = 4 / zoom;
  const textY = ping.y - arm - gap;
  ctx.font = `${fontPx}px Verdana, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const width = Math.min(ctx.measureText(ping.name).width, 220 / zoom);
  ctx.fillStyle = 'rgba(14, 20, 12, 0.82)';
  ctx.fillRect(ping.x - width / 2 - pad, textY - fontPx - pad, width + pad * 2, fontPx + pad * 2);
  ctx.fillStyle = '#E7D5B1';
  ctx.fillText(ping.name, ping.x, textY, 220 / zoom);
  ctx.restore();
}

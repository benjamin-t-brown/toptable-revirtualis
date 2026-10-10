import { dragBox } from '../../shared/fog.js';
import { handlesFor, hitPlacement, placementCenter, topPlacement, type CornerHandle, type HandleKind } from '../../shared/hit.js';
import { resizedPlacement } from '../../shared/resize.js';
import type { Placement, Point } from '../../shared/types.js';
import { MAX_ZOOM, MIN_ZOOM, screenToWorld, zoomAt, type Camera } from './camera.js';
import type { DraftBox, Tool } from './draw.js';

export interface InputApi {
  getCamera(): Camera;
  setCamera(camera: Camera): void;
  getSize(): { width: number; height: number };
  getTool(): Tool;
  getSelection(): Placement | null;
  setSelection(id: string | null): void;
  placements(): Placement[];
  placement(id: string): Placement | null;
  canMove(placement: Placement): boolean;
  canResize(): boolean;
  canRotate(placement: Placement): boolean;
  maxSize(placement: Placement): number;
  sceneryAt(world: Point): Placement | null;
  placing(): boolean;
  onPlace(world: Point): void;
  onDraft(draft: DraftBox | null): void;
  onFogBox(box: DraftBox): void;
  polygonMove(world: Point | null): void;
  polygonClick(world: Point): void;
  onMove(id: string, x: number, y: number, force: boolean): void;
  onResize(id: string, next: Pick<Placement, 'x' | 'y' | 'w' | 'h'>, force: boolean): void;
  onRotate(id: string, rotation: number, force: boolean): void;
  onDragStart(id: string | null): void;
  setInteracting(active: boolean): void;
  requestDraw(): void;
}

type Drag =
  | { kind: 'pan'; id: number; x: number; y: number }
  | { kind: 'move'; id: number; placementId: string; ox: number; oy: number }
  | { kind: 'resize'; id: number; placementId: string; handle: CornerHandle; start: Placement }
  | { kind: 'rotate'; id: number; placementId: string; startAngle: number; startRot: number }
  | { kind: 'box'; id: number; shape: 'rect' | 'ellipse'; x: number; y: number }
  | { kind: 'poly'; id: number; x: number; y: number; moved: boolean }
  | { kind: 'place'; id: number; x: number; y: number; world: Point; moved: boolean };

function hitHandle(placement: Placement, world: Point, zoom: number, allow: (kind: HandleKind) => boolean): HandleKind | null {
  for (const handle of handlesFor(placement, zoom)) {
    if (!allow(handle.kind)) continue;
    const dx = (handle.x - world.x) * zoom;
    const dy = (handle.y - world.y) * zoom;
    if (dx * dx + dy * dy <= 144) return handle.kind;
  }
  return null;
}

export function bindStage(canvas: HTMLCanvasElement, api: InputApi): () => void {
  const pointers = new Map<number, Point>();
  let drag: Drag | null = null;
  let pinch: { dist: number; zoom: number; world: Point } | null = null;

  const localPoint = (event: PointerEvent): Point => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const worldPoint = (screen: Point): Point => {
    const size = api.getSize();
    return screenToWorld(api.getCamera(), size.width, size.height, screen.x, screen.y);
  };

  const onDown = (event: PointerEvent): void => {
    if (event.button > 2) return;
    event.preventDefault();
    try {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // The pointer can vanish before capture.
      }
      const screen = localPoint(event);
      pointers.set(event.pointerId, screen);
      if (pointers.size >= 2) {
        const pts = [...pointers.values()];
        const a = pts[0];
        const b = pts[1];
        if (a && b) {
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          pinch = {
            dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
            zoom: api.getCamera().zoom,
            world: worldPoint(mid),
          };
        }
        drag = null;
        return;
      }
      const world = worldPoint(screen);
      const tool = api.getTool();
      if (event.button === 1 || event.button === 2 || tool === 'pan') {
        drag = { kind: 'pan', id: event.pointerId, x: screen.x, y: screen.y };
        return;
      }
      if (tool === 'rect' || tool === 'ellipse') {
        drag = { kind: 'box', id: event.pointerId, shape: tool, x: world.x, y: world.y };
        return;
      }
      if (tool === 'polygon') {
        drag = { kind: 'poly', id: event.pointerId, x: screen.x, y: screen.y, moved: false };
        return;
      }
      if (api.placing()) {
        drag = { kind: 'place', id: event.pointerId, x: screen.x, y: screen.y, world, moved: false };
        return;
      }
      const selected = api.getSelection();
      if (selected) {
        const kind = hitHandle(selected, world, api.getCamera().zoom, (handle) => {
          if (handle === 'rotate') return api.canRotate(selected);
          return api.canResize();
        });
        if (kind === 'rotate') {
          const center = placementCenter(selected);
          drag = {
            kind: 'rotate',
            id: event.pointerId,
            placementId: selected.id,
            startAngle: Math.atan2(world.y - center.y, world.x - center.x),
            startRot: selected.rotation,
          };
          api.onDragStart(selected.id);
          return;
        }
        if (kind === 'nw' || kind === 'ne' || kind === 'sw' || kind === 'se') {
          drag = {
            kind: 'resize',
            id: event.pointerId,
            placementId: selected.id,
            handle: kind,
            start: { ...selected, owners: selected.owners.slice() },
          };
          api.onDragStart(selected.id);
          return;
        }
      }
      const hit = topPlacement(api.placements(), world.x, world.y);
      if (hit && hitPlacement(hit, world.x, world.y)) {
        if (api.canMove(hit)) {
          api.setSelection(hit.id);
          drag = { kind: 'move', id: event.pointerId, placementId: hit.id, ox: world.x - hit.x, oy: world.y - hit.y };
          api.onDragStart(hit.id);
          return;
        }
        api.setSelection(null);
        return;
      }
      const backdrop = api.sceneryAt(world);
      if (backdrop) {
        api.setSelection(backdrop.id);
        drag = {
          kind: 'move',
          id: event.pointerId,
          placementId: backdrop.id,
          ox: world.x - backdrop.x,
          oy: world.y - backdrop.y,
        };
        api.onDragStart(backdrop.id);
        return;
      }
      api.setSelection(null);
      drag = { kind: 'pan', id: event.pointerId, x: screen.x, y: screen.y };
    } finally {
      api.setInteracting(pointers.size > 0);
    }
  };

  const onMove = (event: PointerEvent): void => {
    const screen = localPoint(event);
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, screen);
    if (pinch && pointers.size >= 2) {
      const pts = [...pointers.values()];
      const a = pts[0];
      const b = pts[1];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const size = api.getSize();
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.zoom * (dist / pinch.dist)));
      api.setCamera({
        zoom,
        x: pinch.world.x - (mid.x - size.width / 2) / zoom,
        y: pinch.world.y - (mid.y - size.height / 2) / zoom,
      });
      api.requestDraw();
      return;
    }
    const world = worldPoint(screen);
    if (!drag || drag.id !== event.pointerId) {
      if (api.getTool() === 'polygon') api.polygonMove(world);
      return;
    }
    if (drag.kind === 'pan') {
      const camera = api.getCamera();
      api.setCamera({
        ...camera,
        x: camera.x - (screen.x - drag.x) / camera.zoom,
        y: camera.y - (screen.y - drag.y) / camera.zoom,
      });
      drag.x = screen.x;
      drag.y = screen.y;
      api.requestDraw();
      return;
    }
    if (drag.kind === 'move') {
      api.onMove(drag.placementId, world.x - drag.ox, world.y - drag.oy, false);
      return;
    }
    if (drag.kind === 'resize') {
      api.onResize(
        drag.placementId,
        resizedPlacement(drag.start, drag.handle, world, event.shiftKey, api.maxSize(drag.start)),
        false,
      );
      return;
    }
    if (drag.kind === 'rotate') {
      const placement = api.placement(drag.placementId);
      if (!placement) return;
      const center = placementCenter(placement);
      const angle = Math.atan2(world.y - center.y, world.x - center.x);
      api.onRotate(drag.placementId, drag.startRot + angle - drag.startAngle, false);
      return;
    }
    if (drag.kind === 'box') {
      const box = dragBox(drag.x, drag.y, world.x, world.y, event.shiftKey);
      api.onDraft({ ...box, kind: drag.shape });
      return;
    }
    if (drag.kind === 'poly' || drag.kind === 'place') {
      if (Math.hypot(screen.x - drag.x, screen.y - drag.y) > 8) drag.moved = true;
      if (drag.kind === 'poly') api.polygonMove(world);
    }
  };

  const onUp = (event: PointerEvent): void => {
    const screen = localPoint(event);
    const world = worldPoint(screen);
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    try {
      if (!drag || drag.id !== event.pointerId) return;
      const finished = drag;
      drag = null;
      if (finished.kind === 'poly' && !finished.moved && event.button === 0) api.polygonClick(world);
      if (finished.kind === 'place' && !finished.moved) api.onPlace(finished.world);
      if (finished.kind === 'box') {
        const box = dragBox(finished.x, finished.y, world.x, world.y, event.shiftKey);
        api.onDraft(null);
        if (box.w >= 4 && box.h >= 4) api.onFogBox({ ...box, kind: finished.shape });
      }
      if (finished.kind === 'move') {
        const placement = api.placement(finished.placementId);
        if (placement) api.onMove(placement.id, placement.x, placement.y, true);
      }
      if (finished.kind === 'resize') {
        const placement = api.placement(finished.placementId);
        if (placement) api.onResize(placement.id, placement, true);
      }
      if (finished.kind === 'rotate') {
        const placement = api.placement(finished.placementId);
        if (placement) api.onRotate(placement.id, placement.rotation, true);
      }
      api.onDragStart(null);
    } finally {
      api.setInteracting(pointers.size > 0);
    }
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const screen = { x: event.clientX - canvas.getBoundingClientRect().left, y: event.clientY - canvas.getBoundingClientRect().top };
    const size = api.getSize();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    api.setCamera(zoomAt(api.getCamera(), size.width, size.height, screen.x, screen.y, factor));
    api.requestDraw();
  };

  const onMenu = (event: Event): void => event.preventDefault();
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onMenu);
  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onMenu);
  };
}

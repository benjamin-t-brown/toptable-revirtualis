import type { ClientOp, ServerOp } from './protocol.js';
import type { Asset, FogShape, Placement, RoomState, Scene } from './types.js';
import { DEFAULT_TABLE_COLOR, DEFAULT_TABLE_SIZE, MAX_TABLE_SIZE, MIN_TABLE_SIZE } from './types.js';
import { clamp } from './validate.js';

export interface IdSource {
  next(): string;
}

export type MaterializeResult = { ok: true; ops: ServerOp[] } | { ok: false; error: string };

const MAX_SCENES = 40;
const MAX_PLACEMENTS = 400;
const MAX_FOG = 300;
const TOKEN_SIZE = 64;
const PROP_SIZE = 96;

export function blankScene(id: string, name: string, sortIndex: number): Scene {
  return {
    id,
    name,
    mapAssetId: null,
    backgroundAssetId: null,
    mapFrame: null,
    backgroundFrame: null,
    backgroundColor: DEFAULT_TABLE_COLOR,
    fogEnabled: false,
    width: DEFAULT_TABLE_SIZE,
    height: DEFAULT_TABLE_SIZE,
    sortIndex,
  };
}

export function activeScene(state: RoomState): Scene | null {
  return state.scenes.find((scene) => scene.id === state.activeSceneId) ?? null;
}

function nextSort(items: readonly { sortIndex: number }[]): number {
  let max = -1;
  for (const item of items) max = Math.max(max, item.sortIndex);
  return max + 1;
}

function copyName(name: string): string {
  const next = `${name} copy`;
  return next.length > 40 ? next.slice(0, 40) : next;
}

export function materialize(state: RoomState, op: ClientOp, ids: IdSource): MaterializeResult {
  switch (op.type) {
    case 'scene.create': {
      if (state.scenes.length >= MAX_SCENES) return { ok: false, error: 'Too many scenes' };
      const scene = blankScene(ids.next(), op.name, nextSort(state.scenes));
      return {
        ok: true,
        ops: [
          { type: 'scene.upsert', scene },
          { type: 'scene.activate', sceneId: scene.id },
        ],
      };
    }
    case 'scene.delete': {
      if (!state.scenes.some((scene) => scene.id === op.sceneId)) {
        return { ok: false, error: 'Scene not found' };
      }
      if (state.scenes.length <= 1) return { ok: false, error: 'Keep at least one scene' };
      return { ok: true, ops: [{ type: 'scene.remove', sceneId: op.sceneId }] };
    }
    case 'scene.duplicate': {
      const source = state.scenes.find((scene) => scene.id === op.sceneId);
      if (!source) return { ok: false, error: 'Scene not found' };
      if (state.scenes.length >= MAX_SCENES) return { ok: false, error: 'Too many scenes' };
      const sceneId = ids.next();
      const scene: Scene = {
        ...source,
        id: sceneId,
        name: copyName(source.name),
        sortIndex: nextSort(state.scenes),
      };
      const ops: ServerOp[] = [{ type: 'scene.upsert', scene }];
      for (const placement of state.placements) {
        if (placement.sceneId !== source.id) continue;
        ops.push({
          type: 'place.upsert',
          placement: { ...placement, id: ids.next(), sceneId, owners: placement.owners.slice() },
        });
      }
      for (const shape of state.fog) {
        if (shape.sceneId !== source.id) continue;
        ops.push({
          type: 'fog.upsert',
          shape: { ...shape, id: ids.next(), sceneId, points: shape.points.map((point) => ({ ...point })) },
        });
      }
      ops.push({ type: 'scene.activate', sceneId });
      return { ok: true, ops };
    }
    case 'scene.activate':
      if (!state.scenes.some((scene) => scene.id === op.sceneId)) {
        return { ok: false, error: 'Scene not found' };
      }
      return { ok: true, ops: [{ type: 'scene.activate', sceneId: op.sceneId }] };
    case 'scene.update':
      return updateScene(state, op);
    case 'place.add':
      return addPlacement(state, op, ids);
    case 'place.copy':
      return copyPlacement(state, op, ids);
    case 'place.update':
      return patchPlacement(state, op);
    case 'place.delete':
      if (!state.placements.some((placement) => placement.id === op.placementId)) {
        return { ok: false, error: 'Token not found' };
      }
      return { ok: true, ops: [{ type: 'place.remove', placementId: op.placementId }] };
    case 'place.grant': {
      const placement = state.placements.find((item) => item.id === op.placementId);
      if (!placement) return { ok: false, error: 'Token not found' };
      return { ok: true, ops: [{ type: 'place.patch', placementId: placement.id, owners: op.owners.slice() }] };
    }
    case 'fog.add':
      return addFog(state, op, ids);
    case 'fog.delete':
      if (!state.fog.some((shape) => shape.id === op.shapeId)) {
        return { ok: false, error: 'Fog shape not found' };
      }
      return { ok: true, ops: [{ type: 'fog.remove', shapeId: op.shapeId }] };
    case 'fog.clear':
      if (!state.scenes.some((scene) => scene.id === op.sceneId)) {
        return { ok: false, error: 'Scene not found' };
      }
      return { ok: true, ops: [{ type: 'fog.clear', sceneId: op.sceneId }] };
    case 'sound.play': {
      const asset = state.assets.find((item) => item.id === op.assetId);
      if (!asset || asset.class !== 'sound') return { ok: false, error: 'Sound not found' };
      return { ok: true, ops: [{ type: 'sound.play', assetId: asset.id }] };
    }
    case 'asset.delete':
      if (!state.assets.some((asset) => asset.id === op.assetId)) {
        return { ok: false, error: 'Asset not found' };
      }
      return { ok: true, ops: [{ type: 'asset.remove', assetId: op.assetId }] };
    case 'asset.move': {
      const asset = state.assets.find((item) => item.id === op.assetId);
      if (!asset || asset.class !== 'token') return { ok: false, error: 'Token not found' };
      return { ok: true, ops: [{ type: 'asset.upsert', asset: { ...asset, folder: op.folder } }] };
    }
    default:
      return { ok: false, error: 'Invalid action' };
  }
}

function updateScene(state: RoomState, op: Extract<ClientOp, { type: 'scene.update' }>): MaterializeResult {
  const scene = state.scenes.find((item) => item.id === op.sceneId);
  if (!scene) return { ok: false, error: 'Scene not found' };
  const next: Scene = { ...scene };
  if (op.name !== undefined) next.name = op.name;
  if (op.fogEnabled !== undefined) next.fogEnabled = op.fogEnabled;
  if (op.backgroundColor !== undefined) next.backgroundColor = op.backgroundColor;
  if (op.width !== undefined && Number.isFinite(op.width) && op.width > 0) {
    next.width = clamp(Math.round(op.width), MIN_TABLE_SIZE, MAX_TABLE_SIZE);
  }
  if (op.height !== undefined && Number.isFinite(op.height) && op.height > 0) {
    next.height = clamp(Math.round(op.height), MIN_TABLE_SIZE, MAX_TABLE_SIZE);
  }
  if (op.mapAssetId !== undefined) {
    if (op.mapAssetId !== null) {
      const asset = state.assets.find((item) => item.id === op.mapAssetId);
      if (!asset || asset.class !== 'map') return { ok: false, error: 'Map not found' };
    }
    if (op.mapAssetId !== next.mapAssetId) next.mapFrame = null;
    next.mapAssetId = op.mapAssetId;
  }
  if (op.backgroundAssetId !== undefined) {
    if (op.backgroundAssetId !== null) {
      const asset = state.assets.find((item) => item.id === op.backgroundAssetId);
      if (!asset || asset.class !== 'background') return { ok: false, error: 'Background not found' };
    }
    if (op.backgroundAssetId !== next.backgroundAssetId) next.backgroundFrame = null;
    next.backgroundAssetId = op.backgroundAssetId;
  }
  if (op.mapFrame !== undefined) next.mapFrame = op.mapFrame;
  if (op.backgroundFrame !== undefined) next.backgroundFrame = op.backgroundFrame;
  return { ok: true, ops: [{ type: 'scene.upsert', scene: next }] };
}

function addPlacement(
  state: RoomState,
  op: Extract<ClientOp, { type: 'place.add' }>,
  ids: IdSource,
): MaterializeResult {
  const scene = state.scenes.find((item) => item.id === op.sceneId);
  if (!scene) return { ok: false, error: 'Scene not found' };
  const asset = state.assets.find((item) => item.id === op.assetId);
  if (!asset || (asset.class !== 'token' && asset.class !== 'prop')) {
    return { ok: false, error: 'Only tokens and props can be placed' };
  }
  const count = state.placements.filter((item) => item.sceneId === scene.id).length;
  if (count >= MAX_PLACEMENTS) return { ok: false, error: 'Too many pieces in this scene' };
  const size = asset.class === 'token' ? TOKEN_SIZE : PROP_SIZE;
  let layer = 0;
  for (const placement of state.placements) {
    if (placement.sceneId === scene.id) layer = Math.max(layer, placement.layer + 1);
  }
  const placement: Placement = {
    id: ids.next(),
    sceneId: scene.id,
    assetId: asset.id,
    x: clamp(op.x - size / 2, -100000, 100000),
    y: clamp(op.y - size / 2, -100000, 100000),
    w: size,
    h: size,
    rotation: 0,
    layer,
    label: '',
    owners: [],
  };
  return { ok: true, ops: [{ type: 'place.upsert', placement }] };
}

function copyPlacement(
  state: RoomState,
  op: Extract<ClientOp, { type: 'place.copy' }>,
  ids: IdSource,
): MaterializeResult {
  const source = state.placements.find((item) => item.id === op.placementId);
  if (!source) return { ok: false, error: 'Token not found' };
  const count = state.placements.filter((item) => item.sceneId === source.sceneId).length;
  if (count >= MAX_PLACEMENTS) return { ok: false, error: 'Too many pieces in this scene' };
  let layer = source.layer;
  for (const placement of state.placements) {
    if (placement.sceneId === source.sceneId) layer = Math.max(layer, placement.layer + 1);
  }
  const placement: Placement = {
    id: ids.next(),
    sceneId: source.sceneId,
    assetId: source.assetId,
    x: clamp(op.x - source.w / 2, -100000, 100000),
    y: clamp(op.y - source.h / 2, -100000, 100000),
    w: source.w,
    h: source.h,
    rotation: source.rotation,
    layer,
    label: source.label,
    owners: source.owners.slice(),
  };
  return { ok: true, ops: [{ type: 'place.upsert', placement }] };
}

function patchPlacement(state: RoomState, op: Extract<ClientOp, { type: 'place.update' }>): MaterializeResult {
  const placement = state.placements.find((item) => item.id === op.placementId);
  if (!placement) return { ok: false, error: 'Token not found' };
  const patch: Extract<ServerOp, { type: 'place.patch' }> = {
    type: 'place.patch',
    placementId: placement.id,
  };
  if (op.x !== undefined) patch.x = clamp(op.x, -100000, 100000);
  if (op.y !== undefined) patch.y = clamp(op.y, -100000, 100000);
  if (op.w !== undefined) patch.w = clamp(op.w, 8, 8000);
  if (op.h !== undefined) patch.h = clamp(op.h, 8, 8000);
  if (op.rotation !== undefined) {
    if (Math.abs(op.rotation) > 10000) return { ok: false, error: 'Invalid rotation' };
    patch.rotation = op.rotation;
  }
  if (op.layer !== undefined) patch.layer = clamp(Math.round(op.layer), -100000, 100000);
  if (op.label !== undefined) patch.label = op.label;
  return { ok: true, ops: [patch] };
}

function addFog(
  state: RoomState,
  op: Extract<ClientOp, { type: 'fog.add' }>,
  ids: IdSource,
): MaterializeResult {
  const scene = state.scenes.find((item) => item.id === op.sceneId);
  if (!scene) return { ok: false, error: 'Scene not found' };
  const count = state.fog.filter((shape) => shape.sceneId === scene.id).length;
  if (count >= MAX_FOG) return { ok: false, error: 'Too many fog shapes' };
  let x = op.x;
  let y = op.y;
  let w = op.w;
  let h = op.h;
  if (op.kind !== 'polygon') {
    if (w < 0) {
      x += w;
      w = Math.abs(w);
    }
    if (h < 0) {
      y += h;
      h = Math.abs(h);
    }
    if (w < 2 || h < 2) return { ok: false, error: 'Fog shape is too small' };
    w = clamp(w, 2, 20000);
    h = clamp(h, 2, 20000);
  }
  const shape: FogShape = {
    id: ids.next(),
    sceneId: scene.id,
    kind: op.kind,
    mode: op.mode,
    points: op.points.map((point) => ({
      x: clamp(point.x, -100000, 100000),
      y: clamp(point.y, -100000, 100000),
    })),
    x: clamp(x, -100000, 100000),
    y: clamp(y, -100000, 100000),
    w,
    h,
    sortIndex: nextSort(state.fog.filter((item) => item.sceneId === scene.id)),
  };
  const ops: ServerOp[] = [];
  if (!scene.fogEnabled) ops.push({ type: 'scene.upsert', scene: { ...scene, fogEnabled: true } });
  ops.push({ type: 'fog.upsert', shape });
  return { ok: true, ops };
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((entry) => entry.id === item.id);
  if (index < 0) return items.concat(item);
  const next = items.slice();
  next[index] = item;
  return next;
}

export function applyServerOp(state: RoomState, op: ServerOp): RoomState {
  switch (op.type) {
    case 'scene.upsert':
      return { ...state, scenes: upsert(state.scenes, op.scene) };
    case 'scene.remove': {
      const scenes = state.scenes.filter((scene) => scene.id !== op.sceneId);
      let activeSceneId = state.activeSceneId;
      if (activeSceneId === op.sceneId) {
        const next = scenes.slice().sort((a, b) => a.sortIndex - b.sortIndex)[0];
        activeSceneId = next?.id ?? null;
      }
      return {
        ...state,
        scenes,
        activeSceneId,
        placements: state.placements.filter((placement) => placement.sceneId !== op.sceneId),
        fog: state.fog.filter((shape) => shape.sceneId !== op.sceneId),
      };
    }
    case 'scene.activate':
      if (!state.scenes.some((scene) => scene.id === op.sceneId)) return state;
      return { ...state, activeSceneId: op.sceneId };
    case 'place.upsert':
      return { ...state, placements: upsert(state.placements, op.placement) };
    case 'place.patch': {
      const current = state.placements.find((placement) => placement.id === op.placementId);
      if (!current) return state;
      const placement: Placement = { ...current };
      if (op.x !== undefined) placement.x = op.x;
      if (op.y !== undefined) placement.y = op.y;
      if (op.w !== undefined) placement.w = op.w;
      if (op.h !== undefined) placement.h = op.h;
      if (op.rotation !== undefined) placement.rotation = op.rotation;
      if (op.layer !== undefined) placement.layer = op.layer;
      if (op.label !== undefined) placement.label = op.label;
      if (op.owners !== undefined) placement.owners = op.owners.slice();
      return { ...state, placements: upsert(state.placements, placement) };
    }
    case 'place.remove':
      return { ...state, placements: state.placements.filter((placement) => placement.id !== op.placementId) };
    case 'fog.upsert':
      return { ...state, fog: upsert(state.fog, op.shape) };
    case 'fog.remove':
      return { ...state, fog: state.fog.filter((shape) => shape.id !== op.shapeId) };
    case 'fog.clear':
      return { ...state, fog: state.fog.filter((shape) => shape.sceneId !== op.sceneId) };
    case 'asset.upsert':
      return { ...state, assets: upsert(state.assets, op.asset) };
    case 'asset.remove':
      return removeAsset(state, op.assetId);
    case 'sound.play':
      return state;
    default:
      return state;
  }
}

function removeAsset(state: RoomState, assetId: string): RoomState {
  return {
    ...state,
    assets: state.assets.filter((asset) => asset.id !== assetId),
    placements: state.placements.filter((placement) => placement.assetId !== assetId),
    scenes: state.scenes.map((scene) => ({
      ...scene,
      mapAssetId: scene.mapAssetId === assetId ? null : scene.mapAssetId,
      mapFrame: scene.mapAssetId === assetId ? null : scene.mapFrame,
      backgroundAssetId: scene.backgroundAssetId === assetId ? null : scene.backgroundAssetId,
      backgroundFrame: scene.backgroundAssetId === assetId ? null : scene.backgroundFrame,
    })),
  };
}

export function assetRemovedIds(ops: readonly ServerOp[]): string[] {
  const ids: string[] = [];
  for (const op of ops) {
    if (op.type === 'asset.remove') ids.push(op.assetId);
  }
  return ids;
}

export function emptyRoom(code: string): RoomState {
  return { code, activeSceneId: null, assets: [], scenes: [], placements: [], fog: [] };
}

export function findAsset(state: RoomState, id: string): Asset | undefined {
  return state.assets.find((asset) => asset.id === id);
}

import type { Asset, FogKind, FogMode, FogShape, ImageFrame, Placement, Point, Presence, Role, RoomState, Scene } from './types.js';
import { cleanColor, cleanFolder, cleanLabel, cleanOwners, cleanSceneName, finiteNumber, isId, isRecord, parseImageFrame } from './validate.js';

export interface SessionResponse {
  code: string;
  token: string;
  role: Role;
  name: string;
  dmKey?: string;
}

export type ClientOp =
  | { type: 'scene.create'; name: string }
  | { type: 'scene.delete'; sceneId: string }
  | { type: 'scene.duplicate'; sceneId: string }
  | { type: 'scene.activate'; sceneId: string }
  | {
      type: 'scene.update';
      sceneId: string;
      name?: string;
      mapAssetId?: string | null;
      backgroundAssetId?: string | null;
      mapFrame?: ImageFrame | null;
      backgroundFrame?: ImageFrame | null;
      backgroundColor?: string;
      fogEnabled?: boolean;
      width?: number;
      height?: number;
    }
  | { type: 'place.add'; sceneId: string; assetId: string; x: number; y: number }
  | { type: 'place.copy'; placementId: string; x: number; y: number }
  | {
      type: 'place.update';
      placementId: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      rotation?: number;
      layer?: number;
      label?: string;
    }
  | { type: 'place.delete'; placementId: string }
  | { type: 'place.grant'; placementId: string; owners: string[] }
  | {
      type: 'fog.add';
      sceneId: string;
      kind: FogKind;
      mode: FogMode;
      points: Point[];
      x: number;
      y: number;
      w: number;
      h: number;
    }
  | { type: 'fog.delete'; shapeId: string }
  | { type: 'fog.clear'; sceneId: string }
  | { type: 'sound.play'; assetId: string }
  | { type: 'asset.delete'; assetId: string }
  | { type: 'asset.move'; assetId: string; folder: string };

export type ServerOp =
  | { type: 'scene.upsert'; scene: Scene }
  | { type: 'scene.remove'; sceneId: string }
  | { type: 'scene.activate'; sceneId: string }
  | { type: 'place.upsert'; placement: Placement }
  | {
      type: 'place.patch';
      placementId: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      rotation?: number;
      layer?: number;
      label?: string;
      owners?: string[];
    }
  | { type: 'place.remove'; placementId: string }
  | { type: 'fog.upsert'; shape: FogShape }
  | { type: 'fog.remove'; shapeId: string }
  | { type: 'fog.clear'; sceneId: string }
  | { type: 'asset.upsert'; asset: Asset }
  | { type: 'asset.remove'; assetId: string }
  | { type: 'sound.play'; assetId: string };

export interface SnapshotBody {
  role: Role;
  selfName: string;
  presence: Presence[];
  state: RoomState;
}

export type ServerMsg =
  | ({ type: 'snapshot' } & SnapshotBody)
  | { type: 'ops'; ops: ServerOp[] }
  | { type: 'reject'; error: string; snapshot?: SnapshotBody }
  | { type: 'presence'; presence: Presence[] }
  | { type: 'error'; error: string };

const PLACE_FIELDS = ['x', 'y', 'w', 'h', 'rotation', 'layer'] as const;
export type PlaceField = (typeof PLACE_FIELDS)[number];

export function placeFields(op: Extract<ClientOp, { type: 'place.update' }>): PlaceField[] {
  return PLACE_FIELDS.filter((key) => op[key] !== undefined);
}

function optionalId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (isId(value)) return value;
  return undefined;
}

function optionalPositive(source: Record<string, unknown>, key: string): number | undefined | false {
  if (!(key in source)) return undefined;
  const parsed = finiteNumber(source[key]);
  if (parsed === null || parsed <= 0) return false;
  return parsed;
}

function optionalNumber(source: Record<string, unknown>, key: string): number | undefined | false {
  if (!(key in source)) return undefined;
  const parsed = finiteNumber(source[key]);
  return parsed === null ? false : parsed;
}

function readPoints(value: unknown): Point[] | null {
  if (!Array.isArray(value) || value.length > 64) return null;
  const points: Point[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const x = finiteNumber(item.x);
    const y = finiteNumber(item.y);
    if (x === null || y === null) return null;
    points.push({ x, y });
  }
  return points;
}

export function parseClientOp(value: unknown): ClientOp | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  switch (value.type) {
    case 'scene.create': {
      const name = cleanSceneName(value.name);
      return name ? { type: 'scene.create', name } : null;
    }
    case 'scene.delete':
      return isId(value.sceneId) ? { type: 'scene.delete', sceneId: value.sceneId } : null;
    case 'scene.duplicate':
      return isId(value.sceneId) ? { type: 'scene.duplicate', sceneId: value.sceneId } : null;
    case 'scene.activate':
      return isId(value.sceneId) ? { type: 'scene.activate', sceneId: value.sceneId } : null;
    case 'scene.update': {
      if (!isId(value.sceneId)) return null;
      const op: Extract<ClientOp, { type: 'scene.update' }> = {
        type: 'scene.update',
        sceneId: value.sceneId,
      };
      if ('name' in value) {
        const name = cleanSceneName(value.name);
        if (!name) return null;
        op.name = name;
      }
      if ('mapAssetId' in value) {
        const id = optionalId(value.mapAssetId);
        if (id === undefined && value.mapAssetId !== null) return null;
        op.mapAssetId = id ?? null;
      }
      if ('backgroundAssetId' in value) {
        const id = optionalId(value.backgroundAssetId);
        if (id === undefined && value.backgroundAssetId !== null) return null;
        op.backgroundAssetId = id ?? null;
      }
      if ('mapFrame' in value) {
        const frame = parseImageFrame(value.mapFrame);
        if (frame === undefined) return null;
        op.mapFrame = frame;
      }
      if ('backgroundFrame' in value) {
        const frame = parseImageFrame(value.backgroundFrame);
        if (frame === undefined) return null;
        op.backgroundFrame = frame;
      }
      if ('backgroundColor' in value) {
        const color = cleanColor(value.backgroundColor);
        if (!color) return null;
        op.backgroundColor = color;
      }
      if ('fogEnabled' in value) {
        if (typeof value.fogEnabled !== 'boolean') return null;
        op.fogEnabled = value.fogEnabled;
      }
      const width = optionalPositive(value, 'width');
      if (width === false) return null;
      if (width !== undefined) op.width = width;
      const height = optionalPositive(value, 'height');
      if (height === false) return null;
      if (height !== undefined) op.height = height;
      return op;
    }
    case 'place.add': {
      const x = finiteNumber(value.x);
      const y = finiteNumber(value.y);
      if (!isId(value.sceneId) || !isId(value.assetId) || x === null || y === null) return null;
      return { type: 'place.add', sceneId: value.sceneId, assetId: value.assetId, x, y };
    }
    case 'place.copy': {
      const x = finiteNumber(value.x);
      const y = finiteNumber(value.y);
      if (!isId(value.placementId) || x === null || y === null) return null;
      return { type: 'place.copy', placementId: value.placementId, x, y };
    }
    case 'place.update': {
      if (!isId(value.placementId)) return null;
      const op: Extract<ClientOp, { type: 'place.update' }> = {
        type: 'place.update',
        placementId: value.placementId,
      };
      for (const key of PLACE_FIELDS) {
        const parsed = optionalNumber(value, key);
        if (parsed === false) return null;
        if (parsed !== undefined) op[key] = parsed;
      }
      if ('label' in value) {
        const label = cleanLabel(value.label);
        if (label === null) return null;
        op.label = label;
      }
      return placeFields(op).length > 0 || op.label !== undefined ? op : null;
    }
    case 'place.delete':
      return isId(value.placementId) ? { type: 'place.delete', placementId: value.placementId } : null;
    case 'place.grant': {
      if (!isId(value.placementId)) return null;
      const owners = cleanOwners(value.owners);
      if (!owners) return null;
      return { type: 'place.grant', placementId: value.placementId, owners };
    }
    case 'fog.add': {
      if (!isId(value.sceneId)) return null;
      if (value.kind !== 'polygon' && value.kind !== 'rect' && value.kind !== 'ellipse') return null;
      if (value.mode !== 'reveal' && value.mode !== 'cover') return null;
      const points = readPoints(value.points);
      const x = finiteNumber(value.x);
      const y = finiteNumber(value.y);
      const w = finiteNumber(value.w);
      const h = finiteNumber(value.h);
      if (!points || x === null || y === null || w === null || h === null) return null;
      if (value.kind === 'polygon' && points.length < 3) return null;
      return {
        type: 'fog.add',
        sceneId: value.sceneId,
        kind: value.kind,
        mode: value.mode,
        points,
        x,
        y,
        w,
        h,
      };
    }
    case 'fog.delete':
      return isId(value.shapeId) ? { type: 'fog.delete', shapeId: value.shapeId } : null;
    case 'fog.clear':
      return isId(value.sceneId) ? { type: 'fog.clear', sceneId: value.sceneId } : null;
    case 'sound.play':
      return isId(value.assetId) ? { type: 'sound.play', assetId: value.assetId } : null;
    case 'asset.delete':
      return isId(value.assetId) ? { type: 'asset.delete', assetId: value.assetId } : null;
    case 'asset.move': {
      const folder = cleanFolder(value.folder);
      return isId(value.assetId) && folder ? { type: 'asset.move', assetId: value.assetId, folder } : null;
    }
    default:
      return null;
  }
}

export function parseClientMessage(value: unknown): { type: 'op'; op: ClientOp } | null {
  if (!isRecord(value) || value.type !== 'op') return null;
  const op = parseClientOp(value.op);
  return op ? { type: 'op', op } : null;
}

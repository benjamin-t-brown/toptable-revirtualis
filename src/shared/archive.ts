import {
  MAX_RULER_SCALE,
  MAX_TABLE_SIZE,
  MIN_RULER_SCALE,
  MIN_TABLE_SIZE,
  type AssetClass,
  type FogShape,
  type Placement,
  type Scene,
} from './types.js';
import {
  cleanAssetName,
  cleanColor,
  cleanFolder,
  cleanLabel,
  cleanOwners,
  cleanSceneName,
  finiteNumber,
  isAssetClass,
  isId,
  isRecord,
  parseImageFrame,
} from './validate.js';

export const ARCHIVE_VERSION = 1;
export const MAX_ARCHIVE_BYTES = 96 * 1024 * 1024;
export const MAX_ARCHIVE_UPLOADS = 300;
const MAX_SCENES = 40;
const MAX_PLACEMENTS = 400;
const MAX_FOG = 300;
const MAX_FOG_POINTS = 64;

export interface ArchiveAsset {
  id: string;
  name: string;
  class: AssetClass;
  mime: string;
  folder?: string;
  source?: string;
}

const SOURCE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(png|jpe?g|gif|webp)$/;
const MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'audio/mpeg', 'audio/ogg', 'audio/wav']);

export interface RoomArchive {
  version: 1;
  activeSceneId: string;
  scenes: Scene[];
  placements: Placement[];
  fog: FogShape[];
  assets: ArchiveAsset[];
}

export function parseRoomArchive(value: unknown): { ok: true; archive: RoomArchive } | { ok: false; error: string } {
  if (!isRecord(value) || value.version !== ARCHIVE_VERSION) return fail('Archive version is not supported');
  if (!Array.isArray(value.assets) || !Array.isArray(value.scenes) || !Array.isArray(value.placements) || !Array.isArray(value.fog)) {
    return fail('Archive is missing its lists');
  }
  if (value.scenes.length < 1 || value.scenes.length > MAX_SCENES) return fail('Archive has an invalid scene list');
  if (value.assets.length > 2000) return fail('Archive has too many assets');
  const assets: ArchiveAsset[] = [];
  const assetIds = new Set<string>();
  let uploads = 0;
  for (const item of value.assets) {
    const asset = parseArchiveAsset(item);
    if (!asset) return fail('Archive has an invalid asset');
    if (assetIds.has(asset.id)) return fail('Archive repeats an asset');
    assetIds.add(asset.id);
    if (!asset.source) uploads += 1;
    assets.push(asset);
  }
  if (uploads > MAX_ARCHIVE_UPLOADS) return fail('Archive has too many uploaded files');
  const scenes: Scene[] = [];
  const sceneIds = new Set<string>();
  for (const item of value.scenes) {
    const scene = parseScene(item, assetIds);
    if (!scene) return fail('Archive has an invalid scene');
    if (sceneIds.has(scene.id)) return fail('Archive repeats a scene');
    sceneIds.add(scene.id);
    scenes.push(scene);
  }
  if (!isId(value.activeSceneId) || !sceneIds.has(value.activeSceneId)) return fail('Archive has no active scene');
  const placements: Placement[] = [];
  const placementIds = new Set<string>();
  const placed = new Map<string, number>();
  for (const item of value.placements) {
    const placement = parsePlacement(item, sceneIds, assetIds);
    if (!placement) return fail('Archive has an invalid piece');
    if (placementIds.has(placement.id)) return fail('Archive repeats a piece');
    placementIds.add(placement.id);
    const count = (placed.get(placement.sceneId) ?? 0) + 1;
    if (count > MAX_PLACEMENTS) return fail('Archive has too many pieces in a scene');
    placed.set(placement.sceneId, count);
    placements.push(placement);
  }
  const fog: FogShape[] = [];
  const fogIds = new Set<string>();
  const fogCounts = new Map<string, number>();
  for (const item of value.fog) {
    const shape = parseFog(item, sceneIds);
    if (!shape) return fail('Archive has an invalid fog shape');
    if (fogIds.has(shape.id)) return fail('Archive repeats a fog shape');
    fogIds.add(shape.id);
    const count = (fogCounts.get(shape.sceneId) ?? 0) + 1;
    if (count > MAX_FOG) return fail('Archive has too many fog shapes');
    fogCounts.set(shape.sceneId, count);
    fog.push(shape);
  }
  return {
    ok: true,
    archive: { version: ARCHIVE_VERSION, activeSceneId: value.activeSceneId, scenes, placements, fog, assets },
  };
}

function parseArchiveAsset(value: unknown): ArchiveAsset | null {
  if (!isRecord(value) || !isId(value.id) || !isAssetClass(value.class)) return null;
  if (typeof value.mime !== 'string' || !MIMES.has(value.mime)) return null;
  const image = value.mime.startsWith('image/');
  if (value.class === 'sound' ? image : !image) return null;
  const name = cleanAssetName(value.name);
  const asset: ArchiveAsset = { id: value.id, name, class: value.class, mime: value.mime };
  if ('folder' in value && value.folder != null) {
    const folder = cleanFolder(value.folder);
    if (!folder) return null;
    asset.folder = folder;
  }
  if ('source' in value && value.source != null) {
    if (typeof value.source !== 'string' || !SOURCE_NAME.test(value.source)) return null;
    if (value.class !== 'token' || !image) return null;
    asset.source = value.source;
  }
  return asset;
}

function parseScene(value: unknown, assetIds: Set<string>): Scene | null {
  if (!isRecord(value) || !isId(value.id)) return null;
  const name = cleanSceneName(value.name);
  const color = cleanColor(value.backgroundColor);
  const width = finiteNumber(value.width);
  const height = finiteNumber(value.height);
  const rulerScale = finiteNumber(value.rulerScale);
  const sortIndex = finiteNumber(value.sortIndex);
  if (!name || !color || width === null || height === null || rulerScale === null || sortIndex === null) return null;
  if (width < MIN_TABLE_SIZE || height < MIN_TABLE_SIZE || width > MAX_TABLE_SIZE || height > MAX_TABLE_SIZE) return null;
  if (rulerScale < MIN_RULER_SCALE || rulerScale > MAX_RULER_SCALE) return null;
  if (!Number.isInteger(sortIndex) || sortIndex < 0 || sortIndex > 100000) return null;
  if (value.rulerUnit !== 'ft' && value.rulerUnit !== 'm') return null;
  if (typeof value.fogEnabled !== 'boolean') return null;
  const mapAssetId = optionalAsset(value.mapAssetId, assetIds);
  const backgroundAssetId = optionalAsset(value.backgroundAssetId, assetIds);
  const mapFrame = parseImageFrame(value.mapFrame);
  const backgroundFrame = parseImageFrame(value.backgroundFrame);
  if (mapAssetId === undefined || backgroundAssetId === undefined || mapFrame === undefined || backgroundFrame === undefined) return null;
  return {
    id: value.id,
    name,
    mapAssetId,
    backgroundAssetId,
    mapFrame,
    backgroundFrame,
    backgroundColor: color,
    fogEnabled: value.fogEnabled,
    width,
    height,
    rulerScale,
    rulerUnit: value.rulerUnit,
    sortIndex,
  };
}

function parsePlacement(value: unknown, sceneIds: Set<string>, assetIds: Set<string>): Placement | null {
  if (!isRecord(value) || !isId(value.id) || !isId(value.sceneId) || !isId(value.assetId)) return null;
  if (!sceneIds.has(value.sceneId) || !assetIds.has(value.assetId)) return null;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const w = finiteNumber(value.w);
  const h = finiteNumber(value.h);
  const rotation = finiteNumber(value.rotation);
  const layer = finiteNumber(value.layer);
  if (x === null || y === null || w === null || h === null || rotation === null || layer === null) return null;
  if (Math.abs(x) > 100000 || Math.abs(y) > 100000 || Math.abs(rotation) > 10000) return null;
  if (w < 8 || h < 8 || w > MAX_TABLE_SIZE || h > MAX_TABLE_SIZE) return null;
  if (!Number.isInteger(layer) || Math.abs(layer) > 100000) return null;
  const label = cleanLabel(value.label ?? '');
  const owners = cleanOwners(value.owners ?? []);
  if (label === null || !owners) return null;
  return { id: value.id, sceneId: value.sceneId, assetId: value.assetId, x, y, w, h, rotation, layer, label, owners };
}

function parseFog(value: unknown, sceneIds: Set<string>): FogShape | null {
  if (!isRecord(value) || !isId(value.id) || !isId(value.sceneId) || !sceneIds.has(value.sceneId)) return null;
  if (value.kind !== 'polygon' && value.kind !== 'rect' && value.kind !== 'ellipse') return null;
  if (value.mode !== 'reveal' && value.mode !== 'cover') return null;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const w = finiteNumber(value.w);
  const h = finiteNumber(value.h);
  const sortIndex = finiteNumber(value.sortIndex);
  if (x === null || y === null || w === null || h === null || sortIndex === null) return null;
  if (!Number.isInteger(sortIndex) || sortIndex < 0 || sortIndex > 100000) return null;
  if (!Array.isArray(value.points) || value.points.length > MAX_FOG_POINTS) return null;
  const points: { x: number; y: number }[] = [];
  for (const item of value.points) {
    if (!isRecord(item)) return null;
    const px = finiteNumber(item.x);
    const py = finiteNumber(item.y);
    if (px === null || py === null || Math.abs(px) > 100000 || Math.abs(py) > 100000) return null;
    points.push({ x: px, y: py });
  }
  if (value.kind === 'polygon' && points.length < 3) return null;
  return { id: value.id, sceneId: value.sceneId, kind: value.kind, mode: value.mode, points, x, y, w, h, sortIndex };
}

function optionalAsset(value: unknown, assetIds: Set<string>): string | null | undefined {
  if (value === null) return null;
  if (!isId(value) || !assetIds.has(value)) return undefined;
  return value;
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

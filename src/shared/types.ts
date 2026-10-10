export type Role = 'dm' | 'player';

export type AssetClass = 'map' | 'token' | 'background' | 'prop' | 'sound';

export const ASSET_CLASSES: readonly AssetClass[] = [
  'map',
  'token',
  'background',
  'prop',
  'sound',
];

export interface Asset {
  id: string;
  name: string;
  class: AssetClass;
  mime: string;
  /** Set when a token has been filed by hand. Null uses the name-based folder. */
  folder?: string | null;
}

export interface ImageFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export interface Scene {
  id: string;
  name: string;
  mapAssetId: string | null;
  backgroundAssetId: string | null;
  /** Null until the map is moved. The image then draws at its own size from the origin. */
  mapFrame: ImageFrame | null;
  backgroundFrame: ImageFrame | null;
  backgroundColor: string;
  fogEnabled: boolean;
  width: number;
  height: number;
  sortIndex: number;
}

export interface Placement {
  id: string;
  sceneId: string;
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  layer: number;
  /** Shown above the token. Empty until someone types one. */
  label: string;
  owners: string[];
}

export interface Point {
  x: number;
  y: number;
}

export type FogKind = 'polygon' | 'rect' | 'ellipse';
export type FogMode = 'reveal' | 'cover';

export interface FogShape {
  id: string;
  sceneId: string;
  kind: FogKind;
  mode: FogMode;
  points: Point[];
  x: number;
  y: number;
  w: number;
  h: number;
  sortIndex: number;
}

export interface Presence {
  name: string;
  role: Role;
}

export interface RoomState {
  code: string;
  activeSceneId: string | null;
  assets: Asset[];
  scenes: Scene[];
  placements: Placement[];
  fog: FogShape[];
}

export const DEFAULT_TABLE_COLOR = '#000000';
export const TABLE_BACKDROP = '#363636';
export const DEFAULT_TABLE_SIZE = 5000;
export const MIN_TABLE_SIZE = 256;
export const MAX_TABLE_SIZE = 20000;

export function sceneBoard(scene: { width?: number; height?: number } | null | undefined): { width: number; height: number } {
  return { width: boardEdge(scene?.width), height: boardEdge(scene?.height) };
}

function boardEdge(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_TABLE_SIZE;
  return value;
}

export const DICE_SIDES = [4, 6, 8, 10, 12, 100, 20] as const;
export type DieSides = (typeof DICE_SIDES)[number];

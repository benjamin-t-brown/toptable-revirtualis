import type { AssetClass, ImageFrame } from './types.js';
import { ASSET_CLASSES, MAX_TABLE_SIZE } from './types.js';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 24) return null;
  if (/[\u0000-\u001f]/.test(name)) return null;
  return name;
}

export function cleanSceneName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 40) return null;
  if (/[\u0000-\u001f]/.test(name)) return null;
  return name;
}

const FOLDER = /^(?:[A-Za-z0-9][A-Za-z0-9 ]{0,39})(?:\/[A-Za-z0-9][A-Za-z0-9 ]{0,39}){0,3}$/;

export function cleanFolder(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const folder = value.trim();
  if (!FOLDER.test(folder)) return null;
  return folder;
}

export function cleanAssetName(value: unknown): string {
  const raw = typeof value === 'string' ? value : 'asset';
  const base = raw.split(/[/\\]/).pop() ?? 'asset';
  const cleaned = base.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
  return cleaned || 'asset';
}

export function cleanColor(value: unknown): string | null {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) return null;
  return value.toLowerCase();
}

export function cleanOwners(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 24) return null;
  const owners: string[] = [];
  for (const item of value) {
    const name = cleanName(item);
    if (!name) return null;
    if (!owners.includes(name)) owners.push(name);
  }
  return owners;
}

export function isAssetClass(value: unknown): value is AssetClass {
  return typeof value === 'string' && (ASSET_CLASSES as readonly string[]).includes(value);
}

export function parseImageFrame(value: unknown): ImageFrame | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const w = finiteNumber(value.w);
  const h = finiteNumber(value.h);
  const rotation = finiteNumber(value.rotation);
  if (x === null || y === null || w === null || h === null || rotation === null) return undefined;
  if (Math.abs(x) > 100000 || Math.abs(y) > 100000 || Math.abs(rotation) > 10000) return undefined;
  if (w < 16 || h < 16 || w > MAX_TABLE_SIZE || h > MAX_TABLE_SIZE) return undefined;
  return { x, y, w, h, rotation };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

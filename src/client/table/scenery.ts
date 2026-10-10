import type { ImageFrame, Placement, Scene } from '../../shared/types.js';

export const MAP_SELECTION = 'scene-map';
export const BACKGROUND_SELECTION = 'scene-background';

export type SceneryKind = 'map' | 'background';

export function sceneryKind(id: string): SceneryKind | null {
  if (id === MAP_SELECTION) return 'map';
  if (id === BACKGROUND_SELECTION) return 'background';
  return null;
}

export function sceneryPlacement(
  scene: Scene,
  kind: SceneryKind,
  images: ReadonlyMap<string, CanvasImageSource>,
): Placement | null {
  const assetId = kind === 'map' ? scene.mapAssetId : scene.backgroundAssetId;
  if (!assetId) return null;
  const stored = kind === 'map' ? scene.mapFrame : scene.backgroundFrame;
  const frame = stored ?? naturalFrame(images.get(assetId));
  if (!frame) return null;
  return {
    id: kind === 'map' ? MAP_SELECTION : BACKGROUND_SELECTION,
    sceneId: scene.id,
    assetId,
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h,
    rotation: frame.rotation,
    layer: kind === 'map' ? -1 : -2,
    label: '',
    owners: [],
  };
}

export function frameOf(placement: Pick<Placement, 'x' | 'y' | 'w' | 'h' | 'rotation'>): ImageFrame {
  return { x: placement.x, y: placement.y, w: placement.w, h: placement.h, rotation: placement.rotation };
}

function naturalFrame(image: CanvasImageSource | undefined): ImageFrame | null {
  const size = image ? sourceSize(image) : null;
  if (!size) return null;
  return { x: 0, y: 0, w: size.w, h: size.h, rotation: 0 };
}

function sourceSize(image: CanvasImageSource): { w: number; h: number } | null {
  if (image instanceof ImageBitmap || image instanceof HTMLCanvasElement) {
    if (image.width < 1 || image.height < 1) return null;
    return { w: image.width, h: image.height };
  }
  if (image instanceof HTMLImageElement) {
    if (image.naturalWidth < 1 || image.naturalHeight < 1) return null;
    return { w: image.naturalWidth, h: image.naturalHeight };
  }
  return null;
}

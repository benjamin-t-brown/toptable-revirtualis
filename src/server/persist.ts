import type { DatabaseSync } from 'node:sqlite';
import type { ServerOp } from '../shared/protocol.js';
import type { FogShape, ImageFrame, Placement, RoomState, Scene } from '../shared/types.js';

function frameText(frame: ImageFrame | null): string | null {
  return frame ? JSON.stringify(frame) : null;
}

function upsertScene(db: DatabaseSync, roomId: string, scene: Scene): void {
  db.prepare(
    `INSERT INTO scenes (id, room_id, name, map_asset_id, background_asset_id, background_color, fog_enabled, sort_index, width, height, map_frame, background_frame)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       map_asset_id = excluded.map_asset_id,
       background_asset_id = excluded.background_asset_id,
       background_color = excluded.background_color,
       fog_enabled = excluded.fog_enabled,
       sort_index = excluded.sort_index,
       width = excluded.width,
       height = excluded.height,
       map_frame = excluded.map_frame,
       background_frame = excluded.background_frame`,
  ).run(
    scene.id,
    roomId,
    scene.name,
    scene.mapAssetId,
    scene.backgroundAssetId,
    scene.backgroundColor,
    scene.fogEnabled ? 1 : 0,
    scene.sortIndex,
    scene.width,
    scene.height,
    frameText(scene.mapFrame),
    frameText(scene.backgroundFrame),
  );
}

function upsertPlacement(db: DatabaseSync, placement: Placement): void {
  db.prepare(
    `INSERT INTO placements (id, scene_id, asset_id, x, y, w, h, rotation, layer, owners)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       scene_id = excluded.scene_id,
       asset_id = excluded.asset_id,
       x = excluded.x,
       y = excluded.y,
       w = excluded.w,
       h = excluded.h,
       rotation = excluded.rotation,
       layer = excluded.layer,
       owners = excluded.owners`,
  ).run(
    placement.id,
    placement.sceneId,
    placement.assetId,
    placement.x,
    placement.y,
    placement.w,
    placement.h,
    placement.rotation,
    placement.layer,
    JSON.stringify(placement.owners),
  );
}

function upsertFog(db: DatabaseSync, shape: FogShape): void {
  db.prepare(
    `INSERT INTO fog_shapes (id, scene_id, kind, mode, points, x, y, w, h, sort_index)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       scene_id = excluded.scene_id,
       kind = excluded.kind,
       mode = excluded.mode,
       points = excluded.points,
       x = excluded.x,
       y = excluded.y,
       w = excluded.w,
       h = excluded.h,
       sort_index = excluded.sort_index`,
  ).run(
    shape.id,
    shape.sceneId,
    shape.kind,
    shape.mode,
    JSON.stringify(shape.points),
    shape.x,
    shape.y,
    shape.w,
    shape.h,
    shape.sortIndex,
  );
}

export function persistOps(db: DatabaseSync, roomId: string, ops: readonly ServerOp[], next: RoomState): void {
  for (const op of ops) {
    switch (op.type) {
      case 'scene.upsert':
        upsertScene(db, roomId, op.scene);
        break;
      case 'scene.remove':
        db.prepare('DELETE FROM placements WHERE scene_id = ?').run(op.sceneId);
        db.prepare('DELETE FROM fog_shapes WHERE scene_id = ?').run(op.sceneId);
        db.prepare('DELETE FROM scenes WHERE id = ?').run(op.sceneId);
        break;
      case 'scene.activate':
        break;
      case 'place.upsert':
        upsertPlacement(db, op.placement);
        break;
      case 'place.patch': {
        const placement = next.placements.find((item) => item.id === op.placementId);
        if (placement) upsertPlacement(db, placement);
        break;
      }
      case 'place.remove':
        db.prepare('DELETE FROM placements WHERE id = ?').run(op.placementId);
        break;
      case 'fog.upsert':
        upsertFog(db, op.shape);
        break;
      case 'fog.remove':
        db.prepare('DELETE FROM fog_shapes WHERE id = ?').run(op.shapeId);
        break;
      case 'fog.clear':
        db.prepare('DELETE FROM fog_shapes WHERE scene_id = ?').run(op.sceneId);
        break;
      case 'asset.upsert':
        db.prepare(
          `INSERT INTO assets (id, room_id, name, class, mime, created_at, folder)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             class = excluded.class,
             mime = excluded.mime,
             folder = excluded.folder`,
        ).run(op.asset.id, roomId, op.asset.name, op.asset.class, op.asset.mime, Date.now(), op.asset.folder ?? null);
        break;
      case 'asset.remove':
        db.prepare('DELETE FROM placements WHERE asset_id = ?').run(op.assetId);
        db.prepare('UPDATE scenes SET map_asset_id = NULL, map_frame = NULL WHERE map_asset_id = ?').run(op.assetId);
        db.prepare('UPDATE scenes SET background_asset_id = NULL, background_frame = NULL WHERE background_asset_id = ?').run(op.assetId);
        db.prepare('DELETE FROM assets WHERE id = ?').run(op.assetId);
        break;
      case 'sound.play':
        break;
      default:
        break;
    }
  }
  db.prepare('UPDATE rooms SET active_scene_id = ? WHERE id = ?').run(next.activeSceneId, roomId);
}

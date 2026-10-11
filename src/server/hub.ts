import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket, type RawData } from 'ws';
import { hashSecret, newCode, newSecret, verifySecret } from './auth.js';
import type { AppDatabase, CatalogToken, StoredRoom, StoredSession } from './db.js';
import { loadDefaultTokens } from './tokens.js';
import { packRoom, unpackRoom } from './archive.js';
import { persistOps, persistPlacements } from './persist.js';
import type { Actor } from '../shared/permissions.js';
import { canPerform } from '../shared/permissions.js';
import type { ClientOp, ServerMsg, ServerOp, SessionResponse, SnapshotBody } from '../shared/protocol.js';
import { parseClientMessage } from '../shared/protocol.js';
import { applyServerOp, assetRemovedIds, blankScene, materialize } from '../shared/reduce.js';
import type { ArchiveAsset, RoomArchive } from '../shared/archive.js';
import type { Asset, FogShape, Placement, Presence, RoomState, Scene } from '../shared/types.js';
import { cleanName } from '../shared/validate.js';

const MAX_ASSETS = 300;
const MAX_SOCKET_BUFFER = 64 * 1024;
const PLACEMENT_QUIET_MS = 200;
const PLACEMENT_CHECKPOINT_MS = 400;
const PUMP_MS = 100;

function ephemeral(op: ServerOp): boolean {
  return op.type === 'sound.play' || op.type === 'ping' || op.type === 'mark' || op.type === 'ruler' || op.type === 'ruler.clear';
}

function geometryPatch(op: ServerOp): op is Extract<ServerOp, { type: 'place.patch' }> {
  if (op.type !== 'place.patch') return false;
  let geometry = false;
  if (op.x !== undefined) geometry = true;
  if (op.y !== undefined) geometry = true;
  if (op.w !== undefined) geometry = true;
  if (op.h !== undefined) geometry = true;
  if (op.rotation !== undefined) geometry = true;
  if (op.layer !== undefined || op.label !== undefined || op.owners !== undefined) return false;
  return geometry;
}

function holdKey(message: ServerMsg): string | null {
  if (message.type !== 'ops' || message.ops.length !== 1) return null;
  const op = message.ops[0];
  if (!op) return null;
  if (op.type === 'ruler' || op.type === 'ruler.clear') return `ruler:${op.id}`;
  if (geometryPatch(op)) return `place:${op.placementId}`;
  return null;
}

function dirtyKey(roomId: string, placementId: string): string {
  return `${roomId}\0${placementId}`;
}

function remapRef(ids: ReadonlyMap<string, string>, id: string | null): string | null | undefined {
  if (id === null) return null;
  return ids.get(id);
}

function rawText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

interface LiveClient {
  socket: WebSocket;
  token: string;
  roomId: string;
  name: string;
  role: StoredSession['role'];
  stamps: number[];
  held: Map<string, string>;
}

interface DirtyPlacement {
  roomId: string;
  placementId: string;
  since: number;
  touched: number;
}

interface CachedRoom {
  id: string;
  dmKeyHash: string;
  state: RoomState;
  sharedAssetIds: Set<string>;
}

export type ActionResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export class Hub {
  private readonly rooms = new Map<string, CachedRoom>();
  private readonly live = new Map<string, LiveClient>();
  private readonly byRoom = new Map<string, Set<LiveClient>>();
  private readonly dirty = new Map<string, DirtyPlacement>();
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private readonly filesDir: string;
  private readonly catalog: CatalogToken[];

  constructor(
    private readonly db: AppDatabase,
    dataDir: string,
  ) {
    this.filesDir = join(dataDir, 'files');
    mkdirSync(this.filesDir, { recursive: true });
    this.catalog = loadDefaultTokens(db, this.filesDir);
  }

  close(): void {
    this.flushPlacements(true);
    if (this.pumpTimer) clearInterval(this.pumpTimer);
    this.pumpTimer = null;
    for (const client of this.live.values()) client.socket.close();
    this.live.clear();
    this.byRoom.clear();
    this.dirty.clear();
    this.rooms.clear();
    this.db.close();
  }

  filePath(assetId: string): string {
    return join(this.filesDir, assetId);
  }

  createRoom(nameInput: unknown): ActionResult<SessionResponse> {
    const name = cleanName(nameInput ?? 'DM');
    if (!name) return { ok: false, status: 400, error: 'Enter a name up to 24 characters' };
    let code = newCode();
    for (let attempt = 0; attempt < 8 && this.db.codeTaken(code); attempt += 1) code = newCode();
    if (this.db.codeTaken(code)) return { ok: false, status: 500, error: 'Could not create a room' };
    const dmKey = newSecret();
    const scene = blankScene(randomUUID(), 'Scene 1', 0);
    const room: CachedRoom = {
      id: randomUUID(),
      dmKeyHash: hashSecret(dmKey),
      state: { code, activeSceneId: scene.id, assets: [], scenes: [scene], placements: [], fog: [] },
      sharedAssetIds: new Set(),
    };
    this.db.insertRoom(room, scene);
    const seeded = this.db.seedDefaultTokens(room.id, this.catalog);
    room.state.assets = seeded;
    room.sharedAssetIds = new Set(seeded.map((asset) => asset.id));
    const token = newSecret();
    this.db.insertSession({ token, roomId: room.id, name, role: 'dm' });
    this.rooms.set(room.id, room);
    return { ok: true, value: { code, token, role: 'dm', name, dmKey } };
  }

  join(code: string, nameInput: unknown, dmKey: unknown): ActionResult<SessionResponse> {
    const room = this.roomByCode(code);
    if (!room) return { ok: false, status: 404, error: 'Room not found' };
    if (typeof dmKey === 'string' && dmKey.length > 0) return this.reclaim(room, nameInput, dmKey);
    const name = cleanName(nameInput);
    if (!name) return { ok: false, status: 400, error: 'Enter a name up to 24 characters' };
    if (this.db.dmNames(room.id).includes(name) || this.nameLive(room.id, name)) {
      return { ok: false, status: 409, error: 'That name is in use' };
    }
    this.db.deletePlayerNamed(room.id, name);
    const token = newSecret();
    this.db.insertSession({ token, roomId: room.id, name, role: 'player' });
    return { ok: true, value: { code: room.state.code, token, role: 'player', name } };
  }

  private reclaim(room: CachedRoom, nameInput: unknown, dmKey: string): ActionResult<SessionResponse> {
    if (!verifySecret(dmKey, room.dmKeyHash)) return { ok: false, status: 403, error: 'DM key does not match' };
    const existing = this.db.dmNames(room.id)[0] ?? 'DM';
    const name = cleanName(nameInput ?? existing) ?? existing;
    if (this.nameLive(room.id, name)) {
      const holder = this.findLiveByName(room.id, name);
      if (holder && holder.role !== 'dm') return { ok: false, status: 409, error: 'That name is in use' };
    }
    for (const client of this.clientsIn(room.id)) {
      if (client.role === 'dm') client.socket.close(4000, 'replaced');
    }
    this.db.deleteRole(room.id, 'dm');
    const token = newSecret();
    this.db.insertSession({ token, roomId: room.id, name, role: 'dm' });
    return { ok: true, value: { code: room.state.code, token, role: 'dm', name, dmKey } };
  }

  leave(token: string): ActionResult<{ gone: true }> {
    const session = this.db.getSession(token);
    if (!session) return { ok: false, status: 401, error: 'Session expired' };
    this.db.deleteSession(token);
    const client = this.live.get(token);
    client?.socket.close(4001, 'left');
    return { ok: true, value: { gone: true } };
  }

  deleteRoom(token: string, code: string): ActionResult<{ deleted: true }> {
    const session = this.db.getSession(token);
    if (!session || session.role !== 'dm') return { ok: false, status: 403, error: 'Only the DM can delete the room' };
    const room = this.rooms.get(session.roomId) ?? this.remember(this.db.loadRoomById(session.roomId));
    if (!room || room.state.code !== code) return { ok: false, status: 404, error: 'Room not found' };
    const assetIds = room.state.assets.map((asset) => asset.id);
    this.dropDirtyRoom(room.id);
    this.db.deleteRoom(room.id);
    this.rooms.delete(room.id);
    for (const id of assetIds) {
      if (!room.sharedAssetIds.has(id)) this.removeFile(id);
    }
    for (const client of this.clientsIn(room.id)) client.socket.close(4002, 'room deleted');
    return { ok: true, value: { deleted: true } };
  }

  exportRoom(token: string, code: string): ActionResult<Buffer> {
    const session = this.db.getSession(token);
    if (!session || session.role !== 'dm') return { ok: false, status: 403, error: 'Only the DM can export the room' };
    const room = this.rooms.get(session.roomId) ?? this.remember(this.db.loadRoomById(session.roomId));
    if (!room || room.state.code !== code) return { ok: false, status: 404, error: 'Room not found' };
    const sources = this.db.starterSources(room.id);
    const files = new Map<string, Uint8Array>();
    const assets: ArchiveAsset[] = [];
    for (const asset of room.state.assets) {
      const record: ArchiveAsset = { id: asset.id, name: asset.name, class: asset.class, mime: asset.mime };
      if (asset.folder) record.folder = asset.folder;
      if (room.sharedAssetIds.has(asset.id)) {
        const source = sources.get(asset.id);
        if (!source) return { ok: false, status: 500, error: 'A starter token has no filename' };
        record.source = source;
      } else {
        const path = this.filePath(asset.id);
        if (!existsSync(path)) return { ok: false, status: 500, error: 'An uploaded file is missing' };
        files.set(asset.id, readFileSync(path));
      }
      assets.push(record);
    }
    const active = room.state.scenes.find((scene) => scene.id === room.state.activeSceneId) ?? room.state.scenes[0];
    if (!active) return { ok: false, status: 500, error: 'Room has no scene' };
    const archive: RoomArchive = {
      version: 1,
      activeSceneId: active.id,
      scenes: room.state.scenes,
      placements: room.state.placements,
      fog: room.state.fog,
      assets,
    };
    return { ok: true, value: Buffer.from(packRoom(archive, files)) };
  }

  importRoom(nameInput: unknown, bytes: Uint8Array): ActionResult<SessionResponse> {
    const unpacked = unpackRoom(bytes);
    if (!unpacked.ok) return { ok: false, status: 400, error: unpacked.error };
    for (const asset of unpacked.archive.assets) {
      if (asset.source && !this.db.findDefaultToken(asset.source)) {
        return { ok: false, status: 400, error: `Starter token ${asset.source} is not on this server` };
      }
    }
    const created = this.createRoom(nameInput);
    if (!created.ok) return created;
    const room = this.roomByCode(created.value.code);
    const blankId = room?.state.scenes[0]?.id;
    if (!room || !blankId) {
      this.deleteRoom(created.value.token, created.value.code);
      return { ok: false, status: 500, error: 'Could not create a room' };
    }
    const built = this.archiveOps(room, unpacked.archive, unpacked.files, blankId);
    if (!built.ok) {
      this.deleteRoom(created.value.token, created.value.code);
      return built;
    }
    const saved = this.commit(room, built.ops);
    if (!saved.ok) {
      this.deleteRoom(created.value.token, created.value.code);
      return { ok: false, status: 500, error: saved.error };
    }
    try {
      for (const file of built.uploads) writeFileSync(this.filePath(file.id), file.bytes);
    } catch (error) {
      console.error(error);
      this.deleteRoom(created.value.token, created.value.code);
      return { ok: false, status: 500, error: 'Could not store the archive files' };
    }
    return created;
  }

  authorizeFile(token: string, assetId: string): { mime: string; fileId: string } | null {
    const session = this.db.getSession(token);
    const asset = this.db.getAsset(assetId);
    if (!session || !asset || session.roomId !== asset.roomId) return null;
    return { mime: asset.mime, fileId: asset.fileId ?? assetId };
  }

  addAsset(token: string, asset: Asset): ActionResult<Asset> {
    const session = this.db.getSession(token);
    if (!session || session.role !== 'dm') return { ok: false, status: 403, error: 'Only the DM can upload' };
    const room = this.roomById(session.roomId);
    if (!room) return { ok: false, status: 404, error: 'Room not found' };
    const uploaded = room.state.assets.filter((item) => !room.sharedAssetIds.has(item.id)).length;
    if (uploaded >= MAX_ASSETS) return { ok: false, status: 400, error: 'Too many assets' };
    const op: ServerOp = { type: 'asset.upsert', asset };
    const result = this.commit(room, [op]);
    if (!result.ok) return { ok: false, status: 500, error: result.error };
    this.broadcast(room.id, { type: 'ops', ops: [op] });
    return { ok: true, value: asset };
  }

  writeFailureCleanup(assetId: string): void {
    this.removeFile(assetId);
  }

  connect(socket: WebSocket, token: string): void {
    const session = this.db.getSession(token);
    if (!session) {
      socket.close(4001, 'unauthorized');
      return;
    }
    const room = this.roomById(session.roomId);
    if (!room) {
      socket.close(4002, 'room deleted');
      return;
    }
    if (this.nameLive(room.id, session.name, token)) {
      this.db.deleteSession(token);
      socket.close(4009, 'name in use');
      return;
    }
    const client: LiveClient = {
      socket,
      token,
      roomId: room.id,
      name: session.name,
      role: session.role,
      stamps: [],
      held: new Map(),
    };
    const previous = this.live.get(token);
    if (previous) this.removeClient(previous);
    this.addClient(client);
    if (previous && previous.socket !== socket) previous.socket.close(4000, 'replaced');
    socket.on('message', (data, isBinary) => this.onMessage(client, data, isBinary));
    socket.on('close', () => {
      if (this.live.get(token) !== client) return;
      this.removeClient(client);
      this.broadcast(room.id, { type: 'presence', presence: this.presence(room.id) });
    });
    socket.on('error', () => socket.close());
    const snapshot = this.snapshotBody(session, room);
    this.send(socket, { type: 'snapshot', ...snapshot });
    this.broadcast(room.id, { type: 'presence', presence: snapshot.presence }, socket);
  }

  private onMessage(client: LiveClient, data: RawData, isBinary: boolean): void {
    if (isBinary || this.live.get(client.token) !== client) return;
    const text = rawText(data);
    if (text.length > 64_000) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return;
    }
    const message = parseClientMessage(parsed);
    if (!message) {
      this.send(client.socket, { type: 'reject', error: 'Bad message' });
      return;
    }
    if (!this.allow(client)) {
      this.send(client.socket, { type: 'reject', error: 'Slow down' });
      return;
    }
    const room = this.rooms.get(client.roomId);
    if (!room) return;
    const actor: Actor = { role: client.role, name: client.name };
    if (!canPerform(actor, room.state, message.op)) {
      this.reject(client, room, message.op, 'Not allowed');
      return;
    }
    const made = materialize(room.state, message.op, { next: () => randomUUID() }, client.name);
    if (!made.ok) {
      this.reject(client, room, message.op, made.error);
      return;
    }
    const saved = this.commit(room, made.ops);
    if (!saved.ok) {
      this.reject(client, room, message.op, saved.error);
      return;
    }
    for (const id of assetRemovedIds(made.ops)) {
      const shared = room.sharedAssetIds.has(id);
      room.sharedAssetIds.delete(id);
      if (!shared) this.removeFile(id);
    }
    const except = message.op.type === 'place.update' ? client.socket : undefined;
    this.broadcast(room.id, { type: 'ops', ops: made.ops }, except);
  }

  private reject(client: LiveClient, room: CachedRoom, op: ClientOp, error: string): void {
    const message: ServerMsg = { type: 'reject', error };
    if (op.type === 'place.update') {
      const session = this.db.getSession(client.token);
      if (session) message.snapshot = this.snapshotBody(session, room);
    }
    this.send(client.socket, message);
  }

  private archiveOps(
    room: CachedRoom,
    archive: RoomArchive,
    files: ReadonlyMap<string, Buffer>,
    blankId: string,
  ): { ok: true; ops: ServerOp[]; uploads: { id: string; bytes: Buffer }[] } | { ok: false; status: number; error: string } {
    const bySource = new Map<string, string>();
    for (const [id, source] of this.db.starterSources(room.id)) bySource.set(source, id);
    const assetIds = new Map<string, string>();
    const ops: ServerOp[] = [];
    const uploads: { id: string; bytes: Buffer }[] = [];
    for (const asset of archive.assets) {
      if (asset.source) {
        const dest = bySource.get(asset.source);
        if (!dest) return { ok: false, status: 400, error: `Starter token ${asset.source} is not on this server` };
        assetIds.set(asset.id, dest);
        if (asset.folder) {
          const current = room.state.assets.find((item) => item.id === dest);
          if (current) ops.push({ type: 'asset.upsert', asset: { ...current, folder: asset.folder } });
        }
        continue;
      }
      const bytes = files.get(asset.id);
      if (!bytes) return { ok: false, status: 400, error: 'Archive is missing an uploaded file' };
      const id = randomUUID();
      assetIds.set(asset.id, id);
      const next: Asset = { id, name: asset.name, class: asset.class, mime: asset.mime };
      if (asset.folder) next.folder = asset.folder;
      ops.push({ type: 'asset.upsert', asset: next });
      uploads.push({ id, bytes });
    }
    const sceneIds = new Map<string, string>();
    for (const scene of archive.scenes) sceneIds.set(scene.id, randomUUID());
    for (const scene of archive.scenes) {
      const id = sceneIds.get(scene.id);
      const mapAssetId = remapRef(assetIds, scene.mapAssetId);
      const backgroundAssetId = remapRef(assetIds, scene.backgroundAssetId);
      if (!id || mapAssetId === undefined || backgroundAssetId === undefined) {
        return { ok: false, status: 400, error: 'Archive refers to a missing asset' };
      }
      const next: Scene = { ...scene, id, mapAssetId, backgroundAssetId };
      ops.push({ type: 'scene.upsert', scene: next });
    }
    for (const placement of archive.placements) {
      const sceneId = sceneIds.get(placement.sceneId);
      const assetId = assetIds.get(placement.assetId);
      if (!sceneId || !assetId) return { ok: false, status: 400, error: 'Archive refers to a missing piece' };
      const next: Placement = { ...placement, id: randomUUID(), sceneId, assetId };
      ops.push({ type: 'place.upsert', placement: next });
    }
    for (const shape of archive.fog) {
      const sceneId = sceneIds.get(shape.sceneId);
      if (!sceneId) return { ok: false, status: 400, error: 'Archive refers to a missing fog shape' };
      const next: FogShape = { ...shape, id: randomUUID(), sceneId };
      ops.push({ type: 'fog.upsert', shape: next });
    }
    const active = sceneIds.get(archive.activeSceneId);
    if (!active) return { ok: false, status: 400, error: 'Archive has no active scene' };
    ops.push({ type: 'scene.activate', sceneId: active });
    ops.push({ type: 'scene.remove', sceneId: blankId });
    return { ok: true, ops, uploads };
  }

  private commit(room: CachedRoom, ops: ServerOp[]): { ok: true } | { ok: false; error: string } {
    let next = room.state;
    for (const op of ops) next = applyServerOp(next, op);
    const durable = ops.filter((op) => !ephemeral(op) && !geometryPatch(op));
    const activeChanged = next.activeSceneId !== room.state.activeSceneId;
    if (durable.length > 0 || activeChanged) {
      try {
        this.db.transaction(() => persistOps(this.db.raw, room.id, durable, next, room.state));
      } catch (error) {
        console.error(error);
        return { ok: false, error: 'Save failed' };
      }
    }
    room.state = next;
    for (const op of durable) {
      if (op.type === 'place.upsert') this.clearDirty(room.id, op.placement.id);
      if (op.type === 'place.patch' || op.type === 'place.remove') this.clearDirty(room.id, op.placementId);
    }
    this.dropMissingPlacements(room);
    const now = Date.now();
    for (const op of ops) {
      if (!geometryPatch(op)) continue;
      if (!room.state.placements.some((placement) => placement.id === op.placementId)) continue;
      this.markDirty(room.id, op.placementId, now);
    }
    return { ok: true };
  }

  private allow(client: LiveClient): boolean {
    const now = Date.now();
    client.stamps = client.stamps.filter((stamp) => now - stamp < 1000);
    if (client.stamps.length >= 45) return false;
    client.stamps.push(now);
    return true;
  }

  private snapshotBody(session: Pick<StoredSession, 'role' | 'name'>, room: CachedRoom): SnapshotBody {
    return {
      role: session.role,
      selfName: session.name,
      presence: this.presence(room.id),
      state: room.state,
    };
  }

  private presence(roomId: string): Presence[] {
    return this.clientsIn(roomId)
      .map((client) => ({ name: client.name, role: client.role }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private nameLive(roomId: string, name: string, exceptToken?: string): boolean {
    return this.findLiveByName(roomId, name, exceptToken) !== null;
  }

  private findLiveByName(roomId: string, name: string, exceptToken?: string): LiveClient | null {
    for (const client of this.live.values()) {
      if (client.roomId === roomId && client.name === name && client.token !== exceptToken) return client;
    }
    return null;
  }

  private clientsIn(roomId: string): LiveClient[] {
    return [...(this.byRoom.get(roomId) ?? [])];
  }

  private addClient(client: LiveClient): void {
    this.live.set(client.token, client);
    let group = this.byRoom.get(client.roomId);
    if (!group) {
      group = new Set();
      this.byRoom.set(client.roomId, group);
    }
    group.add(client);
  }

  private removeClient(client: LiveClient): void {
    client.held.clear();
    if (this.live.get(client.token) === client) this.live.delete(client.token);
    const group = this.byRoom.get(client.roomId);
    if (!group) return;
    group.delete(client);
    if (group.size === 0) this.byRoom.delete(client.roomId);
  }

  private broadcast(roomId: string, message: ServerMsg, except?: WebSocket): void {
    const data = JSON.stringify(message);
    const key = holdKey(message);
    for (const client of this.clientsIn(roomId)) {
      if (client.socket === except) continue;
      this.deliver(client, message, data, key);
    }
  }

  private deliver(client: LiveClient, message: ServerMsg, data: string, key: string | null): void {
    if (client.socket.readyState !== WebSocket.OPEN) return;
    if (key) {
      if (client.socket.bufferedAmount > MAX_SOCKET_BUFFER) {
        client.held.set(key, data);
        this.ensurePump();
        return;
      }
      client.held.delete(key);
      client.socket.send(data);
      return;
    }
    if (message.type === 'snapshot') client.held.clear();
    else this.flushHeldClient(client, true);
    if (client.socket.readyState === WebSocket.OPEN) client.socket.send(data);
  }

  private send(socket: WebSocket, message: ServerMsg): void {
    const client = this.clientBySocket(socket);
    if (client) this.deliver(client, message, JSON.stringify(message), holdKey(message));
    else if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  private clientBySocket(socket: WebSocket): LiveClient | null {
    for (const client of this.live.values()) {
      if (client.socket === socket) return client;
    }
    return null;
  }

  private markDirty(roomId: string, placementId: string, now: number): void {
    const key = dirtyKey(roomId, placementId);
    const existing = this.dirty.get(key);
    if (existing) existing.touched = now;
    else this.dirty.set(key, { roomId, placementId, since: now, touched: now });
    this.ensurePump();
  }

  private clearDirty(roomId: string, placementId: string): void {
    this.dirty.delete(dirtyKey(roomId, placementId));
  }

  private dropDirtyRoom(roomId: string): void {
    for (const [key, item] of this.dirty) {
      if (item.roomId === roomId) this.dirty.delete(key);
    }
  }

  private dropMissingPlacements(room: CachedRoom): void {
    for (const [key, item] of this.dirty) {
      if (item.roomId !== room.id) continue;
      if (!room.state.placements.some((placement) => placement.id === item.placementId)) this.dirty.delete(key);
    }
  }

  private ensurePump(): void {
    if (this.pumpTimer) return;
    this.pumpTimer = setInterval(() => this.pump(), PUMP_MS);
    this.pumpTimer.unref();
  }

  private pump(): void {
    this.flushPlacements(false);
    for (const client of this.live.values()) this.flushHeldClient(client, false);
    if (this.dirty.size === 0 && !this.holding()) {
      if (this.pumpTimer) clearInterval(this.pumpTimer);
      this.pumpTimer = null;
    }
  }

  private holding(): boolean {
    for (const client of this.live.values()) {
      if (client.held.size > 0) return true;
    }
    return false;
  }

  private flushHeldClient(client: LiveClient, force: boolean): void {
    if (client.held.size === 0) return;
    if (client.socket.readyState !== WebSocket.OPEN) {
      client.held.clear();
      return;
    }
    if (!force && client.socket.bufferedAmount > MAX_SOCKET_BUFFER) return;
    for (const [key, payload] of client.held) {
      if (!force && client.socket.bufferedAmount > MAX_SOCKET_BUFFER) return;
      client.held.delete(key);
      client.socket.send(payload);
    }
  }

  private flushPlacements(force: boolean): void {
    const now = Date.now();
    const due = new Map<string, Map<string, string>>();
    for (const [key, item] of this.dirty) {
      const quiet = now - item.touched >= PLACEMENT_QUIET_MS;
      const checkpoint = now - item.since >= PLACEMENT_CHECKPOINT_MS;
      if (!force && !quiet && !checkpoint) continue;
      let roomDue = due.get(item.roomId);
      if (!roomDue) {
        roomDue = new Map();
        due.set(item.roomId, roomDue);
      }
      roomDue.set(item.placementId, key);
    }
    for (const [roomId, roomDue] of due) {
      const room = this.rooms.get(roomId);
      if (!room) {
        for (const key of roomDue.values()) this.dirty.delete(key);
        continue;
      }
      const placements: Placement[] = [];
      const keys: string[] = [];
      for (const [placementId, key] of roomDue) {
        const placement = room.state.placements.find((item) => item.id === placementId);
        if (!placement) {
          this.dirty.delete(key);
          continue;
        }
        placements.push(placement);
        keys.push(key);
      }
      if (placements.length === 0) continue;
      try {
        this.db.transaction(() => persistPlacements(this.db.raw, placements));
      } catch (error) {
        console.error(error);
        continue;
      }
      for (const key of keys) this.dirty.delete(key);
    }
  }

  private roomByCode(code: string): CachedRoom | null {
    for (const room of this.rooms.values()) {
      if (room.state.code === code) return room;
    }
    return this.remember(this.db.loadRoom(code));
  }

  private roomById(id: string): CachedRoom | null {
    return this.rooms.get(id) ?? this.remember(this.db.loadRoomById(id));
  }

  private remember(stored: StoredRoom | null): CachedRoom | null {
    if (!stored) return null;
    const room: CachedRoom = {
      id: stored.id,
      dmKeyHash: stored.dmKeyHash,
      state: stored.state,
      sharedAssetIds: new Set(this.db.sharedAssetIds(stored.id)),
    };
    this.rooms.set(room.id, room);
    return room;
  }

  private removeFile(assetId: string): void {
    try {
      unlinkSync(this.filePath(assetId));
    } catch {
      // The file may already be gone.
    }
  }
}

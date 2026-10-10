import { randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket, type RawData } from 'ws';
import { hashSecret, newCode, newSecret, verifySecret } from './auth.js';
import type { AppDatabase, CatalogToken, StoredRoom, StoredSession } from './db.js';
import { loadDefaultTokens } from './tokens.js';
import { persistOps } from './persist.js';
import type { Actor } from '../shared/permissions.js';
import { canPerform } from '../shared/permissions.js';
import type { ClientOp, ServerMsg, ServerOp, SessionResponse, SnapshotBody } from '../shared/protocol.js';
import { parseClientMessage } from '../shared/protocol.js';
import { applyServerOp, assetRemovedIds, blankScene, materialize } from '../shared/reduce.js';
import type { Asset, Presence, RoomState } from '../shared/types.js';
import { cleanName } from '../shared/validate.js';

const MAX_ASSETS = 300;

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
    for (const client of this.live.values()) client.socket.close();
    this.live.clear();
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
    this.db.deleteRoom(room.id);
    this.rooms.delete(room.id);
    for (const id of assetIds) {
      if (!room.sharedAssetIds.has(id)) this.removeFile(id);
    }
    for (const client of this.clientsIn(room.id)) client.socket.close(4002, 'room deleted');
    return { ok: true, value: { deleted: true } };
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
    };
    const previous = this.live.get(token);
    this.live.set(token, client);
    if (previous && previous.socket !== socket) previous.socket.close(4000, 'replaced');
    socket.on('message', (data, isBinary) => this.onMessage(client, data, isBinary));
    socket.on('close', () => {
      const current = this.live.get(token);
      if (current?.socket !== socket) return;
      this.live.delete(token);
      this.broadcast(room.id, { type: 'presence', presence: this.presence(room.id) });
    });
    socket.on('error', () => socket.close());
    const snapshot = this.snapshotBody(session, room);
    this.send(socket, { type: 'snapshot', ...snapshot });
    this.broadcast(room.id, { type: 'presence', presence: snapshot.presence }, socket);
  }

  private onMessage(client: LiveClient, data: RawData, isBinary: boolean): void {
    if (isBinary || !this.live.has(client.token)) return;
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
    const made = materialize(room.state, message.op, { next: () => randomUUID() });
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

  private commit(room: CachedRoom, ops: ServerOp[]): { ok: true } | { ok: false; error: string } {
    let next = room.state;
    for (const op of ops) next = applyServerOp(next, op);
    try {
      this.db.transaction(() => persistOps(this.db.raw, room.id, ops, next));
    } catch (error) {
      console.error(error);
      return { ok: false, error: 'Save failed' };
    }
    room.state = next;
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
    return [...this.live.values()].filter((client) => client.roomId === roomId);
  }

  private broadcast(roomId: string, message: ServerMsg, except?: WebSocket): void {
    const data = JSON.stringify(message);
    for (const client of this.clientsIn(roomId)) {
      if (client.socket === except) continue;
      if (client.socket.readyState === WebSocket.OPEN) client.socket.send(data);
    }
  }

  private send(socket: WebSocket, message: ServerMsg): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
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

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { WebSocket } from 'ws';
import { packRoom } from '../src/server/archive.js';
import type { RoomArchive } from '../src/shared/archive.js';
import type { ServerMsg } from '../src/shared/protocol.js';
import type { Scene } from '../src/shared/types.js';
import { startServer, type RunningServer } from '../src/server/index.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function multipart(fields: Record<string, string>, file: { filename: string; mime: string; buf: Buffer }) {
  const boundary = '----toptableboundary';
  const chunks: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
    ),
  );
  chunks.push(file.buf);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function postJson(url: string, token?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: token ? undefined : undefined,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function post(url: string, payload: unknown, token?: string) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function emptyScene(id: string): Scene {
  return {
    id,
    name: 'Scene 1',
    mapAssetId: null,
    backgroundAssetId: null,
    mapFrame: null,
    backgroundFrame: null,
    backgroundColor: '#000000',
    fogEnabled: false,
    width: 5000,
    height: 5000,
    rulerScale: 1,
    rulerUnit: 'ft',
    sortIndex: 0,
  };
}

async function postArchive(url: string, name: string, bytes: Uint8Array): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = new FormData();
  body.set('name', name);
  body.set('file', new Blob([bytes]), 'room.zip');
  const response = await fetch(url, { method: 'POST', body });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function listen(socket: WebSocket): ServerMsg[] {
  const messages: ServerMsg[] = [];
  socket.on('message', (data) => {
    messages.push(JSON.parse(data.toString()) as ServerMsg);
  });
  return messages;
}

function placementRow(file: string, id: string): { x: number; label: string } | undefined {
  const raw = new DatabaseSync(file, { readOnly: true, timeout: 3000 });
  try {
    return raw.prepare('SELECT x, label FROM placements WHERE id = ?').get(id) as { x: number; label: string } | undefined;
  } finally {
    raw.close();
  }
}

async function until(check: () => boolean): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > 4000) throw new Error('timed out waiting for the server');
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

describe('room server', () => {
  let running: RunningServer | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    if (running) await running.close();
    running = null;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it('rejects a player who moves someone else\'s token and accepts their own', async () => {
    dir = await mkdtemp(join(tmpdir(), 'toptable-'));
    running = await startServer({ port: 0, dataDir: dir, staticDir: null });
    const created = await post(`${running.url}/api/rooms`, { name: 'DM' });
    expect(created.status).toBe(201);
    const code = String(created.body.code);
    const dmToken = String(created.body.token);
    const joined = await post(`${running.url}/api/rooms/${code}/join`, { name: 'Ada' });
    expect(joined.status).toBe(200);
    const adaToken = String(joined.body.token);

    const dm = new WebSocket(`${running.url.replace('http', 'ws')}/ws?token=${encodeURIComponent(dmToken)}`);
    const ada = new WebSocket(`${running.url.replace('http', 'ws')}/ws?token=${encodeURIComponent(adaToken)}`);
    const dmMessages = listen(dm);
    const adaMessages = listen(ada);
    await until(() => dmMessages.some((message) => message.type === 'snapshot') && adaMessages.some((message) => message.type === 'snapshot'));

    const form = multipart({ class: 'token', name: 'Hero' }, { filename: 'hero.png', mime: 'image/png', buf: PNG });
    const uploaded = await fetch(`${running.url}/api/rooms/${code}/assets`, {
      method: 'POST',
      headers: { authorization: `Bearer ${dmToken}`, 'content-type': form.contentType },
      body: form.body,
    });
    expect(uploaded.status).toBe(201);
    const uploadedBody = (await uploaded.json()) as { asset: { id: string; class: string; folder?: string } };
    expect(uploadedBody.asset.folder).toBe('Custom');
    await until(() => dmMessages.some((message) => message.type === 'ops' && message.ops.some((op) => op.type === 'asset.upsert')));

    const denied = await fetch(`${running.url}/api/rooms/${code}/assets`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adaToken}`, 'content-type': form.contentType },
      body: form.body,
    });
    expect(denied.status).toBe(403);

    const sceneId = dmMessages
      .filter((message) => message.type === 'snapshot')
      .flatMap((message) => (message.type === 'snapshot' ? message.state.scenes : []))[0]?.id;
    expect(sceneId).toBeTruthy();
    dm.send(JSON.stringify({ type: 'op', op: { type: 'place.add', sceneId, assetId: uploadedBody.asset.id, x: 80, y: 90 } }));
    await until(() => adaMessages.some((message) => message.type === 'ops' && message.ops.some((op) => op.type === 'place.upsert')));
    const placed = adaMessages.flatMap((message) => (message.type === 'ops' ? message.ops : [])).find((op) => op.type === 'place.upsert');
    expect(placed?.type).toBe('place.upsert');
    if (placed?.type !== 'place.upsert') return;
    const placementId = placed.placement.id;

    ada.send(JSON.stringify({ type: 'op', op: { type: 'place.update', placementId, x: 12345.67 } }));
    ada.send(JSON.stringify({ type: 'op', op: { type: 'fog.clear', sceneId } }));
    await until(() => adaMessages.some((message) => message.type === 'reject'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const leaked = JSON.stringify(dmMessages).includes('12345.67');
    expect(leaked).toBe(false);
    expect(adaMessages.some((message) => message.type === 'reject' && message.error === 'Not allowed')).toBe(true);

    dm.send(JSON.stringify({ type: 'op', op: { type: 'place.grant', placementId, owners: ['Ada'] } }));
    await until(() => adaMessages.some((message) => message.type === 'ops' && message.ops.some((op) => op.type === 'place.patch' && op.owners?.includes('Ada'))));
    ada.send(JSON.stringify({ type: 'op', op: { type: 'place.update', placementId, x: 40, y: 50, rotation: 0.2 } }));
    await until(() =>
      dmMessages.some(
        (message) => message.type === 'ops' && message.ops.some((op) => op.type === 'place.patch' && op.x === 40 && op.y === 50),
      ),
    );

    const file = await fetch(`${running.url}/files/${uploadedBody.asset.id}?token=${encodeURIComponent(adaToken)}`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    dm.close();
    ada.close();
  });

  it('keeps a display name exclusive while that player is connected', async () => {
    dir = await mkdtemp(join(tmpdir(), 'toptable-'));
    running = await startServer({ port: 0, dataDir: dir, staticDir: null });
    const created = await post(`${running.url}/api/rooms`, { name: 'DM' });
    const code = String(created.body.code);
    const first = await post(`${running.url}/api/rooms/${code}/join`, { name: 'Ada' });
    const socket = new WebSocket(`${running.url.replace('http', 'ws')}/ws?token=${encodeURIComponent(String(first.body.token))}`);
    const messages = listen(socket);
    await until(() => messages.some((message) => message.type === 'snapshot'));
    const blocked = await post(`${running.url}/api/rooms/${code}/join`, { name: 'Ada' });
    expect(blocked.status).toBe(409);
    socket.close();
    await until(() => socket.readyState === WebSocket.CLOSED);
    const again = await post(`${running.url}/api/rooms/${code}/join`, { name: 'Ada' });
    expect(again.status).toBe(200);
  });

  it('keeps the DM in the room after the socket drops and reconnects', async () => {
    dir = await mkdtemp(join(tmpdir(), 'toptable-'));
    running = await startServer({ port: 0, dataDir: dir, staticDir: null });
    const created = await post(`${running.url}/api/rooms`, { name: 'DM' });
    expect(created.status).toBe(201);
    const token = String(created.body.token);
    const url = `${running.url.replace('http', 'ws')}/ws?token=${encodeURIComponent(token)}`;
    const first = new WebSocket(url);
    const firstMessages = listen(first);
    await until(() => firstMessages.some((message) => message.type === 'snapshot' && message.role === 'dm'));
    const overlap = new WebSocket(url);
    const overlapMessages = listen(overlap);
    await until(() => overlapMessages.some((message) => message.type === 'snapshot' && message.role === 'dm'));
    await until(() => first.readyState === WebSocket.CLOSED);
    overlap.close();
    await until(() => overlap.readyState === WebSocket.CLOSED);
    const again = new WebSocket(url);
    const againMessages = listen(again);
    await until(() => againMessages.some((message) => message.type === 'snapshot' && message.role === 'dm'));
    again.close();
  });

  it('seeds bundled tokens into a new room and still blocks player uploads', async () => {
    dir = await mkdtemp(join(tmpdir(), 'toptable-'));
    running = await startServer({ port: 0, dataDir: dir, staticDir: null });
    const created = await post(`${running.url}/api/rooms`, { name: 'DM' });
    expect(created.status).toBe(201);
    const code = String(created.body.code);
    const dmToken = String(created.body.token);
    const joined = await post(`${running.url}/api/rooms/${code}/join`, { name: 'Ada' });
    expect(joined.status).toBe(200);
    const adaToken = String(joined.body.token);

    const dm = new WebSocket(`${running.url.replace('http', 'ws')}/ws?token=${encodeURIComponent(dmToken)}`);
    const messages = listen(dm);
    await until(() => messages.some((message) => message.type === 'snapshot'));
    const snapshot = messages.find((message) => message.type === 'snapshot');
    expect(snapshot?.type).toBe('snapshot');
    if (snapshot?.type !== 'snapshot') return;
    const tokens = snapshot.state.assets.filter((asset) => asset.class === 'token');
    const names = tokens.map((asset) => asset.name);
    expect(names).toContain('angel');
    expect(names).toContain('human male');
    expect(names).not.toContain('prompt yes');
    expect(names).not.toContain('cursor');
    expect(names).not.toContain('abjuration');
    expect(snapshot.state.placements).toEqual([]);
    expect(tokens.length).toBeGreaterThan(800);

    const angel = tokens.find((asset) => asset.name === 'angel');
    expect(angel).toBeTruthy();
    expect(angel?.folder ?? null).toBeNull();
    const picture = await fetch(`${running.url}/files/${angel?.id}?token=${encodeURIComponent(adaToken)}`);
    expect(picture.status).toBe(200);
    expect(picture.headers.get('content-type')).toBe('image/png');

    const form = multipart({ class: 'token', name: 'Hero' }, { filename: 'hero.png', mime: 'image/png', buf: PNG });
    const denied = await fetch(`${running.url}/api/rooms/${code}/assets`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adaToken}`, 'content-type': form.contentType },
      body: form.body,
    });
    expect(denied.status).toBe(403);

    const sceneId = snapshot.state.scenes[0]?.id;
    expect(sceneId).toBeTruthy();
    dm.send(JSON.stringify({ type: 'op', op: { type: 'place.add', sceneId, assetId: angel?.id, x: 80, y: 90 } }));
    await until(() => messages.some((message) => message.type === 'ops' && message.ops.some((op) => op.type === 'place.upsert')));
    const placed = messages.flatMap((message) => (message.type === 'ops' ? message.ops : [])).find((op) => op.type === 'place.upsert');
    expect(placed?.type).toBe('place.upsert');
    if (placed?.type === 'place.upsert') expect(placed.placement.assetId).toBe(angel?.id);
    dm.close();
  });

  it('shows a drag and a ruler immediately, and saves the token once the drag settles', async () => {
    dir = await mkdtemp(join(tmpdir(), 'toptable-'));
    running = await startServer({ port: 0, dataDir: dir, staticDir: null });
    const created = await post(`${running.url}/api/rooms`, { name: 'DM' });
    const code = String(created.body.code);
    const dmToken = String(created.body.token);
    const joined = await post(`${running.url}/api/rooms/${code}/join`, { name: 'Ada' });
    const adaToken = String(joined.body.token);
    const dbFile = join(dir, 'toptable.sqlite');

    const dm = new WebSocket(`${running.url.replace('http', 'ws')}/ws?token=${encodeURIComponent(dmToken)}`);
    const ada = new WebSocket(`${running.url.replace('http', 'ws')}/ws?token=${encodeURIComponent(adaToken)}`);
    const dmMessages = listen(dm);
    const adaMessages = listen(ada);
    await until(() => dmMessages.some((message) => message.type === 'snapshot') && adaMessages.some((message) => message.type === 'snapshot'));

    const form = multipart({ class: 'token', name: 'Hero' }, { filename: 'hero.png', mime: 'image/png', buf: PNG });
    const uploaded = await fetch(`${running.url}/api/rooms/${code}/assets`, {
      method: 'POST',
      headers: { authorization: `Bearer ${dmToken}`, 'content-type': form.contentType },
      body: form.body,
    });
    expect(uploaded.status).toBe(201);
    const assetId = ((await uploaded.json()) as { asset: { id: string } }).asset.id;
    const sceneId = dmMessages.find((message) => message.type === 'snapshot');
    if (sceneId?.type !== 'snapshot') throw new Error('missing snapshot');
    const scene = sceneId.state.scenes[0]?.id;
    expect(scene).toBeTruthy();

    dm.send(JSON.stringify({ type: 'op', op: { type: 'place.add', sceneId: scene, assetId, x: 80, y: 90 } }));
    await until(() => adaMessages.some((message) => message.type === 'ops' && message.ops.some((op) => op.type === 'place.upsert')));
    const placed = adaMessages.flatMap((message) => (message.type === 'ops' ? message.ops : [])).find((op) => op.type === 'place.upsert');
    if (placed?.type !== 'place.upsert') throw new Error('missing placement');
    const placementId = placed.placement.id;

    dm.send(JSON.stringify({ type: 'op', op: { type: 'place.update', placementId, label: 'Goblin' } }));
    await until(() =>
      adaMessages.some((message) => message.type === 'ops' && message.ops.some((op) => op.type === 'place.patch' && op.label === 'Goblin')),
    );
    expect(placementRow(dbFile, placementId)).toMatchObject({ label: 'Goblin' });

    dm.send(JSON.stringify({ type: 'op', op: { type: 'place.update', placementId, x: 40, y: 50 } }));
    await until(() =>
      adaMessages.some((message) => message.type === 'ops' && message.ops.some((op) => op.type === 'place.patch' && op.x === 40 && op.y === 50)),
    );
    const rulerId = '22222222-2222-2222-2222-222222222222';
    dm.send(JSON.stringify({ type: 'op', op: { type: 'ruler', id: rulerId, sceneId: scene, x: 1, y: 2, x2: 3, y2: 4 } }));
    await until(() => adaMessages.some((message) => message.type === 'ops' && message.ops.some((op) => op.type === 'ruler' && op.id === rulerId)));

    await until(() => placementRow(dbFile, placementId)?.x === 40);

    dm.send(JSON.stringify({ type: 'op', op: { type: 'place.update', placementId, x: 70, y: 80 } }));
    await until(() => adaMessages.some((message) => message.type === 'ops' && message.ops.some((op) => op.type === 'place.patch' && op.x === 70)));
    dm.close();
    ada.close();
    await running.close();
    running = null;
    expect(placementRow(dbFile, placementId)?.x).toBe(70);
  });

  it('exports a room and loads it as a new room', async () => {
    dir = await mkdtemp(join(tmpdir(), 'toptable-'));
    running = await startServer({ port: 0, dataDir: dir, staticDir: null });
    const created = await post(`${running.url}/api/rooms`, { name: 'DM' });
    const code = String(created.body.code);
    const dmToken = String(created.body.token);
    const joined = await post(`${running.url}/api/rooms/${code}/join`, { name: 'Ada' });
    const adaToken = String(joined.body.token);
    const denied = await fetch(`${running.url}/api/rooms/${code}/export`, {
      headers: { authorization: `Bearer ${adaToken}` },
    });
    expect(denied.status).toBe(403);

    const dm = new WebSocket(`${running.url.replace('http', 'ws')}/ws?token=${encodeURIComponent(dmToken)}`);
    const messages = listen(dm);
    await until(() => messages.some((message) => message.type === 'snapshot'));
    const snapshot = messages.find((message) => message.type === 'snapshot');
    if (snapshot?.type !== 'snapshot') throw new Error('missing snapshot');
    const sceneId = snapshot.state.scenes[0]?.id;
    const angel = snapshot.state.assets.find((asset) => asset.name === 'angel');
    expect(sceneId).toBeTruthy();
    expect(angel).toBeTruthy();

    const form = multipart({ class: 'token', name: 'Hero' }, { filename: 'hero.png', mime: 'image/png', buf: PNG });
    const uploaded = await fetch(`${running.url}/api/rooms/${code}/assets`, {
      method: 'POST',
      headers: { authorization: `Bearer ${dmToken}`, 'content-type': form.contentType },
      body: form.body,
    });
    expect(uploaded.status).toBe(201);
    const heroId = ((await uploaded.json()) as { asset: { id: string } }).asset.id;
    dm.send(JSON.stringify({ type: 'op', op: { type: 'place.add', sceneId, assetId: heroId, x: 80, y: 90 } }));
    dm.send(JSON.stringify({ type: 'op', op: { type: 'place.add', sceneId, assetId: angel?.id, x: 120, y: 90 } }));
    await until(() => messages.flatMap((message) => (message.type === 'ops' ? message.ops : [])).filter((op) => op.type === 'place.upsert').length >= 2);
    const originalIds = messages
      .flatMap((message) => (message.type === 'ops' ? message.ops : []))
      .flatMap((op) => (op.type === 'place.upsert' ? [op.placement.id] : []));

    const exported = await fetch(`${running.url}/api/rooms/${code}/export`, {
      headers: { authorization: `Bearer ${dmToken}` },
    });
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-type')).toBe('application/zip');
    const loaded = await postArchive(`${running.url}/api/rooms/import`, 'Keeper', new Uint8Array(await exported.arrayBuffer()));
    expect(loaded.status).toBe(201);
    expect(loaded.body.role).toBe('dm');
    expect(typeof loaded.body.dmKey).toBe('string');
    expect(loaded.body.code).not.toBe(code);
    const nextToken = String(loaded.body.token);
    const next = new WebSocket(`${running.url.replace('http', 'ws')}/ws?token=${encodeURIComponent(nextToken)}`);
    const nextMessages = listen(next);
    await until(() => nextMessages.some((message) => message.type === 'snapshot'));
    const restored = nextMessages.find((message) => message.type === 'snapshot');
    if (restored?.type !== 'snapshot') throw new Error('missing restored snapshot');
    const angels = restored.state.assets.filter((asset) => asset.name === 'angel');
    expect(angels).toHaveLength(1);
    const hero = restored.state.assets.find((asset) => asset.name === 'hero.png');
    expect(hero?.folder).toBe('Custom');
    const heroPiece = restored.state.placements.find((placement) => placement.assetId === hero?.id);
    const angelPiece = restored.state.placements.find((placement) => placement.assetId === angels[0]?.id);
    expect(heroPiece).toBeTruthy();
    expect(angelPiece).toBeTruthy();
    expect(originalIds).not.toContain(heroPiece?.id);
    expect(originalIds).not.toContain(angelPiece?.id);
    const heroFile = await fetch(`${running.url}/files/${hero?.id}?token=${encodeURIComponent(nextToken)}`);
    expect(heroFile.status).toBe(200);
    expect(Buffer.from(await heroFile.arrayBuffer())).toEqual(PNG);
    const angelFile = await fetch(`${running.url}/files/${angels[0]?.id}?token=${encodeURIComponent(nextToken)}`);
    expect(angelFile.status).toBe(200);
    expect(angelFile.headers.get('content-type')).toBe('image/png');
    dm.close();
    next.close();
  });

  it('rejects a missing starter token and a hostile archive entry', async () => {
    dir = await mkdtemp(join(tmpdir(), 'toptable-'));
    running = await startServer({ port: 0, dataDir: dir, staticDir: null });
    const sceneId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const assetId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const archive: RoomArchive = {
      version: 1,
      activeSceneId: sceneId,
      scenes: [emptyScene(sceneId)],
      placements: [],
      fog: [],
      assets: [{ id: assetId, name: 'Missing', class: 'token', mime: 'image/png', source: 'not-a-real-token.png' }],
    };
    const missing = await postArchive(`${running.url}/api/rooms/import`, 'DM', packRoom(archive, new Map()));
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe('Starter token not-a-real-token.png is not on this server');
    const hostile = await postArchive(`${running.url}/api/rooms/import`, 'DM', zipSync({ '../secret': strToU8('no') }));
    expect(hostile.status).toBe(400);
    expect(hostile.body.error).toBe('Archive entry is not allowed');
  });

  it('answers a health check', async () => {
    dir = await mkdtemp(join(tmpdir(), 'toptable-'));
    running = await startServer({ port: 0, dataDir: dir, staticDir: null });
    const health = await fetch(`${running.url}/health`);
    expect(health.status).toBe(200);
    expect(await postJson(`${running.url}/api/rooms/not-a-code/join`)).toMatchObject({ status: 400 });
  });
});

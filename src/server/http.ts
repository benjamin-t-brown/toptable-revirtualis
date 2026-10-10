import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import Busboy from 'busboy';
import type { Hub } from './hub.js';
import { maxUploadBytes, sniff } from './files.js';
import type { Asset, AssetClass } from '../shared/types.js';
import { cleanAssetName, isAssetClass, isRecord } from '../shared/validate.js';

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.json': 'application/json',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export interface HttpContext {
  hub: Hub;
  staticDir: string | null;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(data);
}

function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

function readBody(req: IncomingMessage, limit = 1_000_000): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('too big'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false; status: number }> {
  try {
    const raw = await readBody(req);
    if (raw.length === 0) return { ok: true, value: {} };
    return { ok: true, value: JSON.parse(raw.toString('utf8')) as unknown };
  } catch (error) {
    const tooBig = error instanceof Error && error.message === 'too big';
    return { ok: false, status: tooBig ? 413 : 400 };
  }
}

function roomCode(value: string): string | null {
  const code = decodeURIComponent(value).toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : null;
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse, ctx: HttpContext): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'GET' && path === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'POST' && path === '/api/rooms') {
    const body = await readJson(req);
    if (!body.ok) {
      sendJson(res, body.status, { error: 'Bad request' });
      return;
    }
    const name = isRecord(body.value) ? body.value.name : 'DM';
    const result = ctx.hub.createRoom(name);
    sendJson(res, result.ok ? 201 : result.status, result.ok ? result.value : { error: result.error });
    return;
  }

  const join = /^\/api\/rooms\/([^/]+)\/join$/.exec(path);
  if (method === 'POST' && join?.[1]) {
    const code = roomCode(join[1]);
    if (!code) {
      sendJson(res, 400, { error: 'Bad room code' });
      return;
    }
    const body = await readJson(req);
    if (!body.ok) {
      sendJson(res, body.status, { error: 'Bad request' });
      return;
    }
    const name = isRecord(body.value) ? body.value.name : undefined;
    const dmKey = isRecord(body.value) ? body.value.dmKey : undefined;
    const result = ctx.hub.join(code, name, dmKey);
    sendJson(res, result.ok ? 200 : result.status, result.ok ? result.value : { error: result.error });
    return;
  }

  const leave = /^\/api\/rooms\/([^/]+)\/leave$/.exec(path);
  if (method === 'POST' && leave?.[1]) {
    const token = bearer(req);
    if (!token) {
      sendJson(res, 401, { error: 'Missing session' });
      return;
    }
    const result = ctx.hub.leave(token);
    sendJson(res, result.ok ? 200 : result.status, result.ok ? result.value : { error: result.error });
    return;
  }

  const room = /^\/api\/rooms\/([^/]+)$/.exec(path);
  if (method === 'DELETE' && room?.[1]) {
    const code = roomCode(room[1]);
    const token = bearer(req);
    if (!code || !token) {
      sendJson(res, token ? 400 : 401, { error: token ? 'Bad room code' : 'Missing session' });
      return;
    }
    const result = ctx.hub.deleteRoom(token, code);
    sendJson(res, result.ok ? 200 : result.status, result.ok ? result.value : { error: result.error });
    return;
  }

  const upload = /^\/api\/rooms\/([^/]+)\/assets$/.exec(path);
  if (method === 'POST' && upload?.[1]) {
    const code = roomCode(upload[1]);
    const token = bearer(req);
    if (!code || !token) {
      sendJson(res, token ? 400 : 401, { error: token ? 'Bad room code' : 'Missing session' });
      return;
    }
    await receiveUpload(req, res, ctx, token);
    return;
  }

  const file = /^\/files\/([^/]+)$/.exec(path);
  if (method === 'GET' && file?.[1]) {
    sendFile(req, res, ctx, file[1], url.searchParams.get('token'));
    return;
  }

  if (method === 'GET' && ctx.staticDir) {
    serveStatic(req, res, ctx.staticDir, path);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

function sendFile(req: IncomingMessage, res: ServerResponse, ctx: HttpContext, assetId: string, token: string | null): void {
  if (!token) {
    sendJson(res, 401, { error: 'Missing session' });
    return;
  }
  const asset = ctx.hub.authorizeFile(token, assetId);
  if (!asset) {
    sendJson(res, 404, { error: 'File not found' });
    return;
  }
  const filePath = ctx.hub.filePath(asset.fileId);
  if (!existsSync(filePath)) {
    sendJson(res, 404, { error: 'File not found' });
    return;
  }
  const stat = statSync(filePath);
  res.writeHead(200, {
    'content-type': asset.mime,
    'content-length': stat.size,
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

interface UploadParts {
  assetClass: AssetClass | null;
  filename: string;
  declared: string;
  bytes: Buffer | null;
  tooBig: boolean;
}

function receiveUpload(req: IncomingMessage, res: ServerResponse, ctx: HttpContext, token: string): Promise<void> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolvePromise();
    };
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: maxUploadBytes(), fields: 8, fieldSize: 1024 },
      });
    } catch {
      sendJson(res, 400, { error: 'Expected a file upload' });
      finish();
      return;
    }
    const parts: UploadParts = { assetClass: null, filename: 'asset', declared: '', bytes: null, tooBig: false };
    let fileDone = Promise.resolve();
    let failed = false;
    parser.on('field', (name, value) => {
      if (name === 'class' && isAssetClass(value)) parts.assetClass = value;
      if (name === 'name') parts.filename = value;
    });
    parser.on('file', (_name, stream, info) => {
      const chunks: Buffer[] = [];
      let size = 0;
      parts.declared = info.mimeType;
      if (info.filename) parts.filename = info.filename;
      fileDone = new Promise((resolveFile) => {
        stream.on('limit', () => {
          parts.tooBig = true;
        });
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxUploadBytes()) {
            parts.tooBig = true;
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () => {
          if (!parts.tooBig) parts.bytes = Buffer.concat(chunks);
          resolveFile();
        });
        stream.on('error', () => resolveFile());
      });
    });
    parser.on('error', () => {
      failed = true;
      if (!res.headersSent) sendJson(res, 400, { error: 'Could not read the upload' });
      finish();
    });
    parser.on('close', () => {
      void fileDone.then(() => {
        if (settled || failed) return;
        try {
          storeUpload(res, ctx, token, parts);
        } catch (error) {
          console.error(error);
          if (!res.headersSent) sendJson(res, 500, { error: 'Server error' });
        }
        finish();
      });
    });
    req.pipe(parser);
  });
}

function storeUpload(res: ServerResponse, ctx: HttpContext, token: string, parts: UploadParts): void {
  if (parts.tooBig) {
    sendJson(res, 413, { error: 'File is larger than 8 MB' });
    return;
  }
  if (!parts.assetClass || !parts.bytes) {
    sendJson(res, 400, { error: 'Choose a file and an asset class' });
    return;
  }
  const mime = sniff(parts.bytes, parts.declared);
  if (!mime) {
    sendJson(res, 400, { error: 'Use a png, jpeg, gif, webp, mp3, ogg, or wav file' });
    return;
  }
  const image = mime.startsWith('image/');
  if (parts.assetClass === 'sound' && image) {
    sendJson(res, 400, { error: 'Sounds need an audio file' });
    return;
  }
  if (parts.assetClass !== 'sound' && !image) {
    sendJson(res, 400, { error: 'That class needs an image' });
    return;
  }
  const asset: Asset = {
    id: randomUUID(),
    name: cleanAssetName(parts.filename),
    class: parts.assetClass,
    mime,
    ...(parts.assetClass === 'token' ? { folder: 'Custom' } : {}),
  };
  writeFileSync(ctx.hub.filePath(asset.id), parts.bytes);
  const result = ctx.hub.addAsset(token, asset);
  if (!result.ok) {
    ctx.hub.writeFailureCleanup(asset.id);
    sendJson(res, result.status, { error: result.error });
    return;
  }
  sendJson(res, 201, { asset: result.value });
}

function serveStatic(req: IncomingMessage, res: ServerResponse, staticDir: string, pathname: string): void {
  const root = resolve(staticDir);
  const decoded = decodeURIComponent(pathname);
  const requested = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const full = resolve(root, requested);
  const rel = relative(root, full);
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  const filePath = existsSync(full) && statSync(full).isFile() ? full : null;
  const fallback = !filePath && !extname(requested) ? resolve(root, 'index.html') : null;
  const target = filePath ?? (fallback && existsSync(fallback) ? fallback : null);
  if (!target) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  const type = STATIC_TYPES[extname(target)] ?? 'application/octet-stream';
  const stat = statSync(target);
  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(target).pipe(res);
}

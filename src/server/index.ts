import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { openDatabase } from './db.js';
import { handleRequest } from './http.js';
import { Hub } from './hub.js';
import { installWarningFilter } from './warnings.js';

installWarningFilter();

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export async function startServer(options: {
  port?: number;
  dataDir: string;
  staticDir?: string | null;
}): Promise<RunningServer> {
  const dataDir = resolve(options.dataDir);
  const db = openDatabase(resolve(dataDir, 'toptable.sqlite'));
  const hub = new Hub(db, dataDir);
  const staticDir = options.staticDir ? resolve(options.staticDir) : null;
  const server = createServer((req, res) => {
    void handleRequest(req, res, { hub, staticDir }).catch((error: unknown) => {
      console.error(error);
      if (res.headersSent) return;
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Server error' }));
    });
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      hub.connect(ws, url.searchParams.get('token') ?? '');
    });
  });
  const timer = setInterval(() => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.ping();
    }
  }, 30_000);
  timer.unref();
  const port = options.port ?? Number(process.env.PORT ?? 3001);
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolveListen());
  });
  const address = server.address();
  const chosen = typeof address === 'object' && address ? address.port : port;
  return {
    url: `http://127.0.0.1:${chosen}`,
    port: chosen,
    async close() {
      clearInterval(timer);
      await Promise.all(
        [...wss.clients].map(
          (client) =>
            new Promise<void>((resolveClose) => {
              if (client.readyState === WebSocket.CLOSED) {
                resolveClose();
                return;
              }
              client.once('close', () => resolveClose());
              client.close();
            }),
        ),
      );
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      });
      wss.close();
      hub.close();
    },
  };
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const expected = pathToFileURL(entry).href;
  if (process.platform === 'win32') return import.meta.url.toLowerCase() === expected.toLowerCase();
  return import.meta.url === expected;
}

if (isDirectRun()) {
  const staticDir = process.env.NODE_ENV === 'production' ? resolve('dist') : null;
  startServer({
    port: Number(process.env.PORT ?? 3001),
    dataDir: process.env.DATA_DIR ?? resolve('data'),
    staticDir,
  }).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

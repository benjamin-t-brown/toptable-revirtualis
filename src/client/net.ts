import type { ServerMsg } from '../shared/protocol.js';

export interface LiveSocket {
  send(message: unknown): void;
  close(): void;
}

const FATAL = new Set([4000, 4001, 4002, 4009]);

export function connectSocket(
  token: string,
  handlers: {
    onMessage(message: ServerMsg): void;
    onClose(event: CloseEvent): void;
  },
): LiveSocket {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer = 0;

  const open = (): void => {
    if (closed) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(token)}`);
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        handlers.onMessage(JSON.parse(event.data) as ServerMsg);
      } catch {
        // Ignore malformed payloads.
      }
    };
    socket.onopen = () => {
      attempt = 0;
    };
    socket.onclose = (event) => {
      if (closed) return;
      handlers.onClose(event);
      if (FATAL.has(event.code)) return;
      const delay = Math.min(8000, 500 * 2 ** attempt);
      attempt += 1;
      timer = window.setTimeout(open, delay);
    };
  };

  const halt = (): void => {
    closed = true;
    window.clearTimeout(timer);
  };
  window.addEventListener('beforeunload', halt);
  window.addEventListener('pagehide', halt);

  open();
  return {
    send(message: unknown) {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    close() {
      halt();
      window.removeEventListener('beforeunload', halt);
      window.removeEventListener('pagehide', halt);
      socket?.close();
    },
  };
}

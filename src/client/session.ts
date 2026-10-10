import type { Role } from '../shared/types.js';

export interface Session {
  token: string;
  code: string;
  name: string;
  role: Role;
  dmKey?: string;
}

const ACTIVE = 'tt-active';

function key(code: string): string {
  return `tt-session:${code}`;
}

function pendingKey(code: string): string {
  return `tt-dm-key-pending:${code}`;
}

function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const session = parsed as Partial<Session>;
    if (!session.token || !session.code || !session.name) return null;
    if (session.role !== 'dm' && session.role !== 'player') return null;
    return {
      token: session.token,
      code: session.code,
      name: session.name,
      role: session.role,
      dmKey: session.dmKey,
    };
  } catch {
    return null;
  }
}

export function loadSession(code: string): Session | null {
  return parseSession(sessionStorage.getItem(key(code))) ?? parseSession(localStorage.getItem(key(code)));
}

export function saveSession(session: Session): void {
  const raw = JSON.stringify(session);
  const slot = key(session.code);
  sessionStorage.setItem(slot, raw);
  localStorage.setItem(slot, raw);
  sessionStorage.setItem(ACTIVE, session.code);
  localStorage.setItem(ACTIVE, session.code);
}

export function clearSession(code: string): void {
  sessionStorage.removeItem(key(code));
  localStorage.removeItem(key(code));
  sessionStorage.removeItem(pendingKey(code));
  if (sessionStorage.getItem(ACTIVE) === code) sessionStorage.removeItem(ACTIVE);
  if (localStorage.getItem(ACTIVE) === code) localStorage.removeItem(ACTIVE);
}

export function loadActiveSession(): Session | null {
  const code = sessionStorage.getItem(ACTIVE) ?? localStorage.getItem(ACTIVE);
  if (!code) return null;
  const session = loadSession(code);
  if (!session) clearSession(code);
  return session;
}

export function markDmKeyPending(code: string): void {
  sessionStorage.setItem(pendingKey(code), '1');
}

export function dmKeyPending(code: string): boolean {
  return sessionStorage.getItem(pendingKey(code)) === '1';
}

export function clearDmKeyPending(code: string): void {
  sessionStorage.removeItem(pendingKey(code));
}

export type RouteTarget = { kind: 'room'; session: Session } | { kind: 'lobby'; code: string };

export function roomToOpen(hash: string): RouteTarget {
  const match = /^#\/room\/([A-Za-z0-9]+)$/.exec(hash);
  const code = match?.[1]?.toUpperCase() ?? '';
  if (code) {
    const session = loadSession(code);
    if (session) return { kind: 'room', session };
    return { kind: 'lobby', code };
  }
  const active = loadActiveSession();
  if (active) return { kind: 'room', session: active };
  return { kind: 'lobby', code: '' };
}

export function readNotice(): string {
  const notice = sessionStorage.getItem('tt-notice') ?? '';
  sessionStorage.removeItem('tt-notice');
  return notice;
}

export function writeNotice(notice: string): void {
  sessionStorage.setItem('tt-notice', notice);
}

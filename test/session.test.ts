import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSession, roomToOpen, saveSession, type Session } from '../src/client/session.js';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const dm: Session = { token: 'dm-token', code: 'ABCDEF', name: 'DM', role: 'dm', dmKey: 'secret' };
const player: Session = { token: 'player-token', code: 'ABCDEF', name: 'Ada', role: 'player' };

describe('room session restore', () => {
  beforeEach(() => {
    const local = new MemoryStorage();
    const tab = new MemoryStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: tab, configurable: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage');
    Reflect.deleteProperty(globalThis, 'sessionStorage');
  });

  it('returns the DM to the room from the room URL and from the lobby URL', () => {
    saveSession(dm);
    expect(roomToOpen('#/room/ABCDEF')).toEqual({ kind: 'room', session: dm });
    expect(roomToOpen('#/room/abcdef')).toEqual({ kind: 'room', session: dm });
    expect(roomToOpen('')).toEqual({ kind: 'room', session: dm });
    expect(roomToOpen('#/')).toEqual({ kind: 'room', session: dm });
  });

  it('keeps this tab seated when another tab overwrites the shared session', () => {
    saveSession(dm);
    localStorage.setItem('tt-session:ABCDEF', JSON.stringify(player));
    localStorage.setItem('tt-active', 'ABCDEF');
    expect(loadSession('ABCDEF')).toEqual(dm);
    expect(roomToOpen('#/room/ABCDEF').kind).toBe('room');
    if (roomToOpen('#/room/ABCDEF').kind === 'room') {
      expect(roomToOpen('#/room/ABCDEF')).toMatchObject({ session: { role: 'dm', token: 'dm-token' } });
    }
  });

  it('opens the lobby when the room code has no saved seat', () => {
    expect(roomToOpen('#/room/ABCDEF')).toEqual({ kind: 'lobby', code: 'ABCDEF' });
    expect(roomToOpen('')).toEqual({ kind: 'lobby', code: '' });
  });
});

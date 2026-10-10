import { mountLobby } from './lobby.js';
import { roomToOpen } from './session.js';
import { mountTable } from './table/app.js';

export function startRouter(root: HTMLElement): void {
  let cleanup = (): void => {};
  const go = (): void => {
    cleanup();
    const target = roomToOpen(location.hash);
    if (target.kind === 'room') {
      const hash = `#/room/${target.session.code}`;
      const current = /^#\/room\/([A-Za-z0-9]+)$/.exec(location.hash)?.[1]?.toUpperCase() ?? '';
      if (current !== target.session.code) {
        location.hash = hash;
        return;
      }
      cleanup = mountTable(root, target.session);
      return;
    }
    cleanup = mountLobby(root, target.code, (next) => {
      const hash = `#/room/${next}`;
      if (location.hash.toUpperCase() === hash.toUpperCase()) go();
      else location.hash = hash;
    });
  };
  window.addEventListener('hashchange', go);
  go();
}

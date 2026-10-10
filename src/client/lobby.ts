import { helpText, openModal } from './modal.js';
import { markDmKeyPending, saveSession, readNotice, type Session } from './session.js';
import { themeButtonLabel, toggleTheme } from './theme.js';
import type { SessionResponse } from '../shared/protocol.js';

async function post(path: string, payload: unknown): Promise<SessionResponse> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? String(data.error) : 'Request failed';
    throw new Error(error);
  }
  return data as SessionResponse;
}

function field(labelText: string, input: HTMLInputElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'field';
  const span = document.createElement('span');
  span.textContent = labelText;
  label.append(span, input);
  return label;
}

function textInput(value = ''): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.maxLength = 40;
  return input;
}

export function mountLobby(root: HTMLElement, codeHint: string, enter: (code: string) => void): () => void {
  const page = document.createElement('div');
  page.className = 'lobby';
  const bar = document.createElement('header');
  bar.className = 'topbar';
  const brand = document.createElement('strong');
  brand.textContent = 'Toptable';
  const theme = document.createElement('button');
  theme.type = 'button';
  theme.textContent = themeButtonLabel();
  theme.addEventListener('click', () => {
    toggleTheme();
    theme.textContent = themeButtonLabel();
  });
  const help = document.createElement('button');
  help.type = 'button';
  help.textContent = 'Help';
  help.addEventListener('click', () => {
    openModal(page, (close) => {
      const box = document.createElement('div');
      box.className = 'modal';
      const title = document.createElement('h2');
      title.textContent = 'How to play';
      box.append(title);
      for (const paragraph of helpText()) {
        const p = document.createElement('p');
        p.textContent = paragraph;
        box.append(p);
      }
      const done = document.createElement('button');
      done.type = 'button';
      done.textContent = 'Close';
      done.addEventListener('click', close);
      box.append(done);
      return box;
    });
  });
  bar.append(brand, theme, help);

  const notice = document.createElement('p');
  notice.className = 'notice';
  const stored = readNotice();
  notice.hidden = stored.length === 0;
  notice.textContent = stored;
  const error = document.createElement('p');
  error.className = 'notice';
  error.hidden = true;

  const showError = (err: unknown): void => {
    error.hidden = false;
    error.textContent = err instanceof Error ? err.message : 'Something went wrong';
  };

  const createName = textInput('DM');
  const createBtn = document.createElement('button');
  createBtn.type = 'button';
  createBtn.textContent = 'Create room';
  const createSet = document.createElement('fieldset');
  const createLegend = document.createElement('legend');
  createLegend.textContent = 'Create room';
  createSet.append(createLegend, field('Your name', createName), createBtn);

  const joinName = textInput('');
  const joinCode = textInput(codeHint);
  joinCode.maxLength = 6;
  const joinBtn = document.createElement('button');
  joinBtn.type = 'button';
  joinBtn.textContent = 'Join';
  const joinSet = document.createElement('fieldset');
  const joinLegend = document.createElement('legend');
  joinLegend.textContent = 'Join room';
  joinSet.append(joinLegend, field('Your name', joinName), field('Room code', joinCode), joinBtn);

  const reclaimCode = textInput(codeHint);
  reclaimCode.maxLength = 6;
  const reclaimKey = textInput('');
  const reclaimName = textInput('DM');
  const reclaimBtn = document.createElement('button');
  reclaimBtn.type = 'button';
  reclaimBtn.textContent = 'Reclaim DM';
  const reclaimSet = document.createElement('fieldset');
  const reclaimLegend = document.createElement('legend');
  reclaimLegend.textContent = 'Reclaim DM';
  reclaimSet.append(
    reclaimLegend,
    field('Room code', reclaimCode),
    field('DM key', reclaimKey),
    field('Your name', reclaimName),
    reclaimBtn,
  );

  const grid = document.createElement('div');
  grid.className = 'lobby-grid';
  grid.append(createSet, joinSet, reclaimSet);
  page.append(bar, notice, error, grid);
  root.replaceChildren(page);

  const finish = (result: SessionResponse): void => {
    const session: Session = {
      token: result.token,
      code: result.code,
      name: result.name,
      role: result.role,
      dmKey: result.dmKey,
    };
    saveSession(session);
    if (result.dmKey) markDmKeyPending(result.code);
    enter(result.code);
  };

  createBtn.addEventListener('click', () => {
    error.hidden = true;
    void post('/api/rooms', { name: createName.value }).then(finish).catch(showError);
  });
  joinBtn.addEventListener('click', () => {
    error.hidden = true;
    void post(`/api/rooms/${encodeURIComponent(joinCode.value.trim())}/join`, { name: joinName.value })
      .then(finish)
      .catch(showError);
  });
  reclaimBtn.addEventListener('click', () => {
    error.hidden = true;
    void post(`/api/rooms/${encodeURIComponent(reclaimCode.value.trim())}/join`, {
      name: reclaimName.value,
      dmKey: reclaimKey.value.trim(),
    })
      .then(finish)
      .catch(showError);
  });

  return () => {
    root.replaceChildren();
  };
}

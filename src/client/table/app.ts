import { helpText, openModal } from '../modal.js';
import { connectSocket, type LiveSocket } from '../net.js';
import { clearDmKeyPending, clearSession, dmKeyPending, saveSession, writeNotice, type Session } from '../session.js';
import { themeButtonLabel, toggleTheme } from '../theme.js';
import { prepareUpload } from '../upload.js';
import type { ClientOp, ServerMsg, ServerOp } from '../../shared/protocol.js';
import { controlsPlacement } from '../../shared/permissions.js';
import { activeScene, applyServerOp } from '../../shared/reduce.js';
import { hitPlacement } from '../../shared/hit.js';
import type { Asset, AssetClass, FogMode, ImageFrame, Placement, Point, Presence, Role, RoomState } from '../../shared/types.js';
import { ASSET_CLASSES, DEFAULT_TABLE_SIZE, MAX_TABLE_SIZE, MIN_TABLE_SIZE, sceneBoard } from '../../shared/types.js';
import { assetFolder, folderSize, groupByFolder, type FolderNode } from '../../shared/tokenFolders.js';
import { cleanLabel, cleanName } from '../../shared/validate.js';
import { fitBoard, screenToWorld, type Camera } from './camera.js';
import { drawTable, type DraftBox, type Tool } from './draw.js';
import { bindStage } from './input.js';
import { BACKGROUND_SELECTION, frameOf, MAP_SELECTION, sceneryKind, sceneryPlacement, type SceneryKind } from './scenery.js';

const ASSET_LABELS: Record<AssetClass, string> = {
  map: 'Maps',
  token: 'Tokens',
  background: 'Backgrounds',
  prop: 'Props',
  sound: 'Sounds',
};

export function mountTable(root: HTMLElement, session: Session): () => void {
  let room: RoomState | null = null;
  let role: Role = session.role;
  let selfName = session.name;
  let presence: Presence[] = [];
  let camera: Camera = { x: DEFAULT_TABLE_SIZE / 2, y: DEFAULT_TABLE_SIZE / 2, zoom: 0.15 };
  let tool: Tool = 'select';
  let fogMode: FogMode = 'reveal';
  let selectionId: string | null = null;
  let cursorWorld: Point | null = null;
  let placeAssetId: string | null = null;
  let assetTab: AssetClass = 'token';
  let sidebarWidth = readSidebarWidth();
  const openFolders = new Set<string>();
  const desktopSidebar = window.matchMedia('(min-width: 801px)');
  let sidebarTab: 'scenes' | 'assets' = 'scenes';
  let polygon: Point[] = [];
  let polygonCursor: Point | null = null;
  let draft: DraftBox | null = null;
  let dragId: string | null = null;
  let framedScene: string | null = null;
  let viewLocked = false;
  let cssWidth = 1;
  let cssHeight = 1;
  let dpr = 1;
  let epoch = 0;
  let lastSend = 0;
  const images = new Map<string, ImageBitmap>();
  const loading = new Set<string>();
  const sounds: HTMLAudioElement[] = [];

  const shell = document.createElement('div');
  shell.className = 'shell';
  const bar = document.createElement('header');
  bar.className = 'topbar';
  const brand = document.createElement('strong');
  brand.textContent = 'Toptable';
  const roomLabel = document.createElement('span');
  roomLabel.textContent = session.code;
  const who = document.createElement('span');
  const sceneLabel = document.createElement('span');
  const status = document.createElement('span');
  status.className = 'status';
  status.textContent = 'Connecting…';
  const themeBtn = button(themeButtonLabel());
  const helpBtn = button('Help');
  const keyBtn = button('DM key');
  const deleteBtn = button('Delete room');
  const leaveBtn = button('Leave');
  bar.append(brand, roomLabel, who, sceneLabel, status, themeBtn, helpBtn, keyBtn, deleteBtn, leaveBtn);

  const workspace = document.createElement('div');
  workspace.className = 'workspace';
  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  const tabs = document.createElement('div');
  tabs.className = 'tabs tabs-main';
  const scenesTab = button('Scenes');
  const assetsTab = button('Assets');
  tabs.append(scenesTab, assetsTab);

  const scenesPane = document.createElement('div');
  const newSceneBtn = button('New scene');
  const sceneList = document.createElement('div');
  sceneList.className = 'list';
  const sceneFields = document.createElement('div');
  sceneFields.className = 'stack';
  const sceneName = document.createElement('input');
  sceneName.type = 'text';
  sceneName.maxLength = 40;
  const widthInput = document.createElement('input');
  widthInput.type = 'number';
  widthInput.min = String(MIN_TABLE_SIZE);
  widthInput.max = String(MAX_TABLE_SIZE);
  widthInput.step = '1';
  const heightInput = document.createElement('input');
  heightInput.type = 'number';
  heightInput.min = String(MIN_TABLE_SIZE);
  heightInput.max = String(MAX_TABLE_SIZE);
  heightInput.step = '1';
  const mapSelect = document.createElement('select');
  const bgSelect = document.createElement('select');
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  const fogCheck = document.createElement('input');
  fogCheck.type = 'checkbox';
  const fogList = document.createElement('div');
  fogList.className = 'list';
  sceneFields.append(
    labeled('Scene name', sceneName),
    labeled('Width', widthInput),
    labeled('Height', heightInput),
    labeled('Map', mapSelect),
    labeled('Background', bgSelect),
    labeled('Table color', colorInput),
    labeledCheck('Fog', fogCheck),
    fogList,
  );
  const people = document.createElement('div');
  people.className = 'list';
  const playerHint = document.createElement('p');
  playerHint.className = 'hint';
  playerHint.textContent = 'Drag empty space to pan. Scroll or pinch to zoom. You can move tokens assigned to your name.';
  scenesPane.append(newSceneBtn, sceneList, sceneFields, playerHint, heading('People'), people);

  const assetsPane = document.createElement('div');
  const classTabs = document.createElement('div');
  classTabs.className = 'tabs tabs-class';
  const uploadBtn = button('Upload');
  uploadBtn.className = 'upload-btn';
  const assetFilter = document.createElement('input');
  assetFilter.type = 'search';
  assetFilter.className = 'asset-filter';
  assetFilter.placeholder = 'Search library';
  assetFilter.addEventListener('input', () => render());
  const assetList = document.createElement('div');
  assetList.className = 'list';
  assetsPane.append(classTabs, uploadBtn, assetFilter, assetList);
  const inspector = document.createElement('div');
  inspector.className = 'inspector';
  sidebar.append(tabs, scenesPane, assetsPane, inspector);
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'sidebar-resize';
  resizeHandle.tabIndex = 0;
  resizeHandle.setAttribute('role', 'separator');
  resizeHandle.setAttribute('aria-orientation', 'vertical');
  resizeHandle.setAttribute('aria-label', 'Resize sidebar');
  resizeHandle.title = 'Drag to resize';

  const stage = document.createElement('div');
  stage.className = 'stage';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'Game table');
  const fogCanvas = document.createElement('canvas');
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  const toolButtons: Partial<Record<Tool, HTMLButtonElement>> = {};
  for (const [id, label] of [
    ['select', 'Select'],
    ['pan', 'Pan'],
    ['polygon', 'Polygon'],
    ['rect', 'Square'],
    ['ellipse', 'Circle'],
  ] as const) {
    const control = button(label);
    control.dataset.tool = id;
    toolButtons[id] = control;
    toolbar.append(control);
  }
  const resetBtn = button('Reset view');
  const fogModeSelect = document.createElement('select');
  fogModeSelect.innerHTML = '<option value="reveal">Reveal</option><option value="cover">Cover</option>';
  toolbar.append(resetBtn, fogModeSelect);
  stage.append(canvas, toolbar);
  workspace.append(sidebar, resizeHandle, stage);
  const applySidebarWidth = (): void => {
    const width = Math.min(sidebarMax(), Math.max(SIDEBAR_MIN, sidebarWidth));
    sidebarWidth = width;
    sidebar.style.width = desktopSidebar.matches ? `${width}px` : '';
    resizeHandle.setAttribute('aria-valuemin', String(SIDEBAR_MIN));
    resizeHandle.setAttribute('aria-valuemax', String(sidebarMax()));
    resizeHandle.setAttribute('aria-valuenow', String(width));
  };
  const persistSidebarWidth = (): void => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      /* Storage can be blocked. The width still applies for this visit. */
    }
  };
  resizeHandle.addEventListener('pointerdown', (event) => {
    if (!desktopSidebar.matches || event.button !== 0) return;
    event.preventDefault();
    resizeHandle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startW = sidebar.getBoundingClientRect().width;
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    const move = (ev: PointerEvent): void => {
      sidebarWidth = Math.min(sidebarMax(), Math.max(SIDEBAR_MIN, Math.round(startW + ev.clientX - startX)));
      applySidebarWidth();
    };
    const up = (): void => {
      document.body.style.cursor = previousCursor;
      resizeHandle.removeEventListener('pointermove', move);
      resizeHandle.removeEventListener('pointerup', up);
      persistSidebarWidth();
    };
    resizeHandle.addEventListener('pointermove', move);
    resizeHandle.addEventListener('pointerup', up);
  });
  resizeHandle.addEventListener('keydown', (event) => {
    if (!desktopSidebar.matches) return;
    const step = event.shiftKey ? 48 : 16;
    if (event.key === 'ArrowRight') sidebarWidth = Math.min(sidebarMax(), sidebarWidth + step);
    else if (event.key === 'ArrowLeft') sidebarWidth = Math.max(SIDEBAR_MIN, sidebarWidth - step);
    else return;
    event.preventDefault();
    applySidebarWidth();
    persistSidebarWidth();
  });
  desktopSidebar.addEventListener('change', applySidebarWidth);
  applySidebarWidth();

  const phonebar = document.createElement('nav');
  phonebar.className = 'phonebar';
  const phoneScenes = button('Scenes');
  const phoneAssets = button('Assets');
  const phoneClose = button('Close');
  phonebar.append(phoneScenes, phoneAssets, phoneClose);
  shell.append(bar, workspace, phonebar);
  root.replaceChildren(shell);

  const ctx = canvas.getContext('2d');
  const fogCtx = fogCanvas.getContext('2d');
  let raf = 0;
  let dirty = false;
  const requestDraw = (): void => {
    if (dirty) return;
    dirty = true;
    raf = requestAnimationFrame(() => {
      dirty = false;
      paint();
    });
  };

  const paint = (): void => {
    if (!ctx || !fogCtx || !room) return;
    drawTable(ctx, fogCtx, fogCanvas, {
      room,
      role,
      selfName,
      camera,
      images,
      selectionId,
      tool,
      polygon,
      polygonCursor,
      draft,
      width: cssWidth,
      height: cssHeight,
      dpr,
    });
  };

  const send = (op: ClientOp): void => {
    socket.send({ type: 'op', op });
  };

  const setStatus = (text: string): void => {
    status.textContent = text;
  };

  const selected = (): Placement | null => (selectionId ? pieceFor(selectionId) : null);

  const scenePlacements = (): Placement[] => {
    const scene = room ? activeScene(room) : null;
    if (!scene || !room) return [];
    return room.placements.filter((item) => item.sceneId === scene.id);
  };

  const patchLocal = (id: string, patch: Partial<Placement>): void => {
    const placement = room?.placements.find((item) => item.id === id);
    if (!placement) return;
    Object.assign(placement, patch);
    requestDraw();
  };

  const sendGeometry = (
    id: string,
    patch: { x?: number; y?: number; w?: number; h?: number; rotation?: number },
    force: boolean,
  ): void => {
    patchLocal(id, patch);
    const now = performance.now();
    if (!force && now - lastSend < 66) return;
    lastSend = now;
    if (role === 'player') {
      const op: Extract<ClientOp, { type: 'place.update' }> = { type: 'place.update', placementId: id };
      if (patch.x !== undefined) op.x = patch.x;
      if (patch.y !== undefined) op.y = patch.y;
      if (patch.rotation !== undefined) op.rotation = patch.rotation;
      send(op);
      return;
    }
    send({ type: 'place.update', placementId: id, ...patch });
  };

  const loadImage = (id: string): void => {
    if (images.has(id) || loading.has(id)) return;
    loading.add(id);
    const gen = epoch;
    void fetch(`/files/${id}?token=${encodeURIComponent(session.token)}`)
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => (blob ? createImageBitmap(blob) : null))
      .then((bitmap) => {
        loading.delete(id);
        if (!bitmap) return;
        if (gen !== epoch) {
          bitmap.close();
          return;
        }
        images.set(id, bitmap);
        frameScene();
        requestDraw();
      })
      .catch(() => loading.delete(id));
  };

  const ensureImages = (): void => {
    if (!room) return;
    const liveIds = new Set<string>();
    for (const placement of room.placements) liveIds.add(placement.assetId);
    for (const scene of room.scenes) {
      if (scene.mapAssetId) liveIds.add(scene.mapAssetId);
      if (scene.backgroundAssetId) liveIds.add(scene.backgroundAssetId);
    }
    for (const [id, bitmap] of images) {
      if (!liveIds.has(id)) {
        bitmap.close();
        images.delete(id);
      }
    }
    for (const id of liveIds) loadImage(id);
  };

  const frameScene = (): void => {
    if (viewLocked || !room || cssWidth < 2) return;
    const scene = activeScene(room);
    if (!scene || framedScene === scene.id) return;
    const board = sceneBoard(scene);
    camera = fitBoard(cssWidth, cssHeight, board.width, board.height);
    framedScene = scene.id;
    requestDraw();
  };

  const playSound = (assetId: string): void => {
    const audio = new Audio(`/files/${assetId}?token=${encodeURIComponent(session.token)}`);
    sounds.push(audio);
    while (sounds.length > 8) sounds.shift()?.pause();
    void audio.play().catch(() => setStatus('The browser blocked sound. Click the table, then play it again.'));
  };

  const applyIncoming = (op: ServerOp): void => {
    if (!room) return;
    if (op.type === 'sound.play') {
      playSound(op.assetId);
      return;
    }
      if (dragId && op.type === 'place.patch' && op.placementId === dragId) {
      const kept: Extract<ServerOp, { type: 'place.patch' }> = { type: 'place.patch', placementId: op.placementId };
      if (op.layer !== undefined) kept.layer = op.layer;
      if (op.label !== undefined) kept.label = op.label;
      if (op.owners !== undefined) kept.owners = op.owners;
      room = applyServerOp(room, kept);
      return;
    }
    if (op.type === 'scene.upsert' && (dragId === MAP_SELECTION || dragId === BACKGROUND_SELECTION)) {
      const current = room.scenes.find((scene) => scene.id === op.scene.id);
      if (current) {
        const scene = { ...op.scene };
        if (dragId === MAP_SELECTION) scene.mapFrame = current.mapFrame;
        else scene.backgroundFrame = current.backgroundFrame;
        room = applyServerOp(room, { type: 'scene.upsert', scene });
        return;
      }
    }
    room = applyServerOp(room, op);
  };

  const sceneryEditable = (kind: SceneryKind): boolean =>
    role === 'dm' &&
    sidebarTab === 'assets' &&
    assetTab === kind &&
    (desktopSidebar.matches || sidebar.classList.contains('open'));

  const sceneryHint = (kind: SceneryKind): string => {
    const name = kind === 'map' ? 'map' : 'background';
    if (sceneryEditable(kind)) return `Drag the ${name} to move it. Corners resize, the knob rotates.`;
    const tab = kind === 'map' ? 'Maps' : 'Backgrounds';
    return `Select the ${tab} tab to move, resize, or rotate this ${name}.`;
  };

  const pieceFor = (id: string): Placement | null => {
    const kind = sceneryKind(id);
    if (!kind || !room) return room?.placements.find((item) => item.id === id) ?? null;
    const scene = activeScene(room);
    return scene ? sceneryPlacement(scene, kind, images) : null;
  };

  const keepSelection = (): void => {
    if (!selectionId || !room) return;
    const kind = sceneryKind(selectionId);
    if (!kind) {
      if (!room.placements.some((item) => item.id === selectionId)) selectionId = null;
      return;
    }
    const scene = activeScene(room);
    const piece = scene ? sceneryPlacement(scene, kind, images) : null;
    if (!piece || !sceneryEditable(kind)) selectionId = null;
  };

  const sendScenery = (id: string, frame: ImageFrame, force: boolean): void => {
    const scene = room ? activeScene(room) : null;
    const kind = sceneryKind(id);
    if (!scene || !kind) return;
    if (kind === 'map') scene.mapFrame = frame;
    else scene.backgroundFrame = frame;
    requestDraw();
    const now = performance.now();
    if (!force && now - lastSend < 66) return;
    lastSend = now;
    if (kind === 'map') send({ type: 'scene.update', sceneId: scene.id, mapFrame: frame });
    else send({ type: 'scene.update', sceneId: scene.id, backgroundFrame: frame });
  };

  const render = (): void => {
    keepSelection();
    const dm = role === 'dm';
    who.textContent = `${selfName} (${role})`;
    const scene = room ? activeScene(room) : null;
    sceneLabel.textContent = scene ? scene.name : 'No scene';
    keyBtn.hidden = !dm || !session.dmKey;
    deleteBtn.hidden = !dm;
    assetsTab.hidden = !dm;
    phoneAssets.hidden = !dm;
    newSceneBtn.hidden = !dm;
    sceneFields.hidden = !dm;
    playerHint.hidden = dm;
    fogModeSelect.hidden = !dm;
    for (const id of ['polygon', 'rect', 'ellipse'] as const) {
      const control = toolButtons[id];
      if (control) control.hidden = !dm;
    }
    stage.dataset.tool = tool;
    for (const [id, control] of Object.entries(toolButtons)) {
      control?.setAttribute('aria-pressed', id === tool ? 'true' : 'false');
    }
    scenesPane.hidden = sidebarTab !== 'scenes';
    assetsPane.hidden = sidebarTab !== 'assets' || !dm;
    scenesTab.setAttribute('aria-pressed', sidebarTab === 'scenes' ? 'true' : 'false');
    assetsTab.setAttribute('aria-pressed', sidebarTab === 'assets' ? 'true' : 'false');

    sceneList.replaceChildren();
    if (room) {
      const scenes = room.scenes.slice().sort((a, b) => a.sortIndex - b.sortIndex);
      for (const item of scenes) {
        const row = document.createElement('div');
        row.className = 'row';
        const open = button(item.name);
        if (item.id === room.activeSceneId) open.className = 'active';
        open.addEventListener('click', () => {
          if (dm && item.id !== room?.activeSceneId) send({ type: 'scene.activate', sceneId: item.id });
        });
        row.append(open);
        if (dm) {
          const copy = button('Copy');
          copy.addEventListener('click', () => send({ type: 'scene.duplicate', sceneId: item.id }));
          const remove = button('Delete');
          remove.addEventListener('click', () => {
            if (confirm(`Delete ${item.name}?`)) send({ type: 'scene.delete', sceneId: item.id });
          });
          row.append(copy, remove);
        }
        sceneList.append(row);
      }
    }

    if (scene && document.activeElement !== sceneName) sceneName.value = scene.name;
    fillAssetSelect(mapSelect, 'map', scene?.mapAssetId ?? null, 'No map');
    fillAssetSelect(bgSelect, 'background', scene?.backgroundAssetId ?? null, 'No image');
    if (scene && document.activeElement !== colorInput) colorInput.value = scene.backgroundColor;
    if (scene && document.activeElement !== widthInput) widthInput.value = String(sceneBoard(scene).width);
    if (scene && document.activeElement !== heightInput) heightInput.value = String(sceneBoard(scene).height);
    fogCheck.checked = scene?.fogEnabled ?? false;

    fogList.replaceChildren();
    if (dm && scene && room) {
      for (const shape of room.fog.filter((item) => item.sceneId === scene.id)) {
        const row = document.createElement('div');
        row.className = 'row';
        const label = document.createElement('span');
        label.textContent = `${shape.kind} ${shape.mode}`;
        const remove = button('Delete');
        remove.addEventListener('click', () => send({ type: 'fog.delete', shapeId: shape.id }));
        row.append(label, remove);
        fogList.append(row);
      }
      if (scene.fogEnabled) {
        const clear = button('Clear fog shapes');
        clear.addEventListener('click', () => send({ type: 'fog.clear', sceneId: scene.id }));
        fogList.append(clear);
      }
    }

    people.replaceChildren();
    for (const person of presence) {
      const line = document.createElement('div');
      line.textContent = `${person.name} (${person.role})`;
      people.append(line);
    }

    classTabs.replaceChildren();
    for (const assetClass of ASSET_CLASSES) {
      const tab = button(ASSET_LABELS[assetClass]);
      tab.setAttribute('aria-pressed', assetClass === assetTab ? 'true' : 'false');
      tab.addEventListener('click', () => {
        assetTab = assetClass;
        render();
        requestDraw();
      });
      classTabs.append(tab);
    }
    uploadBtn.hidden = !dm;
    assetFilter.hidden = !dm;
    assetList.replaceChildren();
    const query = assetFilter.value.trim().toLowerCase();
    const assets = (room?.assets ?? []).filter((asset) => asset.class === assetTab);
    if (assetTab === 'token') {
      assetList.classList.add('token-tree');
      fillTokenTree(assetList, assets, query);
    } else {
      assetList.classList.remove('token-tree');
      let shownAssets = assets.slice();
      if (query) shownAssets = shownAssets.filter((asset) => asset.name.toLowerCase().includes(query));
      shownAssets.sort((a, b) => a.name.localeCompare(b.name));
      if (shownAssets.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = query ? 'No matches.' : 'Nothing in this class yet.';
        assetList.append(empty);
      }
      const shown = shownAssets.slice(0, 48);
      if (shownAssets.length > shown.length) {
        const more = document.createElement('p');
        more.className = 'hint';
        more.textContent = `Showing ${shown.length} of ${shownAssets.length}. Search to narrow.`;
        assetList.append(more);
      }
      for (const asset of shown) assetList.append(assetRow(asset));
    }
    renderInspector();
  };

  const armedToken = (): Asset | null => {
    if (tool !== 'select' || !placeAssetId || !room) return null;
    const asset = room.assets.find((item) => item.id === placeAssetId);
    return asset?.class === 'token' ? asset : null;
  };

  const fillTokenTree = (parent: HTMLElement, assets: Asset[], query: string): void => {
    let list = assets.slice();
    if (query) {
      list = list.filter((asset) => `${asset.name} ${assetFolder(asset)}`.toLowerCase().includes(query));
    }
    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = query ? 'No matches.' : 'Nothing in this class yet.';
      parent.append(empty);
      return;
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    const total = list.length;
    const capped = query && list.length > 80 ? list.slice(0, 80) : list;
    if (capped.length < total) {
      const more = document.createElement('p');
      more.className = 'hint';
      more.textContent = `Showing ${capped.length} of ${total}. Search to narrow.`;
      parent.append(more);
    }
    const tree = groupByFolder(capped, (asset) => assetFolder(asset));
    const draw = (node: FolderNode<Asset>, depth: number): void => {
      for (const folder of node.folders) {
        const expanded = query.length > 0 || openFolders.has(folder.path);
        const control = document.createElement('button');
        control.type = 'button';
        control.className = 'tree-folder';
        control.style.paddingLeft = `${4 + depth * 14}px`;
        control.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        const twist = document.createElement('span');
        twist.className = 'twist';
        twist.setAttribute('aria-hidden', 'true');
        twist.textContent = expanded ? '▾' : '▸';
        const label = document.createElement('span');
        label.textContent = folder.name;
        const count = document.createElement('span');
        count.className = 'tree-count';
        count.setAttribute('aria-hidden', 'true');
        count.textContent = String(folderSize(folder));
        control.append(twist, label, count);
        const moving = armedToken();
        if (moving && assetFolder(moving) !== folder.path) control.title = `Move ${moving.name} here`;
        control.addEventListener('click', () => {
          if (moving && assetFolder(moving) !== folder.path) {
            const parts = folder.path.split('/');
            for (let i = 1; i <= parts.length; i += 1) openFolders.add(parts.slice(0, i).join('/'));
            send({ type: 'asset.move', assetId: moving.id, folder: folder.path });
            setStatus(`Moved ${moving.name} to ${folder.path.replaceAll('/', ' / ')}.`);
            return;
          }
          if (query) return;
          if (openFolders.has(folder.path)) openFolders.delete(folder.path);
          else openFolders.add(folder.path);
          render();
        });
        parent.append(control);
        if (expanded) draw(folder, depth + 1);
      }
      for (const asset of node.items) parent.append(assetRow(asset, depth));
    };
    draw(tree, 0);
  };

  const assetRow = (asset: Asset, depth = 0): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'row asset-row';
    if (depth > 0) row.style.paddingLeft = `${4 + depth * 14}px`;
    const canPlace = role === 'dm' && (asset.class === 'token' || asset.class === 'prop');
    if (canPlace && placeAssetId === asset.id) row.classList.add('placing');
    const thumb = asset.class === 'sound' ? null : document.createElement('img');
    if (thumb) {
      thumb.className = 'thumb';
      thumb.alt = '';
      thumb.src = `/files/${asset.id}?token=${encodeURIComponent(session.token)}`;
    }
    const name = document.createElement('span');
    name.textContent = asset.name;
    if (canPlace) {
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'asset-pick';
      pick.setAttribute('aria-pressed', placeAssetId === asset.id ? 'true' : 'false');
      if (thumb) pick.append(thumb);
      pick.append(name);
      pick.addEventListener('click', () => {
        placeAssetId = asset.id;
        tool = 'select';
        setStatus(
          asset.class === 'token'
            ? `Click the table to place ${asset.name}, or a folder to move it. Esc cancels.`
            : `Click the table to place ${asset.name}. Esc cancels.`,
        );
        render();
      });
      row.append(pick);
    } else {
      if (thumb) row.append(thumb);
      row.append(name);
    }
    if (role === 'dm' && asset.class === 'map') {
      const use = button('Use map');
      use.addEventListener('click', () => {
        const scene = room ? activeScene(room) : null;
        if (scene) {
          send({ type: 'scene.update', sceneId: scene.id, mapAssetId: asset.id });
          setStatus(sceneryHint('map'));
        }
      });
      row.append(use);
    }
    if (role === 'dm' && asset.class === 'background') {
      const use = button('Use background');
      use.addEventListener('click', () => {
        const scene = room ? activeScene(room) : null;
        if (scene) {
          send({ type: 'scene.update', sceneId: scene.id, backgroundAssetId: asset.id });
          setStatus(sceneryHint('background'));
        }
      });
      row.append(use);
    }
    if (role === 'dm' && asset.class === 'sound') {
      const play = button('Play');
      play.addEventListener('click', () => send({ type: 'sound.play', assetId: asset.id }));
      row.append(play);
    }
    if (role === 'dm') {
      const remove = button('×');
      remove.className = 'icon-x';
      remove.setAttribute('aria-label', `Delete ${asset.name}`);
      remove.title = 'Delete';
      remove.addEventListener('click', () => {
        if (confirm(`Delete ${asset.name}?`)) send({ type: 'asset.delete', assetId: asset.id });
      });
      row.append(remove);
    }
    return row;
  };

  const renderInspector = (): void => {
    const previousLabel = inspector.querySelector<HTMLInputElement>('input[data-kind="token-label"]');
    const keepLabel =
      previousLabel && document.activeElement === previousLabel
        ? { value: previousLabel.value, caret: previousLabel.selectionStart ?? previousLabel.value.length }
        : null;
    inspector.replaceChildren();
    const scenery = selectionId ? sceneryKind(selectionId) : null;
    if (scenery) {
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent =
        scenery === 'map'
          ? 'Map selected. Drag it, or use the corners to resize and the knob to rotate.'
          : 'Background selected. Drag it, or use the corners to resize and the knob to rotate.';
      inspector.append(note);
      return;
    }
    const placement = selected();
    if (!placement || !room) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Nothing selected.';
      inspector.append(empty);
      return;
    }
    const asset = room.assets.find((item) => item.id === placement.assetId);
    const title = document.createElement('strong');
    title.textContent = asset?.name ?? 'Piece';
    inspector.append(title);
    const canEdit = controlsPlacement({ role, name: selfName }, placement.owners);
    if (asset?.class === 'token' && canEdit) {
      const field = document.createElement('label');
      field.className = 'field';
      field.append(document.createTextNode('Label'));
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 40;
      input.placeholder = 'Name above the token';
      input.dataset.kind = 'token-label';
      input.setAttribute('aria-label', 'Token label');
      input.value = keepLabel?.value ?? placement.label;
      input.addEventListener('input', () => {
        const label = cleanLabel(input.value);
        if (label === null || label === placement.label) return;
        placement.label = label;
        send({ type: 'place.update', placementId: placement.id, label });
        requestDraw();
      });
      input.addEventListener('blur', () => {
        input.value = placement.label;
      });
      field.append(input);
      inspector.append(field);
      if (keepLabel) {
        const caret = keepLabel.caret;
        queueMicrotask(() => {
          input.focus();
          input.setSelectionRange(caret, caret);
        });
      }
    }
    if (role !== 'dm') {
      const note = document.createElement('p');
      note.textContent = placement.owners.includes(selfName) ? 'You can move this.' : 'The DM controls this.';
      inspector.append(note);
      return;
    }
    const names = new Set<string>(placement.owners);
    for (const person of presence) if (person.role === 'player') names.add(person.name);
    for (const name of names) {
      const label = document.createElement('label');
      label.className = 'check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = placement.owners.includes(name);
      box.addEventListener('change', () => {
        const next = placement.owners.filter((owner) => owner !== name);
        if (box.checked) next.push(name);
        send({ type: 'place.grant', placementId: placement.id, owners: next });
      });
      label.append(box, document.createTextNode(` ${name}`));
      inspector.append(label);
    }
    const addRow = document.createElement('div');
    addRow.className = 'row';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Player name';
    nameInput.maxLength = 24;
    const add = button('Grant');
    add.addEventListener('click', () => {
      const name = cleanName(nameInput.value);
      if (!name) return;
      const next = placement.owners.includes(name) ? placement.owners : placement.owners.concat(name);
      send({ type: 'place.grant', placementId: placement.id, owners: next });
      nameInput.value = '';
    });
    addRow.append(nameInput, add);
    const forward = button('Forward');
    forward.addEventListener('click', () => restack(1));
    const back = button('Back');
    back.addEventListener('click', () => restack(-1));
    const remove = button('Delete');
    remove.addEventListener('click', () => send({ type: 'place.delete', placementId: placement.id }));
    inspector.append(addRow, forward, back, remove);
  };

  const restack = (direction: 1 | -1): void => {
    const placement = selected();
    if (!placement || !room || role !== 'dm') return;
    const layers = scenePlacements().map((item) => item.layer);
    const next = direction > 0 ? Math.max(...layers) + 1 : Math.min(...layers) - 1;
    placement.layer = next;
    send({ type: 'place.update', placementId: placement.id, layer: next });
    requestDraw();
  };

  const fillAssetSelect = (select: HTMLSelectElement, assetClass: AssetClass, value: string | null, empty: string): void => {
    const assets = (room?.assets ?? []).filter((asset) => asset.class === assetClass);
    const signature = `${empty}|${value ?? ''}|${assets.map((asset) => asset.id).join(',')}`;
    if (select.dataset.sig === signature) return;
    select.dataset.sig = signature;
    select.replaceChildren();
    const none = document.createElement('option');
    none.value = '';
    none.textContent = empty;
    select.append(none);
    for (const asset of assets) {
      const option = document.createElement('option');
      option.value = asset.id;
      option.textContent = asset.name;
      select.append(option);
    }
    select.value = value ?? '';
  };

  const commitPolygon = (): void => {
    const scene = room ? activeScene(room) : null;
    if (!scene || polygon.length < 3) return;
    send({
      type: 'fog.add',
      sceneId: scene.id,
      kind: 'polygon',
      mode: fogMode,
      points: polygon.map((point) => ({ ...point })),
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
    polygon = [];
    polygonCursor = null;
    requestDraw();
  };

  const resize = (): void => {
    cssWidth = Math.max(1, canvas.clientWidth);
    cssHeight = Math.max(1, canvas.clientHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    fogCanvas.width = canvas.width;
    fogCanvas.height = canvas.height;
    frameScene();
    requestDraw();
  };
  const observer = new ResizeObserver(() => resize());
  observer.observe(stage);

  const unbind = bindStage(canvas, {
    getCamera: () => camera,
    setCamera: (next) => {
      camera = next;
    },
    getSize: () => ({ width: cssWidth, height: cssHeight }),
    getTool: () => tool,
    getSelection: selected,
    setSelection: (id) => {
      selectionId = id;
      render();
      requestDraw();
    },
    placements: scenePlacements,
    placement: (id) => pieceFor(id),
    canMove: (placement) => controlsPlacement({ role, name: selfName }, placement.owners),
    canResize: () => role === 'dm',
    canRotate: (placement) => controlsPlacement({ role, name: selfName }, placement.owners),
    maxSize: (placement) => (sceneryKind(placement.id) ? MAX_TABLE_SIZE : 8000),
    sceneryAt: (world) => {
      if (role !== 'dm' || tool !== 'select' || sidebarTab !== 'assets' || !room) return null;
      const kind: SceneryKind | null = assetTab === 'map' || assetTab === 'background' ? assetTab : null;
      if (!kind) return null;
      const scene = activeScene(room);
      if (!scene) return null;
      const piece = sceneryPlacement(scene, kind, images);
      if (!piece || !hitPlacement(piece, world.x, world.y)) return null;
      return piece;
    },
    placing: () => placeAssetId !== null,
    onPlace: (world) => {
      const scene = room ? activeScene(room) : null;
      if (!scene || !placeAssetId) return;
      send({ type: 'place.add', sceneId: scene.id, assetId: placeAssetId, x: world.x, y: world.y });
      placeAssetId = null;
      setStatus('');
      render();
    },
    onDraft: (next) => {
      draft = next;
      requestDraw();
    },
    onFogBox: (box) => {
      const scene = room ? activeScene(room) : null;
      draft = null;
      if (!scene) return;
      send({
        type: 'fog.add',
        sceneId: scene.id,
        kind: box.kind,
        mode: fogMode,
        points: [],
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
      });
      requestDraw();
    },
    polygonMove: (world) => {
      polygonCursor = world;
      requestDraw();
    },
    polygonClick: (world) => {
      const first = polygon[0];
      if (first && polygon.length >= 3) {
        const dx = (first.x - world.x) * camera.zoom;
        const dy = (first.y - world.y) * camera.zoom;
        if (dx * dx + dy * dy <= 144) {
          commitPolygon();
          return;
        }
      }
      polygon = polygon.concat(world);
      requestDraw();
    },
    onMove: (id, x, y, force) => {
      const piece = sceneryKind(id) ? pieceFor(id) : null;
      if (piece) {
        sendScenery(id, { ...frameOf(piece), x, y }, force);
        return;
      }
      sendGeometry(id, { x, y }, force);
    },
    onResize: (id, next, force) => {
      const piece = sceneryKind(id) ? pieceFor(id) : null;
      if (piece) {
        sendScenery(id, { ...frameOf(piece), ...next }, force);
        return;
      }
      sendGeometry(id, next, force);
    },
    onRotate: (id, rotation, force) => {
      const piece = sceneryKind(id) ? pieceFor(id) : null;
      if (piece) {
        sendScenery(id, { ...frameOf(piece), rotation }, force);
        return;
      }
      sendGeometry(id, { rotation }, force);
    },
    onDragStart: (id) => {
      dragId = id;
    },
    setInteracting: (active) => {
      viewLocked = active;
      if (!active) frameScene();
    },
    requestDraw,
  });

  const onKey = (event: KeyboardEvent): void => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    if (event.key === 'Escape') {
      polygon = [];
      polygonCursor = null;
      draft = null;
      placeAssetId = null;
      selectionId = null;
      setStatus('');
      render();
      requestDraw();
    } else if (event.key === 'Enter' && tool === 'polygon') {
      commitPolygon();
    } else if ((event.key === 'Backspace' || event.key === 'Delete') && tool === 'polygon' && polygon.length > 0) {
      event.preventDefault();
      polygon = polygon.slice(0, -1);
      requestDraw();
    } else if (event.key.toLowerCase() === 'c' && !event.ctrlKey && !event.metaKey && !event.altKey && role === 'dm') {
      const piece = selected();
      const scene = room ? activeScene(room) : null;
      if (!piece || sceneryKind(piece.id) || !scene || piece.sceneId !== scene.id) return;
      if (!cursorWorld) {
        setStatus('Point at the table, then press C.');
        return;
      }
      event.preventDefault();
      const asset = room?.assets.find((item) => item.id === piece.assetId);
      send({ type: 'place.copy', placementId: piece.id, x: cursorWorld.x, y: cursorWorld.y });
      setStatus(asset ? `Copied ${asset.name}.` : 'Copied.');
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectionId && !sceneryKind(selectionId) && role === 'dm') {
      event.preventDefault();
      send({ type: 'place.delete', placementId: selectionId });
    }
  };
  window.addEventListener('keydown', onKey);
  const trackCursor = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    cursorWorld = screenToWorld(camera, cssWidth, cssHeight, event.clientX - rect.left, event.clientY - rect.top);
  };
  const clearCursor = (): void => {
    cursorWorld = null;
  };
  canvas.addEventListener('pointermove', trackCursor);
  canvas.addEventListener('pointerleave', clearCursor);

  const showHelp = (): void => {
    openModal(shell, (close) => {
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
      const closeBtn = button('Close');
      closeBtn.addEventListener('click', close);
      box.append(closeBtn);
      return box;
    });
  };

  themeBtn.addEventListener('click', () => {
    toggleTheme();
    themeBtn.textContent = themeButtonLabel();
  });
  helpBtn.addEventListener('click', showHelp);
  const showDmKey = (acknowledge: boolean): void => {
    if (!session.dmKey) return;
    openModal(
      shell,
      (close) => {
        const box = document.createElement('div');
        box.className = 'modal';
        const title = document.createElement('h2');
        title.textContent = acknowledge ? 'Room is open' : 'DM key';
        const code = document.createElement('p');
        code.textContent = `Room code: ${session.code}`;
        const hint = document.createElement('p');
        hint.textContent = 'DM key (save this):';
        const input = document.createElement('input');
        input.type = 'text';
        input.readOnly = true;
        input.value = session.dmKey ?? '';
        const copy = button('Copy key');
        copy.addEventListener('click', () => {
          void navigator.clipboard.writeText(session.dmKey ?? '').catch(() => input.select());
        });
        const closeBtn = button(acknowledge ? 'Enter table' : 'Close');
        closeBtn.addEventListener('click', () => {
          if (acknowledge) clearDmKeyPending(session.code);
          close();
        });
        box.append(title, code, hint, input, copy, closeBtn);
        return box;
      },
      !acknowledge,
    );
  };
  keyBtn.addEventListener('click', () => showDmKey(false));
  if (dmKeyPending(session.code)) showDmKey(true);
  deleteBtn.addEventListener('click', () => {
    if (!confirm('Delete this room and its files?')) return;
    void fetch(`/api/rooms/${session.code}`, { method: 'DELETE', headers: { authorization: `Bearer ${session.token}` } }).then(
      (response) => {
        if (!response.ok) {
          setStatus('Could not delete the room.');
          return;
        }
        writeNotice('The room was deleted.');
        clearSession(session.code);
        location.hash = '#/';
      },
    );
  });
  leaveBtn.addEventListener('click', () => {
    socket.close();
    void fetch(`/api/rooms/${session.code}/leave`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.token}` },
    }).finally(() => {
      clearSession(session.code);
      location.hash = '#/';
    });
  });
  newSceneBtn.addEventListener('click', () => {
    const count = (room?.scenes.length ?? 0) + 1;
    send({ type: 'scene.create', name: `Scene ${count}` });
  });
  sceneName.addEventListener('change', () => {
    const scene = room ? activeScene(room) : null;
    if (!scene || scene.name === sceneName.value) return;
    send({ type: 'scene.update', sceneId: scene.id, name: sceneName.value });
  });
  mapSelect.addEventListener('change', () => {
    const scene = room ? activeScene(room) : null;
    if (!scene) return;
    send({ type: 'scene.update', sceneId: scene.id, mapAssetId: mapSelect.value || null });
    if (mapSelect.value) setStatus(sceneryHint('map'));
  });
  bgSelect.addEventListener('change', () => {
    const scene = room ? activeScene(room) : null;
    if (!scene) return;
    send({ type: 'scene.update', sceneId: scene.id, backgroundAssetId: bgSelect.value || null });
    if (bgSelect.value) setStatus(sceneryHint('background'));
  });
  colorInput.addEventListener('change', () => {
    const scene = room ? activeScene(room) : null;
    if (!scene) return;
    send({ type: 'scene.update', sceneId: scene.id, backgroundColor: colorInput.value });
  });
  const commitBoardEdge = (axis: 'width' | 'height', input: HTMLInputElement): void => {
    const scene = room ? activeScene(room) : null;
    if (!scene) return;
    const current = sceneBoard(scene)[axis];
    const parsed = Number(input.value);
    if (!Number.isInteger(parsed) || parsed < MIN_TABLE_SIZE || parsed > MAX_TABLE_SIZE) {
      input.value = String(current);
      setStatus(`Board ${axis} must be a whole number from ${MIN_TABLE_SIZE} to ${MAX_TABLE_SIZE}.`);
      return;
    }
    if (parsed === current) return;
    setStatus('');
    if (axis === 'width') send({ type: 'scene.update', sceneId: scene.id, width: parsed });
    else send({ type: 'scene.update', sceneId: scene.id, height: parsed });
  };
  widthInput.addEventListener('change', () => commitBoardEdge('width', widthInput));
  heightInput.addEventListener('change', () => commitBoardEdge('height', heightInput));
  fogCheck.addEventListener('change', () => {
    const scene = room ? activeScene(room) : null;
    if (!scene) return;
    send({ type: 'scene.update', sceneId: scene.id, fogEnabled: fogCheck.checked });
  });
  fogModeSelect.addEventListener('change', () => {
    fogMode = fogModeSelect.value === 'cover' ? 'cover' : 'reveal';
  });
  for (const [id, control] of Object.entries(toolButtons)) {
    control?.addEventListener('click', () => {
      tool = id as Tool;
      if (tool !== 'polygon') {
        polygon = [];
        polygonCursor = null;
      }
      if (tool === 'polygon') setStatus('Click to add points. Click the first point to close.');
      else if (tool === 'rect') setStatus('Drag a rectangle. Hold Shift for a square.');
      else if (tool === 'ellipse') setStatus('Drag an oval. Hold Shift for a circle.');
      else if (!placeAssetId) setStatus('');
      render();
      requestDraw();
    });
  }
  resetBtn.addEventListener('click', () => {
    framedScene = null;
    frameScene();
  });
  uploadBtn.addEventListener('click', () => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = assetTab === 'sound' ? 'audio/mpeg,audio/ogg,audio/wav,.mp3,.ogg,.wav' : 'image/png,image/jpeg,image/gif,image/webp';
    picker.addEventListener('change', () => {
      const file = picker.files?.[0];
      if (!file || !room) return;
      setStatus('Uploading…');
      void prepareUpload(file).then(async (prepared) => {
        const body = new FormData();
        body.set('class', assetTab);
        body.set('name', prepared.name);
        body.set('file', prepared.blob, prepared.name);
        const response = await fetch(`/api/rooms/${session.code}/assets`, {
          method: 'POST',
          headers: { authorization: `Bearer ${session.token}` },
          body,
        });
        const payload: unknown = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = payload && typeof payload === 'object' && 'error' in payload ? String(payload.error) : 'Upload failed';
          setStatus(message);
          return;
        }
        if (room && payload && typeof payload === 'object' && 'asset' in payload) {
          const asset = payload.asset as Asset;
          room = applyServerOp(room, { type: 'asset.upsert', asset });
          if (asset.folder) {
            const parts = asset.folder.split('/');
            for (let i = 1; i <= parts.length; i += 1) openFolders.add(parts.slice(0, i).join('/'));
          }
          ensureImages();
          render();
          setStatus(asset.folder ? `Added ${asset.name} to ${asset.folder}.` : '');
          return;
        }
        setStatus('');
      });
    });
    picker.click();
  });
  scenesTab.addEventListener('click', () => {
    sidebarTab = 'scenes';
    sidebar.classList.add('open');
    render();
    requestDraw();
  });
  assetsTab.addEventListener('click', () => {
    sidebarTab = 'assets';
    sidebar.classList.add('open');
    render();
    requestDraw();
  });
  phoneScenes.addEventListener('click', () => {
    sidebarTab = 'scenes';
    sidebar.classList.add('open');
    render();
    requestDraw();
  });
  phoneAssets.addEventListener('click', () => {
    sidebarTab = 'assets';
    sidebar.classList.add('open');
    render();
    requestDraw();
  });
  phoneClose.addEventListener('click', () => {
    sidebar.classList.remove('open');
    render();
    requestDraw();
  });

  const onMessage = (message: ServerMsg): void => {
    if (message.type === 'snapshot') {
      room = message.state;
      role = message.role;
      selfName = message.selfName;
      presence = message.presence;
      session.role = role;
      session.name = selfName;
      saveSession(session);
      keepSelection();
      ensureImages();
      frameScene();
      setStatus('');
      render();
      requestDraw();
      return;
    }
    if (message.type === 'presence') {
      presence = message.presence;
      render();
      return;
    }
    if (message.type === 'reject') {
      setStatus(message.error);
      if (message.snapshot) {
        room = message.snapshot.state;
        presence = message.snapshot.presence;
        ensureImages();
        render();
        requestDraw();
      }
      return;
    }
    if (message.type === 'error') {
      setStatus(message.error);
      return;
    }
    if (message.type !== 'ops' || !room) return;
    let structural = false;
    for (const op of message.ops) {
      if (op.type !== 'place.patch' && op.type !== 'sound.play') structural = true;
      if (op.type === 'place.patch' && (op.owners || op.label !== undefined)) structural = true;
      if (op.type === 'scene.activate') framedScene = null;
      applyIncoming(op);
    }
    keepSelection();
    ensureImages();
    frameScene();
    if (structural) render();
    requestDraw();
  };

  const socket: LiveSocket = connectSocket(session.token, {
    onMessage,
    onClose: (event) => {
      if (event.code === 4001) {
        writeNotice('That session is no longer valid.');
        clearSession(session.code);
        location.hash = '#/';
        return;
      }
      if (event.code === 4002) {
        writeNotice('The room was deleted.');
        clearSession(session.code);
        location.hash = '#/';
        return;
      }
      if (event.code === 4009) {
        writeNotice('That name is already in the room.');
        clearSession(session.code);
        location.hash = '#/';
        return;
      }
      if (event.code === 4000) {
        setStatus('This seat was opened in another tab.');
        return;
      }
      setStatus('Reconnecting…');
    },
  });

  render();
  resize();

  return () => {
    epoch += 1;
    cancelAnimationFrame(raf);
    observer.disconnect();
    unbind();
    window.removeEventListener('keydown', onKey);
    canvas.removeEventListener('pointermove', trackCursor);
    canvas.removeEventListener('pointerleave', clearCursor);
    desktopSidebar.removeEventListener('change', applySidebarWidth);
    socket.close();
    for (const bitmap of images.values()) bitmap.close();
    images.clear();
    for (const audio of sounds) audio.pause();
  };
}

const SIDEBAR_WIDTH_KEY = 'tt-sidebar-width';
const SIDEBAR_MIN = 220;

function sidebarMax(): number {
  return Math.max(SIDEBAR_MIN, Math.min(560, window.innerWidth - 360));
}

function readSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (raw === null) return 280;
    const saved = Number(raw);
    if (Number.isFinite(saved)) return Math.min(sidebarMax(), Math.max(SIDEBAR_MIN, saved));
  } catch {
    /* Storage can be blocked. */
  }
  return 280;
}

function button(label: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  return node;
}

function heading(text: string): HTMLElement {
  const node = document.createElement('h2');
  node.textContent = text;
  return node;
}

function labeled(text: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'field';
  const span = document.createElement('span');
  span.textContent = text;
  label.append(span, control);
  return label;
}

function labeledCheck(text: string, control: HTMLInputElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'check';
  label.append(control, document.createTextNode(` ${text}`));
  return label;
}

export function openModal(
  parent: HTMLElement,
  build: (close: () => void) => HTMLElement,
  dismiss = true,
): void {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const close = (): void => back.remove();
  if (dismiss) {
    back.addEventListener('click', (event) => {
      if (event.target === back) close();
    });
  }
  const dialog = build(close);
  dialog.setAttribute('role', 'dialog');
  back.append(dialog);
  parent.append(back);
}

export function helpText(): string[] {
  return [
    'Create a room to run the game. Share the room code. Keep the DM key; it is the only way back in as the DM.',
    'Players join with the code and a display name. The DM uploads maps, tokens, props, backgrounds, and sounds, then places tokens and props into scenes.',
    'Assign a token to a player name. That player can move and rotate it. The DM can move everything else. With a piece selected, press C to copy it under the pointer, including its size and rotation.',
    'Drag empty table space to pan. The wheel zooms toward the pointer, and a pinch zooms. That view stays on your screen. Fog tools and token drags still use the left button.',
    'Fog tools cut holes in the fog. Polygon, square, and circle are the cutters. Choose Cover to paint fog back. Hold Shift for a perfect square or circle.',
    'Dice stay on this device, including on this screen, and keep working while other panels are open.',
  ];
}

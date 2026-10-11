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
    'The Board tab chooses the scene every player sees. Opening a scene under Scenes changes only the DM’s table, so another scene can be prepared while play continues.',
    'Assign a token to a player name. That player can move and rotate it, and either of you can type a label that shows above the token. The DM can move everything else. With a piece selected, press C to copy it under the pointer, including its size, rotation, and label.',
    'Drag empty table space to pan, or hold Space and move the pointer. The wheel zooms toward the pointer, a pinch zooms, and = and - zoom the view. That view stays on your screen. Fog tools and token drags still use the left button.',
    'Each scene can turn fog on or off. Fog on covers the whole map, and polygon, square, and circle cut that cover away. Hold Shift for a perfect square or circle. Fog off hides those tools.',
    'The ruler draws a line while the button is held and labels the distance in feet or meters. To set the scale, choose 5×5, 10×10, or 50×50 and drag one square over that much of the map. That drag sets how many pixels equal one foot or meter, then the tool goes away. Everyone viewing that scene sees later measurements.',
    'Dice stay on this device, including on this screen, and keep working while other panels are open.',
  ];
}

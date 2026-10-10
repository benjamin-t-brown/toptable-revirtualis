import { mountDice } from './dice/panel.js';
import { startRouter } from './router.js';
import { initTheme } from './theme.js';

initTheme();
const dice = document.querySelector('#dice');
const app = document.querySelector('#app');
if (dice instanceof HTMLElement) mountDice(dice);
if (app instanceof HTMLElement) startRouter(app);

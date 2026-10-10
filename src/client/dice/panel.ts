import { DICE_SIDES, type DieSides } from '../../shared/types.js';
import { formatModifier, formatRollLine, rollDie, sumLast, type RollRecord } from '../../shared/dice.js';

const STORAGE = 'tt-dice';

interface DiceState {
  history: RollRecord[];
  modifier: number;
  sumCount: number;
  includeBonus: boolean;
  open: boolean;
  nextSeq: number;
}

function loadState(): DiceState {
  const narrow = window.matchMedia('(max-width: 800px)').matches;
  const base: DiceState = { history: [], modifier: 0, sumCount: 3, includeBonus: false, open: !narrow, nextSeq: 1 };
  const raw = localStorage.getItem(STORAGE);
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Partial<DiceState>;
    return {
      history: Array.isArray(parsed.history) ? parsed.history.filter(isRoll).slice(0, 200) : [],
      modifier: typeof parsed.modifier === 'number' && Number.isFinite(parsed.modifier) ? Math.round(parsed.modifier) : 0,
      sumCount: typeof parsed.sumCount === 'number' ? Math.min(50, Math.max(1, Math.round(parsed.sumCount))) : 3,
      includeBonus: parsed.includeBonus === true,
      open: typeof parsed.open === 'boolean' ? parsed.open : base.open,
      nextSeq: typeof parsed.nextSeq === 'number' ? parsed.nextSeq : 1,
    };
  } catch {
    return base;
  }
}

function isRoll(value: unknown): value is RollRecord {
  if (!value || typeof value !== 'object') return false;
  const roll = value as Partial<RollRecord>;
  return (
    typeof roll.seq === 'number' &&
    typeof roll.sides === 'number' &&
    typeof roll.natural === 'number' &&
    typeof roll.modifier === 'number' &&
    (DICE_SIDES as readonly number[]).includes(roll.sides)
  );
}

export function mountDice(root: HTMLElement): void {
  const state = loadState();
  const panel = document.createElement('div');
  panel.className = 'dice-root';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'dice-toggle';
  const toggleLabel = document.createElement('span');
  toggleLabel.textContent = 'Dice';
  const toggleGlyph = document.createElement('span');
  toggleGlyph.className = 'dice-glyph';
  toggleGlyph.setAttribute('aria-hidden', 'true');
  toggle.append(toggleLabel, toggleGlyph);
  const body = document.createElement('div');
  body.className = 'dice-body';

  const left = document.createElement('div');
  left.className = 'dice-left';
  const dieRow = document.createElement('div');
  dieRow.className = 'die-row';
  for (const sides of DICE_SIDES) {
    const die = document.createElement('button');
    die.type = 'button';
    die.className = sides === 20 ? 'die d20' : 'die';
    die.textContent = `D${sides}`;
    die.addEventListener('click', () => roll(sides));
    dieRow.append(die);
  }
  const bonus = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Bonus';
  const bonusRow = document.createElement('div');
  bonusRow.className = 'bonus-row';
  const dieName = document.createElement('span');
  dieName.className = 'bonus-die';
  const natural = document.createElement('span');
  const minus = document.createElement('button');
  minus.type = 'button';
  minus.textContent = '-';
  const modLabel = document.createElement('span');
  modLabel.className = 'mod-box';
  const plus = document.createElement('button');
  plus.type = 'button';
  plus.textContent = '+';
  const equals = document.createElement('span');
  equals.textContent = '=';
  const total = document.createElement('span');
  total.className = 'bonus-total';
  bonusRow.append(dieName, natural, minus, modLabel, plus, equals, total);
  bonus.append(legend, bonusRow);
  left.append(dieRow, bonus);

  const right = document.createElement('div');
  right.className = 'dice-right';
  const sumLine = document.createElement('div');
  sumLine.className = 'sum-line';
  const includeLabel = document.createElement('label');
  includeLabel.className = 'check';
  const include = document.createElement('input');
  include.type = 'checkbox';
  include.checked = state.includeBonus;
  includeLabel.append(include, document.createTextNode(' Include bonus'));
  const stepper = document.createElement('div');
  stepper.className = 'stepper';
  const sumMinus = document.createElement('button');
  sumMinus.type = 'button';
  sumMinus.textContent = '-';
  const sumCount = document.createElement('span');
  sumCount.className = 'mod-box';
  const sumPlus = document.createElement('button');
  sumPlus.type = 'button';
  sumPlus.textContent = '+';
  stepper.append(sumMinus, sumCount, sumPlus);
  const history = document.createElement('div');
  history.className = 'dice-history';
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = 'Clear history';
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = 'On this device only';
  right.append(sumLine, includeLabel, stepper, history, clear, note);
  body.append(left, right);
  panel.append(toggle, body);
  root.replaceChildren(panel);

  const persist = (): void => {
    localStorage.setItem(STORAGE, JSON.stringify(state));
  };
  const paint = (): void => {
    panel.classList.toggle('collapsed', !state.open);
    toggle.setAttribute('aria-expanded', state.open ? 'true' : 'false');
    toggle.setAttribute('aria-label', state.open ? 'Minimize dice' : 'Restore dice');
    toggleGlyph.textContent = state.open ? '−' : '+';
    const last = state.history[0];
    dieName.textContent = last ? `D${last.sides}` : 'D—';
    natural.textContent = last ? String(last.natural) : '—';
    modLabel.textContent = formatModifier(state.modifier);
    total.textContent = last ? String(last.natural + state.modifier) : '—';
    sumCount.textContent = String(state.sumCount);
    sumLine.textContent = `Sum last ${state.sumCount} = ${sumLast(state.history, state.sumCount, state.includeBonus)}`;
    history.replaceChildren();
    for (const rollRecord of state.history) {
      const line = document.createElement('div');
      line.textContent = formatRollLine(rollRecord);
      history.append(line);
    }
  };
  const roll = (sides: DieSides): void => {
    const record: RollRecord = {
      seq: state.nextSeq,
      sides,
      natural: rollDie(sides),
      modifier: state.modifier,
    };
    state.nextSeq += 1;
    state.history.unshift(record);
    if (state.history.length > 200) state.history.length = 200;
    state.open = true;
    persist();
    paint();
  };

  toggle.addEventListener('click', () => {
    state.open = !state.open;
    persist();
    paint();
  });
  minus.addEventListener('click', () => {
    state.modifier -= 1;
    persist();
    paint();
  });
  plus.addEventListener('click', () => {
    state.modifier += 1;
    persist();
    paint();
  });
  sumMinus.addEventListener('click', () => {
    state.sumCount = Math.max(1, state.sumCount - 1);
    persist();
    paint();
  });
  sumPlus.addEventListener('click', () => {
    state.sumCount = Math.min(50, state.sumCount + 1);
    persist();
    paint();
  });
  include.addEventListener('change', () => {
    state.includeBonus = include.checked;
    persist();
    paint();
  });
  clear.addEventListener('click', () => {
    state.history = [];
    state.nextSeq = 1;
    persist();
    paint();
  });
  paint();
}

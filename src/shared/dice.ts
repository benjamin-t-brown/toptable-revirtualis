import type { DieSides } from './types.js';

export interface RollRecord {
  seq: number;
  sides: DieSides;
  natural: number;
  modifier: number;
}

export function rollDie(sides: number, rng: () => number = Math.random): number {
  const face = Math.floor(rng() * sides);
  return face + 1;
}

export function rollTotal(roll: RollRecord): number {
  return roll.natural + roll.modifier;
}

export function sumLast(history: readonly RollRecord[], count: number, includeBonus: boolean): number {
  const n = Math.max(0, Math.floor(count));
  let total = 0;
  const slice = history.slice(0, n);
  for (const roll of slice) {
    total += includeBonus ? roll.natural + roll.modifier : roll.natural;
  }
  return total;
}

export function formatModifier(modifier: number): string {
  if (modifier >= 0) return `+${modifier}`;
  return String(modifier);
}

export function formatRollLine(roll: RollRecord): string {
  return `${roll.seq}. D${roll.sides}  ${roll.natural} + ${roll.modifier} = ${rollTotal(roll)}`;
}

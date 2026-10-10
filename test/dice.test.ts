import { describe, expect, it } from 'vitest';
import { formatRollLine, rollDie, rollTotal, sumLast, type RollRecord } from '../src/shared/dice.js';

const history: RollRecord[] = [
  { seq: 4, sides: 4, natural: 4, modifier: 0 },
  { seq: 3, sides: 6, natural: 5, modifier: 0 },
  { seq: 2, sides: 6, natural: 1, modifier: 0 },
  { seq: 1, sides: 20, natural: 19, modifier: 0 },
];

describe('dice', () => {
  it('rolls inclusive faces from 1 through the die size', () => {
    expect(rollDie(6, () => 0)).toBe(1);
    expect(rollDie(6, () => 0.999)).toBe(6);
    expect(rollDie(100, () => 0.5)).toBe(51);
  });

  it('sums the newest rolls and can ignore stored modifiers', () => {
    expect(sumLast(history, 3, false)).toBe(10);
    expect(sumLast(history, 3, true)).toBe(10);
    const withBonus: RollRecord[] = [{ ...history[0]!, modifier: 2 }, ...history.slice(1)];
    expect(sumLast(withBonus, 3, false)).toBe(10);
    expect(sumLast(withBonus, 3, true)).toBe(12);
    expect(rollTotal(withBonus[0]!)).toBe(6);
  });

  it('formats a history line', () => {
    expect(formatRollLine(history[0]!)).toBe('4. D4  4 + 0 = 4');
    expect(formatRollLine({ seq: 2, sides: 20, natural: 19, modifier: -1 })).toBe('2. D20  19 + -1 = 18');
  });
});

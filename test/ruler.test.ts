import { describe, expect, it } from 'vitest';
import { formatRuler, rulerLength, rulerScaleFromSquare } from '../src/shared/ruler.js';

describe('ruler distance', () => {
  it('maps table pixels through the scene scale', () => {
    expect(rulerLength({ x: 0, y: 0 }, { x: 30, y: 40 }, 10)).toBe(5);
    expect(formatRuler({ x: 0, y: 0 }, { x: 30, y: 40 }, 10, 'ft')).toBe('5 ft');
    expect(formatRuler({ x: 0, y: 0 }, { x: 100, y: 0 }, 40, 'm')).toBe('2.5 m');
  });

  it('defaults a missing scale to one pixel per unit', () => {
    expect(formatRuler({ x: 0, y: 0 }, { x: 12, y: 0 }, 0, 'ft')).toBe('12 ft');
  });

  it('reads a drawn square as pixels per unit', () => {
    expect(rulerScaleFromSquare(100, 5)).toBe(20);
    expect(rulerScaleFromSquare(250, 10)).toBe(25);
    expect(rulerScaleFromSquare(0, 5)).toBeNull();
    expect(rulerScaleFromSquare(10, 0)).toBeNull();
  });
});

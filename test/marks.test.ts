import { describe, expect, it } from 'vitest';
import { MARK_HOLD_MS, MARK_LIFE_MS, PING_HOLD_MS, PING_LIFE_MS, markOpacity, pingOpacity } from '../src/shared/marks.js';

describe('ephemeral ink', () => {
  it('stays solid for 3 seconds and is gone at 5', () => {
    expect(markOpacity(0)).toBe(1);
    expect(markOpacity(MARK_HOLD_MS)).toBe(1);
    expect(markOpacity(MARK_HOLD_MS + (MARK_LIFE_MS - MARK_HOLD_MS) / 2)).toBeCloseTo(0.5);
    expect(markOpacity(MARK_LIFE_MS)).toBe(0);
    expect(markOpacity(MARK_LIFE_MS + 1000)).toBe(0);
  });

  it('stays solid for 2 seconds and is gone at 3', () => {
    expect(pingOpacity(0)).toBe(1);
    expect(pingOpacity(PING_HOLD_MS)).toBe(1);
    expect(pingOpacity(PING_HOLD_MS + (PING_LIFE_MS - PING_HOLD_MS) / 2)).toBeCloseTo(0.5);
    expect(pingOpacity(PING_LIFE_MS)).toBe(0);
    expect(pingOpacity(PING_LIFE_MS + 1000)).toBe(0);
  });
});

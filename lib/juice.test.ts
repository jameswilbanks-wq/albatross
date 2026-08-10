import { describe, it, expect } from 'vitest';
import { impliedProbability, isHighProbabilityBet, todayISODate, isEventToday, isJuicePick } from './juice';

describe('impliedProbability', () => {
  it('takes the higher of the two leg prices regardless of side', () => {
    // Buying NO at $0.04 (4% confidence) + YES at $0.89 (89% confidence) —
    // the "high probability" read is the 0.89 leg, not the 0.04 one.
    expect(impliedProbability({ legA: { price: 0.04 }, legB: { price: 0.89 } })).toBeCloseTo(0.89, 5);
    expect(impliedProbability({ legA: { price: 0.6 }, legB: { price: 0.3 } })).toBeCloseTo(0.6, 5);
  });
});

describe('isHighProbabilityBet', () => {
  it('is true when the higher leg meets the default 0.85 threshold', () => {
    expect(isHighProbabilityBet({ legA: { price: 0.04 }, legB: { price: 0.89 } })).toBe(true);
  });

  it('is false for a near-coinflip arb even with positive edge', () => {
    expect(isHighProbabilityBet({ legA: { price: 0.48 }, legB: { price: 0.49 } })).toBe(false);
  });

  it('respects a custom threshold', () => {
    expect(isHighProbabilityBet({ legA: { price: 0.7 }, legB: { price: 0.3 } }, 0.6)).toBe(true);
    expect(isHighProbabilityBet({ legA: { price: 0.7 }, legB: { price: 0.3 } }, 0.9)).toBe(false);
  });
});

describe('todayISODate', () => {
  it('formats as YYYY-MM-DD', () => {
    const fixed = Date.UTC(2026, 7, 10, 15, 30); // Aug 10 2026, 15:30 UTC
    expect(todayISODate(fixed)).toBe('2026-08-10');
  });
});

describe('isEventToday', () => {
  const fixed = Date.UTC(2026, 7, 10, 15, 30);

  it('is true when the event date matches today', () => {
    expect(isEventToday('2026-08-10', fixed)).toBe(true);
  });

  it('is false for a different date', () => {
    expect(isEventToday('2026-08-11', fixed)).toBe(false);
    expect(isEventToday('2026-08-09', fixed)).toBe(false);
  });

  it('is false when no event date is given', () => {
    expect(isEventToday(undefined, fixed)).toBe(false);
    expect(isEventToday(null, fixed)).toBe(false);
  });
});

describe('isJuicePick', () => {
  const fixed = Date.UTC(2026, 7, 10, 15, 30);

  it('requires both high probability AND today', () => {
    expect(isJuicePick({ legA: { price: 0.9 }, legB: { price: 0.1 }, eventDate: '2026-08-10' }, 0.85, fixed)).toBe(
      true
    );
  });

  it('rejects a high-probability bet that is not today', () => {
    expect(isJuicePick({ legA: { price: 0.9 }, legB: { price: 0.1 }, eventDate: '2026-08-11' }, 0.85, fixed)).toBe(
      false
    );
  });

  it('rejects a today event with low probability', () => {
    expect(isJuicePick({ legA: { price: 0.5 }, legB: { price: 0.51 }, eventDate: '2026-08-10' }, 0.85, fixed)).toBe(
      false
    );
  });
});

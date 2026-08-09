import { describe, it, expect } from 'vitest';
import { calcMaxCapital, Level } from './sizing';

describe('calcMaxCapital', () => {
  it('walks both books and stops once the level edge drops below minEdge', () => {
    const asksA: Level[] = [
      { price: 0.4, size: 50 },
      { price: 0.42, size: 50 },
    ];
    const asksB: Level[] = [
      { price: 0.45, size: 50 },
      { price: 0.49, size: 100 },
    ];
    const noFee = () => 0;

    // level 1: cost 0.85, edge 0.15 -> fill 50
    // level 2: cost 0.91, edge 0.09 -> still above minEdge(0.05) -> fill 50
    const result = calcMaxCapital(asksA, asksB, 0.05, noFee);

    expect(result.size).toBe(100);
    expect(result.capital).toBeCloseTo(0.85 * 50 + 0.91 * 50, 5);
    expect(result.levels).toBe(2);
  });

  it('stops immediately when the first level is already below minEdge', () => {
    const asksA: Level[] = [{ price: 0.6, size: 50 }];
    const asksB: Level[] = [{ price: 0.6, size: 50 }];
    const noFee = () => 0;

    const result = calcMaxCapital(asksA, asksB, 0.05, noFee);

    expect(result.size).toBe(0);
    expect(result.levels).toBe(0);
    expect(result.avgEdge).toBe(0);
  });

  it('is limited by the smaller side of each level (does not over-fill)', () => {
    const asksA: Level[] = [{ price: 0.3, size: 20 }];
    const asksB: Level[] = [{ price: 0.3, size: 100 }];
    const noFee = () => 0;

    const result = calcMaxCapital(asksA, asksB, 0.05, noFee);

    expect(result.size).toBe(20);
  });
});

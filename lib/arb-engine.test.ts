import { describe, it, expect } from 'vitest';
import { findArb, Quote } from './arb-engine';

function quote(overrides: Partial<Quote>): Quote {
  return {
    venue: 'kalshi',
    pairId: 'test-pair',
    yesAsk: 0.5,
    yesBid: 0.49,
    yesAskSize: 100,
    noAsk: 0.5,
    noBid: 0.49,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('findArb', () => {
  it('finds a net-positive arb when YES_A + NO_B costs comfortably under $1 after fees', () => {
    // Kalshi YES ask 0.40 (fee = ceil(0.07*0.4*0.6*100)/100 = 0.02)
    // Polymarket NO ask 0.45, politics category (fee = 0.01 * 0.45 * 0.55 ~= 0.0025)
    const qA = quote({ venue: 'kalshi', yesAsk: 0.4 });
    const qB = quote({ venue: 'polymarket', noAsk: 0.45, category: 'politics' });

    const arb = findArb(qA, qB);

    expect(arb).not.toBeNull();
    expect(arb!.totalCost).toBeCloseTo(0.85, 5);
    expect(arb!.edgeNet).toBeGreaterThan(0);
    expect(arb!.edgeNet).toBeLessThan(arb!.edgeGross); // fees must reduce net edge below gross
  });

  it('returns null when combined ask prices leave no edge after fees', () => {
    const qA = quote({ venue: 'kalshi', yesAsk: 0.5 });
    const qB = quote({ venue: 'polymarket', noAsk: 0.51, category: 'crypto' });

    const arb = findArb(qA, qB);

    expect(arb).toBeNull();
  });

  it('picks whichever of the two strategies (YES-A+NO-B vs NO-A+YES-B) has the higher net edge', () => {
    // YES_A + NO_B = 0.40 + 0.50 = 0.90 (worse)
    // NO_A + YES_B = 0.35 + 0.30 = 0.65 (much better)
    const qA = quote({ venue: 'kalshi', yesAsk: 0.3, noAsk: 0.35 });
    const qB = quote({ venue: 'polymarket', yesAsk: 0.3, noAsk: 0.5, category: 'sports' });

    const arb = findArb(qA, qB);

    expect(arb).not.toBeNull();
    expect(arb!.legA.side).toBe('NO');
    expect(arb!.legB.side).toBe('YES');
    expect(arb!.totalCost).toBeCloseTo(0.65, 5);
  });
});

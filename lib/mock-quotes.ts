// Same deterministic drifting mock-quote shape as app/api/markets/route.ts,
// factored out so the Phase 2 SSE stream (and the Python feed worker) can
// all agree on what "mock but consistent" quotes look like.

import { Quote } from './arb-engine';
import { PolyCategory } from './fees';

export interface MockPair {
  id: string;
  title: string;
  category: PolyCategory;
}

export const MOCK_STREAM_PAIRS: MockPair[] = [
  { id: 'fed-24jul-nochange__0x123-fed-july', title: 'Fed decision in July - No Change', category: 'economics' },
  { id: 'btc-100k-eoy__0x789-btc-100k', title: 'Bitcoin above $100k by year end', category: 'crypto' },
  { id: 'house-control__0xabc-house-control', title: 'Party control of the House', category: 'politics' },
];

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function mockPrice(seed: number, t: number, base: number, amplitude: number): number {
  const wobble = Math.sin(t / 4000 + seed) * amplitude + Math.sin(t / 977 + seed * 3.1) * amplitude * 0.4;
  return Math.min(0.98, Math.max(0.02, Number((base + wobble).toFixed(3))));
}

export function mockStreamQuote(pair: MockPair, venue: 'kalshi' | 'polymarket', t: number): Quote {
  const seed = hashSeed(pair.id + venue);
  const biased = seed % 2 === 0;
  const base = venue === 'kalshi' ? (biased ? 0.42 : 0.5) : biased ? 0.44 : 0.5;
  const yesAsk = mockPrice(seed, t, base, 0.03);
  const noAsk = mockPrice(seed + 1, t, 1 - base - 0.02, 0.03);
  return {
    venue,
    pairId: pair.id,
    yesAsk,
    yesBid: Number((yesAsk - 0.01).toFixed(3)),
    yesAskSize: 100 + (seed % 400),
    noAsk,
    noBid: Number((noAsk - 0.01).toFixed(3)),
    timestamp: t,
    category: pair.category,
  };
}

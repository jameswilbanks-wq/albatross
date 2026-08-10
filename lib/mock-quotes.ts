// Same deterministic drifting mock-quote shape as app/api/markets/route.ts,
// factored out so the Phase 2 SSE stream (and the Python feed worker) can
// all agree on what "mock but consistent" quotes look like.

import { Quote } from './arb-engine';
import { PolyCategory } from './fees';

export interface MockPair {
  id: string;
  title: string;
  category: PolyCategory;
  // Days from "today" this event resolves — 0 = today, 1 = tomorrow, etc.
  // Computed relative to request time (not baked in as a fixed date) so the
  // "today only" Juice filter keeps working correctly no matter what day
  // the server happens to be running on.
  eventDateOffsetDays: number;
  // Optional per-venue price overrides. Omitted = use the default
  // low/high "tier" logic below. Set on the high-probability demo pairs so
  // there's always something for the Juice tab to show — one leg lands
  // near-certain (>0.85) while the other venue prices the same event
  // slightly differently, producing genuine edge on a high-conviction pick.
  kalshiBase?: number;
  polyBase?: number;
}

export const MOCK_STREAM_PAIRS: MockPair[] = [
  {
    id: 'fed-24jul-nochange__0x123-fed-july',
    title: 'Fed decision in July - No Change',
    category: 'economics',
    eventDateOffsetDays: 0,
  },
  {
    id: 'btc-100k-eoy__0x789-btc-100k',
    title: 'Bitcoin above $100k by year end',
    category: 'crypto',
    eventDateOffsetDays: 0,
  },
  {
    id: 'house-control__0xabc-house-control',
    title: 'Party control of the House',
    category: 'politics',
    // Deliberately not today, so the Juice tab's "today only" filter has
    // something real to exclude, not just an always-empty edge case.
    eventDateOffsetDays: 1,
  },
  {
    id: 'fed-no-cut-today__0xdef-fed-no-cut',
    title: 'Fed holds rates steady at today\u2019s meeting',
    category: 'economics',
    eventDateOffsetDays: 0,
    kalshiBase: 0.95,
    polyBase: 0.9,
  },
  {
    id: 'incumbent-favored-today__0xghi-incumbent',
    title: 'Incumbent wins special election held today',
    category: 'politics',
    eventDateOffsetDays: 0,
    kalshiBase: 0.88,
    polyBase: 0.93,
  },
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

/** YYYY-MM-DD (UTC) this pair's underlying event resolves, relative to `now`. */
export function pairEventDateISO(pair: MockPair, now: number = Date.now()): string {
  const d = new Date(now + pair.eventDateOffsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

export function mockStreamQuote(pair: MockPair, venue: 'kalshi' | 'polymarket', t: number): Quote {
  const seed = hashSeed(pair.id + venue);
  const biased = seed % 2 === 0;
  const defaultBase = venue === 'kalshi' ? (biased ? 0.42 : 0.5) : biased ? 0.44 : 0.5;
  const base = venue === 'kalshi' ? pair.kalshiBase ?? defaultBase : pair.polyBase ?? defaultBase;
  // Smaller wobble for the deliberately-lopsided high-probability pairs so
  // they stay comfortably above the 0.85 threshold instead of drifting
  // back and forth across it every tick.
  const amplitude = pair.kalshiBase !== undefined || pair.polyBase !== undefined ? 0.015 : 0.03;
  const yesAsk = mockPrice(seed, t, base, amplitude);
  const noAsk = mockPrice(seed + 1, t, 1 - base - 0.02, amplitude);
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

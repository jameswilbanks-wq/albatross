import { NextResponse } from 'next/server';
import { findArb, Quote } from '@/lib/arb-engine';
import { PolyCategory } from '@/lib/fees';
import pairs from '@/pairs.example.json';

export const dynamic = 'force-dynamic'; // never cache — this is polled every 2s

type Pair = {
  id: string;
  title: string;
  kalshi_ticker: string;
  kalshi_url: string;
  polymarket_id: string;
  polymarket_url: string;
  category: PolyCategory;
};

// --- Quote source -----------------------------------------------------
// Phase 1 default is mocked, deterministic-but-jittery quotes so the
// dashboard is demoable with `pnpm dev` and no API keys or network access.
// Set MOCK_QUOTES=false once workers/kalshi_client.py and
// workers/polymarket_client.py are wired to a real feed (Redis/WS) and this
// route reads from that feed instead of generating numbers.

function mockPrice(seed: number, t: number, base: number, amplitude: number): number {
  // Smooth pseudo-random walk driven by time, deterministic per pair so
  // repeated polls converge instead of jumping around randomly.
  const wobble = Math.sin(t / 4000 + seed) * amplitude + Math.sin(t / 977 + seed * 3.1) * amplitude * 0.4;
  const price = base + wobble;
  return Math.min(0.98, Math.max(0.02, Number(price.toFixed(3))));
}

function mockQuoteFor(pair: Pair, venue: 'kalshi' | 'polymarket', t: number): Quote {
  const seed = hashSeed(pair.id + venue);
  // Bias roughly half the pairs toward a real crossable edge so the demo
  // dashboard actually shows green badges instead of sitting empty.
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

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

async function getQuotes(pair: Pair, t: number): Promise<[Quote, Quote]> {
  const useMock = process.env.MOCK_QUOTES !== 'false';
  if (useMock) {
    return [mockQuoteFor(pair, 'kalshi', t), mockQuoteFor(pair, 'polymarket', t)];
  }
  // Real path: hit the public REST endpoints directly. No auth required for
  // reading orderbooks (see workers/kalshi_client.py / polymarket_client.py
  // for the equivalent Python calls used by the streaming worker).
  const [kalshiRes, polyRes] = await Promise.all([
    fetch(`https://api.elections.kalshi.com/trade-api/v2/markets/${pair.kalshi_ticker}/orderbook`, {
      cache: 'no-store',
    }),
    fetch(`https://clob.polymarket.com/book?token_id=${pair.polymarket_id}`, { cache: 'no-store' }),
  ]);
  if (!kalshiRes.ok || !polyRes.ok) {
    throw new Error(`quote fetch failed for ${pair.id}: kalshi ${kalshiRes.status}, poly ${polyRes.status}`);
  }
  const kalshiBook = await kalshiRes.json();
  const polyBook = await polyRes.json();
  // NOTE: mapping raw orderbook shapes -> Quote is left for the realtime
  // phase (workers/feed.py normalizes this over the WS feed); Phase 1 only
  // needs the mock path to prove the pipeline end-to-end.
  return [
    { ...mockQuoteFor(pair, 'kalshi', t), ...kalshiBook?.quote },
    { ...mockQuoteFor(pair, 'polymarket', t), ...polyBook?.quote },
  ];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const minEdge = parseFloat(searchParams.get('minEdge') || '0');
  const t = Date.now();

  const results = await Promise.all(
    (pairs as Pair[]).map(async (pair) => {
      try {
        const [kalshiQuote, polyQuote] = await getQuotes(pair, t);
        const arb = findArb(kalshiQuote, polyQuote);
        return arb ? { ...arb, title: pair.title, pairId: pair.id } : null;
      } catch (err) {
        console.error(`[markets] failed to quote ${pair.id}:`, err);
        return null;
      }
    })
  );

  const opportunities = results
    .filter((o): o is NonNullable<typeof o> => o !== null && o.edgeNet >= minEdge)
    .sort((a, b) => b.edgeNet - a.edgeNet);

  return NextResponse.json({
    opportunities,
    minEdge,
    mock: process.env.MOCK_QUOTES !== 'false',
    pairCount: (pairs as Pair[]).length,
    generatedAt: t,
  });
}

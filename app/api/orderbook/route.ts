import { NextResponse } from 'next/server';
import { MOCK_STREAM_PAIRS, mockStreamQuote } from '../../../lib/mock-quotes';
import type { Level } from '../../../lib/sizing';

export const dynamic = 'force-dynamic';

const LADDER_DEPTH = 8;

function buildLadder(topPrice: number, topSize: number, seed: number, step: number): Level[] {
  const levels: Level[] = [];
  for (let i = 0; i < LADDER_DEPTH; i++) {
    const price = Number(Math.min(0.99, topPrice + i * step).toFixed(3));
    // Size generally thins out further from the top of book, with a little
    // per-level jitter so the ladder doesn't look perfectly linear.
    const jitter = ((seed + i * 37) % 40) - 20;
    const size = Math.max(5, Math.round((topSize * (1 - i * 0.11)) + jitter));
    levels.push({ price, size });
  }
  return levels;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pairId = searchParams.get('pairId');
  if (!pairId) {
    return NextResponse.json({ error: 'pairId query param is required' }, { status: 400 });
  }

  const pair = MOCK_STREAM_PAIRS.find((p) => p.id === pairId);
  if (!pair) {
    return NextResponse.json({ error: `unknown pairId: ${pairId}` }, { status: 404 });
  }

  const t = Date.now();
  const kalshi = mockStreamQuote(pair, 'kalshi', t);
  const poly = mockStreamQuote(pair, 'polymarket', t);

  const seedFor = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  };

  return NextResponse.json({
    pairId,
    title: pair.title,
    generatedAt: t,
    kalshi: {
      yesAsks: buildLadder(kalshi.yesAsk, kalshi.yesAskSize, seedFor(pairId + 'kalshi-yes'), 0.005),
      noAsks: buildLadder(kalshi.noAsk, kalshi.yesAskSize, seedFor(pairId + 'kalshi-no'), 0.005),
    },
    polymarket: {
      yesAsks: buildLadder(poly.yesAsk, poly.yesAskSize, seedFor(pairId + 'poly-yes'), 0.004),
      noAsks: buildLadder(poly.noAsk, poly.yesAskSize, seedFor(pairId + 'poly-no'), 0.004),
    },
  });
}

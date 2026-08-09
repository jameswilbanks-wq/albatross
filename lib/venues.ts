// Public, no-auth market listings for both venues. Mirrors the shape used
// by workers/kalshi_client.py and workers/polymarket_client.py so the
// discovery pipeline and the quote feed agree on ticker/id conventions.

export interface VenueMarket {
  id: string; // kalshi_ticker or polymarket condition/market id
  title: string;
  rules: string;
  category: string;
}

function isMockMode(): boolean {
  return process.env.MOCK_MODE !== 'false';
}

// A deliberately mixed bag: some pairs are genuine cross-venue matches,
// some are near-misses (same topic, different resolution rules) so the
// LLM-verification step in /api/match has something real to reject.
const MOCK_KALSHI_MARKETS: VenueMarket[] = [
  {
    id: 'FED-24JUL-NOCHANGE',
    title: 'Fed decision in July - No Change',
    rules:
      'Resolves YES if the FOMC makes no change to the federal funds target rate at its July meeting.',
    category: 'economics',
  },
  {
    id: 'BTC-100K-EOY',
    title: 'Bitcoin above $100k by year end',
    rules: 'Resolves YES if BTC/USD (Coinbase) is at or above $100,000 at 11:59pm ET Dec 31.',
    category: 'crypto',
  },
  {
    id: 'HOUSE-CONTROL',
    title: 'Party control of the House',
    rules: 'Resolves YES for Republicans if the GOP holds a majority of House seats after the election.',
    category: 'politics',
  },
  {
    id: 'BTC-150K-EOY',
    title: 'Bitcoin above $150k by year end',
    rules: 'Resolves YES if BTC/USD (Coinbase) is at or above $150,000 at 11:59pm ET Dec 31.',
    category: 'crypto',
  },
];

const MOCK_POLYMARKET_MARKETS: VenueMarket[] = [
  {
    id: '0x123-fed-july',
    title: 'Fed decision in July - No Change',
    rules: 'Resolves YES if the Federal Reserve does not change the federal funds rate at the July FOMC meeting.',
    category: 'economics',
  },
  {
    id: '0x789-btc-100k',
    title: 'Bitcoin above $100k by year end',
    rules: 'Resolves YES if Bitcoin trades at or above $100,000 on any major exchange before Dec 31, 11:59pm ET.',
    category: 'crypto',
  },
  {
    id: '0xabc-house-control',
    title: 'Party control of the House',
    rules: 'Resolves YES for Republicans if Republicans win a majority of seats in the House of Representatives.',
    category: 'politics',
  },
  {
    id: '0xdef-btc-100k-anytime',
    title: 'Bitcoin reaches $100k at any point this year',
    // Same topic as BTC-100K-EOY but a materially different resolution
    // condition ("any point" vs "at year-end") — should be rejected by the
    // LLM verifier even if embeddings put it above the similarity bar.
    rules: 'Resolves YES if Bitcoin touches $100,000 at ANY point during the calendar year, not just at year end.',
    category: 'crypto',
  },
];

export async function fetchKalshiMarkets(): Promise<VenueMarket[]> {
  if (isMockMode()) return MOCK_KALSHI_MARKETS;

  const res = await fetch('https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=1000', {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Kalshi markets fetch failed: ${res.status}`);
  const data = await res.json();
  return (data.markets ?? []).map((m: any) => ({
    id: m.ticker,
    title: m.title ?? m.ticker,
    rules: m.rules_primary ?? '',
    category: (m.category ?? 'general').toLowerCase(),
  }));
}

export async function fetchPolymarketEvents(): Promise<VenueMarket[]> {
  if (isMockMode()) return MOCK_POLYMARKET_MARKETS;

  const res = await fetch('https://gamma-api.polymarket.com/events?active=true&closed=false&limit=1000', {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Polymarket events fetch failed: ${res.status}`);
  const data = await res.json();
  return (data ?? []).map((e: any) => ({
    id: e.id,
    title: e.title ?? e.slug,
    rules: e.description ?? '',
    category: (e.category ?? 'general').toLowerCase(),
  }));
}

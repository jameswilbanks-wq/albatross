import { NextResponse } from 'next/server';
import { fetchKalshiMarkets, fetchPolymarketEvents, VenueMarket } from '../../../lib/venues';
import { embedText, verifyMatch, isOpenAiMockMode } from '../../../lib/openai';
import { cosineSimilarity } from '../../../lib/vector';
import { query } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // embedding + LLM calls over many markets can be slow

const SIMILARITY_THRESHOLD = 0.85;

interface EmbeddedMarket extends VenueMarket {
  embedding: number[];
}

/** pgvector's text input format: '[0.1,0.2,...]' */
function toPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

async function embedAll(markets: VenueMarket[]): Promise<EmbeddedMarket[]> {
  const out: EmbeddedMarket[] = [];
  for (const m of markets) {
    // Title repeated to weight it more heavily than the rules text, which
    // tends to be worded much more inconsistently across venues.
    const embedding = await embedText(`${m.title}\n${m.title}\n${m.rules}`);
    out.push({ ...m, embedding });
  }
  return out;
}

async function upsertMarket(venue: 'kalshi' | 'polymarket', m: EmbeddedMarket) {
  await query(
    `INSERT INTO markets (id, venue, title, rules, category, embedding, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title, rules = excluded.rules, category = excluded.category,
       embedding = excluded.embedding, updated_at = now()`,
    [m.id, venue, m.title, m.rules, m.category, toPgVector(m.embedding)]
  );
}

/** Nearest Polymarket neighbor to a Kalshi market's embedding via pgvector's <=> (cosine distance). */
async function findNearestPolyMarket(
  embedding: number[]
): Promise<{ id: string; title: string; rules: string; category: string; similarity: number } | null> {
  if (!process.env.DATABASE_URL) return null; // mock mode falls back to the JS loop below
  const rows = await query<{
    id: string; title: string; rules: string; category: string; distance: number;
  }>(
    `SELECT id, title, rules, category, embedding <=> $1 AS distance
     FROM markets WHERE venue = 'polymarket'
     ORDER BY embedding <=> $1 LIMIT 1`,
    [toPgVector(embedding)]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return { ...row, similarity: 1 - row.distance }; // cosine distance -> similarity
}

function checkCronAuth(req: Request): boolean {
  const secret = process.env.CRON_SHARED_SECRET;
  if (!secret) return true; // not configured (e.g. local dev) — allow
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();

  const [kalshiMarkets, polyMarkets] = await Promise.all([
    fetchKalshiMarkets(),
    fetchPolymarketEvents(),
  ]);

  const [kalshiEmbedded, polyEmbedded] = await Promise.all([
    embedAll(kalshiMarkets),
    embedAll(polyMarkets),
  ]);

  // Persist every embedded market — this is the catalog pgvector searches
  // against, and what future discovery runs incrementally update.
  await Promise.all([
    ...kalshiEmbedded.map((m) => upsertMarket('kalshi', m)),
    ...polyEmbedded.map((m) => upsertMarket('polymarket', m)),
  ]);

  const candidates: {
    kalshi: EmbeddedMarket;
    poly: EmbeddedMarket;
    similarity: number;
  }[] = [];

  for (const k of kalshiEmbedded) {
    // Real mode: pgvector nearest-neighbor query. Mock/local mode (no
    // DATABASE_URL): same brute-force cosine loop as before, over the
    // small in-memory candidate set — identical results, no DB needed.
    const nearest = await findNearestPolyMarket(k.embedding);
    let best: { id: string; title: string; rules: string; category: string; similarity: number } | null = nearest;
    if (!best) {
      let bestSim = -1;
      for (const p of polyEmbedded) {
        const sim = cosineSimilarity(k.embedding, p.embedding);
        if (sim > bestSim) {
          bestSim = sim;
          best = { id: p.id, title: p.title, rules: p.rules, category: p.category, similarity: sim };
        }
      }
    }
    if (best && best.similarity >= SIMILARITY_THRESHOLD) {
      const poly = polyEmbedded.find((p) => p.id === best!.id)!;
      candidates.push({ kalshi: k, poly, similarity: best.similarity });
    }
  }

  const inserted: Array<{ id: string; title: string; similarity: number; reason: string }> = [];
  const rejected: Array<{ kalshiId: string; polymarketId: string; similarity: number; reason: string }> = [];

  for (const c of candidates) {
    const verification = await verifyMatch(c.kalshi.title, c.kalshi.rules, c.poly.title, c.poly.rules);

    if (!verification.match) {
      rejected.push({
        kalshiId: c.kalshi.id,
        polymarketId: c.poly.id,
        similarity: c.similarity,
        reason: verification.reason,
      });
      continue;
    }

    const pairId = `${c.kalshi.id}__${c.poly.id}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    await query(
      `INSERT INTO pairs (id, kalshi_market_id, polymarket_market_id, title, category, similarity, llm_verified, llm_reason, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, now())
       ON CONFLICT (id) DO UPDATE SET
         similarity = excluded.similarity, llm_verified = true, llm_reason = excluded.llm_reason, updated_at = now()`,
      [pairId, c.kalshi.id, c.poly.id, c.kalshi.title, c.kalshi.category, c.similarity, verification.reason]
    );

    inserted.push({ id: pairId, title: c.kalshi.title, similarity: c.similarity, reason: verification.reason });
  }

  return NextResponse.json({
    mock: isOpenAiMockMode(),
    usingPgvector: Boolean(process.env.DATABASE_URL),
    kalshiMarketsScanned: kalshiMarkets.length,
    polymarketMarketsScanned: polyMarkets.length,
    candidatesAboveSimilarityThreshold: candidates.length,
    similarityThreshold: SIMILARITY_THRESHOLD,
    matchedAndInserted: inserted,
    rejectedByLlm: rejected,
    durationMs: Date.now() - startedAt,
  });
}

export async function GET() {
  const rows = await query(
    `SELECT id, title, category, kalshi_market_id, polymarket_market_id, similarity, llm_verified, llm_reason, status, created_at
     FROM pairs ORDER BY created_at DESC LIMIT 200`
  );
  return NextResponse.json({ pairs: rows });
}

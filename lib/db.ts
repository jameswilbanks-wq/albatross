// Postgres client for Render — replaces the Cloudflare D1 REST-API client
// used during development. Render's managed Postgres has real pgvector
// support, so similarity search moves from an in-application cosine loop
// (lib/vector.ts) to a native SQL `<=>` operator query here.
//
// Required env var: DATABASE_URL (Render injects this automatically when
// the web/worker service is wired to the `albatross-db` database in
// render.yaml via `fromDatabase`).

import { Pool, type QueryResultRow } from 'pg';

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not set — see render.yaml / .env.example');
  }
  pool = new Pool({
    connectionString,
    // Render's internal Postgres connections don't need TLS verification
    // against a public CA; external/local connections do.
    ssl: connectionString.includes('render.com') ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  if (!process.env.DATABASE_URL) {
  if (process.env.MOCK_MODE !== 'false') {
      return mockQuery<T>(sql, params);
    }
    throw new Error('DATABASE_URL not configured and MOCK_MODE=false — nothing to query');
  }
  const client = await getPool().connect();
  try {
    const result = await client.query<T>(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// --------------------------------------------------------------------------
// Mock fallback — same purpose as the earlier D1 in-memory stand-in: lets
// /api/match and friends run end-to-end without a real database attached,
// for local dev before DATABASE_URL exists. Recognizes only the specific
// query shapes issued by app/api/match/route.ts, not general SQL.
// ---------------------------------------------------------------------------

const mockMarkets = new Map<string, QueryResultRow>();
const mockPairs = new Map<string, QueryResultRow>();

function mockQuery<T extends QueryResultRow>(sql: string, params: unknown[]): T[] {
  const s = sql.trim().toUpperCase();

  if (s.startsWith('INSERT INTO MARKETS')) {
    const [id, venue, title, rules, category, embedding] = params;
    const now = new Date().toISOString();
    mockMarkets.set(`${venue}:${id}`, {
      id, venue, title, rules, category, embedding,
      created_at: now, updated_at: now,
    });
    return [] as T[];
  }

  if (s.startsWith('INSERT INTO PAIRS')) {
    const [id, kalshiId, polyId, title, category, similarity, llmReason] = params;
    const now = new Date().toISOString();
    mockPairs.set(String(id), {
      id, kalshi_market_id: kalshiId, polymarket_market_id: polyId,
      title, category, similarity, llm_verified: true, llm_reason: llmReason,
      status: 'active', created_at: now, updated_at: now,
    });
    return [] as T[];
  }

  if (s.startsWith('SELECT') && s.includes('FROM PAIRS')) {
    return Array.from(mockPairs.values()).sort((a, b) =>
      String(b.created_at).localeCompare(String(a.created_at))
    ) as T[];
  }

  if (s.startsWith('SELECT') && s.includes('FROM MARKETS')) {
    return Array.from(mockMarkets.values()) as T[];
  }

  throw new Error(`mock query() doesn't recognize this query shape: ${sql.slice(0, 60)}...`);
}

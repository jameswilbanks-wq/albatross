import { describe, it, expect, beforeEach, vi } from 'vitest';

// Force mock mode and no DATABASE_URL so query() takes the in-memory path.
vi.stubEnv('DATABASE_URL', '');
vi.stubEnv('MOCK_MODE', 'true');

describe('query() mock fallback — pairs insert column alignment', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('maps INSERT INTO pairs params to the right columns, matching the real SQL positions exactly', async () => {
    const { query } = await import('./db');

    // This mirrors the exact SQL and param order used in
    // app/api/match/route.ts — if that SQL changes, this test's inputs
    // should change with it, not just the mock's destructuring.
    await query(
      `INSERT INTO pairs (id, kalshi_market_id, polymarket_market_id, title, category, similarity, llm_verified, llm_reason, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, now())`,
      ['pair-1', 'KALSHI-TICKER', '0xpoly', 'Some Market Title', 'crypto', 0.91, 'LLM said these match because reasons']
    );

    const rows = await query<{
      id: string; kalshi_market_id: string; polymarket_market_id: string;
      title: string; category: string; similarity: number;
      llm_verified: boolean; llm_reason: string;
    }>('SELECT * FROM pairs');

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe('pair-1');
    expect(row.kalshi_market_id).toBe('KALSHI-TICKER');
    expect(row.polymarket_market_id).toBe('0xpoly');
    expect(row.title).toBe('Some Market Title');
    expect(row.category).toBe('crypto');
    expect(row.similarity).toBe(0.91);
    // The two fields that were previously misaligned (once on the D1
    // version of this mock, then again here) — pin them explicitly.
    expect(row.llm_verified).toBe(true);
    expect(row.llm_reason).toBe('LLM said these match because reasons');
  });
});

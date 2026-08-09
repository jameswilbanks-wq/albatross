// Thin OpenAI wrapper for the two calls auto-discovery needs:
//  1. text-embedding-3-small, to embed "title + rules" for each market
//  2. gpt-4o-mini, to verify a high-similarity candidate pair actually
//     resolves identically before we trust it as a tradeable pair.
//
// MOCK_MODE=true (or no OPENAI_API_KEY) swaps in deterministic fakes so the
// whole /api/match pipeline is exercisable without network access or a key
// — same pattern as MOCK_QUOTES in Phase 1.

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;
const VERIFIER_MODEL = 'gpt-4o-mini';

function isMockMode(): boolean {
  return process.env.MOCK_MODE !== 'false' || !process.env.OPENAI_API_KEY;
}

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'if', 'at', 'or', 'and', 'to', 'of', 'in', 'on', 'by', 'be', 'will',
  'this', 'that', 'for', 'with', 'yes', 'no', 'resolves',
]);

/**
 * Deterministic bag-of-words "embedding": each surviving word hashes to a
 * dimension and adds a unit vector there (the classic hashing trick). This
 * is not a real semantic embedding — synonyms won't cluster the way a real
 * model would — but shared vocabulary DOES produce genuine cosine
 * similarity, unlike hashing the whole string, so it exercises the
 * threshold/verification logic meaningfully in mock mode instead of always
 * returning near-zero similarity for everything.
 */
function mockEmbedding(text: string): number[] {
  const vec = new Array(EMBEDDING_DIM).fill(0);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));

  for (const word of words) {
    const idx = hashSeed(word) % EMBEDDING_DIM;
    vec[idx] += 1;
  }

  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export async function embedText(text: string): Promise<number[]> {
  if (isMockMode()) return mockEmbedding(text);

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding as number[];
}

export interface MatchVerification {
  match: boolean;
  reason: string;
}

export async function verifyMatch(
  kalshiTitle: string,
  kalshiRules: string,
  polyTitle: string,
  polyRules: string
): Promise<MatchVerification> {
  if (isMockMode()) {
    // Mock verifier: agree only when titles are near-identical after
    // normalization, so the demo pipeline still exercises the "reject
    // near-miss" path instead of rubber-stamping every high-similarity pair.
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const match = norm(kalshiTitle) === norm(polyTitle);
    return {
      match,
      reason: match
        ? '[mock] Titles normalize identically; assuming matching resolution rules.'
        : '[mock] Titles differ after normalization; resolution rules likely diverge.',
    };
  }

  const prompt = `Do these two markets have identical resolution rules, expiry, and outcome? Answer JSON {match: bool, reason: string}

Market A (Kalshi): ${kalshiTitle}
Rules A: ${kalshiRules}

Market B (Polymarket): ${polyTitle}
Rules B: ${polyRules}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VERIFIER_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI chat completion failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const content = data.choices[0].message.content as string;
  const parsed = JSON.parse(content);
  return { match: Boolean(parsed.match), reason: String(parsed.reason ?? '') };
}

export { isMockMode as isOpenAiMockMode };

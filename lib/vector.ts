// D1 (SQLite) has no native vector type, so embeddings are stored as a
// JSON-encoded float array in a TEXT column and similarity is computed here
// in application code. This is the substitute for pgvector's `<=>` operator.
// Fine at this scale (hundreds to low thousands of markets); if the pair
// catalog grows into the tens of thousands, move this to Cloudflare
// Vectorize or a real pgvector-backed Postgres instead.

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function encodeEmbedding(vec: number[]): string {
  return JSON.stringify(vec);
}

export function decodeEmbedding(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Find the best-matching candidate for `target` among `pool`, if any beats `threshold`. */
export function findBestMatch<T extends { embedding: number[] }>(
  target: number[],
  pool: T[],
  threshold: number
): { candidate: T; similarity: number } | null {
  let best: { candidate: T; similarity: number } | null = null;
  for (const candidate of pool) {
    const similarity = cosineSimilarity(target, candidate.embedding);
    if (similarity >= threshold && (!best || similarity > best.similarity)) {
      best = { candidate, similarity };
    }
  }
  return best;
}

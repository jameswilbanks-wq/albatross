import { describe, it, expect } from 'vitest';
import { cosineSimilarity, findBestMatch, encodeEmbedding, decodeEmbedding } from './vector';

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 10);
  });

  it('throws on dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow();
  });
});

describe('findBestMatch', () => {
  const pool = [
    { id: 'a', embedding: [1, 0, 0] },
    { id: 'b', embedding: [0.9, 0.1, 0] },
    { id: 'c', embedding: [0, 1, 0] },
  ];

  it('returns the closest candidate above threshold', () => {
    const match = findBestMatch([1, 0, 0], pool, 0.85);
    expect(match?.candidate.id).toBe('a');
    expect(match?.similarity).toBeCloseTo(1, 10);
  });

  it('returns null when nothing clears the threshold', () => {
    const match = findBestMatch([0, 0, 1], pool, 0.85);
    expect(match).toBeNull();
  });
});

describe('embedding encode/decode round-trip', () => {
  it('round-trips a vector through JSON', () => {
    const vec = [0.1, -0.2, 0.3];
    expect(decodeEmbedding(encodeEmbedding(vec))).toEqual(vec);
  });

  it('returns null for missing or invalid input', () => {
    expect(decodeEmbedding(null)).toBeNull();
    expect(decodeEmbedding(undefined)).toBeNull();
    expect(decodeEmbedding('not json')).toBeNull();
  });
});

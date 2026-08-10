import { findArb, Quote } from '../../../../lib/arb-engine';
import { MOCK_STREAM_PAIRS, mockStreamQuote, pairEventDateISO } from '../../../../lib/mock-quotes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Redis pub/sub needs a persistent TCP connection, not Edge

const QUOTES_CHANNEL = 'albatross:quotes';
const PUBLISH_INTERVAL_MS = 2000;

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Tracks the latest quote per (pairId, venue) and recomputes arb whenever a
 * new quote for either leg arrives. Shared by both the real Redis-backed
 * path and the in-process mock path below, so "what counts as arb_new"
 * behaves identically either way.
 */
type TrackerResult =
  | { type: 'arb_new'; pairId: string; opportunity: NonNullable<ReturnType<typeof findArb>> }
  | { type: 'arb_closed'; pairId: string }
  | null;

class OpportunityTracker {
  private latest = new Map<string, Quote>(); // key: `${pairId}:${venue}`
  private lastNetEdge = new Map<string, number>(); // key: pairId

  ingest(quote: Quote): TrackerResult {
    this.latest.set(`${quote.pairId}:${quote.venue}`, quote);
    const kalshi = this.latest.get(`${quote.pairId}:kalshi`);
    const poly = this.latest.get(`${quote.pairId}:polymarket`);
    if (!kalshi || !poly) return null;

    const opportunity = findArb(kalshi, poly);
    const prevEdge = this.lastNetEdge.get(quote.pairId) ?? 0;
    const newEdge = opportunity?.edgeNet ?? 0;
    this.lastNetEdge.set(quote.pairId, newEdge);

    // arb_new: crossing from "not profitable" into "profitable", or the
    // edge meaningfully improves — not on every tick, which would just be
    // noisy quote spam under a different event name.
    const crossedIntoProfit = newEdge > 0 && prevEdge <= 0;
    const improvedMeaningfully = newEdge > 0 && newEdge > prevEdge + 0.005;
    if (crossedIntoProfit || improvedMeaningfully) {
      return { type: 'arb_new', pairId: quote.pairId, opportunity: opportunity! };
    }

    // arb_closed: the edge that was previously positive just went to zero
    // or negative — tell the frontend to drop the card instead of leaving
    // a stale opportunity displayed forever.
    if (prevEdge > 0 && newEdge <= 0) {
      return { type: 'arb_closed', pairId: quote.pairId };
    }

    return null;
  }
}

export async function GET() {
  const encoder = new TextEncoder();
  const mockMode = process.env.MOCK_MODE !== 'false';
  const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL;

  const stream = new ReadableStream({
    async start(controller) {
      const tracker = new OpportunityTracker();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        } catch {
          // controller already closed (client disconnected) — ignore
        }
      };

      send('connected', { mock: mockMode, channel: QUOTES_CHANNEL });

      if (!mockMode && redisUrl) {
        // --- Real mode: subscribe to Redis, relay arb_new as quotes arrive ---
        // NOTE: real-mode quotes don't carry eventDate (that lives in the
        // `pairs` table in Postgres, not on the Redis quote payload), so
        // opportunities from this path won't appear in the "Juice: Today"
        // tab until that's wired up — same gap as the rest of real-mode
        // metadata (title, category) documented elsewhere in this file.
        const { default: Redis } = await import('ioredis');
        const sub = new Redis(redisUrl);
        await sub.subscribe(QUOTES_CHANNEL);
        sub.on('message', (_channel, message) => {
          try {
            const quote = JSON.parse(message) as Quote;
            const result = tracker.ingest(quote);
            if (result?.type === 'arb_new') {
              send('arb_new', { ...result.opportunity, pairId: result.pairId });
            } else if (result?.type === 'arb_closed') {
              send('arb_closed', { pairId: result.pairId });
            }
          } catch (err) {
            console.error('[stream] failed to process redis message:', err);
          }
        });
        // Clean up when the client disconnects.
        // (ReadableStream cancel() is called by the runtime on abort.)
        (controller as any)._redisSub = sub;
        return;
      }

      // --- Mock mode: simulate the same quotes -> tracker -> arb_new pipeline in-process ---
      let t = 0;
      const timer = setInterval(() => {
        for (const pair of MOCK_STREAM_PAIRS) {
          for (const venue of ['kalshi', 'polymarket'] as const) {
            const quote = mockStreamQuote(pair, venue, t);
            const result = tracker.ingest(quote);
            if (result?.type === 'arb_new') {
              send('arb_new', {
                ...result.opportunity,
                pairId: result.pairId,
                title: pair.title,
                eventDate: pairEventDateISO(pair),
              });
            } else if (result?.type === 'arb_closed') {
              send('arb_closed', { pairId: result.pairId, title: pair.title });
            }
          }
        }
        t += PUBLISH_INTERVAL_MS;
      }, PUBLISH_INTERVAL_MS);
      (controller as any)._mockTimer = timer;
    },
    cancel(reason) {
      // Best-effort cleanup; the controller reference isn't reachable here
      // in all runtimes, so also rely on process-level GC for the interval.
      void reason;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

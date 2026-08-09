"""
Realtime quote feed — Phase 2.

Subscribes to Kalshi's and Polymarket's public market-data WebSocket feeds
for every pair in the `pairs` table (Cloudflare D1), normalizes each update
into a common Quote shape, and publishes it to a Redis channel that
app/api/opportunities/stream/route.ts consumes over SSE.

This process only ever reads market data and publishes to Redis — it never
places orders. Auto-betting (EXECUTION_ENABLED) is a separate, later phase
and is not touched by this file.

Env vars:
  REDIS_URL               rediss://... or redis://... — Render's managed
                          Key Value service is Redis-protocol compatible,
                          so redis-py works unmodified. (UPSTASH_REDIS_URL
                          is still read as a fallback for local dev against
                          Upstash instead of Render.)
  DATABASE_URL             Postgres connection string (Render injects this
                          automatically via render.yaml's `fromDatabase`)
                          — used to load the active pair list.
  MOCK_MODE               "true" (default) runs a synthetic feed that
                          publishes smoothly drifting quotes on a fixed
                          schedule, so `pnpm worker` is demoable without
                          real venue/DB/Redis credentials. Set to "false" to
                          run the real WS subscriptions below.

Run: pnpm worker   (== python3 workers/feed.py)
"""
import asyncio
import json
import math
import os
import time
import zlib
from dataclasses import dataclass, asdict

try:
    import psycopg2
except ImportError:  # pragma: no cover - psycopg2-binary is in requirements.txt
    psycopg2 = None

try:
    import redis
except ImportError:  # pragma: no cover - redis is in requirements.txt
    redis = None

try:
    import websockets
except ImportError:  # pragma: no cover - websockets is in requirements.txt
    websockets = None

QUOTES_CHANNEL = "albatross:quotes"
MOCK_MODE = os.getenv("MOCK_MODE", "true").lower() != "false"
PUBLISH_INTERVAL_SECONDS = float(os.getenv("FEED_PUBLISH_INTERVAL", "2"))


@dataclass
class Quote:
    pairId: str
    venue: str
    yesAsk: float
    yesBid: float
    noAsk: float
    noBid: float
    yesAskSize: int
    timestamp: int
    category: str = "general"


# ---------------------------------------------------------------------------
# Redis publish (real Upstash, or a local stdout-only stub when no Redis URL
# is configured — so this script always runs to completion on a laptop with
# nothing set up yet).
# ---------------------------------------------------------------------------

class RedisPublisher:
    def __init__(self):
        self.url = os.getenv("REDIS_URL") or os.getenv("UPSTASH_REDIS_URL")
        self._client = None
        if self.url and redis is not None:
            self._client = redis.from_url(self.url, decode_responses=True)

    def publish(self, quote: Quote):
        payload = json.dumps(asdict(quote))
        if self._client:
            self._client.publish(QUOTES_CHANNEL, payload)
        else:
            print(f"[no-redis] would publish -> {QUOTES_CHANNEL}: {payload}")


# ---------------------------------------------------------------------------
# Pair list — loaded from D1 in real mode, hardcoded in mock mode (mirrors
# lib/venues.ts's mock catalog so Phase 1 and Phase 2 demo the same pairs).
# ---------------------------------------------------------------------------

MOCK_PAIRS = [
    {"id": "fed-24jul-nochange__0x123-fed-july", "kalshi_ticker": "FED-24JUL-NOCHANGE",
     "polymarket_id": "0x123-fed-july", "title": "Fed decision in July - No Change", "category": "economics"},
    {"id": "btc-100k-eoy__0x789-btc-100k", "kalshi_ticker": "BTC-100K-EOY",
     "polymarket_id": "0x789-btc-100k", "title": "Bitcoin above $100k by year end", "category": "crypto"},
    {"id": "house-control__0xabc-house-control", "kalshi_ticker": "HOUSE-CONTROL",
     "polymarket_id": "0xabc-house-control", "title": "Party control of the House", "category": "politics"},
]


def load_pairs():
    if MOCK_MODE:
        return MOCK_PAIRS

    if psycopg2 is None:
        raise RuntimeError("psycopg2-binary not installed — pip install -r requirements.txt")
    database_url = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(database_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT p.id, k.id AS kalshi_ticker, m.id AS polymarket_id, p.title, p.category
                FROM pairs p
                JOIN markets k ON k.id = p.kalshi_market_id AND k.venue = 'kalshi'
                JOIN markets m ON m.id = p.polymarket_market_id AND m.venue = 'polymarket'
                WHERE p.status = 'active'
                """
            )
            columns = [desc[0] for desc in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Mock feed — deterministic smooth drift, same shape as the Phase 1 mock
# generator in app/api/markets/route.ts, so the two phases look consistent.
# ---------------------------------------------------------------------------

def _hash_seed(s: str) -> int:
    return zlib.crc32(s.encode("utf-8"))


def _mock_price(seed: int, t: float, base: float, amplitude: float) -> float:
    wobble = math.sin(t / 4 + seed) * amplitude + math.sin(t / 0.977 + seed * 3.1) * amplitude * 0.4
    return min(0.98, max(0.02, round(base + wobble, 3)))


def _mock_quote(pair: dict, venue: str, t: float) -> Quote:
    seed = _hash_seed(pair["id"] + venue) % 1000 / 1000
    biased = int(seed * 1000) % 2 == 0
    base = (0.42 if biased else 0.5) if venue == "kalshi" else (0.44 if biased else 0.5)
    yes_ask = _mock_price(seed, t, base, 0.03)
    no_ask = _mock_price(seed + 1, t, 1 - base - 0.02, 0.03)
    return Quote(
        pairId=pair["id"],
        venue=venue,
        yesAsk=yes_ask,
        yesBid=round(yes_ask - 0.01, 3),
        noAsk=no_ask,
        noBid=round(no_ask - 0.01, 3),
        yesAskSize=100 + int(seed * 400),
        timestamp=int(time.time() * 1000),
        category=pair["category"],
    )


async def run_mock_feed(publisher: RedisPublisher, pairs: list):
    print(f"[feed] MOCK_MODE=true — publishing synthetic quotes for {len(pairs)} pairs "
          f"to '{QUOTES_CHANNEL}' every {PUBLISH_INTERVAL_SECONDS}s")
    t = 0.0
    while True:
        for pair in pairs:
            for venue in ("kalshi", "polymarket"):
                quote = _mock_quote(pair, venue, t)
                publisher.publish(quote)
                print(f"  {pair['title'][:40]:40s} {venue:11s} "
                      f"yesAsk={quote.yesAsk:.3f} noAsk={quote.noAsk:.3f}")
        t += PUBLISH_INTERVAL_SECONDS
        await asyncio.sleep(PUBLISH_INTERVAL_SECONDS)


# ---------------------------------------------------------------------------
# Real feed — Kalshi + Polymarket public WS subscriptions.
# ---------------------------------------------------------------------------

KALSHI_WS = "wss://api.elections.kalshi.com/trade-api/ws/v2"
POLYMARKET_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/market"


async def run_kalshi_feed(publisher: RedisPublisher, pairs: list):
    tickers = [p["kalshi_ticker"] for p in pairs]
    by_ticker = {p["kalshi_ticker"]: p for p in pairs}
    async with websockets.connect(KALSHI_WS) as ws:
        await ws.send(json.dumps({
            "id": 1, "cmd": "subscribe",
            "params": {"channels": ["orderbook_delta"], "market_tickers": tickers},
        }))
        async for raw in ws:
            msg = json.loads(raw)
            ticker = msg.get("market_ticker") or msg.get("ticker")
            pair = by_ticker.get(ticker)
            if not pair:
                continue
            yes_ask = msg.get("yes_ask") or msg.get("yes", {}).get("ask")
            no_ask = msg.get("no_ask") or msg.get("no", {}).get("ask")
            if yes_ask is None or no_ask is None:
                continue
            publisher.publish(Quote(
                pairId=pair["id"], venue="kalshi",
                yesAsk=yes_ask / 100, yesBid=(msg.get("yes_bid", yes_ask - 1)) / 100,
                noAsk=no_ask / 100, noBid=(msg.get("no_bid", no_ask - 1)) / 100,
                yesAskSize=msg.get("yes_ask_size", 0), timestamp=int(time.time() * 1000),
                category=pair["category"],
            ))


async def run_polymarket_feed(publisher: RedisPublisher, pairs: list):
    token_ids = [p["polymarket_id"] for p in pairs]
    by_token = {p["polymarket_id"]: p for p in pairs}
    async with websockets.connect(POLYMARKET_WS) as ws:
        await ws.send(json.dumps({"assets_ids": token_ids, "type": "market"}))
        async for raw in ws:
            msg = json.loads(raw)
            token_id = msg.get("asset_id")
            pair = by_token.get(token_id)
            if not pair:
                continue
            asks = msg.get("asks", [])
            if not asks:
                continue
            yes_ask = float(asks[0]["price"])
            publisher.publish(Quote(
                pairId=pair["id"], venue="polymarket",
                yesAsk=yes_ask, yesBid=yes_ask - 0.01,
                noAsk=1 - yes_ask, noBid=1 - yes_ask - 0.01,
                yesAskSize=int(float(asks[0].get("size", 0))), timestamp=int(time.time() * 1000),
                category=pair["category"],
            ))


async def run_real_feed(publisher: RedisPublisher, pairs: list):
    if websockets is None:
        raise RuntimeError("websockets package not installed — pip install -r requirements.txt")
    print(f"[feed] MOCK_MODE=false — connecting to Kalshi and Polymarket WS for {len(pairs)} pairs")
    await asyncio.gather(
        run_kalshi_feed(publisher, pairs),
        run_polymarket_feed(publisher, pairs),
    )


async def main():
    publisher = RedisPublisher()
    pairs = load_pairs()
    if not pairs:
        print("[feed] no active pairs found — run /api/match first (or check MOCK_MODE)")
        return
    if MOCK_MODE:
        await run_mock_feed(publisher, pairs)
    else:
        await run_real_feed(publisher, pairs)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[feed] stopped")

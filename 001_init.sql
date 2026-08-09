-- Albatross schema for Render Postgres.
-- Run once via Render's "psql" shell, or wired into a release/build step:
--   psql "$DATABASE_URL" -f migrations/001_init.sql

CREATE EXTENSION IF NOT EXISTS vector;

-- Every market seen on either venue gets a row here, with its embedding.
-- This is what /api/match queries against with pgvector's <=> (cosine
-- distance) operator instead of the D1-era in-application cosine loop.
CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,               -- venue-native id: kalshi ticker or polymarket condition id
  venue TEXT NOT NULL CHECK (venue IN ('kalshi', 'polymarket')),
  title TEXT NOT NULL,
  rules TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ivfflat needs at least ~1000 rows of training data to be worth it; until
-- the catalog is that large this index is a no-op improvement but costs
-- nothing to have in place ahead of time.
CREATE INDEX IF NOT EXISTS idx_markets_embedding
  ON markets USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_markets_venue ON markets(venue);

CREATE TABLE IF NOT EXISTS pairs (
  id TEXT PRIMARY KEY,
  kalshi_market_id TEXT NOT NULL REFERENCES markets(id),
  polymarket_market_id TEXT NOT NULL REFERENCES markets(id),
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  similarity REAL,
  llm_verified BOOLEAN NOT NULL DEFAULT false,
  llm_reason TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotes (
  id BIGSERIAL PRIMARY KEY,
  pair_id TEXT NOT NULL REFERENCES pairs(id),
  venue TEXT NOT NULL CHECK (venue IN ('kalshi', 'polymarket')),
  yes_ask REAL NOT NULL,
  yes_bid REAL,
  no_ask REAL NOT NULL,
  no_bid REAL,
  yes_ask_size REAL,
  no_ask_size REAL,
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quotes_pair_ts ON quotes(pair_id, ts DESC);

CREATE TABLE IF NOT EXISTS opportunities (
  id BIGSERIAL PRIMARY KEY,
  pair_id TEXT NOT NULL REFERENCES pairs(id),
  leg_a_venue TEXT NOT NULL,
  leg_a_side TEXT NOT NULL,
  leg_a_price REAL NOT NULL,
  leg_a_fee REAL NOT NULL,
  leg_b_venue TEXT NOT NULL,
  leg_b_side TEXT NOT NULL,
  leg_b_price REAL NOT NULL,
  leg_b_fee REAL NOT NULL,
  edge_gross REAL NOT NULL,
  edge_net REAL NOT NULL,
  max_size REAL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opps_pair_time ON opportunities(pair_id, detected_at DESC);

CREATE TABLE IF NOT EXISTS trades (
  id BIGSERIAL PRIMARY KEY,
  pair_id TEXT NOT NULL REFERENCES pairs(id),
  opportunity_id BIGINT REFERENCES opportunities(id),
  status TEXT NOT NULL CHECK (status IN ('filled', 'aborted', 'unwound', 'failed')),
  designated_amount_usd REAL,
  order_id_a TEXT,
  order_id_b TEXT,
  profit_usd REAL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

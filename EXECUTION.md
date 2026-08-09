# EXECUTION - Auto-Betting Module

## Goal
When netEdge > threshold, automatically buy both sides at designated $ amount.

## CRITICAL SAFETY RULES FOR CLAUDE
1. Default EXECUTION_ENABLED=false. User must explicitly enable in UI.
2. Always dry_run first. Log what WOULD be bought.
3. Atomic 2-leg execution - never leave single-leg exposure > 2 seconds
4. Always re-quote before execution. If edge slipped > 30bps, ABORT.
5. Emergency unwind if leg2 fails after leg1 filled.
6. Kill switch: Redis key execution:kill = true stops all workers instantly.

## Execution Flow
1. Detect arb with edge >= user threshold
2. Check: balance > designatedAmount on both venues
3. Check: fresh orderbook still shows edge
4. Execute smaller liquidity venue FIRST
   - Place LIMIT at ask, wait 800ms for fill
   - If not filled, CANCEL and abort
5. Execute second leg immediately
6. If second fails, UNWIND first leg with market order
7. Log to Supabase trades table

## Config (.env)
EXECUTION_ENABLED=false
DESIGNATED_AMOUNT_USD=100
MAX_SLIPPAGE_BPS=30
KALSHI_API_KEY=
KALSHI_API_SECRET=
POLYMARKET_PRIVATE_KEY=0x...
POLYMARKET_PROXY_WALLET=
UPSTASH_REDIS_URL=

## Kalshi API (REST)
POST https://api.elections.kalshi.com/trade-api/v2/portfolio/orders
Headers: KALSHI-ACCESS-KEY, KALSHI-ACCESS-SIGNATURE
Body: { ticker: "FED-24JUL-NOCHANGE", count: 100, side: "yes", type: "limit", yes_price: 42, ... }

## Polymarket CLOB API
from py_clob_client.client import ClobClient
client = ClobClient(host, chain_id=137, key=private_key, proxy_wallet=proxy)
order = client.create_market_order(...)

## Chrome Takeover Mode (Fallback)
Start Chrome: 
  /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-arb

Then workers/chrome_executor.py connects via CDP.

This mode:
- Finds your already-logged-in Kalshi and Polymarket tabs
- Clicks buy buttons, fills amount, submits
- Much slower (2-3s) and brittle - use only if API keys not available

## Database
trades table:
  id, pair_id, leg1_order_id, leg2_order_id, amount_usd, edge_at_entry, status (filled, aborted, unwound, failed), pnl, created_at

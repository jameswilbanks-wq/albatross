# ARCHITECTURE
[Browser] <-WS-> [Next.js] <-Redis-> [Python Workers] -> [Kalshi WS] & [Poly WS]
DB: Supabase + pgvector, Redis: Upstash
Pure arb engine in lib/arb-engine.ts

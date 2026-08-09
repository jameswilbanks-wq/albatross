# CLAUDE.md - Project Instructions for Albatross Arbitrage Scanner

You are building **Albatross** — a real-time arbitrage detection website for Kalshi vs Polymarket.

## Goal
Detect risk-free arbitrage (albatross) where buying opposite sides across Kalshi & Polymarket costs < $1.00 after fees. Send real-time alerts < 500ms from detection.

## Core Success Criteria
1. Latency: Market -> Detection -> Alert < 1 second
2. Accuracy: Fee-aware NET edge, not gross. Must account for Kalshi ceil(0.07*P*(1-P)) and Polymarket category fees.
3. False positives: 0 — Must verify resolution rules match via LLM before alerting.
4. Alerts: Web Push, Telegram, Discord, Email.
5. Never auto-trade. Read-only detection only.

## Tech Stack
- Frontend: Next.js 14 App Router, Tailwind, shadcn/ui, Recharts
- Backend: Python FastAPI workers + Next.js API Routes
- Realtime: Upstash Redis + WebSockets
- DB: Supabase Postgres + pgvector
- Matching: pgvector + GPT-4o-mini verifier

## Commands
- pnpm dev
- pnpm worker
- pnpm scan

## Rules
- NEVER guess market equivalence. Verify resolution rules.
- All prices 0-1 scale
- Depth-aware sizing mandatory

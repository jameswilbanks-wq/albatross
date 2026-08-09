
# Albatross - Kalshi x Polymarket Arbitrage Finder

This starter beats existing GitHub bots by:
- Auto-discovery with pgvector + LLM verifier (vs manual URL paste)
- Fee-aware net edge (vs gross)
- Depth-aware sizing
- Real-time WS + push alerts
- Web UI

## Quick Start for Claude Code
1. pnpm install
2. cp .env.example .env.local and fill keys
3. pnpm dev
4. In second terminal: pnpm worker

## Claude Prompt
Use CLAUDE.md as system prompt. Then build Phase 1-5 in IMPLEMENTATION_PLAN.md

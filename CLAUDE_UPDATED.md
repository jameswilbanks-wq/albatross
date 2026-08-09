
# UPDATED CLAUDE.md WITH EXECUTION

Add to main CLAUDE.md:

## Execution Module
You now must build auto-betting at designated amount.

Build order:
1. lib/executor.ts + app/api/execute/route.ts (dry run first)
2. workers/executor.py with AtomicExecutor class - must handle unwind logic
3. workers/chrome_executor.py with CDP connection - must handle finding logged-in tabs
4. app/settings/execution.tsx UI with amount input, mode toggle, kill switch
5. Add trades table to Supabase schema

Safety:
- All execution behind EXECUTION_ENABLED flag
- Kill switch checks Redis + file /tmp/kill-switch before every order
- Designated amount from env + UI, default $100
- Always execute smaller depth leg first
- 800ms timeout per leg

Test:
p EXECUTION_ENABLED=false pnpm dev
-> Should log [DRY RUN] not place real orders

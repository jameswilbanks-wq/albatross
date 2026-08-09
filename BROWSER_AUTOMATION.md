# BROWSER AUTOMATION - Chrome Takeover

## Setup for Claude
1. User must start Chrome with remote debugging:
   Windows: chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\chrome-arb
   Mac: /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-arb
   Linux: google-chrome --remote-debugging-port=9222

2. User logs into kalshi.com and polymarket.com manually in that Chrome window (so session/2FA handled by user)

3. Our Playwright script connects:
   browser = playwright.chromium.connect_over_cdp("http://localhost:9222")

4. Execution:
   - Keep 2 persistent pages: one for Kalshi, one for Polymarket
   - On arb signal: navigate, click, fill amount from DESIGNATED_AMOUNT_USD, submit
   - Wait for "Order Confirmed" / "Trade Executed" selector
   - Screenshot on success/failure for audit

## Selectors (update if sites change)
Kalshi:
  - Buy Yes: [data-testid="buy-yes-button"] or button:has-text("Yes")
  - Amount input: input[name="count"] or input[placeholder*="Amount"]
  - Submit: button:has-text("Buy Yes")

Polymarket:
  - Buy Yes: button:has-text("Buy Yes")
  - Buy No: button:has-text("Buy No")
  - Amount: input[placeholder="Amount"] or input[type="number"]
  - Trade button: button:has-text("Buy")

## Safety
- Add 500ms delay between actions to mimic human
- Never store passwords - user stays logged in
- Kill switch checks Redis before every click

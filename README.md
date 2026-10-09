# PUMP DTEC backend

Solana token risk checker. The server serves the page AND the API from the same origin.

## Run locally
1. Install Node 18+.
2. `cp .env.example .env` and put your free Helius key in it (https://www.helius.dev).
3. `HELIUS_API_KEY=your_key node server.js` then open http://localhost:3000

## Deploy
Any Node host works (Render, Railway, Fly.io). Set the env var HELIUS_API_KEY and run `node server.js`.
The page must be served by this server (not from claude.ai), because published artifacts cannot call outside APIs.

## What it checks (all real data)
- Mint and freeze authority (Solana RPC)
- Top 10 holder concentration (Solana RPC; the liquidity pool account is excluded when identifiable)
- Price, market cap, 24h volume, liquidity, pair age (DexScreener, no key needed)

## Known limits
- Pump.fun tokens normally have mint and freeze authority revoked, so those checks pass. Real rug signals there are
  holder concentration and dev wallet selling. Next upgrade: add RugCheck or Bitquery for creator history and bundle detection.
- Liquidity lock status is not checked. Only liquidity size is.
- The score is a heuristic, not proof and not financial advice.

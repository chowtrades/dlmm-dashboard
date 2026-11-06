# Meteora DLMM dashboard (read-only, static)

Runs entirely in the browser: no backend, no keys, no signing. Open `index.html` through any static host.

- `?wallet=<address>` or the input box picks the wallet (default comes from `config.json`).
- `config.json` stores deposits for PnL (position, pool, deposited_sol, opened time) and default RPCs.
- Settings → custom RPC URL (saved in localStorage). A custom RPC is used for every call.
- Auto-refreshes every 60 s (`refreshSeconds` in config.json).

## Data sources
- Solana RPC (default `https://solana-rpc.publicnode.com`) for balance + account data.
- Position discovery (`getProgramAccounts`) goes to `https://public.rpc.solanavibestation.com`
  because publicnode and api.mainnet-beta refuse it from browsers. If that fails, positions from
  config.json and those seen before in this browser are loaded directly.
- Meteora data API `https://dlmm.datapi.meteora.ag/pools/<pool>` for TVL / volume / fees.
- Jupiter `https://lite-api.jup.ag/price/v3` for USD prices.

## Local test
    python3 -m http.server 8000   # then open http://localhost:8000/

## GitHub Pages
Push this folder (`index.html`, `style.css`, `config.json`, `dist/app.js`, `.nojekyll`) to a repo
and enable Pages. All paths are relative and `dist/app.js` is prebuilt, so nothing builds when it's served.

## Rebuild (only if you edit src/)
    npm install && ./build.sh

<!-- pnl fix deploy 2026-11-07 01:18 ICT -->

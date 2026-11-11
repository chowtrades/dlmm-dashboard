# ChowBot · Meteora DLMM dashboard (read-only, static)

## Branding (name, tagline, logo)
- Everything lives in `brand.json`: `name`, `tagline`, `description`, `logo` (header icon + favicons),
  `wordmark` (used in the link-preview image), `url`.
- Logo files: `assets/logo-icon.png` (square icon) and `assets/logo-wordmark.png` (transparent, tight crop).
  To revise, overwrite those files (or point `brand.json` at new ones).
- Then run `node tools/brand.mjs` (or `./build.sh`). It rewrites the `<!-- brand:meta -->` block in
  `index.html` (title, description, OG/Twitter tags), the header name/tagline/logo, and regenerates
  `assets/favicon-32.png`, `assets/apple-touch-icon.png`, `assets/icon-512.png` and `assets/og.png` (1200x630)
  with headless Chrome (`npm i` installs playwright-core; set `CHROME=` if Chrome isn't at /usr/bin/google-chrome).
- Commit and push; GitHub Pages serves it as-is.

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

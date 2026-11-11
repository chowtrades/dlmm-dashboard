// Applies brand.json to index.html (title, meta, OG/Twitter tags, header name/tagline/logo)
// and renders PNG icons + the OG preview image from the logo with headless Chrome.
// Usage: node tools/brand.mjs            (CHROME=/path/to/chrome to override the browser)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b = JSON.parse(fs.readFileSync(path.join(root, 'brand.json'), 'utf8'));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const url = (b.url || '').replace(/\/?$/, '/');
const title = `${b.name} · Live DLMM trading dashboard`;
const meta = `<!-- brand:meta (generated from brand.json by tools/brand.mjs; edit brand.json, not this block) -->
<title>${esc(title)}</title>
<meta name="description" content="${esc(b.description)}">
<meta name="theme-color" content="${esc(b.theme_color || '#0a0a0a')}">
<link rel="icon" href="assets/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="assets/icon-512.png" sizes="512x512" type="image/png">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(b.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(b.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(url)}assets/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(b.description)}">
<meta name="twitter:image" content="${esc(url)}assets/og.png">
<!-- /brand:meta -->`;
const ip = path.join(root, 'index.html');
let html = fs.readFileSync(ip, 'utf8');
html = html.replace(/<!-- brand:meta[\s\S]*?<!-- \/brand:meta -->/, meta)
  .replace(/(data-brand="name">)[^<]*/, `$1${esc(b.name)}`)
  .replace(/(data-brand="tagline">)[^<]*/, `$1${esc(b.tagline)}`)
  .replace(/src="[^"]*"([^>]*data-brand-logo)/, `src="${esc(b.logo)}"$1`);
fs.writeFileSync(ip, html);
console.log('index.html branded as', b.name);

// ---- images ----
let chromium;
try { ({ chromium } = await import('playwright-core')); } catch { console.log('playwright-core not installed; skipped PNG icons/OG image'); process.exit(0); }
const dataUri = (f) => `data:image/${f.endsWith('.svg') ? 'svg+xml' : f.endsWith('.jpg') ? 'jpeg' : 'png'};base64,` + fs.readFileSync(path.join(root, f)).toString('base64');
const logoUrl = dataUri(b.logo);
const wordUrl = b.wordmark ? dataUri(b.wordmark) : null;
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const page = await browser.newPage();
const shot = async (w, h, body, out) => {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden">${body}</body></html>`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => {}))); });
  await page.screenshot({ path: path.join(root, 'assets', out), omitBackground: out !== 'og.png' });
  console.log('wrote assets/' + out);
};
const img = (s) => `<img src="${logoUrl}" style="width:${s}px;height:${s}px;display:block;object-fit:contain">`;
await shot(32, 32, img(32), 'favicon-32.png');
await shot(512, 512, img(512), 'icon-512.png');
await shot(180, 180, `<div style="background:#0a0a0a;width:180px;height:180px;display:grid;place-items:center">${img(150)}</div>`, 'apple-touch-icon.png');
await shot(1200, 630, `
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800&display=swap">
<div style="width:1200px;height:630px;box-sizing:border-box;font-family:Inter,sans-serif;color:#f2ede0;position:relative;
  background:radial-gradient(800px 420px at 50% -8%,rgba(212,175,55,.20),transparent 62%),radial-gradient(600px 300px at 50% 115%,rgba(212,175,55,.10),transparent 60%),#0a0a0a;
  display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
  <div style="position:absolute;inset:22px;border:1.5px solid rgba(212,175,55,.38);border-radius:26px"></div>
  <div style="display:flex;align-items:center;gap:26px">${img(165)}
    ${wordUrl ? `<img src="${wordUrl}" style="height:118px;display:block">` : `<div style="font-size:110px;font-weight:800;color:#D4AF37">${esc(b.name)}</div>`}</div>
  <div style="margin-top:34px;font-size:40px;font-weight:700;letter-spacing:-.5px">${esc(b.tagline)}</div>
  <div style="margin-top:16px;font-size:26px;font-weight:500;color:#a39c8a">Live wallet value · PnL · win rate · every trade on-chain</div>
  <div style="position:absolute;bottom:52px;font-size:20px;color:#D4AF37;font-weight:700;letter-spacing:4px">● LIVE DASHBOARD</div>
</div>`, 'og.png');
await browser.close();

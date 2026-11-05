// Read-only Meteora DLMM dashboard. No keys, no signing, browser only.
import DLMMImport from '@meteora-ag/dlmm';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const DLMM = DLMMImport.default || DLMMImport;
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const DATAPI = 'https://dlmm.datapi.meteora.ag';
const JUP = 'https://lite-api.jup.ag/price/v3';
const LS_RPC = 'dlmmdash.rpc';
const LS_DISC = 'dlmmdash.discoveryRpc';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (a) => (a ? a.slice(0, 4) + '…' + a.slice(-4) : '');
const scan = (a, kind = 'account') => `https://solscan.io/${kind}/${a}`;
const link = (a, kind, label) => `<a href="${scan(a, kind)}" target="_blank" rel="noopener">${esc(label ?? short(a))}</a>`;

function fmt(n, d = 4) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a === 0) return '0';
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(1) + 'K';
  if (a >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: d });
  // small numbers: significant digits
  return n.toPrecision(Math.max(d, 4)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
function fmtPrice(p) {
  if (p == null || !isFinite(p)) return '—';
  if (p >= 1) return p.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return p.toExponential(4);
}
const usd = (n) => (n == null || !isFinite(n) ? '—' : (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(n) < 1 && n !== 0 ? 4 : 2 }));
const pct = (n) => (n == null || !isFinite(n) ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%');
const ict = (d) => new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Saigon', hour12: false, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ICT';

// ---------- state / settings ----------
let config = { positions: [] };
const params = new URLSearchParams(location.search);
let wallet = '';
let timer = null, countdown = 0;

function settings() {
  return {
    rpc: params.get('rpc') || localStorage.getItem(LS_RPC) || config.rpc || 'https://solana-rpc.publicnode.com',
    disc: localStorage.getItem(LS_DISC) || config.discoveryRpc || 'https://public.rpc.solanavibestation.com',
  };
}

// Connection that sends getProgramAccounts (position discovery) to a gPA-capable public RPC,
// and everything else to the main RPC. If the user set a custom RPC, it is used for everything.
function makeConnection() {
  const { rpc, disc } = settings();
  const custom = !!(params.get('rpc') || localStorage.getItem(LS_RPC));
  const route = (url, init) => {
    if (!custom) {
      try {
        const b = JSON.parse(init.body);
        const m = Array.isArray(b) ? b[0]?.method : b.method;
        if (m === 'getProgramAccounts') return fetch(disc, init);
      } catch {}
    }
    return fetch(url, init);
  };
  return new Connection(rpc, { commitment: 'confirmed', fetch: route, disableRetryOnRateLimit: false });
}

async function getJSON(url, timeout = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ---------- data ----------
async function loadPositions(conn, owner) {
  const notes = [];
  try {
    const map = await DLMM.getAllLbPairPositionsByUser(conn, owner);
    // remember discovered positions so a later gPA failure can still load them
    const found = [...map.values()].flatMap((e) => e.lbPairPositionsData.map((p) => ({ position: p.publicKey.toBase58(), pool: e.publicKey.toBase58(), owner: owner.toBase58() })));
    try { localStorage.setItem('dlmmdash.known.' + owner.toBase58(), JSON.stringify(found)); } catch {}
    return { map, via: 'getProgramAccounts', notes };
  } catch (e) {
    notes.push('Position discovery (getProgramAccounts) failed: ' + (e.message || e) + ' — falling back to positions in config.json / previously seen in this browser.');
  }
  // Fallback: positions listed in config.json for this wallet + positions discovered earlier in this browser
  const map = new Map();
  let known = [];
  try { known = JSON.parse(localStorage.getItem('dlmmdash.known.' + owner.toBase58()) || '[]'); } catch {}
  const list = [...config.positions.filter((p) => !p.owner || p.owner === owner.toBase58()), ...known]
    .filter((p, i, a) => a.findIndex((q) => q.position === p.position) === i);
  for (const c of list) {
    try {
      const dlmm = await DLMM.create(conn, new PublicKey(c.pool));
      const pos = await dlmm.getPosition(new PublicKey(c.position));
      const entry = map.get(c.pool) || { publicKey: dlmm.pubkey, lbPair: dlmm.lbPair, tokenX: dlmm.tokenX, tokenY: dlmm.tokenY, lbPairPositionsData: [] };
      entry.lbPairPositionsData.push(pos);
      map.set(c.pool, entry);
    } catch (e) {
      notes.push(`Could not load ${short(c.position)}: ${e.message || e} (closed or RPC rate-limited?)`);
    }
  }
  return { map, via: 'config.json', notes };
}

async function loadPrices(mints) {
  try {
    const j = await getJSON(`${JUP}?ids=${[...new Set(mints)].join(',')}`);
    const out = {};
    for (const m of mints) if (j[m]?.usdPrice) out[m] = { usd: j[m].usdPrice, ch24: j[m].priceChange24h };
    return out;
  } catch (e) { console.warn('Jupiter price failed', e); return {}; }
}

async function loadPool(addr) {
  try { return await getJSON(`${DATAPI}/pools/${addr}`); } catch (e) { console.warn('pool api failed', e); return null; }
}

const binPrice = (id, step, dx, dy) => Math.pow(1 + step / 10000, id) * Math.pow(10, dx - dy);

function buildPosition(entry, posData, pool, prices, cfg) {
  const lb = entry.lbPair;
  const step = lb.binStep;
  const xMint = entry.tokenX.publicKey.toBase58();
  const yMint = entry.tokenY.publicKey.toBase58();
  const dx = entry.tokenX.mint?.decimals ?? pool?.token_x?.decimals ?? 0;
  const dy = entry.tokenY.mint?.decimals ?? pool?.token_y?.decimals ?? 0;
  const symX = pool?.token_x?.symbol || short(xMint);
  const symY = pool?.token_y?.symbol || (yMint === SOL_MINT ? 'SOL' : short(yMint));
  const d = posData.positionData;
  const ux = (v, dec) => Number(v?.toString?.() ?? v ?? 0) / 10 ** dec;
  const X = ux(d.totalXAmount, dx), Y = ux(d.totalYAmount, dy);
  const fX = ux(d.feeX, dx), fY = ux(d.feeY, dy);
  const cX = ux(d.totalClaimedFeeXAmount, dx), cY = ux(d.totalClaimedFeeYAmount, dy);
  const active = lb.activeId;
  const pActive = binPrice(active, step, dx, dy);
  const pLo = binPrice(d.lowerBinId, step, dx, dy), pHi = binPrice(d.upperBinId, step, dx, dy);
  const inRange = active >= d.lowerBinId && active <= d.upperBinId;

  const solUsd = prices[SOL_MINT]?.usd ?? (pool?.token_y?.address === SOL_MINT ? pool.token_y.price : null);
  const usdX = prices[xMint]?.usd ?? pool?.token_x?.price ?? null;
  const usdY = prices[yMint]?.usd ?? pool?.token_y?.price ?? null;
  // value in Y via pool's active price, then to SOL/USD
  const yUsd = usdY ?? (yMint === SOL_MINT ? solUsd : null);
  const valY = X * pActive + Y; // in token Y
  const feesY = fX * pActive + fY;
  const claimedY = cX * pActive + cY;
  const toUsd = (vy) => (yUsd != null ? vy * yUsd : null);
  const toSol = (vy) => (yMint === SOL_MINT ? vy : (yUsd != null && solUsd ? (vy * yUsd) / solUsd : null));
  const valueSol = toSol(valY), feesSol = toSol(feesY), claimedSol = toSol(claimedY);
  // Jupiter mark-to-market (alternative) for X side
  const jupValueUsd = usdX != null && yUsd != null ? X * usdX + Y * yUsd : null;

  const bins = d.positionBinData.map((b) => {
    const bx = ux(b.positionXAmount, dx), by = ux(b.positionYAmount, dy);
    const p = Number(b.pricePerToken) || binPrice(b.binId, step, dx, dy);
    return { id: b.binId, price: p, x: bx, y: by, v: bx * p + by };
  });

  let pnl = null;
  if (cfg?.deposited_sol != null && valueSol != null) {
    const total = valueSol + (feesSol || 0) + (claimedSol || 0);
    pnl = { dep: cfg.deposited_sol, total, abs: total - cfg.deposited_sol, pct: ((total - cfg.deposited_sol) / cfg.deposited_sol) * 100, usd: solUsd ? (total - cfg.deposited_sol) * solUsd : null };
  }
  return {
    pool: entry.publicKey.toBase58(), position: posData.publicKey.toBase58(), name: pool?.name || `${symX}-${symY}`,
    symX, symY, xMint, yMint, step, active, pActive, pLo, pHi, lower: d.lowerBinId, upper: d.upperBinId, inRange,
    X, Y, fX, fY, cX, cY, valueSol, valueUsd: toUsd(valY), feesSol, feesUsd: toUsd(feesY), jupValueUsd,
    usdX, usdY: yUsd, bins, pnl, cfg, poolInfo: pool, lastUpdatedAt: Number(d.lastUpdatedAt?.toString?.() ?? 0),
  };
}

// ---------- render ----------
const sgn = (n, d = 4) => (n == null || !isFinite(n) ? '—' : (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(d));
const cls = (n) => (n == null || !isFinite(n) ? '' : n >= 0 ? 'pos' : 'neg');
function renderHistory(h, live) {
  const el = $('#history');
  if (!h) { el.innerHTML = '<p class="muted">Position history unavailable.</p>'; return; }
  const meteora = (pool) => `<a href="https://app.meteora.ag/dlmm/${esc(pool)}" target="_blank" rel="noopener">${esc(short(pool))}</a>`;
  const tl = (t) => (t ? link(t, 'tx', short(t)) : '—');
  const t = (d) => (d ? esc(ict(d).replace(' ICT', '')) : '—');
  const row = (r, exit, pnl, pp, status) => `<tr><td><b>${esc(r.pair)}</b> <span class="badge ${status === 'open' ? 'in' : 'cl'}">${status}</span><small>${link(r.position, 'account')}</small></td><td>${meteora(r.pool)}</td><td>${t(r.opened)}</td><td>${r.closed ? t(r.closed) : '—'}</td><td>${fmt(r.entry_sol, 4)}</td><td>${exit != null ? fmt(exit, 4) : '—'}</td><td class="${cls(pnl)}">${sgn(pnl)}<small class="${cls(pnl)}">${pp != null ? pct(pp) : ''}</small></td><td class="reason">${esc(r.reason || (status === 'open' ? 'live' : ''))}</td><td>${tl(r.open_tx)} / ${tl(r.close_tx)}</td></tr>`;
  const openRows = (h.open || []).map((r) => { const p = live.find((x) => x.position === r.position); const v = p?.pnl?.total ?? (p ? (p.valueSol || 0) + (p.feesSol || 0) : null); const d = v != null ? v - r.entry_sol : null; return row(r, v, d, d != null ? (d / r.entry_sol) * 100 : null, 'open'); });
  const closed = h.closed || [];
  const tot = closed.reduce((s, r) => s + (r.pnl_sol || 0), 0);
  el.innerHTML = `<div class="tablewrap"><table class="hist"><thead><tr><th>Pair</th><th>Pool</th><th>Opened (ICT)</th><th>Closed (ICT)</th><th>Entry SOL</th><th>Exit SOL</th><th>PnL SOL / %</th><th>Close reason</th><th>Open / close tx</th></tr></thead><tbody>
    ${openRows.join('')}${closed.map((r) => row(r, r.exit_sol, r.pnl_sol, r.pnl_pct, 'closed')).join('')}</tbody>
    <tfoot><tr><td colspan="6"><b>Realized total (${closed.length} closed)</b></td><td class="${cls(tot)}"><b>${sgn(tot)}</b></td><td colspan="2" class="muted">Exit/PnL from autopilot logs; MAMESUKE uses wallet delta (incl. swap). Open row is live (incl. fees).</td></tr></tfoot></table></div>`;
}
function renderPnl(cur, rent, hist, solUsd) {
  const init = Number(config.initial_balance_sol ?? 0.5);
  const tot = cur - init;
  const pts = (hist?.points || []).map((p) => ({ t: Date.parse(p.ts), v: Number(p.value_sol) })).filter((p) => isFinite(p.t) && isFinite(p.v)).sort((a, b) => a.t - b.t);
  const target = Date.now() - 864e5;
  let ref = null, label = '';
  if (pts.length) {
    const old = pts.filter((p) => p.t <= target);
    ref = old.length ? old.reduce((b, p) => (Math.abs(p.t - target) < Math.abs(b.t - target) ? p : b)) : pts[0];
    const hrs = (Date.now() - ref.t) / 36e5;
    label = `vs ${fmt(ref.v, 4)} SOL at ${ict(ref.t)}${old.length ? '' : ` (oldest point, only ${hrs.toFixed(1)}h)`}`;
  }
  const d24 = ref ? cur - ref.v : null;
  const realized = (config.closed_positions || []).filter((c) => c.closed && Date.parse(c.closed) >= target && c.pnl_sol != null);
  const rsum = realized.reduce((s, c) => s + c.pnl_sol, 0);
  const u = (n) => (solUsd && n != null ? ' · ' + usd(n * solUsd) : '');
  $('#pnl').innerHTML = `
    <div class="stat big"><label>24h PnL</label><b class="${cls(d24)}">${sgn(d24)} SOL <span>${ref ? pct((d24 / ref.v) * 100) : '—'}</span></b><small>${ref ? esc(label) : 'No value history yet'}${u(d24)}</small>${realized.length ? `<small>Realized (closed last 24h, logged): <span class="${cls(rsum)}">${sgn(rsum)} SOL</span> · ${realized.length} close(s)</small>` : ''}</div>
    <div class="stat big"><label>Total PnL vs ${fmt(init, 4)} SOL start</label><b class="${cls(tot)}">${sgn(tot)} SOL <span>${pct((tot / init) * 100)}</span></b><small>Now ${fmt(cur, 6)} SOL (free SOL + positions + fees + ${fmt(rent, 4)} rent)${u(tot)} · since ${esc(config.start_date ? ict(config.start_date) : '—')}</small></div>`;
  window.__pnl = { cur, tot, d24, ref };
}
function binChart(p) {
  const bins = [...p.bins].sort((a, b) => a.id - b.id);
  if (!bins.length) return '';
  const W = 720, H = 200, pad = 2;
  const lo = Math.min(bins[0].id, p.active), hi = Math.max(bins[bins.length - 1].id, p.active);
  const n = hi - lo + 1;
  const bw = (W - 2) / n;
  const max = Math.max(...bins.map((b) => b.v), 1e-18);
  let bars = '';
  for (const b of bins) {
    const h = (b.v / max) * (H - pad - 8);
    const x = 1 + (b.id - lo) * bw;
    const isA = b.id === p.active;
    const fill = isA ? '#facc15' : b.y > 0 && b.x === 0 ? '#22d3ee' : b.x > 0 && b.y === 0 ? '#a78bfa' : '#34d399';
    bars += `<rect x="${x.toFixed(2)}" y="${(H - pad - h).toFixed(2)}" width="${Math.max(bw - 1, 0.6).toFixed(2)}" height="${Math.max(h, b.v > 0 ? 1 : 0).toFixed(2)}" fill="${fill}"><title>bin ${b.id}\nprice ${fmtPrice(b.price)} ${p.symY}\n${fmt(b.x)} ${p.symX} + ${fmt(b.y)} ${p.symY}${isA ? '\nACTIVE' : ''}</title></rect>`;
  }
  const ax = 1 + (p.active - lo) * bw + bw / 2;
  const marker = `<line x1="${ax}" x2="${ax}" y1="4" y2="${H - pad}" stroke="#facc15" stroke-dasharray="3 3" stroke-width="1.5"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="bin liquidity">${bars}${marker}</svg>
  <div class="axis"><span>${fmtPrice(bins[0].price)}</span><span class="act">active bin ${p.active} · ${fmtPrice(p.pActive)}</span><span>${fmtPrice(bins[bins.length - 1].price)}</span></div>
  <div class="legend"><span><i style="background:#a78bfa"></i>${esc(p.symX)} only</span><span><i style="background:#22d3ee"></i>${esc(p.symY)} only</span><span><i style="background:#34d399"></i>mixed</span><span><i style="background:#facc15"></i>active bin</span></div>`;
}

function positionCard(p) {
  const pi = p.poolInfo;
  const badge = p.inRange ? '<span class="badge in">IN RANGE</span>' : `<span class="badge out">OUT OF RANGE ${p.active < p.lower ? '▼ below' : '▲ above'}</span>`;
  const pnl = p.pnl
    ? `<div class="stat"><label>PnL vs deposit</label><b class="${p.pnl.abs >= 0 ? 'pos' : 'neg'}">${p.pnl.abs >= 0 ? '+' : ''}${p.pnl.abs.toFixed(6)} SOL</b><small>${pct(p.pnl.pct)} · ${usd(p.pnl.usd)}</small><small>deposited ${fmt(p.pnl.dep)} SOL → now ${fmt(p.pnl.total, 6)} SOL (incl. fees)</small></div>`
    : `<div class="stat"><label>PnL vs deposit</label><b>—</b><small>add this position to config.json</small></div>`;
  const opened = p.cfg?.opened ? `<small>opened ${ict(p.cfg.opened)}${p.cfg.strategy ? ' · ' + esc(p.cfg.strategy) : ''}${p.cfg.open_tx ? ' · ' + link(p.cfg.open_tx, 'tx', 'open tx') : ''}</small>` : '';
  return `<section class="card">
    <div class="head">
      <div><h2>${esc(p.name)} ${badge}</h2>
      <small>bin step ${p.step} · position ${link(p.position)} · pool ${link(p.pool)} · <a href="https://app.meteora.ag/dlmm/${p.pool}" target="_blank" rel="noopener">Meteora</a></small>${opened}</div>
    </div>
    <div class="grid">
      <div class="stat"><label>Value</label><b>${fmt(p.valueSol, 6)} SOL</b><small>${usd(p.valueUsd)}${p.jupValueUsd != null ? ' · Jup mark ' + usd(p.jupValueUsd) : ''}</small></div>
      ${pnl}
      <div class="stat"><label>Range (${esc(p.symY)} per ${esc(p.symX)})</label><b>${fmtPrice(p.pLo)} – ${fmtPrice(p.pHi)}</b><small>bins ${p.lower} … ${p.upper} (${p.upper - p.lower + 1})</small></div>
      <div class="stat"><label>Active price</label><b>${fmtPrice(p.pActive)}</b><small>bin ${p.active}${p.usdX != null ? ' · ' + esc(p.symX) + ' $' + fmtPrice(p.usdX) : ''}</small></div>
      <div class="stat"><label>Amounts</label><b>${fmt(p.X, 2)} ${esc(p.symX)}</b><b>${fmt(p.Y, 6)} ${esc(p.symY)}</b></div>
      <div class="stat"><label>Unclaimed fees</label><b>${fmt(p.fX, 2)} ${esc(p.symX)} · ${fmt(p.fY, 6)} ${esc(p.symY)}</b><small>≈ ${fmt(p.feesSol, 5)} SOL · ${usd(p.feesUsd)}${p.cX || p.cY ? ` · claimed ${fmt(p.cX, 2)} ${esc(p.symX)} / ${fmt(p.cY, 6)} ${esc(p.symY)}` : ''}</small></div>
    </div>
    <h3>Position liquidity by bin</h3>
    ${binChart(p)}
    ${pi ? `<h3>Pool stats</h3><div class="grid">
      <div class="stat"><label>TVL</label><b>${usd(pi.tvl)}</b><small>${fmt(pi.token_x_amount, 2)} ${esc(p.symX)} + ${fmt(pi.token_y_amount, 2)} ${esc(p.symY)}</small></div>
      <div class="stat"><label>24h volume</label><b>${usd(pi.volume?.['24h'])}</b><small>1h ${usd(pi.volume?.['1h'])}</small></div>
      <div class="stat"><label>24h fees / TVL</label><b>${pct(pi.fee_tvl_ratio?.['24h']).replace('+', '')}</b><small>fees 24h ${usd(pi.fees?.['24h'])} · base fee ${pi.pool_config?.base_fee_pct ?? '—'}% · dyn ${pi.dynamic_fee_pct != null ? pi.dynamic_fee_pct.toFixed(3) + '%' : '—'}</small></div>
      <div class="stat"><label>Tokens</label><small>${esc(p.symX)} ${link(p.xMint, 'token')}${pi.token_x?.is_verified === false ? ' <span class="warn">unverified</span>' : ''}</small><small>${esc(p.symY)} ${link(p.yMint, 'token')}</small><small>mcap ${usd(pi.token_x?.market_cap)}</small></div>
    </div>` : '<p class="muted">Pool stats unavailable (Meteora data API).</p>'}
  </section>`;
}

async function refresh() {
  const status = $('#status');
  status.textContent = 'Loading…';
  status.className = 'status';
  let owner;
  try { owner = new PublicKey(wallet); } catch { status.textContent = 'Invalid wallet address'; status.className = 'status err'; return; }
  const conn = makeConnection();
  const notes = [];
  try {
    const [lamports, { map, via, notes: n }] = await Promise.all([conn.getBalance(owner), loadPositions(conn, owner)]);
    notes.push(...n);
    const entries = [...map.values()];
    const mints = [SOL_MINT, ...entries.flatMap((e) => [e.tokenX.publicKey.toBase58(), e.tokenY.publicKey.toBase58()])];
    const [prices, ...pools] = await Promise.all([loadPrices(mints), ...entries.map((e) => loadPool(e.publicKey.toBase58()))]);
    const solUsd = prices[SOL_MINT]?.usd ?? pools.find((x) => x?.token_y?.address === SOL_MINT)?.token_y?.price;
    const positions = [];
    entries.forEach((e, i) => {
      for (const pd of e.lbPairPositionsData) {
        const cfg = config.positions.find((c) => c.position === pd.publicKey.toBase58());
        positions.push(buildPosition(e, pd, pools[i], prices, cfg));
      }
    });
    const sol = lamports / LAMPORTS_PER_SOL;
    let rent = 0;
    try { const accs = await conn.getMultipleAccountsInfo(positions.map((p) => new PublicKey(p.position))); rent = accs.reduce((s, a) => s + (a?.lamports || 0), 0) / LAMPORTS_PER_SOL; } catch (e) { notes.push('Position rent lookup failed; total excludes rent.'); }
    const totPos = positions.reduce((s, p) => s + (p.valueSol || 0) + (p.feesSol || 0), 0);
    const hist = await getJSON('value_history.json?t=' + Date.now()).catch(() => null);
    renderPnl(sol + totPos + rent, rent, hist, solUsd);
    renderHistory(await getJSON('position_history.json?t=' + Date.now()).catch(() => null), positions);
    $('#summary').innerHTML = `
      <div class="stat"><label>Wallet SOL</label><b>${fmt(sol, 4)} SOL</b><small>${usd(solUsd ? sol * solUsd : null)}</small></div>
      <div class="stat"><label>DLMM positions</label><b>${positions.length}</b><small>${fmt(totPos, 6)} SOL incl. fees · ${usd(solUsd ? totPos * solUsd : null)}</small></div>
      <div class="stat"><label>Total (SOL + LP)</label><b>${fmt(sol + totPos, 4)} SOL</b><small>${usd(solUsd ? (sol + totPos) * solUsd : null)}</small></div>
      <div class="stat"><label>SOL price</label><b>${usd(solUsd)}</b><small>Jupiter</small></div>`;
    $('#walletLink').innerHTML = link(wallet, 'account', wallet);
    $('#positions').innerHTML = positions.length ? positions.map(positionCard).join('') : '<section class="card"><p class="muted">No open DLMM positions found for this wallet.</p></section>';
    $('#notes').innerHTML = notes.map((x) => `<div class="note">${esc(x)}</div>`).join('');
    status.textContent = `Updated ${ict(Date.now())} · positions via ${via} · RPC ${new URL(settings().rpc).host}`;
    window.__dash = { ok: true, positions: positions.length, sol, updated: Date.now() };
  } catch (e) {
    console.warn(e);
    status.textContent = 'Error: ' + (e.message || e) + ' — try a different RPC in Settings.';
    status.className = 'status err';
    window.__dash = { ok: false, error: String(e.message || e) };
  }
}

function schedule() {
  clearInterval(timer);
  const every = config.refreshSeconds || 60;
  countdown = every;
  timer = setInterval(() => {
    countdown--;
    $('#countdown').textContent = `next refresh in ${countdown}s`;
    if (countdown <= 0) { countdown = every; refresh(); }
  }, 1000);
}

async function init() {
  try { config = await getJSON('config.json'); } catch (e) { console.warn('config.json missing', e); }
  wallet = params.get('wallet') || config.wallet || '';
  $('#wallet').value = wallet;
  const s = settings();
  $('#rpc').value = localStorage.getItem(LS_RPC) || '';
  $('#rpc').placeholder = s.rpc;
  $('#disc').value = localStorage.getItem(LS_DISC) || '';
  $('#disc').placeholder = config.discoveryRpc || s.disc;
  $('#walletForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    wallet = $('#wallet').value.trim();
    const u = new URL(location.href); u.searchParams.set('wallet', wallet); history.replaceState(null, '', u);
    refresh(); schedule();
  });
  $('#saveRpc').addEventListener('click', () => {
    const r = $('#rpc').value.trim(), d = $('#disc').value.trim();
    r ? localStorage.setItem(LS_RPC, r) : localStorage.removeItem(LS_RPC);
    d ? localStorage.setItem(LS_DISC, d) : localStorage.removeItem(LS_DISC);
    refresh(); schedule();
  });
  $('#resetRpc').addEventListener('click', () => { localStorage.removeItem(LS_RPC); localStorage.removeItem(LS_DISC); $('#rpc').value = ''; $('#disc').value = ''; refresh(); schedule(); });
  $('#refreshNow').addEventListener('click', () => { refresh(); schedule(); });
  await refresh();
  schedule();
}
init();

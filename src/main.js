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
function startSol() {
  const v = config.start_sol ?? config.initial_balance_sol;
  const n = Number(v);
  return (v != null && v !== '' && Number.isFinite(n) && n > 0) ? n : null;
}
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
    const cfgOpen = config.positions.filter((p) => !p.owner || p.owner === owner.toBase58());
    if (found.length || !cfgOpen.length) return { map, via: 'getProgramAccounts', notes };
    notes.push('Position discovery returned no positions but config.json lists open ones — loading those directly.');
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
  // Accept deposited_sol (canonical) or entry_sol (autopilot alias) so a mis-keyed config still shows PnL.
  const dep = cfg?.deposited_sol ?? cfg?.entry_sol;
  if (dep != null && valueSol != null) {
    // Current position value = holdings + unclaimed fees. Claimed fees already left the position.
    const total = valueSol + (feesSol || 0);
    pnl = { dep, total, abs: total - dep, pct: ((total - dep) / dep) * 100, usd: solUsd ? (total - dep) * solUsd : null };
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
const ictShort = (d) => new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Saigon', hour12: false, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const ictTime = (d) => new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Saigon', hour12: false, hour: '2-digit', minute: '2-digit' });
function dur(ms) {
  if (!isFinite(ms) || ms < 0) return '—';
  const m = Math.round(ms / 6e4);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
const ago = (t) => dur(Date.now() - t) + ' ago';
function ictYmd(d) {
  return new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Saigon' }); // YYYY-MM-DD in ICT
}
const sol = (n, d = 4) => `${fmt(n, d)} <small>SOL</small>`;

// Brand name comes from brand.json, stamped into index.html by tools/brand.mjs
const brandName = () => document.querySelector('[data-brand="name"]')?.textContent.trim() || 'The bot';

let view = { series: [], closed: [], cur: null, range: 'all' };

function historyPoints(hist) {
  return (hist?.points || []).map((p) => ({ t: Date.parse(p.ts), v: Number(p.value_sol) })).filter((p) => isFinite(p.t) && isFinite(p.v)).sort((a, b) => a.t - b.t);
}

function renderHero(cur, rent, freeSol, hist, ph, solUsd) {
  const init = startSol();
  const closed = ph?.closed || [];
  const nOpen = (ph?.open || []).length;
  const wins = closed.filter((r) => (r.pnl_sol || 0) > 0).length, losses = closed.filter((r) => (r.pnl_sol || 0) < 0).length;
  const real = closed.reduce((s, r) => s + (r.pnl_sol || 0), 0);
  const u = (n) => (solUsd && n != null && isFinite(n) ? usd(n * solUsd) : '');
  if (init == null) {
    $('#heroMain').innerHTML = `<div class="eyebrow">Portfolio value</div><div class="big">${sol(cur, 4)}</div><div class="usd">${u(cur)}</div><div class="since">Waiting for funding. PnL starts once the bot wallet is funded.</div>`;
    $('#kpis').innerHTML = '';
    window.__pnl = { cur, tot: null, awaiting: true };
    return;
  }
  const tot = cur - init;
  const pts = historyPoints(hist);
  const startMs = Date.parse(config.start_date || '') || pts[0]?.t || Date.now();
  const days = Math.max(1, (Date.now() - startMs) / 864e5);
  const avg = tot / days, avgPct = (tot / init) * 100 / days;
  // today (ICT calendar day): now vs the last snapshot before ICT midnight (or the first one today)
  const midnight = Date.parse(ictYmd(Date.now()) + 'T00:00:00+07:00');
  const before = pts.filter((p) => p.t <= midnight);
  const tRef = before.length ? before[before.length - 1] : pts.find((p) => p.t >= midnight) || (startMs >= midnight ? { t: startMs, v: init } : null);
  const today = tRef ? cur - tRef.v : null;
  const todayN = closed.filter((r) => r.closed && ictYmd(r.closed) === ictYmd(Date.now())).length;
  // 24h
  const target = Date.now() - 864e5;
  const old = pts.filter((p) => p.t <= target);
  const ref = pts.length ? (old.length ? old[old.length - 1] : pts[0]) : null;
  const d24 = ref ? cur - ref.v : null;
  const wr = closed.length ? (wins / closed.length) * 100 : null;
  $('#heroMain').innerHTML = `
    <div class="eyebrow">Portfolio value</div>
    <div class="big">${fmt(cur, 4)}<small>SOL</small></div>
    <div class="usd">${u(cur) || '&nbsp;'}</div>
    <div class="pill ${cls(tot)}">${tot >= 0 ? '▲' : '▼'} ${pct((tot / init) * 100)} <span style="opacity:.75">· ${sgn(tot)} SOL</span></div>
    <div class="since">All-time vs ${fmt(init, 4)} SOL start · since ${esc(ictShort(startMs))} ICT</div>`;
  const kpi = (label, val, c, small, extra = '') => `<div class="kpi"><label>${label}</label><b class="${c}">${val}</b><small>${small}</small>${extra}</div>`;
  $('#kpis').innerHTML = [
    kpi("Today's PnL", today != null ? pct((today / tRef.v) * 100) : '—', cls(today), today != null ? `${sgn(today)} SOL · ${todayN} close${todayN === 1 ? '' : 's'}` : 'no data yet'),
    kpi('24h PnL', d24 != null ? pct((d24 / ref.v) * 100) : '—', cls(d24), d24 != null ? `${sgn(d24)} SOL${old.length ? '' : ` · ${dur(Date.now() - ref.t)} of data`}` : 'no data yet'),
    kpi('Avg / day', pct(avgPct), cls(avg), `${sgn(avg)} SOL · ${days.toFixed(1)} days`),
    kpi('Win rate', wr != null ? wr.toFixed(0) + '%' : '—', '', `${wins}W · ${losses}L`, closed.length ? `<div class="wl"><i style="width:${wr.toFixed(1)}%"></i></div>` : ''),
    kpi('Trades', String(closed.length + nOpen), '', `${closed.length} closed · ${nOpen} open`),
    kpi('Realized PnL', sgn(real), cls(real), `${pct((real / init) * 100)} of start${u(real) ? ' · ' + u(real) : ''}`),
  ].join('');
  window.__pnl = { cur, tot, d24, ref, avg, days, avgPct, today };
}

function renderValueChart() {
  const el = $('#valueChart');
  const init = startSol();
  const all = view.series;
  if (all.length < 2) { el.innerHTML = '<div class="empty">Not enough history yet. The chart fills in as snapshots arrive.</div>'; return; }
  const now = Date.now();
  const span = { '24h': 864e5, '7d': 7 * 864e5 }[view.range];
  let pts = span ? all.filter((p) => p.t >= now - span) : all;
  if (pts.length < 2) pts = all.slice(-2);
  const W = Math.max(280, el.clientWidth || 800), H = W < 600 ? 210 : 270;
  const L = 6, R = 58, T = 14, B = 26;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const vs = pts.map((p) => p.v).concat(init != null ? [init] : []);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  const padv = (hi - lo || 0.01) * 0.12; lo -= padv; hi += padv;
  const x = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
  const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${x(t1).toFixed(1)},${H - B}L${x(t0).toFixed(1)},${H - B}Z`;
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4, yy = y(v).toFixed(1);
    grid += `<line class="gl" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text class="yl" x="${W - R + 8}" y="${+yy + 3.5}">${v.toFixed(3)}</text>`;
  }
  const multiDay = t1 - t0 > 1.5 * 864e5;
  const nx = W < 600 ? 3 : 5;
  for (let i = 0; i <= nx; i++) {
    const t = t0 + ((t1 - t0) * i) / nx;
    const lab = multiDay ? new Date(t).toLocaleDateString('en-GB', { timeZone: 'Asia/Saigon', day: 'numeric', month: 'short' }) : ictTime(t);
    grid += `<text class="xl" x="${x(t).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === nx ? 'end' : 'middle'}">${lab}</text>`;
  }
  const base = init != null ? `<line class="base" x1="${L}" x2="${W - R}" y1="${y(init).toFixed(1)}" y2="${y(init).toFixed(1)}"/><text class="baselbl" x="${L + 4}" y="${(y(init) - 6).toFixed(1)}">START ${fmt(init, 3)}</text>` : '';
  const near = (t) => pts.reduce((b, p) => (Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b));
  const marks = view.closed.filter((c) => c.closed && Date.parse(c.closed) >= t0 && Date.parse(c.closed) <= t1 && c.pnl_sol != null).map((c) => {
    const t = Date.parse(c.closed), v = near(t).v;
    return `<circle cx="${x(t).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="#0a0a0a" stroke="${c.pnl_sol >= 0 ? '#5fb98a' : '#d0716a'}" stroke-width="2"><title>${esc(c.pair)} closed ${esc(ictShort(t))} · ${sgn(c.pnl_sol)} SOL</title></circle>`;
  }).join('');
  const last = pts[pts.length - 1];
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Wallet value over time">
    <defs><linearGradient id="va" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D4AF37" stop-opacity=".30"/><stop offset="1" stop-color="#D4AF37" stop-opacity="0"/></linearGradient>
    <linearGradient id="vl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9C7A1E"/><stop offset=".6" stop-color="#D4AF37"/><stop offset="1" stop-color="#F7D774"/></linearGradient></defs>
    ${grid}${base}<path d="${area}" fill="url(#va)"/><path d="${line}" fill="none" stroke="url(#vl)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    ${marks}<circle cx="${x(last.t).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="4.5" fill="#F5C542"/><circle cx="${x(last.t).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="9" fill="#F5C542" opacity=".18"/>
    <line id="hx" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="#D4AF37" stroke-opacity=".5" stroke-dasharray="3 3" style="display:none"/>
    <circle id="hd" r="4.5" fill="#F5C542" stroke="#0a0a0a" stroke-width="2" style="display:none"/>
    <rect id="hov" x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/></svg><div class="tip" id="vtip"></div>`;
  const hov = $('#hov'), tip = $('#vtip'), hx = $('#hx'), hd = $('#hd');
  const move = (ev) => {
    const r = hov.ownerSVGElement.getBoundingClientRect();
    const cx = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * (W / r.width);
    const t = t0 + ((cx - L) / (W - L - R)) * (t1 - t0);
    const p = near(t), px = x(p.t), py = y(p.v);
    hx.setAttribute('x1', px); hx.setAttribute('x2', px); hx.style.display = '';
    hd.setAttribute('cx', px); hd.setAttribute('cy', py); hd.style.display = '';
    const d = init != null ? p.v - init : null;
    tip.innerHTML = `<b>${fmt(p.v, 4)} SOL</b>${d != null ? ` <span class="${cls(d)}">${pct((d / init) * 100)}</span>` : ''}<small>${esc(ictShort(p.t))} ICT</small>`;
    tip.style.display = 'block';
    tip.style.left = Math.min(Math.max((px / W) * r.width, 70), r.width - 70) + 'px';
    tip.style.top = (py / H) * r.height + 'px';
  };
  const leave = () => { tip.style.display = 'none'; hx.style.display = 'none'; hd.style.display = 'none'; };
  hov.addEventListener('mousemove', move); hov.addEventListener('touchmove', move, { passive: true });
  hov.addEventListener('mouseleave', leave); hov.addEventListener('touchend', leave);
  const first = pts[0];
  $('#chartSub').innerHTML = `Wallet value in SOL · <span class="${cls(last.v - first.v)}">${pct(((last.v - first.v) / first.v) * 100)}</span> over ${dur(t1 - t0)}`;
}

function renderHistory(h, live, solUsd) {
  const el = $('#history');
  if (!h) { el.innerHTML = '<p class="muted">Trade history unavailable.</p>'; return; }
  if (startSol() == null && !(h.open || []).length && !(h.closed || []).length) {
    el.innerHTML = '<p class="muted">No trades yet. History starts with the first position.</p>';
    return;
  }
  const meteora = (pool) => `<a href="https://app.meteora.ag/dlmm/${esc(pool)}" target="_blank" rel="noopener">Pool ↗</a>`;
  const tl = (t, l) => (t ? link(t, 'tx', l + ' ↗') : '');
  const row = (r, exit, pnl, pp, status) => {
    const o = Date.parse(r.opened), c = r.closed ? Date.parse(r.closed) : Date.now();
    return `<tr>
    <td class="pr"><b>${esc(r.pair)}</b> ${status === 'open' ? '<span class="badge open">Live</span>' : ''}<small>${r.opened ? esc(ictShort(r.opened)) : '—'}</small></td>
    <td class="n ${cls(pnl)}">${sgn(pnl)}<small>${pp != null ? pct(pp) : ''}</small></td>
    <td class="n">${dur(c - o)}</td>
    <td class="n hide-sm">${fmt(r.entry_sol, 4)} → ${exit != null ? fmt(exit, 4) : '—'}</td>
    <td class="reason hide-sm"><span title="${esc(r.reason || '')}">${esc(r.reason || (status === 'open' ? 'live position' : ''))}</span></td>
    <td class="lk hide-sm">${meteora(r.pool)}${link(r.position, 'account', 'Position ↗')}${tl(r.open_tx, 'Open')} ${tl(r.close_tx, 'Close')}</td></tr>`;
  };
  let unr = 0, unrOk = true;
  const openRows = (h.open || []).map((r) => { const p = live.find((x) => x.position === r.position); const entry = r.entry_sol ?? p?.pnl?.dep; const v = p?.pnl?.total ?? (p ? (p.valueSol || 0) + (p.feesSol || 0) : null); const d = v != null && entry != null ? v - entry : null; if (d == null || !isFinite(d)) unrOk = false; else unr += d; return row({ ...r, entry_sol: entry }, v, d, d != null && entry ? (d / entry) * 100 : null, 'open'); });
  const closed = h.closed || [];
  const real = closed.reduce((s, r) => s + (r.pnl_sol || 0), 0);
  const best = closed.reduce((b, r) => (b == null || (r.pnl_sol ?? -1e9) > b.pnl_sol ? r : b), null);
  const worst = closed.reduce((b, r) => (b == null || (r.pnl_sol ?? 1e9) < b.pnl_sol ? r : b), null);
  const held = closed.map((r) => Date.parse(r.closed) - Date.parse(r.opened)).filter((x) => isFinite(x) && x >= 0);
  const u = (n) => (solUsd && n != null ? usd(n * solUsd) : '');
  $('#histSub').textContent = `${closed.length} closed${(h.open || []).length ? ` · ${(h.open || []).length} live` : ''} · newest first`;
  el.innerHTML = `<div class="tablewrap"><table class="hist"><thead><tr><th>Pair</th><th class="n">PnL SOL</th><th class="n">Held</th><th class="n hide-sm">Entry → Exit</th><th class="hide-sm">Exit reason</th><th class="hide-sm">Links</th></tr></thead><tbody>
    ${openRows.join('')}${closed.map((r) => row(r, r.exit_sol, r.pnl_sol, r.pnl_pct, 'closed')).join('')}</tbody></table></div>
    <div class="summary-strip">
      <div class="stat"><label>Realized total</label><b class="${cls(real)}">${sgn(real)} SOL</b><small>${u(real) || '&nbsp;'}</small></div>
      <div class="stat"><label>Unrealized</label><b class="${cls(unrOk ? unr : null)}">${(h.open || []).length ? sgn(unrOk ? unr : null) + ' SOL' : '—'}</b><small>${(h.open || []).length ? 'live, incl. fees' : 'all in SOL'}</small></div>
      <div class="stat"><label>Best / worst</label><b><span class="pos">${best ? sgn(best.pnl_sol, 3) : '—'}</span> / <span class="neg">${worst ? sgn(worst.pnl_sol, 3) : '—'}</span></b><small>${best ? esc(best.pair) : ''}${worst ? ' / ' + esc(worst.pair) : ''}</small></div>
      <div class="stat"><label>Avg hold</label><b>${held.length ? dur(held.reduce((a, b) => a + b, 0) / held.length) : '—'}</b><small>per closed trade</small></div>
    </div>`;
}

function dailyRealizedRows() {
  const by = new Map();
  for (const c of config.closed_positions || []) {
    if (c.pnl_sol == null || !c.closed || !isFinite(Date.parse(c.closed))) continue;
    const k = ictYmd(c.closed);
    const cur = by.get(k) || { pnl: 0, n: 0 };
    cur.pnl += c.pnl_sol;
    cur.n += 1;
    by.set(k, cur);
  }
  return [...by.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, v]) => ({ day, ...v }));
}
function renderDaily(solUsd) {
  const rows = dailyRealizedRows();
  const el = $('#daily');
  if (!rows.length) { el.innerHTML = '<p class="muted">No closed trades yet.</p>'; return; }
  const max = Math.max(...rows.map((r) => Math.abs(r.pnl)), 1e-9);
  el.innerHTML = rows.map((r) => {
    const label = new Date(r.day + 'T12:00:00+07:00').toLocaleDateString('en-GB', { timeZone: 'Asia/Saigon', weekday: 'short', day: 'numeric', month: 'short' });
    const isToday = r.day === ictYmd(Date.now());
    const w = Math.max(3, (Math.abs(r.pnl) / max) * 100);
    return `<div class="drow"><span>${esc(label)}<br><small class="muted">${isToday ? 'today · ' : ''}${r.n} close${r.n === 1 ? '' : 's'}</small></span><span class="dbar"><i class="${r.pnl >= 0 ? 'pos' : 'neg'}" style="width:${w.toFixed(1)}%"></i></span><span class="v ${cls(r.pnl)}">${sgn(r.pnl)}<small>${solUsd ? usd(r.pnl * solUsd) : ''}</small></span></div>`;
  }).join('') + '<p class="muted small" style="margin:10px 0 0">Sum of logged closed-trade PnL per Asia/Saigon (ICT) day. Today’s PnL above is the change in total wallet value since ICT midnight, so it also includes swap costs and leftover token dust.</p>';
}

function binChart(p) {
  const bins = [...p.bins].sort((a, b) => a.id - b.id);
  if (!bins.length) return '';
  const W = 720, H = 170, pad = 2;
  const lo = Math.min(bins[0].id, p.active), hi = Math.max(bins[bins.length - 1].id, p.active);
  const n = hi - lo + 1;
  const bw = (W - 2) / n;
  const max = Math.max(...bins.map((b) => b.v), 1e-18);
  let bars = '';
  for (const b of bins) {
    const h = (b.v / max) * (H - pad - 10);
    const x = 1 + (b.id - lo) * bw;
    const isA = b.id === p.active;
    const fill = isA ? '#F7D774' : b.y > 0 && b.x === 0 ? '#D4AF37' : b.x > 0 && b.y === 0 ? '#7d6a3a' : '#b8901f';
    bars += `<rect x="${x.toFixed(2)}" y="${(H - pad - h).toFixed(2)}" width="${Math.max(bw - 1, 0.6).toFixed(2)}" height="${Math.max(h, b.v > 0 ? 1 : 0).toFixed(2)}" rx="1" fill="${fill}"><title>bin ${b.id}\nprice ${fmtPrice(b.price)} ${p.symY}\n${fmt(b.x)} ${p.symX} + ${fmt(b.y)} ${p.symY}${isA ? '\nACTIVE' : ''}</title></rect>`;
  }
  const ax = 1 + (p.active - lo) * bw + bw / 2;
  const marker = `<line x1="${ax}" x2="${ax}" y1="4" y2="${H - pad}" stroke="#F7D774" stroke-dasharray="3 3" stroke-width="1.5"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="bin liquidity">${bars}${marker}</svg>
  <div class="axis"><span>${fmtPrice(bins[0].price)}</span><span class="act">active ${fmtPrice(p.pActive)}</span><span>${fmtPrice(bins[bins.length - 1].price)}</span></div>
  <div class="legend"><span><i style="background:#D4AF37"></i>${esc(p.symY)}</span><span><i style="background:#7d6a3a"></i>${esc(p.symX)}</span><span><i style="background:#b8901f"></i>mixed</span><span><i style="background:#F7D774"></i>active bin</span></div>`;
}

function positionCard(p) {
  const pi = p.poolInfo;
  const badge = p.inRange ? '<span class="badge in">● In range</span>' : `<span class="badge out">Out of range ${p.active < p.lower ? '▼' : '▲'}</span>`;
  const pnl = p.pnl
    ? `<div class="stat"><label>PnL</label><b class="${cls(p.pnl.abs)}">${sgn(p.pnl.abs, 5)} SOL</b><small>${pct(p.pnl.pct)} · incl. fees</small></div>`
    : `<div class="stat"><label>PnL</label><b>—</b><small>deposit not logged</small></div>`;
  const opened = p.cfg?.opened ? `Opened ${esc(ictShort(p.cfg.opened))} ICT · ${ago(Date.parse(p.cfg.opened))}` : '';
  return `<section class="card">
    <div class="card-head"><div><h2>Current position</h2><div class="sub">${opened}</div></div>${badge}</div>
    <div class="pos-head"><span class="pair">${esc(p.name)}</span><span class="sub" style="margin:0">bin step ${p.step} · ${p.cfg?.strategy ? esc(p.cfg.strategy) + ' · ' : ''}<a href="https://app.meteora.ag/dlmm/${p.pool}" target="_blank" rel="noopener">Meteora ↗</a> · ${link(p.position, 'account', 'Solscan ↗')}</span></div>
    <div class="grid">
      <div class="stat"><label>Value</label><b>${fmt(p.valueSol, 5)} SOL</b><small>${usd(p.valueUsd)}</small></div>
      ${pnl}
      <div class="stat"><label>Unclaimed fees</label><b>${fmt(p.feesSol, 5)} SOL</b><small>${usd(p.feesUsd)}</small></div>
      <div class="stat"><label>Deposited</label><b>${p.pnl ? fmt(p.pnl.dep, 4) + ' SOL' : '—'}</b><small>${p.upper - p.lower + 1} bins</small></div>
    </div>
    <h3>Liquidity by bin</h3>
    ${binChart(p)}
    ${pi ? `<h3>Pool</h3><div class="grid">
      <div class="stat"><label>TVL</label><b>${usd(pi.tvl)}</b><small>mcap ${usd(pi.token_x?.market_cap)}</small></div>
      <div class="stat"><label>Volume 24h</label><b>${usd(pi.volume?.['24h'])}</b><small>1h ${usd(pi.volume?.['1h'])}</small></div>
      <div class="stat"><label>Fees / TVL 24h</label><b>${pct(pi.fee_tvl_ratio?.['24h']).replace('+', '')}</b><small>base fee ${pi.pool_config?.base_fee_pct ?? '—'}%</small></div>
      <div class="stat"><label>Token</label><b>${esc(p.symX)}</b><small>${link(p.xMint, 'token')}${pi.token_x?.is_verified === false ? ' · unverified' : ''}</small></div>
    </div>` : ''}
  </section>`;
}
function waitingCard(freeSol, ph) {
  const last = (ph?.closed || [])[0];
  return `<section class="card">
    <div class="card-head"><div><h2>Current position</h2><div class="sub">Live from chain</div></div><span class="badge cl">Flat</span></div>
    <div class="waiting"><div class="radar"><i></i></div>
      <div class="t">In SOL, waiting for the next setup</div>
      <div class="d">${esc(brandName())} is holding SOL and scanning fresh Meteora DLMM pools for momentum, volume and fees that fit its entry rules.</div>
      <div class="grid">
        <div class="stat"><label>Ready capital</label><b>${fmt(freeSol, 4)} SOL</b><small>free wallet balance</small></div>
        ${last ? `<div class="stat"><label>Last trade</label><b class="${cls(last.pnl_sol)}">${esc(last.pair)} ${sgn(last.pnl_sol, 4)}</b><small>closed ${last.closed ? ago(Date.parse(last.closed)) : '—'}</small></div>` : ''}
      </div></div>
  </section>`;
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2200);
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
    const free = lamports / LAMPORTS_PER_SOL;
    let rent = 0;
    try { const accs = await conn.getMultipleAccountsInfo(positions.map((p) => new PublicKey(p.position))); rent = accs.reduce((s, a) => s + (a?.lamports || 0), 0) / LAMPORTS_PER_SOL; } catch (e) { notes.push('Position rent lookup failed; total excludes rent.'); }
    const totPos = positions.reduce((s, p) => s + (p.valueSol || 0) + (p.feesSol || 0), 0);
    const [hist, ph] = await Promise.all([
      getJSON('value_history.json?t=' + Date.now()).catch(() => null),
      getJSON('position_history.json?t=' + Date.now()).catch(() => null),
    ]);
    const cur = free + totPos + rent;
    renderHero(cur, rent, free, hist, ph, solUsd);
    view.series = [...historyPoints(hist), { t: Date.now(), v: cur }];
    view.closed = ph?.closed || [];
    renderValueChart();
    renderHistory(ph, positions, solUsd);
    renderDaily(solUsd);
    $('#summary').innerHTML = `
      <div class="stat"><label>Free SOL</label><b>${fmt(free, 4)} SOL</b><small>${usd(solUsd ? free * solUsd : null)}</small></div>
      <div class="stat"><label>In positions</label><b>${fmt(totPos, 4)} SOL</b><small>${positions.length} open · incl. fees</small></div>
      <div class="stat"><label>Position rent</label><b>${fmt(rent, 4)} SOL</b><small>refunded on close</small></div>
      <div class="stat"><label>SOL price</label><b>${usd(solUsd)}</b><small>Jupiter</small></div>`;
    $('#walletLink').innerHTML = link(wallet, 'account', short(wallet) + ' on Solscan ↗');
    $('#positions').innerHTML = positions.length ? positions.map(positionCard).join('') : waitingCard(free, ph);
    $('#notes').innerHTML = notes.map((x) => `<div class="note">${esc(x)}</div>`).join('');
    status.textContent = `Updated ${ict(Date.now())} · positions via ${via}`;
    $('#live').className = 'live ok';
    $('#liveText').textContent = 'Live · ' + ictTime(Date.now()) + ' ICT';
    window.__dash = { ok: true, positions: positions.length, sol: free, updated: Date.now() };
  } catch (e) {
    console.warn(e);
    status.textContent = 'Error: ' + (e.message || e) + ' (try a different RPC in Settings)';
    status.className = 'status err';
    $('#live').className = 'live err';
    $('#liveText').textContent = 'Reconnecting…';
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
  try { config = await getJSON('config.json?t=' + Date.now()); } catch (e) { console.warn('config.json missing', e); }
  config.positions = config.positions || [];
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
  $('#rangeTabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-range]'); if (!b) return;
    view.range = b.dataset.range;
    $('#rangeTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    renderValueChart();
  });
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(renderValueChart, 150); });
  $('#share').addEventListener('click', async () => {
    const url = location.origin + location.pathname;
    try {
      if (navigator.share) await navigator.share({ title: document.title, url });
      else { await navigator.clipboard.writeText(url); toast('Link copied'); }
    } catch {}
  });
  await refresh();
  schedule();
}
init();

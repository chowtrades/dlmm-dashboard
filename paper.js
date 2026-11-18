(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(x, d) { return x == null || isNaN(x) ? '—' : Number(x).toFixed(d == null ? 4 : d); }
  function pct(x) { return x == null || isNaN(x) ? '—' : (x >= 0 ? '+' : '') + Number(x).toFixed(2) + '%'; }
  function cls(x) { return x > 0 ? 'pos' : x < 0 ? 'neg' : ''; }
  function ago(iso) { if (!iso) return '—'; var s = Math.round((Date.now() - Date.parse(iso)) / 1000); if (s < 60) return s + 's ago'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago'; return Math.round(s / 86400) + 'd ago'; }
  function when(iso) { try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } }
  function kpi(l, v, c) { return '<div class="kpi"><div class="l">' + esc(l) + '</div><div class="v ' + (c || '') + '">' + v + '</div></div>'; }
  function chart(pts, start) {
    if (!pts || pts.length < 2) return '<div class="muted small">Not enough points yet.</div>';
    var W = 1000, H = 220, P = 28, xs = pts.map(function (p) { return Date.parse(p.t); }), ys = pts.map(function (p) { return p.v; }).concat([start]);
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (y1 - y0 < 1e-6) { y0 -= 0.005; y1 += 0.005; }
    var X = function (x) { return P + (W - 2 * P) * (x - x0) / Math.max(1, x1 - x0); }, Y = function (y) { return H - P - (H - 2 * P) * (y - y0) / (y1 - y0); };
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(Date.parse(p.t)).toFixed(1) + ' ' + Y(p.v).toFixed(1); }).join(' ');
    var last = pts[pts.length - 1].v, col = last >= start ? '#D4AF37' : '#d0716a';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
      '<line x1="' + P + '" x2="' + (W - P) + '" y1="' + Y(start) + '" y2="' + Y(start) + '" stroke="#3a3222" stroke-dasharray="6 6"/>' +
      '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.5" vector-effect="non-scaling-stroke"/>' +
      '<text x="' + (P + 4) + '" y="' + (Y(start) - 6) + '" fill="#6f695c" font-size="12">start ' + start + ' SOL</text>' +
      '<text x="' + (W - P) + '" y="16" fill="#9a9384" font-size="12" text-anchor="end">' + n(y1) + '</text>' +
      '<text x="' + (W - P) + '" y="' + (H - 8) + '" fill="#9a9384" font-size="12" text-anchor="end">' + n(y0) + '</text></svg>';
  }
  function render(d) {
    var start = d.start_balance_sol || 0.5, eq = d.equity_sol, s = d.stats || {};
    $('equity').textContent = n(eq) + ' SOL';
    var dp = eq - start; $('pnl').innerHTML = '<span class="' + cls(dp) + '">' + (dp >= 0 ? '+' : '') + n(dp) + ' SOL (' + pct(100 * dp / start) + ')</span> <span class="muted">vs ' + start + ' SOL start · free ' + n(d.balance_sol) + '</span>';
    $('kpis').innerHTML = kpi('Trades', s.trades || 0) + kpi('Win rate', s.win_rate_pct == null ? '—' : s.win_rate_pct + '%') + kpi('Avg', pct(s.avg_pct), cls(s.avg_pct)) + kpi('Median', pct(s.median_pct), cls(s.median_pct)) +
      kpi('Best', pct(s.best_pct), cls(s.best_pct)) + kpi('Worst', pct(s.worst_pct), cls(s.worst_pct)) + kpi('Total PnL', n(s.total_pnl_sol) + ' SOL', cls(s.total_pnl_sol));
    var o = d.open;
    if (o) {
      $('open').className = '';
      $('open').innerHTML = '<div class="p-open">' + kpi('Token', '<a href="https://dexscreener.com/solana/' + esc(o.pool) + '" target="_blank" rel="noopener">' + esc(o.pair) + '</a>') +
        kpi('Pool', '<a href="https://app.meteora.ag/dlmm/' + esc(o.pool) + '" target="_blank" rel="noopener">' + esc(String(o.pool).slice(0, 6)) + '…</a>') +
        kpi('Size', n(o.size_sol, 3) + ' SOL') + kpi('Value', n(o.value_sol) + ' SOL') + kpi('PnL', pct(o.pnl_pct), cls(o.pnl_pct)) + kpi('Fees (est.)', n(o.fees_sol, 5) + ' SOL') +
        kpi('Held', (o.held_min || 0) + ' min') + kpi('Range', o.in_range === false ? '<span class="neg">out (bin ' + o.active_bin_rel + ')</span>' : 'in (bin ' + (o.active_bin_rel || 0) + ')') +
        kpi('Fee rate now / peak', n(o.fee_rate_h, 1) + ' / ' + n(o.peak_fee_rate_h, 1) + ' %/h') + kpi('TVL now / entry', '$' + (o.tvl_usd || 0).toLocaleString() + ' / $' + (o.entry_tvl_usd || 0).toLocaleString()) + '</div>' +
        '<div class="muted small" style="margin-top:8px">Opened ' + esc(when(o.opened)) + ' · entry price ' + esc(o.entry_price_sol) + ' SOL · bin step ' + esc(o.bin_step) + '</div>';
    } else { $('open').className = 'muted'; $('open').textContent = 'No open paper position. Waiting for a pool that passes every entry filter.'; }
    $('chart').innerHTML = chart(d.equity, start);
    var rows = (d.trades || []).map(function (t) {
      return '<tr><td class="mono">' + esc(when(t.closed)) + '</td><td><a href="https://dexscreener.com/solana/' + esc(t.pool) + '" target="_blank" rel="noopener">' + esc(t.pair) + '</a></td><td class="mono">' + n(t.size_sol, 3) + '</td><td class="mono ' + cls(t.pnl_pct) + '">' + pct(t.pnl_pct) + ' <span class="muted">(' + n(t.pnl_sol) + ')</span></td><td class="mono">' + esc(t.held_min) + 'm</td><td class="reason">' + esc(String(t.reason || '').slice(0, 160)) + '</td></tr>';
    }).join('');
    document.querySelector('#trades tbody').innerHTML = rows;
    $('noTrades').textContent = rows ? '' : 'No closed paper trades yet.';
    var sc = d.last_scan;
    $('scan').innerHTML = sc ? 'Last scan ' + esc(ago(sc.at)) + ' · ' + esc(sc.young) + ' young SOL pools' + ((sc.near || []).length ? '<br>' + sc.near.map(function (x) { return '<span class="tag">' + esc(x.pair) + '</span> ' + (x.pass ? '<span class="pos">pass</span>' : esc((x.fails || []).slice(0, 3).join(', '))); }).join('<br>') : '') : '—';
    $('updated').textContent = when(d.published) + ' (' + ago(d.published) + ')' + (d.engine_heartbeat ? ' · engine heartbeat ' + ago(d.engine_heartbeat) : '');
    var stale = d.published && Date.now() - Date.parse(d.published) > 2 * 3600e3;
    $('live').className = 'live ' + (stale ? 'err' : 'ok'); $('liveText').textContent = stale ? 'Stale' : 'Paper engine';
  }
  function load() {
    fetch('paper.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(render).catch(function (e) { $('live').className = 'live err'; $('liveText').textContent = 'No data yet'; });
  }
  load(); setInterval(load, 60000);
})();

/* ============================================================
   flight-follow.js
   ------------------------------------------------------------
   Add-on for AIX SEC OPS AIXindex.html — It reads the arrivals
   table that AIXindex.html already builds and layers a "track
   this flight" checkbox + a live progress-bar panel on top.
============================================================ */
(function () {
  'use strict';

  const STORAGE_KEY   = 'ff_followed_v1';
  const SCAN_MS        = 2000;
  const TICK_MS        = 15000;
  const ALERT_MINUTES  = [60, 30, 15, 10, 5, 0];
  const APPROACH_WINDOW_SEC = 3 * 3600;
  let soundEnabled = localStorage.getItem('ff_sound_v1') === '1';

  let followed = new Map();
  let alertsEnabled = false;

  function getArrivalsBody() {
    return document.querySelector('#bArr') ||
           document.querySelector('#arrivals-table tbody');
  }
  function getArrivalsHeadRow() {
    return document.querySelector('#tArr thead tr') ||
           document.querySelector('#arrivals-table thead tr');
  }
  function rowId(tr) {
    return tr.dataset.fid || tr.dataset.flightId || '';
  }
  function rowEta(tr) {
    return (parseInt(tr.dataset.est, 10) || parseInt(tr.dataset.sch, 10) || 0);
  }
  function rowSch(tr) {
    return parseInt(tr.dataset.sch, 10) || 0;
  }
  function rowFlightNo(tr) {
    return (tr.cells[0] ? tr.cells[0].textContent : '').trim();
  }
  function rowFrom(tr) {
    return (tr.cells[2] ? tr.cells[2].textContent : '').trim();
  }
  function isRealRow(tr) {
    return tr.cells && tr.cells.length >= 6 && !tr.dataset.skeleton;
  }

  function fmtIST(ts) {
    if (typeof window.toIST === 'function') {
      try { return window.toIST(ts); } catch (e) { /* fall through */ }
    }
    if (!ts) return '–';
    try {
      return new Date(ts * 1000).toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false
      });
    } catch (e) { return '–'; }
  }
  function fmtRemaining(sec) {
    if (sec <= 0) return 'Due now';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(msg) {
    if (typeof window.showToast === 'function') {
      try { window.showToast(msg); return; } catch (e) { /* fall through */ }
    }
    let t = document.getElementById('ffFallbackToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'ffFallbackToast';
      t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
        'background:#e2394a;color:#fff;padding:8px 16px;border-radius:10px;font-size:.8rem;' +
        'z-index:9999;opacity:0;transition:opacity .3s;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2500);
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      arr.forEach(item => followed.set(item.fid, item));
    } catch (e) { /* ignore corrupt storage */ }
  }
  function saveStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(followed.values())));
    } catch (e) { /* storage may be full/unavailable */ }
  }

  function followFlight(tr) {
    const fid = rowId(tr);
    if (!fid || followed.has(fid)) return;
    const record = {
      fid,
      fn: rowFlightNo(tr),
      from: rowFrom(tr),
      sch: rowSch(tr),
      eta: rowEta(tr),
      startedAt: Math.floor(Date.now() / 1000),
      notified: []
    };
    followed.set(fid, record);
    saveStore();
    renderPanel();
    toast(`Tracking ${record.fn}`);
    maybePromptForAlerts();
  }

  function unfollowFlight(fid) {
    if (!followed.has(fid)) return;
    const rec = followed.get(fid);
    followed.delete(fid);
    saveStore();
    renderPanel();
    const body = getArrivalsBody();
    if (body) {
      const tr = body.querySelector(`tr[data-fid="${CSS.escape(fid)}"], tr[data-flight-id="${CSS.escape(fid)}"]`);
      const cb = tr && tr.querySelector('.ff-check');
      if (cb) cb.checked = false;
    }
    if (rec) toast(`Stopped tracking ${rec.fn}`);
  }

  function ensureHeaderColumn() {
    const headRow = getArrivalsHeadRow();
    if (!headRow || headRow.querySelector('.ff-th')) return;
    // Header already present in AIXindex.html — just ensure class
    const existing = headRow.querySelector('th:last-child');
    if (existing && !existing.classList.contains('ff-th')) {
      existing.classList.add('ff-th');
    }
  }

  function ensureCheckbox(tr) {
    if (!isRealRow(tr) || tr.querySelector('.ff-check')) return;
    const fid = rowId(tr);
    if (!fid) return;

    // If table already has 8 columns (Track header present), append to last cell or create
    const td = document.createElement('td');
    td.style.textAlign = 'center';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'ff-check';
    cb.title = 'Track this flight for live updates';
    cb.setAttribute('aria-label', `Track flight ${rowFlightNo(tr) || fid} for live updates`);
    cb.checked = followed.has(fid);
    cb.addEventListener('change', () => {
      if (cb.checked) followFlight(tr);
      else unfollowFlight(fid);
    });

    td.appendChild(cb);
    tr.appendChild(td);
  }

  function scanRows() {
    ensureHeaderColumn();
    const body = getArrivalsBody();
    if (!body) return;
    Array.from(body.rows).forEach(ensureCheckbox);

    Array.from(body.rows).forEach(tr => {
      const fid = rowId(tr);
      if (fid && followed.has(fid)) {
        const rec = followed.get(fid);
        rec.eta = rowEta(tr) || rec.eta;
        rec.sch = rowSch(tr) || rec.sch;
        rec.fn  = rowFlightNo(tr) || rec.fn;
      }
    });
  }

  function maybePromptForAlerts() {
    if (alertsEnabled || !('Notification' in window)) return;
    if (Notification.permission === 'granted') { alertsEnabled = true; return; }
  }

  function checkAlerts(rec, remainingSec) {
    if (!alertsEnabled || Notification.permission !== 'granted') return;
    const remainingMin = Math.floor(remainingSec / 60);
    for (const threshold of ALERT_MINUTES) {
      if (remainingMin <= threshold && !rec.notified.includes(threshold)) {
        rec.notified.push(threshold);
        try {
          new Notification(`✈ ${rec.fn} — ${threshold === 0 ? 'Arriving now' : threshold + ' min out'}`, {
            body: `From ${rec.from || '–'} · ETA ${fmtIST(rec.eta)} IST`,
            tag: `ff-${rec.fid}-${threshold}`
          });
          playAlertBeep();
        } catch (e) { /* notifications may be blocked mid-session */ }
      }
    }
  }

  let panelCollapsed = false;

  function ensurePanelShell() {
    if (document.getElementById('ffPanel')) return;

    const style = document.createElement('style');
    style.textContent = `
      #ffPanel{
        position:fixed; right:14px; bottom:14px; z-index:800;
        width:300px; max-width:calc(100vw - 28px);
        background:var(--card,#131218); color:var(--text,#f3f1ec);
        border:1px solid var(--border,#27252e); border-radius:var(--radius,8px);
        box-shadow:var(--shadow,0 10px 30px rgba(0,0,0,.45));
        font-family:var(--sans,sans-serif); font-size:.75rem;
        overflow:hidden;
      }
      #ffPanel.ff-collapsed #ffPanelBody{ display:none; }
      #ffPanelHeader{
        display:flex; align-items:center; justify-content:space-between;
        padding:9px 12px; cursor:pointer; user-select:none;
        background:var(--surface,#16151b); border-bottom:1px solid var(--border,#27252e);
        font-weight:700; font-family:var(--mono,monospace); font-size:.72rem;
      }
      #ffPanelBody{ max-height:280px; overflow-y:auto; }
      .ff-item{ padding:9px 12px; border-bottom:1px solid var(--border,#27252e); }
      .ff-item:last-child{ border-bottom:none; }
      .ff-item-top{ display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; }
      .ff-fn{ font-family:var(--mono,monospace); font-weight:700; color:var(--accent2,#ff8a1e); }
      .ff-remove{ cursor:pointer; color:var(--muted,#8b8892); font-size:.85rem; padding:0 4px; }
      .ff-remove:hover{ color:var(--red,#ff5a5a); }
      .ff-meta{ display:flex; justify-content:space-between; color:var(--muted,#8b8892); font-size:.66rem; margin-bottom:5px; }
      .ff-bar-track{ height:6px; border-radius:99px; background:var(--border,#27252e); overflow:hidden; }
      .ff-bar-fill{ height:100%; border-radius:99px; background:var(--accent,#e2394a); transition:width .5s ease; }
      .ff-bar-fill.ff-soon{ background:var(--yellow,#ffb238); }
      .ff-bar-fill.ff-due{ background:var(--red,#ff5a5a); }
      .ff-empty{ padding:16px 12px; text-align:center; color:var(--muted,#8b8892); font-size:.7rem; }
      #ffAlertBtn{
        width:100%; padding:8px; border:none; border-top:1px solid var(--border,#27252e);
        background:var(--accent,#e2394a); color:#fff; font-weight:600; font-size:.7rem; cursor:pointer;
      }
      #ffAlertBtn.ff-on{ background:var(--green,#35c48a); }
      #ffBadge{
        background:var(--accent,#e2394a); color:#fff; border-radius:99px;
        padding:1px 7px; font-size:.65rem; margin-left:6px;
      }
      #ffSoundBtn{
        border:none; border-top:1px solid var(--border,#27252e); border-left:1px solid var(--border,#27252e);
        background:var(--surface,#16151b); color:var(--text); cursor:pointer; font-size:1rem;
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'ffPanel';
    panel.innerHTML = `
      <div id="ffPanelHeader">
        <span>🔔 Tracked Flights <span id="ffBadge">0</span></span>
        <span id="ffToggleIcon">▾</span>
      </div>
      <div id="ffPanelBody">
        <div id="ffPanelList"></div>
        <div style="display:flex">
          <button id="ffAlertBtn" style="flex:1">🔔 Enable Alerts</button>
          <button id="ffSoundBtn" style="flex:0 0 44px" title="Play a sound with milestone alerts" aria-label="Toggle alert sound">${soundEnabled ? '🔊' : '🔈'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('ffPanelHeader').addEventListener('click', () => {
      panelCollapsed = !panelCollapsed;
      panel.classList.toggle('ff-collapsed', panelCollapsed);
      document.getElementById('ffToggleIcon').textContent = panelCollapsed ? '▸' : '▾';
    });

    document.getElementById('ffAlertBtn').addEventListener('click', async () => {
      if (!('Notification' in window)) {
        toast('Notifications not supported on this browser');
        return;
      }
      const perm = await Notification.requestPermission();
      alertsEnabled = perm === 'granted';
      document.getElementById('ffAlertBtn').textContent = alertsEnabled ? '✓ Alerts Enabled' : '🔔 Enable Alerts';
      document.getElementById('ffAlertBtn').classList.toggle('ff-on', alertsEnabled);
      toast(alertsEnabled ? 'Milestone alerts enabled' : 'Alerts blocked');
    });

    document.getElementById('ffSoundBtn').addEventListener('click', (e) => {
      soundEnabled = !soundEnabled;
      localStorage.setItem('ff_sound_v1', soundEnabled ? '1' : '0');
      e.target.textContent = soundEnabled ? '🔊' : '🔈';
      toast(soundEnabled ? 'Alert sound on' : 'Alert sound off');
    });
  }

  function playAlertBeep() {
    if (!soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch (e) { /* audio may be blocked without a user gesture */ }
  }

  function renderPanel() {
    ensurePanelShell();
    const list = document.getElementById('ffPanelList');
    const badge = document.getElementById('ffBadge');
    if (!list || !badge) return;

    badge.textContent = followed.size;

    if (followed.size === 0) {
      list.innerHTML = `<div class="ff-empty">Select a flight in the Arrivals table to track it here.</div>`;
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const items = Array.from(followed.values()).sort((a, b) => (a.eta || a.sch) - (b.eta || b.sch));

    list.innerHTML = items.map(rec => {
      const eta = rec.eta || rec.sch || now;
      const windowStart = eta - APPROACH_WINDOW_SEC;
      const elapsed = now - windowStart;
      let pct = Math.min(100, Math.max(0, (elapsed / APPROACH_WINDOW_SEC) * 100));
      const remainingSec = Math.max(0, eta - now);

      checkAlerts(rec, remainingSec);

      let barClass = '';
      if (remainingSec <= 0) { pct = 100; barClass = 'ff-due'; }
      else if (remainingSec <= 15 * 60) barClass = 'ff-soon';

      const fn = escapeHtml(rec.fn || '–');
      const from = escapeHtml(rec.from || '');

      return `
        <div class="ff-item" data-fid="${escapeHtml(rec.fid)}">
          <div class="ff-item-top">
            <span class="ff-fn">${fn}</span>
            <span class="ff-remove" data-remove="${escapeHtml(rec.fid)}" title="Stop tracking" role="button" tabindex="0" aria-label="Stop tracking ${fn}">✕</span>
          </div>
          <div class="ff-meta">
            <span>${from ? 'From ' + from : ''}</span>
            <span>ETA ${fmtIST(eta)} · ${fmtRemaining(remainingSec)}</span>
          </div>
          <div class="ff-bar-track">
            <div class="ff-bar-fill ${barClass}" style="width:${pct.toFixed(1)}%"></div>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('[data-remove]').forEach(el => {
      el.addEventListener('click', () => unfollowFlight(el.getAttribute('data-remove')));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          unfollowFlight(el.getAttribute('data-remove'));
        }
      });
    });

    saveStore();
  }

  let observedBody = null;
  function attachObserver() {
    const body = getArrivalsBody();
    if (!body || body === observedBody) return;
    observedBody = body;
    const observer = new MutationObserver(() => scanRows());
    observer.observe(body, { childList: true });
  }

  function init() {
    loadStore();
    ensurePanelShell();
    renderPanel();
    scanRows();
    attachObserver();
    setInterval(() => { scanRows(); attachObserver(); }, SCAN_MS * 5);
    setInterval(renderPanel, TICK_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

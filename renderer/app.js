'use strict';

const $ = (id) => document.getElementById(id);

const els = {
  loading: $('loading'),
  errorState: $('error-state'),
  errorText: $('error-text'),
  errorRetry: $('error-retry'),
  errorReread: $('error-reread'),
  content: $('content'),
  banner: $('banner'),
  stale: $('stale'),
  sessionPct: $('session-pct'),
  sessionBar: $('session-bar'),
  sessionElapsed: $('session-elapsed'),
  sessionReset: $('session-reset'),
  burning: $('burning'),
  weeklyPct: $('weekly-pct'),
  weeklyDot: $('weekly-dot'),
  weeklyReset: $('weekly-reset'),
  weeklyBar: $('weekly-bar'),
  detailsToggle: $('details-toggle'),
  details: $('details'),
  plan: $('plan'),
  updated: $('updated'),
  refresh: $('refresh'),
  quit: $('quit'),
};

let detailsOpen = false;
let lastSnapshot = null;
let updatedTimer = null;

function statusClass(percent) {
  if (percent >= 80) return 'high';
  if (percent >= 50) return 'med';
  return 'low';
}

function setBar(barEl, percent, parent) {
  const cls = statusClass(percent);
  barEl.style.width = Math.min(100, Math.max(0, percent)) + '%';
  parent.classList.remove('bar-low', 'bar-med', 'bar-high');
  parent.classList.add('bar-' + cls);
}

function setMetricColor(el, percent) {
  el.classList.remove('status-low', 'status-med', 'status-high');
  el.classList.add('status-' + statusClass(percent));
}

function fmtPct(v) { return Math.round(v) + '%'; }

function fmtTok(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M tok';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K tok';
  return n + ' tok';
}

function modelColor(model) {
  switch (model) {
    case 'Opus': return 'var(--purple)';
    case 'Sonnet': return 'var(--blue)';
    case 'Haiku': return 'var(--cyan)';
    default: return 'var(--muted)';
  }
}

function relativeTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function render(snap) {
  lastSnapshot = snap;

  // Loading state
  if (!snap.hasLoaded && !snap.errorMessage) {
    els.loading.classList.remove('hidden');
    els.errorState.classList.add('hidden');
    els.content.classList.add('hidden');
    return;
  }

  // Hard error state (never loaded)
  if (!snap.hasLoaded && snap.errorMessage) {
    els.loading.classList.add('hidden');
    els.content.classList.add('hidden');
    els.errorState.classList.remove('hidden');
    els.errorText.textContent = snap.errorMessage;
    return;
  }

  els.loading.classList.add('hidden');
  els.errorState.classList.add('hidden');
  els.content.classList.remove('hidden');

  // Banner
  const sp = snap.sessionPercent;
  if (sp >= 95) {
    els.banner.className = 'banner crit';
    els.banner.innerHTML = `<span>⚠</span><span>Session almost exhausted</span><span class="reset-text">${snap.fiveHourResetIn || ''}</span>`;
    els.banner.classList.remove('hidden');
  } else if (sp >= 80) {
    els.banner.className = 'banner warn';
    els.banner.innerHTML = `<span>⚠</span><span>Approaching session limit</span><span class="reset-text">${snap.fiveHourResetIn || ''}</span>`;
    els.banner.classList.remove('hidden');
  } else {
    els.banner.classList.add('hidden');
  }

  // Stale banner (loaded once but error on refresh)
  if (snap.errorMessage) {
    els.stale.textContent = '⚠ ' + snap.errorMessage;
    els.stale.classList.remove('hidden');
  } else {
    els.stale.classList.add('hidden');
  }

  // Session
  els.sessionPct.textContent = fmtPct(sp);
  setMetricColor(els.sessionPct, sp);
  setBar(els.sessionBar, sp, els.sessionBar.parentElement);
  els.sessionElapsed.style.width = Math.min(100, snap.sessionElapsedPercent) + '%';
  els.sessionReset.textContent = snap.fiveHourResetIn
    ? snap.fiveHourResetIn.charAt(0).toUpperCase() + snap.fiveHourResetIn.slice(1)
    : '';
  if (sp > snap.sessionElapsedPercent) {
    els.burning.textContent = 'Burning fast';
    els.burning.style.color = `var(--${statusClass(sp) === 'high' ? 'red' : statusClass(sp) === 'med' ? 'orange' : 'green'})`;
  } else {
    els.burning.textContent = '';
  }

  // Weekly
  const wp = snap.weeklyPercent;
  els.weeklyPct.textContent = fmtPct(wp);
  setMetricColor(els.weeklyPct, wp);
  setBar(els.weeklyBar, wp, els.weeklyBar.parentElement);
  if (snap.sevenDayResetIn) {
    els.weeklyDot.classList.remove('hidden');
    els.weeklyReset.textContent = snap.sevenDayResetIn;
  } else {
    els.weeklyDot.classList.add('hidden');
    els.weeklyReset.textContent = '';
  }

  // Details
  els.details.innerHTML = renderDetails(snap);

  // Plan + updated
  els.plan.textContent = snap.planName;
  els.updated.textContent = relativeTime(snap.lastUpdated);
  els.refresh.classList.toggle('spinning', !!snap.isLoading);

  // Tick "n s ago" each second
  if (updatedTimer) clearInterval(updatedTimer);
  updatedTimer = setInterval(() => {
    if (lastSnapshot) els.updated.textContent = relativeTime(lastSnapshot.lastUpdated);
  }, 1000);
}

function renderDetails(snap) {
  const rows = [];
  if (snap.sonnetPercent > 0) rows.push(detailRow('Sonnet (7d)', fmtPct(snap.sonnetPercent), statusClass(snap.sonnetPercent)));
  if (snap.opusPercent > 0) rows.push(detailRow('Opus (7d)', fmtPct(snap.opusPercent), statusClass(snap.opusPercent)));

  const extra = snap.extraUsage;
  if (extra && extra.is_enabled && extra.used_credits != null && extra.monthly_limit != null) {
    rows.push(detailRow('Extra usage', `$${extra.used_credits.toFixed(2)} / $${extra.monthly_limit.toFixed(2)}`));
  } else {
    rows.push(detailRow('Extra usage', 'Off'));
  }

  const lc = snap.localCosts;
  if (lc) {
    rows.push('<div class="detail-divider"></div>');
    if (lc.sessionTotal > 0) {
      rows.push(detailRow('Session (in / out)', `${fmtTok(lc.sessionInput)} / ${fmtTok(lc.sessionOutput)}`));
    }
    if (lc.weeklyTotal > 0) {
      rows.push(detailRow('Weekly (in / out)', `${fmtTok(lc.weeklyInput)} / ${fmtTok(lc.weeklyOutput)}`));
    }
    rows.push(detailRow('Today', fmtTok(lc.todayTokens)));
    rows.push(detailRow('This week', fmtTok(lc.weekTokens)));
    rows.push(detailRow('This month', fmtTok(lc.monthTokens)));

    const breakdown = lc.modelBreakdown || {};
    const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
    if (entries.length) {
      rows.push('<div class="detail-divider"></div>');
      for (const [model, cost] of entries) {
        rows.push(`
          <div class="model-row">
            <span class="swatch" style="background:${modelColor(model)}"></span>
            <span class="name">${escapeHtml(model)}</span>
            <span class="cost">$${cost.toFixed(2)} eq.</span>
          </div>
        `);
      }
    }
  }

  return rows.join('');
}

function detailRow(label, value, cls) {
  const valueClass = cls ? `value status-${cls}` : 'value';
  return `<div class="detail-row"><span class="label">${escapeHtml(label)}</span><span class="${valueClass}">${escapeHtml(value)}</span></div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Wire up
els.detailsToggle.addEventListener('click', () => {
  detailsOpen = !detailsOpen;
  els.detailsToggle.classList.toggle('open', detailsOpen);
  els.details.classList.toggle('hidden', !detailsOpen);
});

els.refresh.addEventListener('click', () => window.claudeBar.refresh());
els.quit.addEventListener('click', () => window.claudeBar.quit());
els.errorRetry.addEventListener('click', () => window.claudeBar.refresh());
els.errorReread.addEventListener('click', () => window.claudeBar.refreshForce());

window.claudeBar.onState(render);
window.claudeBar.getState().then(render);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.claudeBar.hide();
});

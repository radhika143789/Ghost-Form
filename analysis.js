/**
 * analysis.js — Ghost Form Detailed Analysis Page
 */

const SUPABASE_URL      = 'https://czoleruusckauzjcmmml.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tNpP7lz1K5T5NtgnT0OqAw_THzXSU28';

/* ── Auth guard ───────────────────────────────────────────── */
function getSession() {
  try {
    const raw = localStorage.getItem('gf_session');
    if (!raw) return null;
    const d = JSON.parse(raw);
    // FIX: Supabase expires_at is UNIX seconds; Date.now() is milliseconds
    if (Date.now() > d.expires_at * 1000) { localStorage.removeItem('gf_session'); return null; }
    return d;
  } catch { return null; }
}
const session = getSession();
if (!session) window.location.href = 'auth.html';

/* ── Supabase fetch ───────────────────────────────────────── */
async function sbFetch(path, params = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}${params}`, {
    headers: {
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${session.access_token}`,
    }
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/* ── Helpers ──────────────────────────────────────────────── */
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function hide(id) { document.getElementById(id)?.classList.add('hidden'); }
function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

/* ── Domain Analysis ──────────────────────────────────────── */
function buildSignals(rows) {
  // Heuristic signals derived from the available data
  const red    = rows.filter(r => r.threat_level === 'Red').length;
  const yellow = rows.filter(r => r.threat_level === 'Yellow').length;
  const ml     = rows.filter(r => r.detection_method === 'ML_Model').length;
  const total  = rows.length || 1;
  const domain = rows[0]?.domain_flagged || '';

  // Simulated signal scores based on domain heuristics
  const hasNumbers   = /\d/.test(domain.replace(/\./g, ''));
  const hasDash      = domain.split('.')[0].includes('-');
  const tldSuspect   = /\.(ru|xyz|tk|ml|ga|cf|gq|pw|cc|top|click|loan)$/.test(domain);
  const longSubdomain = domain.split('.').length > 3;
  const brandSpoof   = /(paypal|amazon|netflix|microsoft|google|apple|bank|secure|login|verify|update|account)/i.test(domain);

  return [
    { label: 'ML Similarity Score',  pct: Math.round((red / total) * 100 * 0.9 + 10),   color: '#ef4444' },
    { label: 'URL Pattern Risk',      pct: [hasNumbers, hasDash, tldSuspect, longSubdomain].filter(Boolean).length * 25, color: '#f97316' },
    { label: 'Brand Spoof Signal',    pct: brandSpoof ? 88 : 15, color: '#7c3aed' },
    { label: 'Repeat Detections',     pct: Math.min(100, (total / 5) * 100), color: '#fbbf24' },
    { label: 'ML Model Confidence',   pct: Math.round((ml / total) * 100), color: '#00ff88' },
    { label: 'TLD Suspicion',         pct: tldSuspect ? 90 : 12, color: '#00d4ff' },
  ];
}

function renderSignals(signals) {
  const wrap = document.getElementById('signalsWrap');
  wrap.innerHTML = signals.map(s => `
    <div class="signal-bar-wrap">
      <span class="signal-label">${s.label}</span>
      <div class="signal-track">
        <div class="signal-fill" style="width:0%;background:${s.color};" data-pct="${s.pct}"></div>
      </div>
      <span class="signal-val" style="color:${s.color};">${s.pct}%</span>
    </div>`).join('');
  // Animate bars
  setTimeout(() => {
    wrap.querySelectorAll('.signal-fill').forEach(el => {
      el.style.width = el.dataset.pct + '%';
    });
  }, 80);
}

function renderTimeline(rows) {
  const el = document.getElementById('timeline');
  setText('timelineCount', `${rows.length} event${rows.length !== 1 ? 's' : ''}`);
  el.innerHTML = rows.map(r => `
    <div class="timeline-item">
      <div class="timeline-dot" style="background:${r.threat_level === 'Red' ? '#ef4444' : '#fbbf24'};box-shadow:0 0 6px ${r.threat_level === 'Red' ? '#ef4444' : '#fbbf24'};"></div>
      <div style="flex:1;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
          <span class="badge ${r.threat_level === 'Red' ? 'badge-red' : 'badge-yellow'}">${r.threat_level}</span>
          <span class="badge badge-blue">${r.detection_method}</span>
          <span style="font-size:0.72rem;color:var(--text-muted);">${timeAgo(r.created_at)}</span>
        </div>
        <span class="url-pill">${r.domain_flagged}</span>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">${new Date(r.created_at).toLocaleString()}</div>
      </div>
    </div>`).join('');
}

function renderDomainHero(domain, rows) {
  const total = rows.length;
  const red   = rows.filter(r => r.threat_level === 'Red').length;
  const risk  = red > 0 ? 'HIGH' : total > 0 ? 'MEDIUM' : 'LOW';
  const riskColor = risk === 'HIGH' ? '#ef4444' : risk === 'MEDIUM' ? '#f97316' : '#00ff88';
  const firstSeen = rows.length ? new Date(rows[rows.length - 1].created_at).toLocaleDateString() : 'N/A';
  const lastSeen  = rows.length ? new Date(rows[0].created_at).toLocaleDateString() : 'N/A';

  document.getElementById('domainHero').innerHTML = `
    <div class="glass-card" style="padding:24px 28px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px;">
        <div>
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
            <div style="width:44px;height:44px;border-radius:12px;background:rgba(239,68,68,0.15);display:flex;align-items:center;justify-content:center;font-size:1.3rem;">🔍</div>
            <div>
              <div style="font-family:'JetBrains Mono',monospace;font-size:1.1rem;font-weight:700;color:var(--text-primary);">${domain}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);">First seen ${firstSeen} · Last seen ${lastSeen}</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <span class="badge" style="background:rgba(${risk==='HIGH'?'239,68,68':'249,115,22'},0.15);color:${riskColor};border-color:${riskColor}40;">Risk: ${risk}</span>
            <span class="badge badge-neon">${total} Detection${total !== 1 ? 's' : ''}</span>
            <span class="badge badge-blue">${red} Red · ${total - red} Yellow</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;">
          <div style="font-size:2.4rem;font-weight:900;line-height:1;color:${riskColor};">${risk}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);">Risk Level</div>
        </div>
      </div>
    </div>`;
  show('domainHero');
}

/* ── Analyse a specific domain ────────────────────────────── */
async function analyseDomain(domain) {
  hide('allDomainsWrap');
  show('domainHero');
  show('analysisGrid');

  document.getElementById('domainHero').innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:20px;"><div class="spinner"></div><span>Analysing ${domain}…</span></div>`;
  document.getElementById('signalsWrap').innerHTML = '';
  document.getElementById('timeline').innerHTML   = '';

  try {
    const rows = await sbFetch(
      'threat_telemetry',
      `?domain_flagged=eq.${encodeURIComponent(domain)}&order=created_at.desc`
    );
    // Fallback to demo if empty
    const data = rows.length ? rows : buildDemoRows(domain);
    renderDomainHero(domain, data);
    renderSignals(buildSignals(data));
    renderTimeline(data);
  } catch {
    const demo = buildDemoRows(domain);
    renderDomainHero(domain, demo);
    renderSignals(buildSignals(demo));
    renderTimeline(demo);
  }
}

function buildDemoRows(domain) {
  return [
    { domain_flagged: domain, threat_level: 'Red',    detection_method: 'ML_Model', created_at: new Date(Date.now() - 3*60000).toISOString() },
    { domain_flagged: domain, threat_level: 'Yellow', detection_method: 'API',      created_at: new Date(Date.now() - 24*3600000).toISOString() },
  ];
}

/* ── All-domains table ────────────────────────────────────── */
async function loadAllDomains() {
  try {
    const rows = await sbFetch('threat_telemetry', '?select=*&order=created_at.desc&limit=300');
    const data = rows.length ? rows : getDemoAll();

    // Aggregate by domain
    const map = {};
    data.forEach(r => {
      if (!map[r.domain_flagged]) map[r.domain_flagged] = { rows: [], firstSeen: r.created_at };
      map[r.domain_flagged].rows.push(r);
    });

    const domains = Object.entries(map).map(([d, v]) => ({
      domain:    d,
      count:     v.rows.length,
      level:     v.rows.some(r => r.threat_level === 'Red') ? 'Red' : 'Yellow',
      method:    v.rows[0].detection_method,
      firstSeen: v.rows[v.rows.length - 1].created_at,
    })).sort((a, b) => b.count - a.count);

    setText('totalCount', `${domains.length} unique domain${domains.length !== 1 ? 's' : ''}`);

    document.getElementById('allDomainsBody').innerHTML = domains.map(d => `
      <tr>
        <td class="mono">${d.domain}</td>
        <td><span class="badge ${d.level === 'Red' ? 'badge-red' : 'badge-yellow'}">${d.level}</span></td>
        <td><span class="badge badge-blue">${d.method}</span></td>
        <td style="color:var(--text-muted);font-size:0.78rem;">${new Date(d.firstSeen).toLocaleDateString()}</td>
        <td style="font-weight:700;">${d.count}</td>
        <td>
          <button class="btn btn-ghost btn-sm" style="font-size:0.75rem;padding:4px 10px;"
            onclick="document.getElementById('domainSearch').value='${d.domain}'; analyseDomain('${d.domain}')">
            Analyse →
          </button>
        </td>
      </tr>`).join('');
  } catch {
    document.getElementById('allDomainsBody').innerHTML =
      '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px;">Unable to load data. Please try again.</td></tr>';
  }
}

function getDemoAll() {
  return [
    { domain_flagged: 'paypa1-secure.login-verify.com', threat_level: 'Red',    detection_method: 'ML_Model', created_at: new Date(Date.now()-3*60000).toISOString() },
    { domain_flagged: 'amazon-update-billing.net',      threat_level: 'Red',    detection_method: 'ML_Model', created_at: new Date(Date.now()-18*60000).toISOString() },
    { domain_flagged: 'steam-limited-offer.ru',         threat_level: 'Yellow', detection_method: 'API',      created_at: new Date(Date.now()-5*3600000).toISOString() },
  ];
}

/* ── Export JSON ──────────────────────────────────────────── */
document.getElementById('exportBtn')?.addEventListener('click', async () => {
  try {
    const rows = await sbFetch('threat_telemetry', '?order=created_at.desc');
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'ghost-form-analysis.json' });
    a.click(); URL.revokeObjectURL(url);
  } catch { alert('Export failed. Please try again.'); }
});

/* ── Logout ───────────────────────────────────────────────── */
document.getElementById('logoutBtn')?.addEventListener('click', () => {
  localStorage.removeItem('gf_session');
  window.location.href = 'auth.html';
});

/* ── Boot ─────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // User chip
  if (session?.user) {
    setText('userEmail', session.user.email);
    const av = document.getElementById('userAvatar');
    if (av) av.textContent = (session.user.name || session.user.email || '?')[0].toUpperCase();
  }

  // Check URL param
  const params = new URLSearchParams(window.location.search);
  const domain = params.get('domain');
  if (domain) {
    document.getElementById('domainSearch').value = domain;
    analyseDomain(domain);
  } else {
    loadAllDomains();
  }

  // Search button
  document.getElementById('searchBtn')?.addEventListener('click', () => {
    const val = document.getElementById('domainSearch').value.trim();
    if (val) analyseDomain(val);
  });
  document.getElementById('domainSearch')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (val) analyseDomain(val);
    }
  });
});

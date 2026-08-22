/**
 * dashboard.js — Ghost Form Dashboard Logic
 * Handles auth guard, Supabase data fetching, and canvas chart rendering
 */

const SUPABASE_URL      = 'https://czoleruusckauzjcmmml.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tNpP7lz1K5T5NtgnT0OqAw_THzXSU28';

/* ── Session helper ───────────────────────────────────────── */
function getSession() {
  try {
    const raw = localStorage.getItem('gf_session');
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() > data.expires_at) {
      localStorage.removeItem('gf_session');
      return null;
    }
    return data;
  } catch { return null; }
}

/* ── Auth guard ───────────────────────────────────────────── */
const session = getSession();
if (!session) {
  window.location.href = 'auth.html';
  throw new Error('Redirecting to auth — halt execution');
}

/* ── Supabase REST fetch ──────────────────────────────────── */
async function sbFetch(path, params = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}${params}`, {
    headers: {
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type':  'application/json',
    }
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  return res.json();
}

/* ── Format relative time ─────────────────────────────────── */
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatDomain(d) {
  return d.length > 32 ? d.slice(0, 30) + '…' : d;
}

/* ── Render metrics ───────────────────────────────────────── */
function renderMetrics(rows) {
  const total  = rows.length;
  const red    = rows.filter(r => r.threat_level === 'Red').length;
  const yellow = rows.filter(r => r.threat_level === 'Yellow').length;
  const ml     = rows.filter(r => r.detection_method === 'ML_Model').length;

  setText('mTotalBlocked', total);
  setText('mHighRisk',     red);
  setText('mMedRisk',      yellow);
  setText('mMLDetect',     ml);

  const today = rows.filter(r => {
    const d = new Date(r.created_at);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length;
  setText('mBlockedSub', `${today} detected today`);
  setText('mHighSub', red > 0 ? `${Math.round(red/total*100)}% of all threats` : 'None detected');
  setText('mMedSub', yellow > 0 ? `${Math.round(yellow/total*100)}% of all threats` : 'None detected');
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/* ── Render safety score gauge ────────────────────────────── */
function renderGauge(rows) {
  const total = rows.length;
  let score = 100;
  if (total > 0) {
    const red    = rows.filter(r => r.threat_level === 'Red').length;
    const yellow = rows.filter(r => r.threat_level === 'Yellow').length;
    // Penalise: red = -3pt, yellow = -1pt, max penalty 70
    score = Math.max(30, 100 - (red * 3) - yellow);
  }

  const ring  = document.getElementById('gaugeRing');
  const num   = document.getElementById('gaugeNum');
  const label = document.getElementById('gaugeLabel');
  const circumference = 326;
  const offset = circumference - (circumference * score / 100);

  num.textContent = score;
  ring.style.strokeDashoffset = offset;

  if (score >= 80) {
    ring.className = 'ring-val neon';
    num.style.color = '#00ff88';
    label.textContent = '✅ Excellent — Your browsing is highly secure';
  } else if (score >= 55) {
    ring.className = 'ring-val orange';
    num.style.color = '#f97316';
    label.textContent = '⚠️ Fair — Some threats detected, review recommended';
  } else {
    ring.className = 'ring-val red';
    num.style.color = '#ef4444';
    label.textContent = '🔴 At Risk — High threat activity detected';
  }
}

/* ── Render trend sparkline ───────────────────────────────── */
function renderTrendChart(rows) {
  const canvas = document.getElementById('trendChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 400;
  const H = 140;
  canvas.width  = W;
  canvas.height = H;

  // Build last-7-days buckets
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ label: d.toLocaleDateString('en', { weekday: 'short' }), date: d.toDateString(), count: 0 });
  }
  rows.forEach(r => {
    const ds = new Date(r.created_at).toDateString();
    const bucket = days.find(d => d.date === ds);
    if (bucket) bucket.count++;
  });

  const counts = days.map(d => d.count);
  const labels = days.map(d => d.label);
  const maxVal = Math.max(...counts, 1);

  const pad = { top: 16, right: 16, bottom: 28, left: 32 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;
  const stepX = cW / (counts.length - 1);

  // Clear
  ctx.clearRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (cH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
  }

  // Area fill
  const pts = counts.map((v, i) => ({
    x: pad.left + i * stepX,
    y: pad.top + cH - (v / maxVal) * cH
  }));
  const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
  grad.addColorStop(0, 'rgba(0,255,136,0.25)');
  grad.addColorStop(1, 'rgba(0,255,136,0.0)');
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  pts.forEach((p, i) => { if (i > 0) ctx.lineTo(p.x, p.y); });
  ctx.lineTo(pts[pts.length - 1].x, H - pad.bottom);
  ctx.lineTo(pts[0].x, H - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  pts.forEach((p, i) => { i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); });
  ctx.strokeStyle = '#00ff88';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Dots
  pts.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle   = '#080c14';
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth   = 2;
    ctx.fill();
    ctx.stroke();
  });

  // X labels
  ctx.fillStyle = 'rgba(148,163,184,0.7)';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'center';
  labels.forEach((l, i) => {
    ctx.fillText(l, pts[i].x, H - 6);
  });
}

/* ── Render donut chart ───────────────────────────────────── */
function renderDonut(rows) {
  const canvas = document.getElementById('donutChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 160, H = 160;
  canvas.width = W; canvas.height = H;

  const ml  = rows.filter(r => r.detection_method === 'ML_Model').length;
  const api = rows.filter(r => r.detection_method === 'API').length;
  const total = ml + api || 1;

  const slices = [
    { label: 'ML Model', value: ml,  color: '#00ff88' },
    { label: 'API Check', value: api, color: '#7c3aed' },
  ];

  let startAngle = -Math.PI / 2;
  slices.forEach(s => {
    const angle = (s.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(W/2, H/2);
    ctx.arc(W/2, H/2, 65, startAngle, startAngle + angle);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    startAngle += angle;
  });

  // Hole
  ctx.beginPath();
  ctx.arc(W/2, H/2, 40, 0, Math.PI * 2);
  ctx.fillStyle = '#111827';
  ctx.fill();

  // Center text
  ctx.fillStyle = '#f1f5f9';
  ctx.font = 'bold 16px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(total, W/2, H/2 - 7);
  ctx.font = '10px Inter, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('total', W/2, H/2 + 9);

  // Legend
  const legend = document.getElementById('donutLegend');
  legend.innerHTML = slices.map(s => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:0.8rem;">
      <div style="display:flex;align-items:center;gap:7px;">
        <span style="width:10px;height:10px;border-radius:2px;background:${s.color};display:inline-block;flex-shrink:0;"></span>
        <span style="color:var(--text-secondary);">${s.label}</span>
      </div>
      <span style="font-weight:600;color:var(--text-primary);">${s.value} <span style="color:var(--text-muted);font-weight:400;">(${Math.round(s.value/total*100)}%)</span></span>
    </div>
  `).join('');
}

/* ── Render live threat feed ──────────────────────────────── */
function renderFeed(rows) {
  const feed = document.getElementById('threatFeed');
  if (!rows.length) {
    feed.innerHTML = `<div class="empty-state" style="padding:28px;">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2L4 6v6c0 5.25 3.5 10.15 8 11.5C16.5 22.15 20 17.25 20 12V6L12 2z"/></svg>
      <h3>No threats detected</h3><p>All clear — keep browsing safely!</p></div>`;
    return;
  }
  const recent = rows.slice(0, 12);
  feed.innerHTML = `<div class="feed-list" style="padding:4px 16px 8px;">
    ${recent.map(r => `
      <div class="feed-item">
        <span class="feed-dot ${r.threat_level === 'Red' ? 'red' : 'yellow'}"></span>
        <span class="feed-domain">${formatDomain(r.domain_flagged)}</span>
        <span class="badge ${r.threat_level === 'Red' ? 'badge-red' : 'badge-yellow'}" style="font-size:0.65rem;">${r.threat_level}</span>
        <span class="feed-time">${timeAgo(r.created_at)}</span>
      </div>`).join('')}
  </div>`;
}

/* ── Render domains table ─────────────────────────────────── */
function renderDomainsTable(rows) {
  const tbody = document.getElementById('domainsBody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state" style="padding:28px;"><h3>No flagged domains</h3><p>Ghost Form has not detected any threats yet.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.slice(0, 15).map(r => `
    <tr>
      <td class="mono">${r.domain_flagged}</td>
      <td><span class="badge ${r.threat_level === 'Red' ? 'badge-red' : 'badge-yellow'}">${r.threat_level}</span></td>
      <td><span class="badge badge-blue">${r.detection_method}</span></td>
      <td style="color:var(--text-muted);font-size:0.78rem;">${new Date(r.created_at).toLocaleString()}</td>
      <td>
        <a href="analysis.html?domain=${encodeURIComponent(r.domain_flagged)}" class="btn btn-ghost btn-sm" style="font-size:0.75rem;padding:4px 10px;">Analyse →</a>
      </td>
    </tr>`).join('');
}

/* ── Render optimize tips ─────────────────────────────────── */
function renderOptimizeTips(rows) {
  const red    = rows.filter(r => r.threat_level === 'Red').length;
  const total  = rows.length;
  const ml     = rows.filter(r => r.detection_method === 'ML_Model').length;

  const tips = [
    {
      active: red > 0,
      title:  'Review high-risk domains',
      desc:   `You have ${red} Red-level threat${red !== 1 ? 's' : ''} flagged. Open the Analysis page for a detailed breakdown and consider avoiding those sites.`,
      icon:   '🔴'
    },
    {
      active: total > 5,
      title:  'Submit phishing reports',
      desc:   'Help protect the community by submitting manual phishing reports on domains flagged by Ghost Form. Go to Reports → New Report.',
      icon:   '📋'
    },
    {
      active: ml < total * 0.5,
      title:  'Enable on-device ML model',
      desc:   'More than half of detections are coming from the API fallback. Ensure the ML model is loaded (check the extension popup).',
      icon:   '🧠'
    },
    {
      active: true,
      title:  'Add trusted domains to whitelist',
      desc:   'Reduce false positives by adding your internal tools to the trusted domains list in Extension Settings.',
      icon:   '✅'
    },
    {
      active: true,
      title:  'Keep the extension updated',
      desc:   'New phishing patterns are added regularly. Ensure Chrome auto-updates are enabled so Ghost Form always has the latest model.',
      icon:   '⚡'
    },
  ];

  const el = document.getElementById('optimizeTips');
  let n = 1;
  el.innerHTML = tips
    .filter(t => t.active)
    .slice(0, 5)
    .map(t => `
      <div class="tip-card">
        <div class="tip-num">${n++}</div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
            <span>${t.icon}</span>
            <h4 style="font-size:0.88rem;font-weight:600;">${t.title}</h4>
          </div>
          <p style="font-size:0.8rem;color:var(--text-secondary);line-height:1.55;">${t.desc}</p>
        </div>
      </div>`).join('');
}

/* ── Render user info ─────────────────────────────────────── */
function renderUser() {
  const emailEl  = document.getElementById('userEmail');
  const avatarEl = document.getElementById('userAvatar');
  const greetEl  = document.getElementById('headerGreeting');

  if (session?.user) {
    const { email, name } = session.user;
    if (emailEl)  emailEl.textContent  = email;
    if (avatarEl) avatarEl.textContent = (name || email || '?')[0].toUpperCase();
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    if (greetEl)  greetEl.textContent  = `${greet}, ${name || email.split('@')[0]} — here's your security overview`;
  }
}

/* ── Load all data ────────────────────────────────────────── */
async function loadDashboard() {
  try {
    const rows = await sbFetch(
      'threat_telemetry',
      '?select=*&order=created_at.desc&limit=200'
    );
    renderMetrics(rows);
    renderGauge(rows);
    renderFeed(rows);
    renderDomainsTable(rows);
    renderOptimizeTips(rows);
    renderDonut(rows);
    setTimeout(() => renderTrendChart(rows), 50); // after layout
  } catch (err) {
    console.error('[GhostForm Dashboard]', err);
    // Render demo data if Supabase fetch fails (e.g. no internet)
    renderDemoData();
  }
}

/* ── Demo fallback data ───────────────────────────────────── */
function renderDemoData() {
  const demo = [
    { domain_flagged: 'paypa1-secure.login-verify.com', threat_level: 'Red',    detection_method: 'ML_Model', created_at: new Date(Date.now() - 3*60000).toISOString() },
    { domain_flagged: 'amazon-update-billing.net',      threat_level: 'Red',    detection_method: 'ML_Model', created_at: new Date(Date.now() - 18*60000).toISOString() },
    { domain_flagged: 'netfl1x-account-verify.co',     threat_level: 'Red',    detection_method: 'API',      created_at: new Date(Date.now() - 2*3600000).toISOString() },
    { domain_flagged: 'steam-limited-offer.ru',         threat_level: 'Yellow', detection_method: 'ML_Model', created_at: new Date(Date.now() - 5*3600000).toISOString() },
    { domain_flagged: 'google-security-alert.info',     threat_level: 'Yellow', detection_method: 'ML_Model', created_at: new Date(Date.now() - 24*3600000).toISOString() },
    { domain_flagged: 'microsoft-password-reset.xyz',   threat_level: 'Red',    detection_method: 'API',      created_at: new Date(Date.now() - 2*24*3600000).toISOString() },
  ];
  renderMetrics(demo);
  renderGauge(demo);
  renderFeed(demo);
  renderDomainsTable(demo);
  renderOptimizeTips(demo);
  renderDonut(demo);
  setTimeout(() => renderTrendChart(demo), 50);
}

/* ── Logout ───────────────────────────────────────────────── */
document.getElementById('logoutBtn')?.addEventListener('click', () => {
  localStorage.removeItem('gf_session');
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.remove('gf_session');
  }
  window.location.href = 'auth.html';
});

/* ── Refresh button ───────────────────────────────────────── */
document.getElementById('refreshBtn')?.addEventListener('click', () => {
  loadDashboard();
});

/* ── Boot ─────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  renderUser();
  loadDashboard();
});

// Redraw charts on resize
window.addEventListener('resize', () => {
  const session2 = getSession();
  if (session2) loadDashboard();
});

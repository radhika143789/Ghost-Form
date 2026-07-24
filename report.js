/**
 * report.js — Ghost Form Reports Page
 * Handles listing, filtering, pagination and submitting threat reports
 */

const SUPABASE_URL      = 'https://czoleruusckauzjcmmml.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tNpP7lz1K5T5NtgnT0OqAw_THzXSU28';

/* ── Auth guard ───────────────────────────────────────────── */
function getSession() {
  try {
    const raw = localStorage.getItem('gf_session');
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (Date.now() > d.expires_at) { localStorage.removeItem('gf_session'); return null; }
    return d;
  } catch { return null; }
}
const session = getSession();
if (!session) window.location.href = 'auth.html';

/* ── Local threats storage helpers ────────────────────────── */
async function getLocalThreats() {
  return new Promise(resolve => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ localThreats: [] }, (data) => {
        resolve(data.localThreats || []);
      });
    } else {
      resolve([]);
    }
  });
}

async function saveLocalThreat(domain, level, method) {
  const localRows = await getLocalThreats();
  // Check if duplicate in the last 5 minutes to avoid spamming
  const exists = localRows.some(t => t.domain_flagged === domain && t.threat_level === level && (Date.now() - new Date(t.created_at).getTime() < 300000));
  if (exists) return;

  const newThreat = {
    id: 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    domain_flagged: domain,
    threat_level: level,
    detection_method: method,
    created_at: new Date().toISOString()
  };
  
  localRows.unshift(newThreat);
  if (localRows.length > 100) localRows.pop();
  return new Promise(resolve => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ localThreats: localRows }, () => resolve());
    } else {
      resolve();
    }
  });
}

/* ── Helpers ──────────────────────────────────────────────── */
function $(id) { return document.getElementById(id); }
function setText(id, v) { const el = $(id); if (el) el.textContent = v; }

function showAlert(msg, type = 'error') {
  const el = $('reportAlert');
  el.textContent = msg;
  el.className = `alert alert-${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

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

async function sbInsert(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Insert failed (${res.status})`);
  }
}

/* ── State ────────────────────────────────────────────────── */
let allRows    = [];
let filtered   = [];
let activeFilter = 'all';
let page       = 0;
const PAGE_SIZE = 15;

/* ── Stats ────────────────────────────────────────────────── */
function renderStats(rows) {
  const today = new Date().toDateString();
  setText('statTotal',  rows.length);
  setText('statRed',    rows.filter(r => r.threat_level === 'Red').length);
  setText('statYellow', rows.filter(r => r.threat_level === 'Yellow').length);
  setText('statToday',  rows.filter(r => new Date(r.created_at).toDateString() === today).length);
}

/* ── Apply filter ─────────────────────────────────────────── */
function applyFilter(f) {
  activeFilter = f;
  page = 0;
  if (f === 'all') {
    filtered = [...allRows];
  } else if (f === 'Red' || f === 'Yellow') {
    filtered = allRows.filter(r => r.threat_level === f);
  } else {
    filtered = allRows.filter(r => r.detection_method === f);
  }
  setText('reportCountBadge', `${filtered.length} report${filtered.length !== 1 ? 's' : ''}`);
  renderTable();
}

/* ── Render table page ────────────────────────────────────── */
function renderTable() {
  const tbody   = $('reportsBody');
  const start   = page * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  if (!pageRows.length) {
    tbody.innerHTML = `<tr><td colspan="6">
      <div class="empty-state" style="padding:32px;">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
        <h3>No reports found</h3><p>Try a different filter or submit a new report.</p>
      </div></td></tr>`;
    $('prevPageBtn').disabled = true;
    $('nextPageBtn').disabled = true;
    setText('pageInfo', 'No results');
    return;
  }

  tbody.innerHTML = pageRows.map((r, i) => `
    <tr class="fade-in">
      <td style="color:var(--text-muted);font-size:0.78rem;">${start + i + 1}</td>
      <td class="mono">${r.domain_flagged}</td>
      <td><span class="badge ${r.threat_level === 'Red' ? 'badge-red' : 'badge-yellow'}">${r.threat_level}</span></td>
      <td><span class="badge badge-blue">${r.detection_method}</span></td>
      <td>
        <div style="font-size:0.82rem;">${new Date(r.created_at).toLocaleDateString()}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);">${timeAgo(r.created_at)}</div>
      </td>
      <td>
        <a href="analysis.html?domain=${encodeURIComponent(r.domain_flagged)}"
           class="btn btn-ghost btn-sm" style="font-size:0.74rem;padding:4px 10px;">Analyse →</a>
      </td>
    </tr>`).join('');

  setText('pageInfo', `Page ${page + 1} of ${totalPages} · ${filtered.length} total`);
  $('prevPageBtn').disabled = page === 0;
  $('nextPageBtn').disabled = page >= totalPages - 1;
}

/* ── Load data ────────────────────────────────────────────── */
async function loadReports() {
  let dbRows = [];
  try {
    dbRows = await sbFetch('threat_telemetry', '?select=*&order=created_at.desc');
  } catch (err) {
    console.warn('Failed to fetch from Supabase, falling back to local/demo data:', err);
  }

  const localRows = await getLocalThreats();

  // Merge lists, using domain and timestamp to avoid duplicates.
  const merged = [...localRows];
  dbRows.forEach(dbRow => {
    const exists = merged.some(r => r.domain_flagged === dbRow.domain_flagged && Math.abs(new Date(r.created_at).getTime() - new Date(dbRow.created_at).getTime()) < 60000);
    if (!exists) {
      merged.push(dbRow);
    }
  });

  // Sort by created_at desc
  merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  allRows = merged.length ? merged : getDemoRows();
  renderStats(allRows);
  applyFilter('all');
}

function getDemoRows() {
  return [
    { id:'1', domain_flagged:'paypa1-secure.login-verify.com', threat_level:'Red',    detection_method:'ML_Model', created_at:new Date(Date.now()-3*60000).toISOString() },
    { id:'2', domain_flagged:'amazon-update-billing.net',      threat_level:'Red',    detection_method:'ML_Model', created_at:new Date(Date.now()-18*60000).toISOString() },
    { id:'3', domain_flagged:'netfl1x-account-verify.co',      threat_level:'Red',    detection_method:'API',      created_at:new Date(Date.now()-2*3600000).toISOString() },
    { id:'4', domain_flagged:'steam-limited-offer.ru',         threat_level:'Yellow', detection_method:'ML_Model', created_at:new Date(Date.now()-5*3600000).toISOString() },
    { id:'5', domain_flagged:'google-security-alert.info',     threat_level:'Yellow', detection_method:'ML_Model', created_at:new Date(Date.now()-24*3600000).toISOString() },
    { id:'6', domain_flagged:'microsoft-password-reset.xyz',   threat_level:'Red',    detection_method:'API',      created_at:new Date(Date.now()-2*24*3600000).toISOString() },
  ];
}

/* ── Submit report form ───────────────────────────────────── */
$('reportForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  $('reportAlert').classList.add('hidden');

  const domain = $('reportDomain').value.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const level  = $('reportLevel').value;
  const method = $('reportMethod').value;

  if (!domain) return showAlert('Please enter a domain name.');
  if (!level)  return showAlert('Please select a threat level.');

  // Validate domain format
  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-\.]*[a-zA-Z0-9]$/.test(domain)) {
    return showAlert('Invalid domain format. Use e.g. phish-site.xyz (no http://)');
  }

  $('submitReportBtn').disabled = true;
  $('submitBtnText').textContent = 'Submitting…';
  $('submitSpinner').classList.remove('hidden');

  try {
    await sbInsert('threat_telemetry', {
      domain_flagged:   domain,
      threat_level:     level,
      detection_method: method,
    });
    await saveLocalThreat(domain, level, method);
    showAlert('✅ Report submitted successfully! Thank you for keeping the community safe.', 'success');
    $('reportForm').reset();
    await loadReports(); // refresh list
  } catch (err) {
    // Use a demo success if DB constraint fails (e.g. demo env)
    await saveLocalThreat(domain, level, method);
    showAlert('✅ Report logged locally.', 'success');
    $('reportForm').reset();
    await loadReports();
  } finally {
    $('submitReportBtn').disabled = false;
    $('submitBtnText').textContent = 'Submit Report';
    $('submitSpinner').classList.add('hidden');
  }
});

/* ── Form toggle ──────────────────────────────────────────── */
$('toggleFormBtn')?.addEventListener('click', () => {
  const wrap = $('reportFormWrap');
  wrap.classList.toggle('hidden');
  if (!wrap.classList.contains('hidden')) {
    $('reportDomain').focus();
  }
});
$('cancelFormBtn')?.addEventListener('click', () => {
  $('reportFormWrap').classList.add('hidden');
  $('reportForm').reset();
});

/* ── Filter chips ─────────────────────────────────────────── */
document.querySelectorAll('.filter-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyFilter(btn.dataset.filter);
  });
});

/* ── Pagination ───────────────────────────────────────────── */
$('prevPageBtn')?.addEventListener('click', () => { if (page > 0) { page--; renderTable(); } });
$('nextPageBtn')?.addEventListener('click', () => {
  if ((page + 1) * PAGE_SIZE < filtered.length) { page++; renderTable(); }
});

/* ── Logout ───────────────────────────────────────────────── */
$('logoutBtn')?.addEventListener('click', () => {
  localStorage.removeItem('gf_session');
  window.location.href = 'auth.html';
});

/* ── Boot ─────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  if (session?.user) {
    setText('userEmail', session.user.email);
    const av = $('userAvatar');
    if (av) av.textContent = (session.user.name || session.user.email || '?')[0].toUpperCase();
  }
  loadReports();

  // Check if a domain parameter is passed to auto-open and prepopulate form
  const params = new URLSearchParams(window.location.search);
  const prepopulateDomain = params.get('domain');
  if (prepopulateDomain) {
    const domainInput = $('reportDomain');
    if (domainInput) domainInput.value = prepopulateDomain;
    const wrap = $('reportFormWrap');
    if (wrap) wrap.classList.remove('hidden');
  }
});

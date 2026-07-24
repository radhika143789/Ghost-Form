import { getStatusMeta } from './src/popup_ui_state.js';

/* ── Session helper (mirrors auth.js) ───────────────────── */
function getPopupSession() {
  return new Promise(resolve => {
    // Try chrome.storage first (extension context)
    chrome.storage.local.get(['gf_session'], result => {
      const s = result?.gf_session;
      if (s && Date.now() < s.expires_at) { resolve(s); return; }
      resolve(null);
    });
  });
}

function openExtensionPage(page) {
  chrome.tabs.create({ url: chrome.runtime.getURL(page) });
}

/* ── SVG Icon helpers ─────────────────────────────────── */

const ICONS = {
  safe: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#00ff88" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2L4 6v6c0 5.25 3.5 10.15 8 11.5C16.5 22.15 20 17.25 20 12V6L12 2z" stroke="#00ff88" fill="rgba(0,255,136,0.1)"/>
    <polyline points="9 12 11 14 15 10"/>
  </svg>`,

  unsafe: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2L4 6v6c0 5.25 3.5 10.15 8 11.5C16.5 22.15 20 17.25 20 12V6L12 2z" stroke="#ef4444" fill="rgba(239,68,68,0.1)"/>
    <line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="16" r="0.5" fill="#ef4444"/>
  </svg>`,

  unknown: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2L4 6v6c0 5.25 3.5 10.15 8 11.5C16.5 22.15 20 17.25 20 12V6L12 2z" stroke="#fbbf24" fill="rgba(251,191,36,0.08)"/>
    <path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="#fbbf24"/>
  </svg>`,

  scanning: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>`,
};

/* ── Popup Logic ──────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async () => {
  const toggleInput  = document.getElementById('protectionToggle');
  const toggleText   = document.getElementById('toggleText');
  const toggleDot    = document.getElementById('toggleDot');

  /* ── Auth-aware UI ────────────────────────────────── */
  const session = await getPopupSession();
  const userStrip   = document.getElementById('userStrip');
  const loginPrompt = document.getElementById('loginPrompt');

  if (session?.user) {
    // Logged in: show user strip
    userStrip.style.display = 'flex';
    const emailEl = document.getElementById('popupUserEmail');
    if (emailEl) emailEl.textContent = session.user.email;

    document.getElementById('btnDashboard')?.addEventListener('click', () => {
      openExtensionPage('dashboard.html');
    });
    document.getElementById('btnLogout')?.addEventListener('click', () => {
      chrome.storage.local.remove('gf_session', () => {
        userStrip.style.display = 'none';
        if (loginPrompt) loginPrompt.style.display = 'flex';
      });
    });
  } else {
    // Not logged in: show sign-in prompt
    if (loginPrompt) loginPrompt.style.display = 'flex';

    document.getElementById('btnOpenAuth')?.addEventListener('click', () => {
      openExtensionPage('auth.html');
    });
    document.getElementById('btnSkipAuth')?.addEventListener('click', () => {
      if (loginPrompt) loginPrompt.style.display = 'none';
    });
  }

  // --- Protection toggle ---
  chrome.storage.local.get(['protectionEnabled'], (data) => {
    const enabled = data.protectionEnabled !== false; // default ON
    applyToggleState(enabled);
    toggleInput.checked = enabled;
  });

  toggleInput.addEventListener('change', () => {
    const enabled = toggleInput.checked;
    chrome.storage.local.set({ protectionEnabled: enabled });
    applyToggleState(enabled);
  });

  function applyToggleState(enabled) {
    toggleText.textContent = enabled ? 'Protection Active' : 'Protection Paused';
    if (enabled) {
      toggleDot.classList.remove('inactive');
      document.body.classList.remove('protection-off');
    } else {
      toggleDot.classList.add('inactive');
      document.body.classList.add('protection-off');
    }
  }

  // --- Query active tab ---
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    const domainEl  = document.getElementById('currentDomain');

    if (!activeTab || !activeTab.url) {
      domainEl.textContent = 'N/A';
      updateUI('unknown', 0);
      return;
    }

    try {
      const url = new URL(activeTab.url);

      // Internal pages — always safe
      if (['chrome:', 'chrome-extension:', 'about:'].includes(url.protocol)) {
        domainEl.textContent = url.hostname || activeTab.url;
        updateUI('safe', 0);
        return;
      }

      domainEl.textContent = url.hostname || activeTab.url;

      // Ask background for status
      chrome.runtime.sendMessage(
        { action: 'checkStatus', url: activeTab.url },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[GhostForm Popup] Service worker not ready:', chrome.runtime.lastError.message);
            updateUI('unknown', 0);
            return;
          }
          const status   = response?.status ?? 'unknown';
          const trackers = response?.trackersBlocked ?? 0;
          const forms    = response?.formsWatched    ?? 0;
          updateUI(status, trackers, forms);
        }
      );
    } catch (e) {
      domainEl.textContent = activeTab.url;
      updateUI('unknown', 0);
    }
  });

  // --- Footer buttons ---
  document.getElementById('btnSettings')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage?.();
  });

  document.getElementById('btnReport')?.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const urlString = tabs[0]?.url;
      if (urlString) {
        try {
          const domain = new URL(urlString).hostname;
          openExtensionPage(`report.html?domain=${encodeURIComponent(domain)}`);
        } catch {
          openExtensionPage('report.html');
        }
      } else {
        openExtensionPage('report.html');
      }
    });
  });

  document.getElementById('btnReportsPage')?.addEventListener('click', () => {
    openExtensionPage('report.html');
  });
});

/* ── updateUI ─────────────────────────────────────────── */
function updateUI(status, trackersBlocked = 0, formsWatched = 0) {
  const card            = document.getElementById('statusCard');
  const title           = document.getElementById('statusTitle');
  const desc            = document.getElementById('statusDesc');
  const iconWrap        = document.getElementById('statusIconWrap');
  const insight         = document.getElementById('statusInsight');
  const statusPill      = document.getElementById('statusPill');
  const metaLocal       = document.getElementById('statusMetaLocal');
  const metaPrivacy     = document.getElementById('statusMetaPrivacy');
  const statTrackers    = document.getElementById('statTrackers');
  const statForms       = document.getElementById('statForms');
  const statRisk        = document.getElementById('statRisk');
  const meta = getStatusMeta(status, trackersBlocked, formsWatched);

  card.className = 'status-card';
  card.classList.add(meta.stateClass);

  title.textContent = meta.title;
  desc.textContent  = meta.desc;
  insight.textContent = meta.insight;
  statusPill.textContent = meta.pill;
  metaLocal.textContent = meta.metaLocal;
  metaPrivacy.textContent = meta.metaPrivacy;
  iconWrap.innerHTML = ICONS[meta.icon] || ICONS.unknown;
  setStats(statTrackers, statForms, statRisk, trackersBlocked, formsWatched, meta.statRisk, meta.riskClass);
}

function setStats(trackerEl, formsEl, riskEl, trackers, forms, riskText, riskClass) {
  trackerEl.textContent = trackers;
  formsEl.textContent   = forms;
  riskEl.textContent    = riskText;
  riskEl.className      = `stat-value risk-label ${riskClass}`;
}

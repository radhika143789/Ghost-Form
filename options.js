document.addEventListener('DOMContentLoaded', () => {
  const domainInput = document.getElementById('domainInput');
  const addBtn = document.getElementById('addBtn');
  const whitelistEl = document.getElementById('whitelist');

  // Inline error/message display element (replaces alert())
  const statusMsg = document.getElementById('statusMsg');

  function showStatus(text, isError = false) {
    statusMsg.textContent = text;
    statusMsg.className = 'status-msg ' + (isError ? 'error' : 'success');
    clearTimeout(statusMsg._timer);
    statusMsg._timer = setTimeout(() => {
      statusMsg.className = 'status-msg';
    }, 3000);
  }

  // Medium #16: Validate that input is a proper hostname.
  function isValidHostname(hostname) {
    if (hostname === 'localhost') return true;
    if (/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]?$/.test(hostname)) return true;
    return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,}$/.test(hostname);
  }

  loadWhitelist();

  addBtn.addEventListener('click', () => {
    const raw = domainInput.value.trim().toLowerCase();
    if (raw) addDomain(raw);
  });

  domainInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const raw = domainInput.value.trim().toLowerCase();
      if (raw) addDomain(raw);
    }
  });

  function loadWhitelist() {
    chrome.storage.local.get({ userWhitelist: [] }, (result) => {
      renderList(result.userWhitelist);
    });
  }

  function addDomain(domain) {
    domain = domain.replace(/^https?:\/\//i, '').split('/')[0];
    if (!isValidHostname(domain)) {
      showStatus(`"${domain}" is not a valid hostname. Example: google.com`, true);
      return;
    }
    chrome.storage.local.get({ userWhitelist: [] }, (result) => {
      const list = result.userWhitelist;
      if (!list.includes(domain)) {
        list.push(domain);
        chrome.storage.local.set({ userWhitelist: list }, () => {
          domainInput.value = '';
          renderList(list);
          showStatus(`✓ "${domain}" added to whitelist.`);
        });
      } else {
        showStatus(`"${domain}" is already whitelisted.`, true);
      }
    });
  }

  function removeDomain(domain) {
    chrome.storage.local.get({ userWhitelist: [] }, (result) => {
      const list = result.userWhitelist.filter(item => item !== domain);
      chrome.storage.local.set({ userWhitelist: list }, () => {
        renderList(list);
        showStatus(`"${domain}" removed.`);
      });
    });
  }

  function renderList(list) {
    const emptyState = document.getElementById('emptyState');
    whitelistEl.innerHTML = '';
    if (list.length === 0) {
      if (emptyState) emptyState.style.display = 'flex';
      return;
    }
    if (emptyState) emptyState.style.display = 'none';
    list.forEach(domain => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.className = 'domain-text';
      span.textContent = domain;
      li.appendChild(span);
      const btn = document.createElement('button');
      btn.innerHTML = '&times;';
      btn.className = 'remove-btn';
      btn.title = `Remove ${domain}`;
      btn.setAttribute('aria-label', `Remove ${domain}`);
      btn.onclick = () => removeDomain(domain);
      li.appendChild(btn);
      whitelistEl.appendChild(li);
    });
  }

  // ── Ghost Masks Pro — SimpleLogin API Key Management ────────────────────
  const slApiKeyEl  = document.getElementById('slApiKey');
  const slSaveBtn   = document.getElementById('slSaveBtn');
  const slTestBtn   = document.getElementById('slTestBtn');
  const slStatusEl  = document.getElementById('slStatusMsg');

  function showSlStatus(text, isError = false) {
    if (!slStatusEl) return;
    slStatusEl.textContent = text;
    slStatusEl.className = 'status-msg ' + (isError ? 'error' : 'success');
    clearTimeout(slStatusEl._timer);
    slStatusEl._timer = setTimeout(() => { slStatusEl.className = 'status-msg'; }, 4000);
  }

  // Load saved key on open (show masked version)
  chrome.storage.local.get({ simpleloginApiKey: '' }, ({ simpleloginApiKey }) => {
    if (slApiKeyEl && simpleloginApiKey) {
      slApiKeyEl.value = simpleloginApiKey;
      slApiKeyEl.placeholder = 'API key saved ✓';
    }
  });

  // Save API key
  if (slSaveBtn) {
    slSaveBtn.addEventListener('click', () => {
      const key = slApiKeyEl?.value?.trim() ?? '';
      chrome.storage.local.set({ simpleloginApiKey: key }, () => {
        showSlStatus(key ? '✓ SimpleLogin API key saved.' : '✓ API key cleared (using local aliases).');
      });
    });
  }

  // Test API key by pinging SimpleLogin /api/user_info
  if (slTestBtn) {
    slTestBtn.addEventListener('click', async () => {
      const key = slApiKeyEl?.value?.trim() ?? '';
      if (!key) {
        showSlStatus('Enter an API key first.', true);
        return;
      }
      slTestBtn.disabled = true;
      slTestBtn.textContent = 'Testing…';
      try {
        const res = await fetch('https://app.simplelogin.io/api/user_info', {
          headers: { 'Authentication': key },
        });
        if (res.ok) {
          const data = await res.json();
          showSlStatus(`✓ Connected as ${data.email || 'unknown'}. Key is valid!`);
        } else {
          showSlStatus('Invalid API key. Check SimpleLogin → Settings → API keys.', true);
        }
      } catch {
        showSlStatus('Network error. Check your connection.', true);
      } finally {
        slTestBtn.disabled = false;
        slTestBtn.textContent = 'Test';
      }
    });
  }
});


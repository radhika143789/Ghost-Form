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
  // Allows:
  //   - Standard multi-label domains: google.com, sub.domain.co.uk
  //   - localhost (common for dev environments)
  //   - Single-label intranet names: jenkins, gitlab, intranet
  // Rejects: full URLs (http://...), ports, spaces, glob patterns, IPs with ports.
  function isValidHostname(hostname) {
    // Special case: localhost is always valid
    if (hostname === 'localhost') return true;
    // Single-label intranet hostname (no dots, letters/digits/hyphens only, e.g. 'jenkins')
    if (/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]?$/.test(hostname)) return true;
    // Standard multi-label domain: must end with a valid TLD (2+ letters)
    return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(hostname);
  }

  // Load whitelist on open
  loadWhitelist();

  // Add domain on button click
  addBtn.addEventListener('click', () => {
    const raw = domainInput.value.trim().toLowerCase();
    if (raw) addDomain(raw);
  });

  // Add domain on Enter key press
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
    // Strip protocol prefix if user pasted a full URL
    domain = domain.replace(/^https?:\/\//i, '').split('/')[0];

    // Fix #10: Validate before adding
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
          // Fix #9: Inline success message instead of alert()
          showStatus(`✓ "${domain}" added to whitelist.`);
        });
      } else {
        // Fix #9: Inline error message instead of alert()
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
});

document.addEventListener('DOMContentLoaded', () => {
  const domainInput = document.getElementById('domainInput');
  const addBtn = document.getElementById('addBtn');
  const whitelistEl = document.getElementById('whitelist');

  // Load whitelist on open
  loadWhitelist();

  // Add domain on button click
  addBtn.addEventListener('click', () => {
    const domain = domainInput.value.trim().toLowerCase();
    if (domain) {
      addDomain(domain);
    }
  });

  // Add domain on Enter key press
  domainInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const domain = domainInput.value.trim().toLowerCase();
      if (domain) {
        addDomain(domain);
      }
    }
  });

  function loadWhitelist() {
    chrome.storage.local.get({ userWhitelist: [] }, (result) => {
      renderList(result.userWhitelist);
    });
  }

  function addDomain(domain) {
    chrome.storage.local.get({ userWhitelist: [] }, (result) => {
      const list = result.userWhitelist;
      if (!list.includes(domain)) {
        list.push(domain);
        chrome.storage.local.set({ userWhitelist: list }, () => {
          domainInput.value = '';
          renderList(list);
        });
      } else {
        alert('Domain is already whitelisted.');
      }
    });
  }

  function removeDomain(domain) {
    chrome.storage.local.get({ userWhitelist: [] }, (result) => {
      const list = result.userWhitelist.filter(item => item !== domain);
      chrome.storage.local.set({ userWhitelist: list }, () => {
        renderList(list);
      });
    });
  }

  function renderList(list) {
    whitelistEl.innerHTML = '';
    
    if (list.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No domains whitelisted yet.';
      li.style.color = '#64748b';
      whitelistEl.appendChild(li);
      return;
    }

    list.forEach(domain => {
      const li = document.createElement('li');
      
      const span = document.createElement('span');
      span.textContent = domain;
      li.appendChild(span);

      const btn = document.createElement('button');
      btn.textContent = 'Remove';
      btn.className = 'remove-btn';
      btn.onclick = () => removeDomain(domain);
      li.appendChild(btn);

      whitelistEl.appendChild(li);
    });
  }
});

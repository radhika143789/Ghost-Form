document.addEventListener("DOMContentLoaded", () => {
  // Query the currently active tab in the current window
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];

    if (activeTab && activeTab.url) {
      try {
        const url = new URL(activeTab.url);

        // Internal browser pages (chrome://, about:, etc.) are always safe
        if (url.protocol === "chrome:" || url.protocol === "chrome-extension:" || url.protocol === "about:") {
          document.getElementById("currentDomain").textContent = url.hostname || activeTab.url;
          updateUI("safe");
          return;
        }

        document.getElementById("currentDomain").textContent = url.hostname || activeTab.url;

        // Ask background script for the domain trust status
        chrome.runtime.sendMessage(
          { action: "checkStatus", url: activeTab.url },
          (response) => {
            // Fix #14: Always check lastError before reading response.
            // If the service worker is cold (just installed or suspended),
            // lastError will be set and response will be undefined.
            if (chrome.runtime.lastError) {
              console.warn("[GhostForm Popup] Service worker not ready:", chrome.runtime.lastError.message);
              updateUI("unknown");
              return;
            }
            updateUI(response?.status ?? "unknown");
          }
        );
      } catch (e) {
        // URL parse error (e.g. edge case protocols) — not a phishing signal
        document.getElementById("currentDomain").textContent = activeTab.url;
        updateUI("unknown");
      }
    } else {
      // No active tab or no URL (e.g. new tab page before URL loads)
      document.getElementById("currentDomain").textContent = "N/A";
      updateUI("unknown");
    }
  });
});

function updateUI(status) {
  const card = document.getElementById("statusCard");
  const title = document.getElementById("statusTitle");
  const desc = document.getElementById("statusDesc");

  if (status === "safe") {
    card.className = "status-card safe";
    title.textContent = "Verified Domain";
    desc.textContent = "This website is recognized as safe. You may enter sensitive information.";
  } else if (status === "unknown") {
    card.className = "status-card unknown";
    title.textContent = "Unverified Domain";
    desc.textContent = "Ghost Form hasn't verified this site. Avoid entering passwords or card details.";
  } else {
    card.className = "status-card unsafe";
    title.textContent = "Unsafe — Phishing Risk";
    desc.textContent = "Ghost Form's ML model flagged this site as high risk. Do NOT enter any credentials.";
  }
}

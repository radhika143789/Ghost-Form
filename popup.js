document.addEventListener("DOMContentLoaded", () => {
  // Query the currently active tab in the current window
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    
    if (activeTab && activeTab.url) {
      try {
        const url = new URL(activeTab.url);
        document.getElementById("currentDomain").textContent = url.hostname || activeTab.url;
        
        // Ask background script for the domain trust status
        chrome.runtime.sendMessage(
          { action: "checkStatus", url: activeTab.url },
          (response) => {
            if (response && response.status) {
              updateUI(response.status);
            } else {
              updateUI("unsafe");
            }
          }
        );
      } catch (e) {
        document.getElementById("currentDomain").textContent = activeTab.url;
        updateUI("unsafe");
      }
    } else {
      document.getElementById("currentDomain").textContent = "N/A";
      updateUI("unsafe");
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

const THREAT_API_ENDPOINT = "https://ghost-form-proxy.yourdomain.workers.dev/check?domain=";

/**
 * Checks if a domain is saved in the user's manual whitelist.
 * Uses chrome.storage.local to retrieve the 'userWhitelist' array.
 */
async function isDomainWhitelisted(hostname) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ userWhitelist: [] }, (result) => {
      resolve(result.userWhitelist.includes(hostname));
    });
  });
}

/**
 * Helper to add a timeout to fetch requests
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

/**
 * Queries the Threat API for domain status.
 * Gracefully handles network timeouts and 404/500 errors by falling back to "unknown".
 * Uses chrome.storage.session as an in-memory cache.
 */
async function checkDomainWithAPI(hostname) {
  const cacheKey = hostname;
  
  // 1. Check the session cache first
  const cacheResult = await chrome.storage.session.get([cacheKey]);
  if (cacheResult[cacheKey]) {
    return cacheResult[cacheKey]; // 'safe', 'unsafe', or 'unknown'
  }

  // 2. If not in cache, fetch from the Threat API
  try {
    const response = await fetchWithTimeout(`${THREAT_API_ENDPOINT}${encodeURIComponent(hostname)}`, {}, 5000);
    
    let status = "unknown";
    
    if (response.ok) {
      // In a real implementation:
      // const data = await response.json();
      // status = data.isSafe ? "safe" : "unsafe";
      
      // Mocked strict fallback for MVP:
      status = "unsafe"; 
    } else {
      // Handles 404, 500, etc.
      status = "unknown";
    }

    // 3. Save the result to the session cache
    await chrome.storage.session.set({ [cacheKey]: status });
    return status;
    
  } catch (error) {
    // Catch network timeouts or completely failed fetches
    console.error("Error fetching threat data:", error);
    const fallbackStatus = "unknown";
    await chrome.storage.session.set({ [cacheKey]: fallbackStatus });
    return fallbackStatus;
  }
}

/**
 * Main domain checking logic combining whitelist and API.
 */
async function checkDomainStatus(urlString) {
  try {
    const url = new URL(urlString);
    
    // Always trust internal browser pages
    if (url.protocol === "chrome:" || url.protocol === "chrome-extension:") {
      return "safe";
    }

    const hostname = url.hostname;

    // 1. Check User Whitelist
    const isWhitelisted = await isDomainWhitelisted(hostname);
    if (isWhitelisted) {
      return "safe";
    }

    // 2. Check Threat API Cache / Endpoint
    return await checkDomainWithAPI(hostname);

  } catch (e) {
    return "unknown";
  }
}

// Listen for messages from popup or content script
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "checkStatus") {
      checkDomainStatus(request.url).then((status) => {
        sendResponse({ status: status });
      });
      return true; // Keeps the message channel open for async response
    }
  });
}

// Export for Jest testing (only executes in Node environment)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    checkDomainStatus,
    checkDomainWithAPI,
    isDomainWhitelisted
  };
}

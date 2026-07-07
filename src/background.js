/**
 * background.js — Ghost Form Phase 3
 *
 * This is the main service worker. Its key Phase 3 responsibilities are:
 *  1. Spawning and managing the ML Web Worker (ml_worker.js).
 *  2. Routing ANALYZE requests from content.js to the ML Worker.
 *  3. Maintaining a session-level result cache to avoid redundant ML inference.
 *  4. Recovering worker state gracefully after MV3 service worker suspension.
 *
 * Note: The Phase 2 API proxy fallback (THREAT_API_ENDPOINT) has been removed
 * in Phase 3. Detection is now fully on-device via the ML worker.
 */

// ---------------------------------------------------------------------------
// 1. ML Worker Management
// ---------------------------------------------------------------------------

let mlWorker = null;
const pendingRequests = new Map(); // id → { resolve, reject }
// requestCounter replaced by crypto.randomUUID() — see sendToMLWorker

/**
 * Lazily spawns the ML Worker. If the service worker was suspended by MV3
 * and restarted, this re-creates the worker on first use.
 */
function getMLWorker() {
  if (mlWorker) return mlWorker;

  mlWorker = new Worker(
    chrome.runtime.getURL('dist/ml_worker.js'),
    { type: 'module' }
  );

  // Route messages from the worker back to the correct pending Promise
  mlWorker.onmessage = (event) => {
    const { type, id, payload } = event.data;

    if (type === 'STATUS' || type === 'MODEL_PROGRESS') {
      console.log(`[GhostForm ML] ${type}:`, payload);
      return;
    }

    // Fix #1 (race condition resolved): The worker posts READY after its async
    // module initialization finishes. We wait for READY before sending
    // RESTORE_ANCHORS — if we sent it earlier the message would be lost because
    // self.onmessage inside the module worker is not yet registered.
    if (type === 'READY') {
      console.log(`[GhostForm ML] Worker ready (${payload}). Checking for cached anchors...`);
      chrome.storage.session.get(['__ghost_form_anchors__'], (result) => {
        if (result.__ghost_form_anchors__ && mlWorker) {
          mlWorker.postMessage({
            type: 'RESTORE_ANCHORS',
            id: crypto.randomUUID(),
            payload: result.__ghost_form_anchors__,
          });
          console.log('[GhostForm] Sent cached anchor embeddings to worker.');
        }
      });
      return;
    }

    // Worker computed anchor embeddings for the first time — persist them in
    // session storage so they survive the next service worker restart.
    if (type === 'STORE_ANCHORS') {
      chrome.storage.session.set({ __ghost_form_anchors__: payload });
      console.log('[GhostForm] Anchor embeddings cached in session storage.');
      return;
    }

    const pending = pendingRequests.get(id);
    if (!pending) return;

    pendingRequests.delete(id);

    if (type === 'ERROR') {
      pending.reject(new Error(payload));
    } else {
      pending.resolve(payload);
    }
  };

  mlWorker.onerror = (err) => {
    console.error('[GhostForm ML Worker Error]', err);
    // Reject all pending requests and tear down so it respawns next call
    for (const [id, pending] of pendingRequests) {
      pending.reject(new Error('ML Worker crashed'));
    }
    pendingRequests.clear();
    mlWorker = null;
  };

  // Note: RESTORE_ANCHORS is NOT sent here. The worker will post READY
  // after its async module initialization completes, and the READY handler
  // in onmessage above will then send RESTORE_ANCHORS safely.

  return mlWorker;
}

/**
 * Sends a typed message to the ML Worker and returns a Promise.
 * 
 * @param {string} type - Message type ('ANALYZE' | 'EMBED' | 'PING')
 * @param {object} payload - The data to send.
 * @param {number} timeoutMs - Max wait time in milliseconds.
 */
function sendToMLWorker(type, payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    // Fix #16: crypto.randomUUID() is collision-proof and survives service worker restarts
    const id = crypto.randomUUID();
    const worker = getMLWorker();

    // Timeout guard — ML inference can be slow on first run
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`ML Worker timeout for request ${id}`));
    }, timeoutMs);

    pendingRequests.set(id, {
      resolve: (val) => { clearTimeout(timer); resolve(val); },
      reject:  (err) => { clearTimeout(timer); reject(err); },
    });

    worker.postMessage({ type, id, payload });
  });
}

// ---------------------------------------------------------------------------
// 2. Phishing Score Interpretation
// ---------------------------------------------------------------------------

const SIMILARITY_THRESHOLDS = {
  HIGH_RISK:   0.80, // Very likely a brand impersonation
  MEDIUM_RISK: 0.65, // Suspicious similarity to a known brand
};

/**
 * Translates ML similarity scores into Ghost Form's 3-state status model.
 * 
 * @param {Array<{brand: string, score: number, label: string}>} results
 * @returns {{ status: 'safe'|'unsafe'|'unknown', topMatch: object|null }}
 */
function interpretMLResults(results) {
  if (!results || results.length === 0) {
    return { status: 'unknown', topMatch: null };
  }

  const topMatch = results[0];

  if (topMatch.score >= SIMILARITY_THRESHOLDS.HIGH_RISK) {
    return { status: 'unsafe', topMatch };
  } else if (topMatch.score >= SIMILARITY_THRESHOLDS.MEDIUM_RISK) {
    return { status: 'unknown', topMatch }; // Yellow — warn on Regex trigger only
  } else {
    return { status: 'safe', topMatch };
  }
}

// ---------------------------------------------------------------------------
// 3. Domain Whitelist & Session Cache
// ---------------------------------------------------------------------------

// High #9: In-memory whitelist cache — avoids O(n) cold chrome.storage.local I/O
// on every single page load. The Set gives O(1) lookups instead of O(n) array scans.
// Populated lazily on first use; invalidated immediately by chrome.storage.onChanged.
/** @type {Set<string>|null} */
let _whitelistCache = null;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.userWhitelist) {
    _whitelistCache = new Set(changes.userWhitelist.newValue ?? []);
    console.log('[GhostForm] Whitelist cache refreshed:', _whitelistCache.size, 'entries');
  }
});

async function isDomainWhitelisted(hostname) {
  if (!_whitelistCache) {
    // First call: load from storage and prime the cache
    const result = await chrome.storage.local.get({ userWhitelist: [] });
    _whitelistCache = new Set(result.userWhitelist);
  }
  return _whitelistCache.has(hostname); // O(1)
}

async function getSessionCache(key) {
  const result = await chrome.storage.session.get([key]);
  // High #5: Use ?? not || — || coerces falsy values (0, false, '') to null,
  // causing a cache miss even when a valid falsy result was intentionally stored.
  return result[key] ?? null;
}

async function setSessionCache(key, value) {
  await chrome.storage.session.set({ [key]: value });
}

// ---------------------------------------------------------------------------
// 4. Main Domain Status Check — combines whitelist + ML + API fallback
// ---------------------------------------------------------------------------

async function checkDomainStatus(urlString) {
  try {
    const url = new URL(urlString);

    // High #8: Expanded internal protocol set. The previous check only covered
    // chrome:// and chrome-extension://. about:blank, data:, and blob: URLs
    // are also browser-internal and should never be analyzed for phishing.
    const INTERNAL_PROTOCOLS = new Set([
      'chrome:', 'chrome-extension:', 'about:', 'data:', 'blob:', 'devtools:'
    ]);
    if (INTERNAL_PROTOCOLS.has(url.protocol)) {
      return { status: 'safe', source: 'internal' };
    }

    const hostname = url.hostname;

    // Step 1: User whitelist (immediate safe)
    if (await isDomainWhitelisted(hostname)) {
      return { status: 'safe', source: 'whitelist' };
    }

    // Step 2: Session cache (avoid redundant ML inference per tab session)
    const cached = await getSessionCache(`ml_status_${hostname}`);
    if (cached) {
      return { ...cached, source: 'cache' };
    }

    // Step 3: ML-based analysis will be triggered by the content script
    // sending the page text. Domain-level result defaults to 'unknown'
    // until the content script sends ANALYZE_PAGE with full page text.
    return { status: 'unknown', source: 'pending_ml' };

  } catch (e) {
    return { status: 'unknown', source: 'error' };
  }
}

// ---------------------------------------------------------------------------
// 5. Circuit Breaker — Per-Tab Rate Limiter (Token Bucket)
// ---------------------------------------------------------------------------

/**
 * Implements a token-bucket rate limiter per Chrome tab ID.
 *
 * Security properties:
 *  - Enforces a hard maximum of MAX_REQUESTS_PER_WINDOW inference calls
 *    per tab within any WINDOW_MS rolling window.
 *  - A malicious or compromised content script flooding us with 50 ANALYZE_PAGE
 *    messages per second will only ever trigger 1 ML inference; the rest
 *    receive an immediate 'rate_limited' response.
 *  - Tab state is pruned on a 60-second interval to prevent memory leaks
 *    from abandoned tabs.
 *
 * @typedef {{ timestamps: number[] }} TabBucket
 */

const RATE_LIMIT_WINDOW_MS    = 1000; // 1 second rolling window
const MAX_REQUESTS_PER_WINDOW = 1;    // Max 1 ML inference per second per tab

/** @type {Map<number, TabBucket>} */
const rateLimitBuckets = new Map();

/**
 * Returns true if the request for this tabId should be allowed through.
 * Returns false (rate-limited) if the tab has exceeded its quota.
 *
 * @param {number} tabId
 * @returns {boolean}
 */
function isRequestAllowed(tabId) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  if (!rateLimitBuckets.has(tabId)) {
    rateLimitBuckets.set(tabId, { timestamps: [] });
  }

  const bucket = rateLimitBuckets.get(tabId);

  // Evict timestamps outside the rolling window
  bucket.timestamps = bucket.timestamps.filter(ts => ts > windowStart);

  if (bucket.timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    // Quota exceeded — drop the request
    return false;
  }

  // Admit the request and record its timestamp
  bucket.timestamps.push(now);
  return true;
}

// Prune stale tab entries every 60s to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [tabId, bucket] of rateLimitBuckets) {
    // Remove tab entry if no requests in the last 60 seconds
    const hasRecentActivity = bucket.timestamps.some(ts => now - ts < 60_000);
    if (!hasRecentActivity) {
      rateLimitBuckets.delete(tabId);
    }
  }
}, 60_000);

// ---------------------------------------------------------------------------
// 6. Message Router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // --- Check domain trust status (popup or content script) ---
  if (request.action === 'checkStatus') {
    checkDomainStatus(request.url).then(sendResponse);
    return true;
  }

  // --- Run ML phishing analysis on scraped page text ---
  if (request.action === 'ANALYZE_PAGE') {
    const { text, hostname } = request;
    const tabId = sender.tab ? sender.tab.id : -1;

    // ── Circuit Breaker ──────────────────────────────────────────────────────
    if (!isRequestAllowed(tabId)) {
      console.warn(`[GhostForm] Rate limit exceeded for tab ${tabId}. Request dropped.`);
      sendResponse({
        status: 'unknown',
        source: 'rate_limited',
        message: 'Too many inference requests. Max 1 per second per tab.',
      });
      return true;
    }
    // ─────────────────────────────────────────────────────────────────────────

    sendToMLWorker('ANALYZE', { text }, 45000)
      .then(async (results) => {
        const { status, topMatch } = interpretMLResults(results);
        const result = { status, topMatch, allScores: results, source: 'ml' };
        await setSessionCache(`ml_status_${hostname}`, { status, topMatch });
        sendResponse(result);
      })
      .catch((err) => {
        console.error('[GhostForm] ML analysis failed:', err);
        sendResponse({ status: 'unknown', source: 'ml_error', error: err.message });
      });

    return true; // async response
  }

  // --- Ping the ML worker to pre-warm it ---
  if (request.action === 'PING_ML') {
    sendToMLWorker('PING', {}, 60000)
      .then(() => sendResponse({ ready: true }))
      .catch((err) => sendResponse({ ready: false, error: err.message }));
    return true;
  }

  // Fix #19: Unknown action fallback — prevents callers from hanging indefinitely
  console.warn('[GhostForm] Unknown message action:', request.action);
  sendResponse({ error: `Unknown action: ${request.action}` });
  return false;
});

// Pre-warm the ML worker when the service worker starts
// so the model is loaded before the user needs it
getMLWorker();

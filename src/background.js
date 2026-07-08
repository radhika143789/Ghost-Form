/**
 * background.js — Ghost Form Phase 5 (Audit Fix)
 *
 * This is the main service worker. Its responsibilities are:
 *  1. Creating and managing the Offscreen Document that hosts the ML Worker.
 *  2. Routing ANALYZE requests from content.js to the Offscreen Document.
 *  3. Maintaining a session-level result cache to avoid redundant ML inference.
 *  4. Recovering gracefully after MV3 service worker suspension.
 *
 * SECURITY FIX (Critical Audit Finding — MV3 Service Worker Lifecycle):
 *   The ML Web Worker is now hosted inside an Offscreen Document instead of
 *   directly inside this service worker. This prevents Chrome from killing
 *   the WASM runtime mid-inference when it suspends the service worker.
 */

// ---------------------------------------------------------------------------
// 1. Offscreen Document Management
// ---------------------------------------------------------------------------

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

/** @type {boolean} Tracks whether we are in the process of creating the offscreen doc */
let creatingOffscreenDocument = false;

/**
 * Ensures the offscreen document exists. If Chrome suspended and restarted
 * the service worker, the offscreen document may still be alive from the
 * previous session — we check first to avoid duplicates.
 */
async function setupOffscreenDocument() {
  // Check if one already exists (survives service worker restarts)
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });

  if (existingContexts.length > 0) {
    return; // Already running
  }

  // Prevent duplicate creation if two messages arrive simultaneously
  if (creatingOffscreenDocument) {
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (!creatingOffscreenDocument) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
    return;
  }

  creatingOffscreenDocument = true;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['WORKERS'],
      justification: 'Host ML Web Worker for on-device phishing detection (WASM/ONNX inference)',
    });
    console.log('[GhostForm] Offscreen document created successfully.');
  } catch (err) {
    // If it already exists (race condition), that's fine
    if (!err.message?.includes('Only a single offscreen')) {
      console.error('[GhostForm] Failed to create offscreen document:', err);
    }
  } finally {
    creatingOffscreenDocument = false;
  }
}

/**
 * Sends an ML inference request to the offscreen document.
 * The offscreen document hosts the Web Worker and routes the message through.
 *
 * @param {string} action - 'ML_ANALYZE' | 'ML_PING'
 * @param {object} payload - Data fields specific to the action.
 * @param {number} timeoutMs - Max wait time in milliseconds.
 * @returns {Promise<object>} The response from the offscreen ML worker.
 */
async function sendToOffscreenML(action, payload = {}, timeoutMs = 30000) {
  await setupOffscreenDocument();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Offscreen ML timeout for action ${action}`));
    }, timeoutMs);

    chrome.runtime.sendMessage(
      { target: 'offscreen', action, ...payload, timeoutMs },
      (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      }
    );
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
// 3. Domain Whitelist & Session Cache (LRU)
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

// ── LRU Session Cache ─────────────────────────────────────────────────────
//
// PERFORMANCE FIX (Medium Audit Finding — Storage Quota Exhaustion):
//   chrome.storage.session has a strict ~10MB quota. The previous code wrote
//   every unique hostname's ML result to session storage without eviction.
//   A user visiting many unique domains (e.g., Google search results) would
//   eventually hit QUOTA_BYTES_PER_ITEM or total quota, crashing cache writes.
//
//   This LRU cache keeps at most MAX_CACHED_DOMAINS entries in memory, using
//   a Map (which preserves insertion order) for O(1) get/set/delete and O(1)
//   LRU eviction from the front. Session storage is synchronized lazily.

const MAX_CACHED_DOMAINS = 150;

/** @type {Map<string, any>} LRU: oldest entries at the front, newest at the back */
const _sessionLRU = new Map();

/** @type {boolean} Whether the LRU has been primed from storage */
let _lruPrimed = false;

/**
 * Primes the in-memory LRU from chrome.storage.session on first use.
 * Only called once per service worker lifecycle.
 */
async function _primeLRU() {
  if (_lruPrimed) return;
  _lruPrimed = true;

  try {
    const all = await chrome.storage.session.get(null);
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith('ml_status_')) {
        _sessionLRU.set(key, value);
      }
    }
    // If we loaded more than MAX, trim from the front (oldest)
    while (_sessionLRU.size > MAX_CACHED_DOMAINS) {
      const oldestKey = _sessionLRU.keys().next().value;
      _sessionLRU.delete(oldestKey);
      chrome.storage.session.remove(oldestKey).catch(() => {});
    }
    console.log(`[GhostForm] LRU cache primed with ${_sessionLRU.size} entries.`);
  } catch (_) {
    // Non-fatal: cache will be empty but functional
  }
}

async function getSessionCache(key) {
  await _primeLRU();

  if (!_sessionLRU.has(key)) return null;

  // Move to end (most recently used)
  const value = _sessionLRU.get(key);
  _sessionLRU.delete(key);
  _sessionLRU.set(key, value);

  return value;
}

async function setSessionCache(key, value) {
  await _primeLRU();

  // If key already exists, delete it first so it moves to the end
  _sessionLRU.delete(key);

  // Evict oldest entry if at capacity
  if (_sessionLRU.size >= MAX_CACHED_DOMAINS) {
    const oldestKey = _sessionLRU.keys().next().value;
    _sessionLRU.delete(oldestKey);
    // Fire-and-forget storage cleanup
    chrome.storage.session.remove(oldestKey).catch(() => {});
  }

  _sessionLRU.set(key, value);

  // Persist to session storage (fire-and-forget, non-blocking)
  chrome.storage.session.set({ [key]: value }).catch((err) => {
    console.warn('[GhostForm] Session cache write failed (quota?):', err.message);
  });
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
// 5. Circuit Breaker — Per-Tab Rate Limiter + Global Concurrency Lock
// ---------------------------------------------------------------------------

/**
 * SECURITY FIX (Medium Audit Finding — Global Rate Limit Evasion):
 *   The previous implementation only rate-limited per tabId. A malicious site
 *   could open multiple popups or iframes (each with a unique tabId) to bypass
 *   the per-tab limit and flood the ML pipeline, causing OOM in the WASM runtime.
 *
 *   New approach adds TWO layers:
 *     1. Per-tab token bucket (unchanged) — max 1 request/second/tab.
 *     2. Global concurrency lock — max 2 concurrent ML inferences total
 *        across the entire extension. Excess requests are rejected immediately.
 *
 * @typedef {{ timestamps: number[] }} TabBucket
 */

const RATE_LIMIT_WINDOW_MS    = 1000; // 1 second rolling window
const MAX_REQUESTS_PER_WINDOW = 1;    // Max 1 ML inference per second per tab
const MAX_CONCURRENT_INFERENCES = 2;  // Max 2 concurrent ML inferences globally

/** @type {Map<number, TabBucket>} */
const rateLimitBuckets = new Map();

/** @type {number} Currently active ML inference count */
let activeInferences = 0;

/**
 * Returns true if the request for this tabId should be allowed through.
 * Checks BOTH the per-tab rate limit AND the global concurrency limit.
 *
 * @param {number} tabId
 * @returns {boolean}
 */
function isRequestAllowed(tabId) {
  // ── Global concurrency check ──────────────────────────────────────────
  if (activeInferences >= MAX_CONCURRENT_INFERENCES) {
    return false;
  }

  // ── Per-tab rate limit ────────────────────────────────────────────────
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

/**
 * Increments the global inference counter. Call before dispatching ML work.
 */
function acquireInferenceSlot() {
  activeInferences++;
}

/**
 * Decrements the global inference counter. Call in .then()/.catch()/.finally().
 */
function releaseInferenceSlot() {
  activeInferences = Math.max(0, activeInferences - 1);
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

  // Ignore messages targeted at the offscreen document (they're not for us)
  if (request.target === 'offscreen') return false;

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

    // Acquire a global inference slot before dispatching
    acquireInferenceSlot();

    sendToOffscreenML('ML_ANALYZE', { text }, 45000)
      .then(async (response) => {
        releaseInferenceSlot();
        if (!response || !response.success) {
          throw new Error(response?.error || 'Offscreen ML returned failure');
        }
        const { status, topMatch } = interpretMLResults(response.results);
        const result = { status, topMatch, allScores: response.results, source: 'ml' };
        await setSessionCache(`ml_status_${hostname}`, { status, topMatch });
        sendResponse(result);
      })
      .catch((err) => {
        releaseInferenceSlot();
        console.error('[GhostForm] ML analysis failed:', err);
        sendResponse({ status: 'unknown', source: 'ml_error', error: err.message });
      });

    return true; // async response
  }

  // --- Ping the ML worker to pre-warm it ---
  if (request.action === 'PING_ML') {
    sendToOffscreenML('ML_PING', {}, 60000)
      .then((response) => sendResponse({ ready: response?.ready ?? false }))
      .catch((err) => sendResponse({ ready: false, error: err.message }));
    return true;
  }

  // Fix #19: Unknown action fallback — prevents callers from hanging indefinitely
  console.warn('[GhostForm] Unknown message action:', request.action);
  sendResponse({ error: `Unknown action: ${request.action}` });
  return false;
});

// Pre-warm the offscreen document and ML pipeline when the service worker starts
setupOffscreenDocument().then(() => {
  console.log('[GhostForm] Offscreen document pre-warmed on service worker start.');
}).catch((err) => {
  console.warn('[GhostForm] Offscreen pre-warm failed (will retry on first request):', err);
});


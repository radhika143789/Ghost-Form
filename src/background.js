/**
 * background.js — Ghost Form Phase 5 (Audit Fix + Telemetry)
 *
 * This is the main service worker. Its responsibilities are:
 *  1. Creating and managing the Offscreen Document that hosts the ML Worker.
 *  2. Routing ANALYZE requests from content.js to the Offscreen Document.
 *  3. Maintaining a session-level result cache to avoid redundant ML inference.
 *  4. Recovering gracefully after MV3 service worker suspension.
 *  5. Reporting confirmed phishing detections to Supabase (privacy-first: domain + level only).
 *
 * SECURITY FIX (Critical Audit Finding — MV3 Service Worker Lifecycle):
 *   The ML Web Worker is now hosted inside an Offscreen Document instead of
 *   directly inside this service worker. This prevents Chrome from killing
 *   the WASM runtime mid-inference when it suspends the service worker.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

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

// ---------------------------------------------------------------------------
// Reputation Cache TTL Configuration
// ---------------------------------------------------------------------------
/** Primary TTL: cached results expire after 5 minutes */
const REPUTATION_TTL_MS = 5 * 60 * 1000;
/** Grace-period TTL: last-known-good results survive up to 15 minutes */
const REPUTATION_GRACE_TTL_MS = 15 * 60 * 1000;

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

/**
 * Grace-period cache: stores the last known-good result per hostname.
 * Consulted when the ML pipeline fails (timeout, rate-limit, offscreen error)
 * to avoid showing 'unknown' to users when we have a recent safe result.
 *
 * Structure: hostname → { status, topMatch, cachedAt: number }
 * @type {Map<string, {status: string, topMatch: object|null, cachedAt: number}>}
 */
const _graceCache = new Map();
const MAX_GRACE_CACHE = 200;

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

  const value = _sessionLRU.get(key);
  
  // TTL eviction: treat expired entries as a cache miss
  if (value.cachedAt && (Date.now() - value.cachedAt) > REPUTATION_TTL_MS) {
    _sessionLRU.delete(key);
    chrome.storage.session.remove(key).catch(() => {});
    console.log(`[GhostForm] Cache TTL expired for ${key}`);
    return null;
  }

  // Move to end (most recently used)
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

  value.cachedAt = Date.now();
  _sessionLRU.set(key, value);

  // Persist to session storage (fire-and-forget, non-blocking)
  chrome.storage.session.set({ [key]: value }).catch((err) => {
    console.warn('[GhostForm] Session cache write failed (quota?):', err.message);
  });
}

function _updateGraceCache(hostname, status, topMatch) {
  // Only cache definitive results in the grace cache (not unknown/error)
  if (status === 'safe' || status === 'unsafe') {
    // Evict oldest if at capacity
    if (_graceCache.size >= MAX_GRACE_CACHE) {
      const oldestKey = _graceCache.keys().next().value;
      _graceCache.delete(oldestKey);
    }
    _graceCache.set(hostname, { status, topMatch, cachedAt: Date.now() });
  }
}

/**
 * Returns the grace-period cached result for a hostname if it exists
 * and has not exceeded REPUTATION_GRACE_TTL_MS. Returns null otherwise.
 *
 * @param {string} hostname
 * @returns {{status: string, topMatch: object|null}|null}
 */
function getGraceCacheEntry(hostname) {
  const entry = _graceCache.get(hostname);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > REPUTATION_GRACE_TTL_MS) {
    _graceCache.delete(hostname);
    return null;
  }
  return { status: entry.status, topMatch: entry.topMatch };
}

// ---------------------------------------------------------------------------
// 4. Supabase Telemetry Reporter
// ---------------------------------------------------------------------------

/**
 * Reports a confirmed threat to the Supabase threat_telemetry table.
 *
 * PRIVACY GUARANTEE:
 *   Only the flagged domain name, threat level, and detection method are sent.
 *   No user IP, no tab content, no personally identifiable data.
 *   The Supabase anon key is safe to use here — INSERT is allowed for anon
 *   users by RLS policy, but SELECT is restricted to authenticated admins only.
 *
 * This function is fire-and-forget. It must never block or delay
 * sendResponse() to the content script — failures are logged and discarded.
 *
 * @param {string} domain           - e.g. "fake-paypal-login.com"
 * @param {'Red'|'Yellow'} level    - Threat severity
 * @param {'ML_Model'|'API'} method - How the threat was detected
 */
async function reportThreatTelemetry(domain, level, method) {
  // Validate inputs before sending — the DB has CHECK constraints but we
  // want to catch miscalls early to avoid noisy 400 errors in the console.
  if (!domain || !['Red', 'Yellow'].includes(level) || !['ML_Model', 'API'].includes(method)) {
    console.warn('[GhostForm] reportThreatTelemetry: invalid arguments, skipping.', { domain, level, method });
    return;
  }

  if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR_PROJECT_ID')) {
    // Config not yet filled in — skip silently so the extension still works
    // before the developer sets up their Supabase project.
    console.warn('[GhostForm] Telemetry skipped: SUPABASE_URL not configured in src/config.js');
    return;
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/threat_telemetry`, {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal', // Don't return row data — saves bandwidth
      },
      body: JSON.stringify({
        domain_flagged:   domain,
        threat_level:     level,
        detection_method: method,
      }),
    });

    if (!response.ok) {
      // 409 Conflict is acceptable (duplicate row within same session).
      // Log everything else as a warning.
      if (response.status !== 409) {
        console.warn(`[GhostForm] Telemetry POST failed: HTTP ${response.status}`);
      }
    } else {
      console.log(`[GhostForm] Telemetry reported: ${level} threat on ${domain} via ${method}`);
    }
  } catch (err) {
    // Network error (offline, CSP block, etc.) — non-fatal, discard silently
    console.warn('[GhostForm] Telemetry POST error (non-fatal):', err.message);
  }
}

/**
 * Logs a detected threat locally in chrome.storage.local.
 *
 * @param {string} domain
 * @param {'Red'|'Yellow'} level
 * @param {'ML_Model'|'API'} method
 */
function logThreatLocally(domain, level, method) {
  chrome.storage.local.get({ localThreats: [] }, (data) => {
    const list = data.localThreats || [];
    // Check if duplicate in the last 5 minutes to avoid spamming
    const exists = list.some(t => t.domain_flagged === domain && t.threat_level === level && (Date.now() - new Date(t.created_at).getTime() < 300000));
    if (exists) return;

    const newThreat = {
      id: 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      domain_flagged: domain,
      threat_level: level,
      detection_method: method,
      created_at: new Date().toISOString()
    };
    
    list.unshift(newThreat); // add to beginning
    if (list.length > 100) list.pop(); // keep last 100
    chrome.storage.local.set({ localThreats: list }).catch(() => {});
  });
}


// ---------------------------------------------------------------------------
// 5. Main Domain Status Check — combines whitelist + ML + API fallback
// ---------------------------------------------------------------------------

async function checkDomainStatus(urlString, tabId) {
  try {
    const url = new URL(urlString);

    // High #8: Expanded internal protocol set.
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

    // Step 3: Fetch GhostPrint anomaly state for this tab (if any)
    const ghostPrint = tabId ? await getSessionCache(`ghostprint_tab_${tabId}`) : null;

    // Step 3b: Fetch X-Ray Vision structural score for this hostname
    const xrayData = await getSessionCache(`xray_${hostname}`);

    if (cached) {
      return { ...cached, ghostPrint, structuralScore: xrayData?.score ?? 0, matchedTemplate: xrayData?.matchedTemplate ?? null, source: 'cache' };
    }

    // Step 4: ML-based analysis pending — default to 'unknown'
    return { status: 'unknown', ghostPrint, structuralScore: xrayData?.score ?? 0, matchedTemplate: xrayData?.matchedTemplate ?? null, source: 'pending_ml' };

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
  // Hard size cap: if still over limit after time-based eviction, evict oldest
  // This handles burst scenarios where many tabs open within the 60s window.
  while (rateLimitBuckets.size > 500) {
    const oldestTabId = rateLimitBuckets.keys().next().value;
    rateLimitBuckets.delete(oldestTabId);
  }
}, 60_000);

// ---------------------------------------------------------------------------
// 6. Message Router
// ---------------------------------------------------------------------------

/**
 * Wraps chrome.runtime.sendResponse to silently absorb the
 * "message channel closed before a response was received" error.
 *
 * This error fires when the MV3 service worker is suspended by Chrome between
 * the `return true` and the actual `sendResponse()` call. The response is lost,
 * but there is nothing we can do about MV3 lifecycle suspension. Logging a
 * noisy uncaught Promise error every time the worker wakes is not helpful.
 *
 * @param {Function} sendResponse - The original sendResponse from the listener.
 * @param {any} data - The payload to send back.
 */
function safeRespond(sendResponse, data) {
  try {
    sendResponse(data);
  } catch (_) {
    // Channel already closed (service worker was suspended) — discard silently
  }
  // Also clear any dangling lastError to prevent Chrome from logging it
  void chrome.runtime.lastError;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // Ignore messages targeted at the offscreen document (they're not for us)
  if (request.target === 'offscreen') return false;

  // --- Check domain trust status (popup or content script) ---
  if (request.action === 'checkStatus') {
    const tabId = sender.tab?.id ?? null;
    checkDomainStatus(request.url, tabId).then(result => safeRespond(sendResponse, result));
    return true;
  }

  // --- Run ML phishing analysis on scraped page text ---
  if (request.action === 'ANALYZE_PAGE') {
    const { text, hostname } = request;
    const tabId = sender.tab ? sender.tab.id : -1;

    // ── Circuit Breaker ──────────────────────────────────────────────────────
    if (!isRequestAllowed(tabId)) {
      console.warn(`[GhostForm] Rate limit exceeded for tab ${tabId}. Request dropped.`);
      const rateLimitGrace = getGraceCacheEntry(hostname);
      if (rateLimitGrace) {
        safeRespond(sendResponse, { ...rateLimitGrace, source: 'grace_cache_rate_limited' });
      } else {
        safeRespond(sendResponse, {
          status: 'unknown',
          source: 'rate_limited',
          message: 'Too many inference requests. Max 1 per second per tab.',
        });
      }
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
        _updateGraceCache(hostname, status, topMatch);

        // ── Telemetry reporting (fire-and-forget, never blocks sendResponse) ──
        // 'unsafe' maps to Red (HIGH_RISK score >= 0.80)
        // 'unknown' with a topMatch maps to Yellow (MEDIUM_RISK score 0.65–0.79)
        // 'safe' is not reported — we only track threats.
        if (status === 'unsafe') {
          reportThreatTelemetry(hostname, 'Red', 'ML_Model').catch(() => {});
          logThreatLocally(hostname, 'Red', 'ML_Model');
        } else if (status === 'unknown' && topMatch?.score >= SIMILARITY_THRESHOLDS.MEDIUM_RISK) {
          reportThreatTelemetry(hostname, 'Yellow', 'ML_Model').catch(() => {});
          logThreatLocally(hostname, 'Yellow', 'ML_Model');
        }
        // ─────────────────────────────────────────────────────────────────────

        safeRespond(sendResponse, result);
      })
      .catch((err) => {
        releaseInferenceSlot();
        console.error('[GhostForm] ML analysis failed:', err);

        const graceFallback = getGraceCacheEntry(hostname);
        if (graceFallback) {
          console.log(`[GhostForm] Serving grace-cache fallback for ${hostname}: ${graceFallback.status}`);
          safeRespond(sendResponse, { ...graceFallback, source: 'grace_cache' });
        } else {
          safeRespond(sendResponse, { status: 'unknown', source: 'ml_error', error: err.message });
        }
      });

    return true; // async response
  }

  // --- Phase 5: Fine-Print AI — dark pattern consent analysis ---
  if (request.action === 'ANALYZE_CONSENT') {
    const { text: consentText } = request;

    // Import the dark pattern anchors from fine_print_ai (bundled inline to avoid
    // dynamic imports in the service worker context)
    const DARK_PATTERN_PHRASES = [
      'By clicking submit you agree to a recurring monthly subscription charge which will renew automatically until you cancel.',
      'We may share or sell your personal information including name email and browsing data with our affiliated partners and third party advertisers.',
      'By using this service you agree to binding arbitration and waive any right to trial by jury or to participate in a class action lawsuit.',
      'Your free trial will automatically convert to a paid subscription and your payment method will be charged unless you cancel before the trial period ends.',
      'We collect your precise geolocation data continuously including when the application is running in the background.',
      'I agree to receive promotional emails marketing communications and special offers from our partners.',
    ];

    const DARK_PATTERN_LABELS = [
      { id: 'recurring_subscription', label: '⚠️ Recurring Subscription', description: 'May automatically charge you on a recurring basis.', severity: 'high' },
      { id: 'data_sale',              label: '⚠️ Data Sold to Third Parties', description: 'Your personal data may be sold to third parties.', severity: 'high' },
      { id: 'arbitration_clause',     label: '📋 Forced Arbitration', description: 'Waives your right to a jury trial or class action.', severity: 'medium' },
      { id: 'free_trial_trap',        label: '⚠️ Free Trial Auto-Converts', description: 'Free trial automatically converts to paid without notice.', severity: 'high' },
      { id: 'location_tracking',      label: '📍 Continuous Location Tracking', description: 'Tracks your location even when the app is not in use.', severity: 'medium' },
      { id: 'marketing_consent',      label: '📧 Pre-checked Marketing Consent', description: 'Consent to marketing emails is pre-selected by default.', severity: 'low' },
    ];

    sendToOffscreenML('ML_CONSENT_ANALYZE', {
      consentText,
      anchors: DARK_PATTERN_PHRASES,
    }, 30000)
      .then((response) => {
        if (response?.success) {
          const findings = (response.findings || [])
            .map((match) => {
              const label = DARK_PATTERN_LABELS[match.index];
              if (!label) return null;
              return { ...label, score: match.score };
            })
            .filter(f => f !== null && f.score >= 0.6);
          safeRespond(sendResponse, { findings });
        } else {
          safeRespond(sendResponse, { findings: [] });
        }
      })
      .catch(() => safeRespond(sendResponse, { findings: [] }));
    return true;
  }

  // --- Phase 5: X-Ray Vision — store structural score from content script ---
  if (request.action === 'STORE_XRAY_SCORE') {
    const { hostname, score, matchedTemplate, structuralRisk } = request;
    if (hostname) {
      setSessionCache(`xray_${hostname}`, { score, matchedTemplate, structuralRisk })
        .catch(() => {});
    }
    safeRespond(sendResponse, { ok: true });
    return false;
  }

  // --- Ping the ML worker to pre-warm it ---
  if (request.action === 'PING_ML') {
    sendToOffscreenML('ML_PING', {}, 60000)
      .then((response) => safeRespond(sendResponse, { ready: response?.ready ?? false }))
      .catch((err)   => safeRespond(sendResponse, { ready: false, error: err.message }));
    return true;
  }

  // --- Phase 5: GhostPrint — keystroke anomaly alert from content script ---
  if (request.action === 'GHOST_PRINT_ANOMALY') {
    const tabId = sender.tab?.id;
    if (tabId !== undefined) {
      const { anomaly, zScore } = request;
      setSessionCache(`ghostprint_tab_${tabId}`, { anomaly: Boolean(anomaly), zScore: zScore ?? 0 })
        .catch(() => {});
      console.log(`[GhostForm] GhostPrint anomaly tab=${tabId} z=${zScore?.toFixed(2)}`);
    }
    safeRespond(sendResponse, { ok: true });
    return false; // sync response
  }

  // --- Phase 5: Ghost Masks Pro — proxy SimpleLogin alias API ---
  // Content scripts cannot make cross-origin requests to simplelogin.io.
  // The background service worker has no CORS restriction, so we proxy here.
  if (request.action === 'GENERATE_ALIAS') {
    chrome.storage.local.get({ simpleloginApiKey: '' }, async ({ simpleloginApiKey }) => {
      if (!simpleloginApiKey) {
        // No API key — fall back to local alias (caller should generate locally)
        safeRespond(sendResponse, { alias: null, source: 'no_api_key' });
        return;
      }
      try {
        const res = await fetch('https://app.simplelogin.io/api/alias/random/new', {
          method: 'POST',
          headers: {
            'Authentication': simpleloginApiKey,
            'Content-Type':  'application/json',
          },
        });
        if (!res.ok) throw new Error(`SimpleLogin API error: ${res.status}`);
        const data  = await res.json();
        const alias = data.alias || data.email;
        if (!alias) throw new Error('SimpleLogin: no alias in response');
        safeRespond(sendResponse, { alias, source: 'simplelogin' });
      } catch (err) {
        console.warn('[GhostForm] SimpleLogin alias failed:', err.message);
        safeRespond(sendResponse, { alias: null, source: 'api_error', error: err.message });
      }
    });
    return true; // async
  }

  // Fix #19: Unknown action fallback — prevents callers from hanging indefinitely
  console.warn('[GhostForm] Unknown message action:', request.action);
  safeRespond(sendResponse, { error: `Unknown action: ${request.action}` });
  return false;
});

// Clean up per-tab GhostPrint state when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  // Remove tab-scoped session cache key (fire-and-forget)
  chrome.storage.session.remove(`ghostprint_tab_${tabId}`).catch(() => {});
  rateLimitBuckets.delete(tabId);
});

// Pre-warm the offscreen document and ML pipeline when the service worker starts
setupOffscreenDocument().then(() => {
  console.log('[GhostForm] Offscreen document pre-warmed on service worker start.');
}).catch((err) => {
  console.warn('[GhostForm] Offscreen pre-warm failed (will retry on first request):', err);
});


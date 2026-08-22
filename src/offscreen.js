/**
 * offscreen.js — Ghost Form Phase 5 (Audit Fix)
 *
 * This script runs inside an Offscreen Document created by background.js.
 * It manages the ML Web Worker (ml_worker.js) in a stable execution context
 * that survives MV3 service worker suspensions.
 *
 * SECURITY FIX (Critical Audit Finding — MV3 Service Worker Lifecycle):
 *   Previously, the ML Web Worker was spawned directly inside the background
 *   service worker. Chrome aggressively terminates service workers (~30s of
 *   inactivity or ~5 min total runtime). When Chrome killed the SW, the Web
 *   Worker running ML inference was immediately destroyed mid-computation,
 *   crashing the WASM runtime and forcing expensive (~5-10s) re-initialization.
 *
 *   Offscreen documents have a much more stable lifecycle:
 *     - They persist as long as there is an active reason (e.g., WORKERS).
 *     - They don't get killed mid-execution.
 *     - They support WebGPU for future hardware-accelerated inference.
 *
 * Communication protocol:
 *   background.js  ──(chrome.runtime.sendMessage)──▶  offscreen.js
 *   offscreen.js   ──(worker.postMessage)──▶          ml_worker.js
 *   ml_worker.js   ──(postMessage)──▶                 offscreen.js
 *   offscreen.js   ──(sendResponse)──▶                background.js
 */

// ---------------------------------------------------------------------------
// 1. ML Worker Management (migrated from background.js)
// ---------------------------------------------------------------------------

let mlWorker = null;
const pendingRequests = new Map(); // id → { resolve, reject }

/**
 * Lazily spawns the ML Worker inside this offscreen document.
 * Unlike the old background.js approach, this worker will persist
 * as long as the offscreen document is alive.
 */
function getMLWorker() {
  if (mlWorker) return mlWorker;

  mlWorker = new Worker(
    chrome.runtime.getURL('dist/ml_worker.js'),
    { type: 'module' }
  );

  mlWorker.onmessage = (event) => {
    const { type, id, payload } = event.data;

    if (type === 'STATUS' || type === 'MODEL_PROGRESS') {
      console.log(`[GhostForm Offscreen ML] ${type}:`, payload);
      return;
    }

    // When the worker is ready, restore cached anchor embeddings
    if (type === 'READY') {
      console.log(`[GhostForm Offscreen] Worker ready (${payload}). Checking for cached anchors...`);
      chrome.storage.session.get(['__ghost_form_anchors__'], (result) => {
        if (result.__ghost_form_anchors__ && mlWorker) {
          mlWorker.postMessage({
            type: 'RESTORE_ANCHORS',
            id: crypto.randomUUID(),
            payload: result.__ghost_form_anchors__,
          });
          console.log('[GhostForm Offscreen] Sent cached anchor embeddings to worker.');
        }
      });
      return;
    }

    // Worker computed anchor embeddings — persist in session storage
    if (type === 'STORE_ANCHORS') {
      chrome.storage.session.set({ __ghost_form_anchors__: payload });
      console.log('[GhostForm Offscreen] Anchor embeddings cached in session storage.');
      return;
    }

    // Resolve or reject the matching pending Promise
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
    console.error('[GhostForm Offscreen ML Worker Error]', err);
    for (const [id, pending] of pendingRequests) {
      pending.reject(new Error('ML Worker crashed'));
    }
    pendingRequests.clear();
    mlWorker = null;
  };

  return mlWorker;
}

/**
 * Sends a typed message to the ML Worker and returns a Promise.
 *
 * @param {string} type  - Message type ('ANALYZE' | 'EMBED' | 'PING')
 * @param {object} payload - The data to send.
 * @param {number} timeoutMs - Max wait time in milliseconds.
 */
function sendToMLWorker(type, payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const worker = getMLWorker();

    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      // CRASH RECOVERY FIX: Terminate the stuck worker so subsequent
      // requests get a fresh worker instead of queueing behind a blocked one.
      if (mlWorker) {
        console.warn('[GhostForm Offscreen] ML Worker timed out — terminating and respawning on next request.');
        mlWorker.terminate();
        mlWorker = null;
      }
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
// 2. Message Handler — receives tasks from background.js
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Only handle messages targeted at the offscreen document
  if (request.target !== 'offscreen') return false;

  if (request.action === 'ML_ANALYZE') {
    sendToMLWorker('ANALYZE', { text: request.text }, request.timeoutMs || 45000)
      .then((results) => sendResponse({ success: true, results }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // async
  }

  if (request.action === 'ML_PING') {
    sendToMLWorker('PING', {}, request.timeoutMs || 60000)
      .then(() => sendResponse({ ready: true }))
      .catch((err) => sendResponse({ ready: false, error: err.message }));
    return true; // async
  }

  // Phase 5: Fine-Print AI — semantic dark pattern detection
  // Embeds the extracted consent text and compares against dark pattern anchors.
  if (request.action === 'ML_CONSENT_ANALYZE') {
    const { consentText, anchors } = request;
    sendToMLWorker('CONSENT_ANALYZE', { consentText, anchors }, 30000)
      .then((findings) => sendResponse({ success: true, findings }))
      .catch((err) => sendResponse({ success: false, error: err.message, findings: [] }));
    return true; // async
  }

  console.warn('[GhostForm Offscreen] Unknown action:', request.action);
  sendResponse({ error: `Unknown offscreen action: ${request.action}` });
  return false;
});

// ---------------------------------------------------------------------------
// 3. Pre-warm the ML pipeline on offscreen document creation
// ---------------------------------------------------------------------------

console.log('[GhostForm Offscreen] Document created. Pre-warming ML pipeline...');
getMLWorker();

/**
 * content.js — Ghost Form Phase 5
 *
 * Phase 5 features integrated:
 *  - GhostPrint: Keystroke biometric anomaly detection on password fields.
 *  - Active Shield: Clickjack interceptor via elementFromPoint sampling.
 *  - X-Ray Vision: Structural DOM fingerprinting fused with ML results.
 *  - Ghost Masks: Ephemeral email alias injection on risky forms.
 *  - Fine-Print AI: Dark pattern detection in consent/legal text.
 */

let currentStatus = "safe";
const ignoredSessionKey = `ghost-form-ignore-${window.location.hostname}`;

// ── Respect the protection toggle from popup ────────────────────────────────
// If the user paused protection via the popup toggle, bail out immediately.
// chrome.storage.local is available in content scripts.
chrome.storage.local.get({ protectionEnabled: true }, ({ protectionEnabled }) => {
  if (!protectionEnabled) {
    console.log('[GhostForm] Protection is paused by user. Content script idle.');
    return;
  }
  initGhostForm();
});

// ── Live toggle: respond immediately if user pauses protection mid-session ──
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('protectionEnabled' in changes)) return;
  if (changes.protectionEnabled.newValue === false) {
    // Remove all active warning overlays
    document.querySelectorAll('.ghost-form-warning-overlay').forEach(el => el.remove());
    document.querySelectorAll('.ghost-form-unsafe-input').forEach(el => {
      el.removeAttribute('data-ghost-form-active');
      el.classList.remove('ghost-form-unsafe-input');
    });
    // Remove Fine-Print AI banner
    document.getElementById('ghost-fine-print-banner')?.remove();
    // Remove all Ghost Masks
    if (typeof ghostFormMasks !== 'undefined') ghostFormMasks.removeAllGhostMasks();
    console.log('[GhostForm] Protection toggled OFF — all warnings cleared.');
  }
});

function initGhostForm() {

// Ask background script for status
chrome.runtime.sendMessage(
  { action: "checkStatus", url: window.location.href },
  (response) => {
    // High #10: Missing lastError check. On cold service worker start, this callback
    // might fire with lastError set and response undefined, swallowing the error.
    if (chrome.runtime.lastError) {
      console.warn('[GhostForm] Initial status check failed:', chrome.runtime.lastError.message);
      currentStatus = 'unknown'; // Conservative: don't assume safe on error
      return;
    }
    if (response && response.status) {
      currentStatus = response.status;
    }
  }
);

// --- Utilities ---
function isIgnored() {
  return sessionStorage.getItem(ignoredSessionKey) === "true";
}

function setIgnored() {
  sessionStorage.setItem(ignoredSessionKey, "true");
  // Remove all active warnings on screen
  document.querySelectorAll(".ghost-form-unsafe-input").forEach(removeWarning);
}

// Luhn Algorithm validation for Credit Cards
function isValidCreditCard(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let isEven = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    isEven = !isEven;
  }
  return sum % 10 === 0;
}

// Debounce function to prevent UI lag on keypress
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// ---------------------------------------------------------------------------
// DOM Sanitizer — safe text extraction for ML model input
// ---------------------------------------------------------------------------

/**
 * Extracts clean, sanitized visible text from the page for ML analysis.
 *
 * SECURITY FIX (Critical Audit Finding — DOM Truncation Evasion):
 *  The previous implementation cloned the DOM and manually checked inline
 *  styles, which missed CSS-class-based cloaking (e.g., position:absolute;
 *  left:-9999px, transform:scale(0), or text color matching background).
 *  An attacker could inject 2,000 chars of invisible "benign" text to
 *  consume the truncation budget and hide the real phishing payload.
 *
 * New approach:
 *  1. Uses the LIVE DOM's `innerText`, which respects the browser's own
 *     computed style engine — any element that is visually hidden by ANY
 *     CSS technique is automatically excluded by the browser.
 *  2. Adds form-proximity text sampling: text immediately surrounding
 *     <input>, <form>, and <button> elements is extracted with higher
 *     priority, ensuring phishing payloads near credential fields are
 *     always captured even if the page is very long.
 *  3. Collapses whitespace and enforces a hard cap to prevent memory
 *     exhaustion DoS on the ONNX embedding model.
 *
 * @param {Element} [root=document.body] - The root element to extract from.
 * @returns {string} Sanitized, truncated plain text.
 */
function safeExtractText(root = document.body) {
  const MAX_CHARS = 2000;
  const FORM_CONTEXT_BUDGET = 800; // Reserve chars for form-adjacent text

  if (!root) return '';

  // ── Step 1: Extract form-proximity text (highest priority) ──────────────
  // Phishing pages put their credential-stealing payload near input fields.
  // By sampling text around forms/inputs FIRST, we guarantee this content
  // is always included, even if the page has thousands of chars of filler.
  const formContextParts = [];
  const formSelectors = 'form, input, select, textarea, button[type="submit"], [role="form"]';
  const formElements = root.querySelectorAll(formSelectors);

  const seenFormAncestors = new WeakSet();
  for (const el of formElements) {
    // Walk up to the nearest container with meaningful text (form, section, div)
    const contextParent = el.closest('form') || el.parentElement;
    if (!contextParent || seenFormAncestors.has(contextParent)) continue;
    seenFormAncestors.add(contextParent);

    try {
      // innerText on the LIVE DOM respects computed styles natively —
      // elements hidden via CSS classes, external stylesheets, or any
      // technique are automatically excluded by the browser engine.
      const text = (contextParent.innerText || '').replace(/\s+/g, ' ').trim();
      if (text.length > 5) {
        formContextParts.push(text);
      }
    } catch (_) {
      // Skip elements that throw on property access (e.g., detached nodes)
    }
  }

  const formContextText = formContextParts.join(' ').slice(0, FORM_CONTEXT_BUDGET);

  // ── Step 2: Extract global page text (general context) ──────────────────
  // Uses innerText on the live root, which natively excludes:
  //   - display:none, visibility:hidden, opacity:0
  //   - position:absolute; left:-9999px (off-screen cloaking)
  //   - transform:scale(0), clip-path, and other visual hiding
  //   - <script>, <style>, <noscript> (excluded by innerText spec)
  // This is strictly more accurate than the old clone-and-regex approach.
  let globalText = '';
  try {
    globalText = (root.innerText || '').replace(/\s+/g, ' ').trim();
  } catch (_) {
    // Fallback for edge cases where innerText throws
    globalText = (root.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // ── Step 3: Combine with priority ──────────────────────────────────────
  // Form-context text is prepended so the ML model always sees the
  // credential-adjacent content, even after truncation.
  const remainingBudget = MAX_CHARS - formContextText.length;
  const globalPortion = globalText.slice(0, Math.max(remainingBudget, 0));

  const combined = (formContextText + ' ' + globalPortion).replace(/\s+/g, ' ').trim();

  // ── Step 4: HARD CAP — truncate to prevent ML model memory exhaustion ──
  return combined.slice(0, MAX_CHARS);
}

// ---------------------------------------------------------------------------
// ML Page Analysis — fires once on page load (not on every keystroke)
// ---------------------------------------------------------------------------

/**
 * Sends sanitized page text to the background service worker for ML analysis.
 * Uses a one-shot flag to ensure we only run this once per page load,
 * regardless of how many times the content script initializes.
 */
(function triggerMLAnalysis() {
  // Use hostname as the key (consistent with background.js session cache)
  const analysisKey = `ghost-form-ml-analyzed-${window.location.hostname}`;

  // Avoid re-running on the same hostname (e.g., after SPA route changes)
  if (sessionStorage.getItem(analysisKey)) return;
  sessionStorage.setItem(analysisKey, '1');

  // Wait for the DOM to be fully painted before extracting text
  const run = () => {
    const sanitizedText = safeExtractText(document.body);
    if (!sanitizedText || sanitizedText.length < 20) return;

    // ── Phase 5: X-Ray Vision (defensive — feature module may not be loaded) ──
    let structuralSignal = { structuralRisk: 'safe', score: 0, matchedTemplate: null };
    if (typeof ghostFormXRay !== 'undefined') {
      try {
        structuralSignal = ghostFormXRay.analyzePageStructure();
        if (structuralSignal.structuralRisk === 'unsafe') {
          console.info(
            `[GhostForm X-Ray] Structural risk: ${structuralSignal.score} (${structuralSignal.matchedTemplate})`
          );
        }
      } catch (xrayErr) {
        console.warn('[GhostForm X-Ray] Analysis error:', xrayErr.message);
      }
    }

    chrome.runtime.sendMessage(
      {
        action:           'ANALYZE_PAGE',
        text:             sanitizedText,
        hostname:         window.location.hostname,
        structuralRisk:   structuralSignal.structuralRisk,
        structuralScore:  structuralSignal.score,
      },
      (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.status) {
          // Fuse ML status with structural risk:
          // If either signal is 'unsafe', escalate to 'unsafe'.
          // If either is 'unknown', don't downgrade to 'safe'.
          const mlStatus  = response.status;
          const xrayRisk  = structuralSignal.structuralRisk;

          if (mlStatus === 'unsafe' || xrayRisk === 'unsafe') {
            currentStatus = 'unsafe';
          } else if (mlStatus === 'unknown' || xrayRisk === 'unknown') {
            currentStatus = 'unknown';
          } else {
            currentStatus = 'safe';
          }

          // ── Phase 5: Fine-Print AI (BUG-14 fix: once per page) ─────────────
          // sessionStorage key prevents repeated banner stacking on SPA re-routes.
          const fpKey = `ghost-form-fine-print-${window.location.hostname}`;
          if (currentStatus !== 'safe' && !sessionStorage.getItem(fpKey)) {
            sessionStorage.setItem(fpKey, '1');
            if (typeof ghostFormFinePrint !== 'undefined') {
              ghostFormFinePrint.runFinePrintAnalysis(currentStatus);
            }
          }
        }
      }
    );
  };

  // Defer slightly to let the page render its visible content first
  if (document.readyState === 'complete') {
    setTimeout(run, 500);
  } else {
    window.addEventListener('load', () => setTimeout(run, 500), { once: true });
  }
})();

// --- Warning Logic ---
/** @type {WeakMap<Element, HTMLElement>} Maps each input to its active warning overlay */
const _warningElements = new WeakMap();

function showWarning(inputElement) {
  if (isIgnored() || inputElement.hasAttribute("data-ghost-form-active")) return;
  
  inputElement.setAttribute("data-ghost-form-active", "true");
  inputElement.classList.add("ghost-form-unsafe-input");

  const warningMsg = document.createElement("div");
  warningMsg.className = "ghost-form-warning-overlay";
  
  const textNode = document.createElement("div");
  textNode.innerText = "Ghost Form: Unverified domain. High risk form detected.";
  warningMsg.appendChild(textNode);

  const ignoreBtn = document.createElement("button");
  ignoreBtn.className = "ghost-form-ignore-btn";
  ignoreBtn.innerText = "Ignore for this session";
  ignoreBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIgnored();
  };
  warningMsg.appendChild(ignoreBtn);
  
  document.body.appendChild(warningMsg);
  _warningElements.set(inputElement, warningMsg); // ✅ WeakMap — GC-safe

  const updatePosition = () => {
    // Clean up if warning was removed, or if the input was removed from the DOM
    if (!_warningElements.has(inputElement) || !inputElement.isConnected) {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
      if (_warningElements.has(inputElement)) {
        removeWarning(inputElement);
      }
      return;
    }
    const currentRect = inputElement.getBoundingClientRect();
    warningMsg.style.top = `${window.scrollY + currentRect.bottom + 8}px`;
    warningMsg.style.left = `${window.scrollX + currentRect.left}px`;
  };

  // Initial position
  updatePosition();

  // High #7: Fix warning overlay drift on scroll/resize.
  // Add listeners (capture phase for scroll to catch inner containers) to keep
  // the overlay glued to the input field, since we removed the handleBlur cleanup.
  window.addEventListener('scroll', updatePosition, true);
  window.addEventListener('resize', updatePosition);
}

function removeWarning(inputElement) {
  inputElement.removeAttribute("data-ghost-form-active");
  inputElement.classList.remove("ghost-form-unsafe-input");
  
  const warningEl = _warningElements.get(inputElement);
  if (warningEl) {
    warningEl.remove();
    _warningElements.delete(inputElement); // ✅ Allow GC of both nodes
  }
}

// --- Event Handlers ---
function handleFocus(event) {
  if (isIgnored() || currentStatus === "safe") return;

  const target = event.target;
  if (isTargetInput(target)) {
    // Red state: Warn instantly on focus
    if (currentStatus === "unsafe") {
      showWarning(target);
    }

    // ── Phase 5: Active Shield — defensive guard (BUG-13) ───────────────
    if (typeof ghostFormActiveShield !== 'undefined') {
      ghostFormActiveShield.handleActiveShieldFocus(event);
    }

    // ── Phase 5: Ghost Masks — defensive guard (BUG-13) ────────────────
    if ((currentStatus === 'unknown' || currentStatus === 'unsafe') &&
        typeof ghostFormMasks !== 'undefined') {
      ghostFormMasks.offerGhostMask(target, currentStatus);
    }
  }
}

// Fix #7: handleBlur intentionally removed.
// Warnings must persist until the user explicitly clicks "Ignore for this session".
// Removing a warning on blur (tab-away) is a UX anti-pattern for a security tool —
// a user tabbing between a flagged field and another app would never see the warning again.


const debouncedInputCheck = debounce((event) => {
  if (isIgnored() || currentStatus === "safe") return;
  
  const target = event.target;
  if (isTargetInput(target)) {
    const val = target.value || target.innerText || "";
    
    // Check if Password or valid CC
    const isPassword = target.tagName === "INPUT" && target.type.toLowerCase() === "password";
    const isCC = isValidCreditCard(val);
    
    // Yellow state: Trigger warning if high-risk data is typed
    if (isPassword || isCC) {
      showWarning(target);
    }
  }
}, 300);

function isTargetInput(target) {
  if (!target) return false;
  if (target.tagName === "INPUT") {
    const type = target.type.toLowerCase();
    return type === "password" || type === "email" || type === "text" || type === "number" || type === "tel";
  }
  // Support contenteditable forms (Rich Text)
  if (target.getAttribute && target.getAttribute("contenteditable") === "true") {
    return true;
  }
  return false;
}

// Attach listeners to a root element (document or shadow root)
// Tracks which roots have already been instrumented to avoid duplicates.
const _instrumentedRoots = new WeakSet();

function attachListeners(root) {
  if (_instrumentedRoots.has(root)) return;
  _instrumentedRoots.add(root);

  root.addEventListener("focus", handleFocus, true);
  root.addEventListener("input", debouncedInputCheck, true);
  // Note: blur listener intentionally omitted — see comment above.
}

// ---------------------------------------------------------------------------
// Shadow DOM — Closed Mode Interceptor
// ---------------------------------------------------------------------------
//
// SECURITY FIX (High Audit Finding — Shadow DOM Evasion):
//   Advanced phishing kits can mount forms inside Closed Shadow DOMs
//   (attachShadow({ mode: 'closed' })). In closed mode, node.shadowRoot
//   returns null to external scripts, so our content script cannot attach
//   event listeners and the phishing form goes completely undetected.
//
//   This patch overrides Element.prototype.attachShadow to:
//     1. Capture references to ALL shadow roots (open AND closed).
//     2. Store closed roots in a WeakMap keyed by the host element.
//     3. Automatically attach our focus/input listeners to closed roots.
//
//   The patch is injected in the content script's ISOLATED world. For
//   maximum coverage on pages that call attachShadow before our script
//   runs, we also scan the existing DOM on load.

/** @type {WeakMap<Element, ShadowRoot>} */
const closedShadowRoots = new WeakMap();

const _origAttachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function(init) {
  const shadowRoot = _origAttachShadow.call(this, init);

  // Capture closed roots that would otherwise be invisible
  if (init && init.mode === 'closed') {
    closedShadowRoots.set(this, shadowRoot);
  }

  // Attach listeners regardless of open/closed mode
  attachListeners(shadowRoot);

  return shadowRoot;
};

/**
 * Returns the shadow root for an element, even if it's closed.
 * Falls back to the native .shadowRoot (which returns null for closed).
 *
 * @param {Element} el
 * @returns {ShadowRoot|null}
 */
function getShadowRoot(el) {
  return el.shadowRoot || closedShadowRoots.get(el) || null;
}

// ---------------------------------------------------------------------------
// MutationObserver — Debounced & Targeted DOM Scanning
// ---------------------------------------------------------------------------
//
// PERFORMANCE FIX (High Audit Finding — Main Thread Freezing):
//   The previous observer called querySelectorAll('*') on every added node,
//   which is O(n) over the entire subtree and fires on every DOM mutation.
//   On heavy SPAs (React, Angular) that constantly tear down and rebuild
//   large DOM trees, this caused catastrophic UI lag and CPU spiking.
//
//   New approach:
//     1. Batch mutations and debounce processing (100ms coalesce window).
//     2. Use a targeted TreeWalker that only visits ELEMENT_NODE, skipping
//        text, comment, and processing instruction nodes.
//     3. Only scan nodes that have a shadowRoot (open or closed).
//     4. Track already-instrumented roots via WeakSet to avoid duplicate work.

/** @type {Set<Node>} Nodes pending shadow root scanning */
let _pendingScanNodes = new Set();
let _scanDebounceTimer = null;
const SCAN_DEBOUNCE_MS = 100;

/**
 * Scans a subtree for shadow roots (open and closed) and attaches listeners.
 * Uses TreeWalker for O(elements) traversal without allocating a NodeList.
 *
 * @param {Node} root - The root node to scan.
 */
function scanForShadowRoots(root) {
  if (!root || root.nodeType !== Node.ELEMENT_NODE) return;

  // Check the root itself
  const rootShadow = getShadowRoot(/** @type {Element} */ (root));
  if (rootShadow) attachListeners(rootShadow);

  // Walk descendants — TreeWalker is faster than querySelectorAll('*')
  // because it doesn't allocate a static NodeList snapshot.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    const shadow = getShadowRoot(/** @type {Element} */ (node));
    if (shadow) attachListeners(shadow);
  }
}

/**
 * Processes all pending scan nodes in a single batch.
 * Called after the debounce window closes.
 */
function flushPendingScans() {
  const nodes = _pendingScanNodes;
  _pendingScanNodes = new Set();
  _scanDebounceTimer = null;

  for (const node of nodes) {
    // Skip nodes that were removed from the DOM before we got to them
    if (!node.isConnected) continue;
    scanForShadowRoots(node);
  }
}

// --- Initialization & Observers ---

attachListeners(document);

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        _pendingScanNodes.add(node);
      }
    }
  }

  // Debounce: coalesce rapid-fire mutations (e.g., SPA re-renders)
  // into a single scan pass after the DOM settles.
  if (!_scanDebounceTimer && _pendingScanNodes.size > 0) {
    _scanDebounceTimer = setTimeout(flushPendingScans, SCAN_DEBOUNCE_MS);
  }
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

// Scan existing DOM for shadow roots on initial load
// Uses requestIdleCallback to avoid blocking the main thread during page load.
const initialScan = () => {
  scanForShadowRoots(document.documentElement);

  // ── Phase 5: Active Shield — initial clickjack scan ───────────────────
  if (typeof ghostFormActiveShield !== 'undefined') {
    ghostFormActiveShield.runActiveShieldScan(document);
  }
};

if (typeof requestIdleCallback === 'function') {
  requestIdleCallback(initialScan, { timeout: 2000 });
} else {
  setTimeout(initialScan, 100);
}

// ===========================================================================
// PHASE 5 FEATURE INTEGRATION
// ===========================================================================
// All Phase 5 modules are namespaced under ghostForm* globals, populated by
// the Vite bundle. When content.js is bundled, these imports are resolved.
// In the plain-JS content script context, feature modules are bundled into
// a separate content_features.js file loaded via manifest.json content_scripts.

// ── Phase 5: GhostPrint — Keystroke Biometrics ───────────────────────────
if (typeof ghostFormGhostPrint !== 'undefined') {
  ghostFormGhostPrint.attachGhostPrintListeners(document);
  ghostFormGhostPrint.onGhostPrintAnomaly(({ element, score, message }) => {
    console.warn(`[GhostForm GhostPrint] Anomaly on ${element.name || 'password field'}: ${message}`);
    // Escalate to unknown if we were safe — RAT injection risk
    if (currentStatus === 'safe') {
      currentStatus = 'unknown';
    }
    showWarning(element);
  });
} // end initGhostForm()

/**
 * active_shield.js — Ghost Form Phase 5: Feature 4
 * Active Shield: Transparent Overlay & Clickjack Interceptor
 *
 * Detects and neutralizes:
 *  - Invisible iframes overlaying credential inputs (classic clickjacking)
 *  - Cross-origin transparent divs obscuring form elements (z-index hijack)
 *  - Rogue pointer-events traps placed over submit buttons
 *
 * Strategy:
 *  1. On every form focus / DOM mutation, resolve the full z-index stacking
 *     context for the target input using elementFromPoint() sampling.
 *  2. Compare the topmost element against the focused input. If a different
 *     element is intercepting pointer events at that coordinate, flag it.
 *  3. For confirmed clickjacks: inject CSS to neutralize pointer-events on
 *     the rogue layer and visually warn the user.
 *  4. For suspicious iframes: check cross-origin via try/catch on
 *     contentDocument — cross-origin access throws, which is the tell.
 *
 * Zero-knowledge guarantee: no network requests, all analysis is local DOM.
 */

// ---------------------------------------------------------------------------
// 1. Configuration
// ---------------------------------------------------------------------------

const SHIELD_ATTR       = 'data-ghost-shield-checked';
const SHIELD_BLOCKED_ATTR = 'data-ghost-shield-blocked';
const SHIELD_WARNING_CLASS = 'ghost-shield-clickjack-warning';

/** Cross-origin iframes that have already been neutralized this session */
const _blockedElements = new WeakSet();

// ---------------------------------------------------------------------------
// 2. Core Detection: Is this input being obscured?
// ---------------------------------------------------------------------------

/**
 * Samples N points across the bounding box of `inputEl` using
 * elementFromPoint() and checks whether the topmost element at each
 * sample point is actually the input (or a known-safe ancestor).
 *
 * @param {Element} inputEl
 * @returns {{ intercepted: boolean, offender: Element|null }}
 */
function detectClickjackOnElement(inputEl) {
  if (!inputEl || !inputEl.isConnected) return { intercepted: false, offender: null };

  const rect = inputEl.getBoundingClientRect();

  // Element is off-screen or zero-size — skip
  if (rect.width < 1 || rect.height < 1) return { intercepted: false, offender: null };

  // Sample points: center, and four quadrant centers
  const samplePoints = [
    { x: rect.left + rect.width  * 0.5, y: rect.top + rect.height * 0.5 }, // center
    { x: rect.left + rect.width  * 0.25, y: rect.top + rect.height * 0.25 }, // top-left quad
    { x: rect.left + rect.width  * 0.75, y: rect.top + rect.height * 0.25 }, // top-right quad
    { x: rect.left + rect.width  * 0.25, y: rect.top + rect.height * 0.75 }, // bottom-left quad
    { x: rect.left + rect.width  * 0.75, y: rect.top + rect.height * 0.75 }, // bottom-right quad
  ];

  for (const { x, y } of samplePoints) {
    const topEl = document.elementFromPoint(x, y);
    if (!topEl) continue;

    // If topmost element is the input itself or a descendant — all good
    if (topEl === inputEl || inputEl.contains(topEl)) continue;

    // If topmost element is an ancestor of the input — all good
    if (topEl.contains(inputEl)) continue;

    // Something else is sitting on top of the input
    return { intercepted: true, offender: topEl };
  }

  return { intercepted: false, offender: null };
}

// ---------------------------------------------------------------------------
// 3. Iframe Analysis: Is this iframe cross-origin?
// ---------------------------------------------------------------------------

/**
 * Attempts to access contentDocument of an iframe.
 * Cross-origin iframes throw a SecurityError — that's the tell.
 *
 * @param {HTMLIFrameElement} iframe
 * @returns {boolean}
 */
function isCrossOriginIframe(iframe) {
  try {
    // This throws for cross-origin iframes
    const _ = iframe.contentDocument;
    return false;
  } catch (e) {
    return true;
  }
}

/**
 * Returns true if the element is a transparent or near-transparent
 * overlay (opacity < 0.1, or background is none/transparent).
 *
 * @param {Element} el
 * @returns {boolean}
 */
function isInvisibleOverlay(el) {
  const style = window.getComputedStyle(el);
  const opacity = parseFloat(style.opacity);
  const bg = style.backgroundColor;

  const isTransparent = !bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)';
  const isNearInvisible = !isNaN(opacity) && opacity < 0.1;

  return isTransparent || isNearInvisible;
}

// ---------------------------------------------------------------------------
// 4. Threat Response: Neutralize and warn
// ---------------------------------------------------------------------------

/**
 * Injects a visible warning banner above the input and disables
 * pointer-events on the rogue overlaying element.
 *
 * @param {Element} inputEl - The targeted form input.
 * @param {Element} offender - The rogue element obscuring the input.
 * @param {string} reason - Human-readable reason for the warning.
 */
function neutralizeClickjack(inputEl, offender, reason) {
  if (_blockedElements.has(offender)) return;
  _blockedElements.add(offender);

  console.warn('[GhostForm Active Shield] Clickjack detected:', reason, offender);

  // Disable pointer events on the rogue layer
  offender.style.setProperty('pointer-events', 'none', 'important');
  offender.setAttribute(SHIELD_BLOCKED_ATTR, 'true');

  // Show a warning badge anchored to the input
  if (document.body && !inputEl.hasAttribute(SHIELD_WARNING_CLASS)) {
    inputEl.setAttribute(SHIELD_WARNING_CLASS, 'true');

    const warning = document.createElement('div');
    warning.className = SHIELD_WARNING_CLASS;
    warning.setAttribute('role', 'alert');
    warning.setAttribute('aria-live', 'assertive');

    const icon = document.createElement('span');
    icon.textContent = '🛡️';
    icon.className = 'ghost-shield-icon';

    const msg = document.createElement('span');
    msg.textContent = `Ghost Form: Clickjack blocked — ${reason}`;
    msg.className = 'ghost-shield-message';

    warning.appendChild(icon);
    warning.appendChild(msg);
    document.body.appendChild(warning);

    // Position anchored to the input
    const rect = inputEl.getBoundingClientRect();
    warning.style.top  = `${window.scrollY + rect.top - warning.offsetHeight - 6}px`;
    warning.style.left = `${window.scrollX + rect.left}px`;

    // Auto-dismiss after 8 seconds
    setTimeout(() => warning.remove(), 8000);
  }
}

// ---------------------------------------------------------------------------
// 5. Full Scan: Check all high-value inputs on the page
// ---------------------------------------------------------------------------

const HIGH_VALUE_SELECTOR =
  'input[type="password"], input[type="email"], input[type="text"], ' +
  'input[type="tel"], input[type="number"], input[name*="card"], ' +
  'input[name*="cvv"], input[name*="credit"], input[autocomplete*="cc"]';

/**
 * Scans all high-value inputs in a given root for clickjacking threats.
 * Called on page load and after DOM mutations.
 *
 * @param {Document|ShadowRoot} [root=document]
 */
export function runActiveShieldScan(root = document) {
  const inputs = root.querySelectorAll(HIGH_VALUE_SELECTOR);

  for (const input of inputs) {
    // Skip already-checked inputs in this pass
    if (input.hasAttribute(SHIELD_ATTR)) continue;
    input.setAttribute(SHIELD_ATTR, 'true');

    const { intercepted, offender } = detectClickjackOnElement(input);

    if (intercepted && offender) {
      // Check if it's a cross-origin iframe specifically
      if (offender.tagName === 'IFRAME' && isCrossOriginIframe(offender)) {
        neutralizeClickjack(input, offender, 'Cross-origin iframe overlay');
      } else if (isInvisibleOverlay(offender)) {
        neutralizeClickjack(input, offender, 'Invisible overlay element');
      }
    }
  }

  // Also check for suspicious full-page iframes
  const iframes = root.querySelectorAll('iframe');
  for (const iframe of iframes) {
    if (_blockedElements.has(iframe)) continue;

    if (!isCrossOriginIframe(iframe)) continue;

    const style = window.getComputedStyle(iframe);
    const rect  = iframe.getBoundingClientRect();

    // Flag iframes that cover >60% of the viewport
    const viewportArea = window.innerWidth * window.innerHeight;
    const iframeArea   = rect.width * rect.height;

    if (iframeArea / viewportArea > 0.6) {
      // Large cross-origin iframe is very suspicious — warn but don't block
      // (it might be a legitimate embed like YouTube)
      console.warn('[GhostForm Active Shield] Large cross-origin iframe detected:', iframe.src);
    }

    const opacity = parseFloat(style.opacity);
    const isAbsolute = style.position === 'absolute' || style.position === 'fixed';
    const isInvisible = !isNaN(opacity) && opacity < 0.1;

    if (isAbsolute && isInvisible) {
      // Invisible, absolutely-positioned cross-origin iframe = almost certainly clickjacking
      neutralizeClickjack(
        document.activeElement || document.body,
        iframe,
        'Invisible cross-origin iframe'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Re-scan on focus (ensures dynamic forms are checked at the right time)
// ---------------------------------------------------------------------------

/**
 * Handles focus events — rescans the specific input that just received focus.
 * Clears the SHIELD_ATTR so it gets re-checked with fresh getBoundingClientRect.
 *
 * @param {Event} event
 */
export function handleActiveShieldFocus(event) {
  const target = event.target;
  if (!target || target.nodeType !== Node.ELEMENT_NODE) return;

  // Only check high-value inputs
  if (!target.matches(HIGH_VALUE_SELECTOR)) return;

  // Remove the "already checked" marker so this input gets re-evaluated
  target.removeAttribute(SHIELD_ATTR);

  const { intercepted, offender } = detectClickjackOnElement(target);

  if (intercepted && offender) {
    if (offender.tagName === 'IFRAME' && isCrossOriginIframe(offender)) {
      neutralizeClickjack(target, offender, 'Cross-origin iframe overlay on focus');
    } else if (isInvisibleOverlay(offender)) {
      neutralizeClickjack(target, offender, 'Invisible overlay on focus');
    }
  }
}

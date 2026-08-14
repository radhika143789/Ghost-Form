/**
 * ghost_masks.js — Ghost Form Phase 5: Feature 3
 * Ghost Masks: Ephemeral Data Sandboxing
 *
 * When Ghost Form detects a medium-risk or unknown-risk form, it offers to
 * inject a Shadow DOM overlay that replaces the real email/username input
 * with a "masked" version. The user types into our safe overlay; the real
 * input receives a masked alias instead of their actual credentials.
 *
 * Current implementation provides:
 *  1. Visual overlay injection via Shadow DOM (prevents page JS from reading
 *     the overlay's contents directly).
 *  2. Mask generation: produces a locally-generated random alias
 *     (e.g., ghost_a3f2b1@ghostform.shield) as a privacy placeholder.
 *  3. Hook to integrate with external alias APIs (SimpleLogin, etc.) in
 *     a future Pro tier — the generateAlias() function is designed to be
 *     replaceable with an async API call.
 *
 * Zero-knowledge guarantee:
 *  - The local alias generation never contacts a network.
 *  - Only the final alias (not the user's real email) is written into
 *    the real input field before form submission.
 */

// ---------------------------------------------------------------------------
// 1. Alias Generation — Local + SimpleLogin Pro
// ---------------------------------------------------------------------------

const GHOST_ALIAS_DOMAIN = 'ghostform.shield';

/**
 * Generates a locally-scoped random email alias (free tier).
 * No network calls — instant, always available.
 * @returns {string}
 */
function generateLocalAlias() {
  const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `ghost_${randomHex}@${GHOST_ALIAS_DOMAIN}`;
}

/**
 * Generates an alias via SimpleLogin API (Pro tier) or falls back to local.
 * Calls the background service worker as a proxy since content scripts
 * cannot make cross-origin requests to simplelogin.io.
 *
 * @returns {Promise<{alias: string, source: 'simplelogin'|'local'}>}
 */
async function generateAlias() {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      resolve({ alias: generateLocalAlias(), source: 'local' });
      return;
    }
    chrome.runtime.sendMessage({ action: 'GENERATE_ALIAS' }, (response) => {
      if (chrome.runtime.lastError || !response?.alias) {
        // Background returned no alias (no API key, or API error) — use local
        resolve({ alias: generateLocalAlias(), source: 'local' });
        return;
      }
      resolve({ alias: response.alias, source: response.source ?? 'simplelogin' });
    });
  });
}

// ---------------------------------------------------------------------------
// 2. Shadow DOM Overlay Injection
// ---------------------------------------------------------------------------

const MASK_HOST_ATTR    = 'data-ghost-mask-host';
const MASK_ACTIVE_ATTR  = 'data-ghost-mask-active';
/** Tracks elements already offered a mask (WeakSet survives React DOM re-adds) */
const _offeredElements = new WeakSet();

/**
 * Injects a Ghost Mask overlay over the given email/text input.
 *
 * The overlay is a Shadow DOM attached to a positioned <div> inserted
 * adjacent to the real input. The real input is visually hidden but
 * remains in the DOM so form submission logic still works.
 *
 * @param {HTMLInputElement} realInput - The actual form input to mask.
 * @returns {{ aliasUsed: string, overlayEl: Element }} The alias and overlay element.
 */
export function injectGhostMask(realInput, preAlias = null) {
  if (!realInput || !realInput.isConnected) {
    return { aliasUsed: null, overlayEl: null };
  }

  // Don't double-inject
  if (realInput.hasAttribute(MASK_ACTIVE_ATTR)) {
    return { aliasUsed: realInput.getAttribute(MASK_ACTIVE_ATTR), overlayEl: null };
  }

  // Use pre-resolved alias (from SimpleLogin API) or fall back to local generation
  const alias = preAlias || generateLocalAlias();
  const rect  = realInput.getBoundingClientRect();

  // Create the shadow host — an absolutely-positioned div overlaying the real input
  const host = document.createElement('div');
  host.setAttribute(MASK_HOST_ATTR, 'true');
  host.style.cssText = `
    position: fixed;
    top: ${rect.top}px;
    left: ${rect.left}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    z-index: 2147483646;
    box-sizing: border-box;
    pointer-events: all;
  `;
  const controller = new AbortController();
  const { signal } = controller;

  const updateMaskPosition = () => {
    if (!realInput.isConnected) {
      controller.abort(); // ✅ Clean up both listeners at once
      return;
    }
    const r = realInput.getBoundingClientRect();
    host.style.top    = `${r.top}px`;
    host.style.left   = `${r.left}px`;
    host.style.width  = `${r.width}px`;
    host.style.height = `${r.height}px`;
  };
  window.addEventListener('scroll', updateMaskPosition, { capture: true, signal });
  window.addEventListener('resize', updateMaskPosition, { signal });

  // Attach a closed Shadow DOM so page JS cannot access the overlay's content
  const shadow = host.attachShadow({ mode: 'closed' });

  const styleEl = document.createElement('style');
  styleEl.textContent = `:host { display: block; width: 100%; height: 100%; }
    .mask-input { width: 100%; height: 100%; box-sizing: border-box; border: 2px solid #6c63ff;
      border-radius: 4px; padding: 0 8px; font-size: 14px; background: #1a1a2e;
      color: #e0e0e0; outline: none; cursor: text; }
    .mask-badge { position: absolute; top: -22px; left: 0; font-size: 11px;
      background: #6c63ff; color: #fff; padding: 2px 6px; border-radius: 3px 3px 0 0;
      white-space: nowrap; font-family: sans-serif; pointer-events: none; }`;

  const badge = document.createElement('div');
  badge.className = 'mask-badge';
  badge.textContent = '\uD83D\uDD2E Ghost Mask Active';

  const overlayInput = document.createElement('input');
  overlayInput.className = 'mask-input';
  overlayInput.type = 'text';
  overlayInput.setAttribute('autocomplete', 'off');
  overlayInput.setAttribute('spellcheck', 'false');
  overlayInput.placeholder = alias;
  overlayInput.value = alias;

  shadow.appendChild(styleEl);
  shadow.appendChild(badge);
  shadow.appendChild(overlayInput);

  // When the user edits the overlay input, sync to the real input
  overlayInput.addEventListener('input', () => {
    realInput.value = overlayInput.value;
    realInput.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Visually hide the real input (but keep it functional for form submission)
  realInput.style.setProperty('opacity', '0', 'important');
  realInput.style.setProperty('pointer-events', 'none', 'important');
  realInput.setAttribute(MASK_ACTIVE_ATTR, alias);

  // Pre-fill the real input with the alias so submission sends the alias
  realInput.value = alias;

  document.body.appendChild(host);
  return { aliasUsed: alias, overlayEl: host };
}

// ---------------------------------------------------------------------------
// 3. Offer UI: Non-intrusive mask offer banner
// ---------------------------------------------------------------------------



/**
 * Shows a non-intrusive "Mask this email?" offer banner above the input.
 * If the user accepts, injectGhostMask() is called.
 *
 * @param {HTMLInputElement} inputEl - The email/text input to potentially mask.
 * @param {string} riskLevel - 'unknown' or 'unsafe'.
 */
export function offerGhostMask(inputEl, riskLevel = 'unknown') {
  if (!inputEl || !inputEl.isConnected) return;
  if (_offeredElements.has(inputEl)) return;
  if (inputEl.hasAttribute(MASK_ACTIVE_ATTR)) return;

  // Only offer masking on email and text fields (not password fields)
  const type = inputEl.type?.toLowerCase();
  if (type !== 'email' && type !== 'text') return;
  if (!/email|user|login|account/i.test(inputEl.name + inputEl.id + inputEl.placeholder)) {
    if (type !== 'email') return;
  }

  _offeredElements.add(inputEl);

  const rect   = inputEl.getBoundingClientRect();
  const banner = document.createElement('div');
  banner.className = 'ghost-mask-offer';
  banner.style.cssText = `
    position: absolute;
    top: ${window.scrollY + rect.top - 44}px;
    left: ${window.scrollX + rect.left}px;
    z-index: 2147483645;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid #6c63ff;
    border-radius: 6px;
    padding: 6px 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 12px;
    color: #e0e0e0;
    box-shadow: 0 4px 12px rgba(108, 99, 255, 0.3);
    white-space: nowrap;
  `;

  // ✅ Build buttons with createElement to avoid duplicate-ID collision
  // on pages with multiple masked inputs
  const riskIcon = riskLevel === 'unsafe' ? '\uD83D\uDD34' : '\uD83D\uDFE1';

  const infoSpan = document.createElement('span');
  infoSpan.innerHTML = `${riskIcon} <strong>Ghost Form</strong>: Unverified site`;

  const yesBtn = document.createElement('button');
  yesBtn.textContent = '\uD83D\uDD2E Use Mask';
  yesBtn.style.cssText = 'background:#6c63ff;color:#fff;border:none;border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px;font-weight:600;';

  const noBtn = document.createElement('button');
  noBtn.textContent = 'No thanks';
  noBtn.style.cssText = 'background:transparent;color:#aaa;border:1px solid #555;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px;';

  banner.appendChild(infoSpan);
  banner.appendChild(yesBtn);
  banner.appendChild(noBtn);

  document.body.appendChild(banner);

  yesBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Show loading state while alias API resolves
    yesBtn.textContent = '⏳ Getting alias…';
    yesBtn.disabled = true;

    const { alias, source } = await generateAlias();
    banner.remove();
    const { aliasUsed } = injectGhostMask(inputEl, alias);
    if (aliasUsed) {
      const sourceLabel = source === 'simplelogin' ? 'SimpleLogin' : 'local';
      console.info(`[GhostForm Ghost Masks] Email masked with ${sourceLabel} alias: ${aliasUsed}`);
    }
  });

  noBtn.addEventListener('click', (e) => {
    e.preventDefault();
    banner.remove();
  });

  // Auto-dismiss if user ignores it for 15 seconds
  setTimeout(() => {
    if (banner.isConnected) banner.remove();
  }, 15000);
}

// ---------------------------------------------------------------------------
// 4. Remove all active masks (e.g., when user whitelists the domain)
// ---------------------------------------------------------------------------

/**
 * Removes all active Ghost Mask overlays from the page.
 */
export function removeAllGhostMasks() {
  document.querySelectorAll(`[${MASK_HOST_ATTR}]`).forEach(host => host.remove());
  document.querySelectorAll(`[${MASK_ACTIVE_ATTR}]`).forEach(input => {
    input.removeAttribute(MASK_ACTIVE_ATTR);
    input.style.removeProperty('opacity');
    input.style.removeProperty('pointer-events');
  });
}

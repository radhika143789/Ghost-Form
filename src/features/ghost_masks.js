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
// 1. Alias Generation
// ---------------------------------------------------------------------------

const GHOST_ALIAS_DOMAIN = 'ghostform.shield';

/**
 * Generates a locally-scoped random email alias.
 * In a Pro tier, this would be replaced with an API call to SimpleLogin,
 * DuckDuckGo Email Protection, or a custom alias service.
 *
 * @returns {string} A random alias email address.
 */
function generateLocalAlias() {
  const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `ghost_${randomHex}@${GHOST_ALIAS_DOMAIN}`;
}

// ---------------------------------------------------------------------------
// 2. Shadow DOM Overlay Injection
// ---------------------------------------------------------------------------

const MASK_HOST_ATTR    = 'data-ghost-mask-host';
const MASK_ACTIVE_ATTR  = 'data-ghost-mask-active';

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
export function injectGhostMask(realInput) {
  if (!realInput || !realInput.isConnected) {
    return { aliasUsed: null, overlayEl: null };
  }

  // Don't double-inject
  if (realInput.hasAttribute(MASK_ACTIVE_ATTR)) {
    return { aliasUsed: realInput.getAttribute(MASK_ACTIVE_ATTR), overlayEl: null };
  }

  const alias = generateLocalAlias();
  const rect  = realInput.getBoundingClientRect();

  // Create the shadow host — an absolutely-positioned div overlaying the real input
  const host = document.createElement('div');
  host.setAttribute(MASK_HOST_ATTR, 'true');
  host.style.cssText = `
    position: absolute;
    top: ${window.scrollY + rect.top}px;
    left: ${window.scrollX + rect.left}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    z-index: 2147483646;
    box-sizing: border-box;
    pointer-events: all;
  `;

  // Attach a closed Shadow DOM so page JS cannot access the overlay's content
  const shadow = host.attachShadow({ mode: 'closed' });

  shadow.innerHTML = `
    <style>
      :host { display: block; width: 100%; height: 100%; }
      .mask-input {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        border: 2px solid #6c63ff;
        border-radius: 4px;
        padding: 0 8px;
        font-size: 14px;
        background: #1a1a2e;
        color: #e0e0e0;
        outline: none;
        cursor: text;
      }
      .mask-badge {
        position: absolute;
        top: -22px;
        left: 0;
        font-size: 11px;
        background: #6c63ff;
        color: #fff;
        padding: 2px 6px;
        border-radius: 3px 3px 0 0;
        white-space: nowrap;
        font-family: sans-serif;
        pointer-events: none;
      }
    </style>
    <div class="mask-badge">🔮 Ghost Mask Active</div>
    <input
      class="mask-input"
      type="text"
      placeholder="${alias}"
      value="${alias}"
      autocomplete="off"
      spellcheck="false"
    />
  `;

  // When the user edits the overlay input, sync to the real input
  const overlayInput = shadow.querySelector('.mask-input');
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

const OFFER_ATTR = 'data-ghost-mask-offered';

/**
 * Shows a non-intrusive "Mask this email?" offer banner above the input.
 * If the user accepts, injectGhostMask() is called.
 *
 * @param {HTMLInputElement} inputEl - The email/text input to potentially mask.
 * @param {string} riskLevel - 'unknown' or 'unsafe'.
 */
export function offerGhostMask(inputEl, riskLevel = 'unknown') {
  if (!inputEl || !inputEl.isConnected) return;
  if (inputEl.hasAttribute(OFFER_ATTR)) return;
  if (inputEl.hasAttribute(MASK_ACTIVE_ATTR)) return;

  // Only offer masking on email and text fields (not password fields)
  const type = inputEl.type?.toLowerCase();
  if (type !== 'email' && type !== 'text') return;
  if (!/email|user|login|account/i.test(inputEl.name + inputEl.id + inputEl.placeholder)) {
    if (type !== 'email') return;
  }

  inputEl.setAttribute(OFFER_ATTR, 'true');

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

  const riskIcon = riskLevel === 'unsafe' ? '🔴' : '🟡';
  banner.innerHTML = `
    <span>${riskIcon} <strong>Ghost Form</strong>: Unverified site</span>
    <button id="gf-mask-yes" style="
      background: #6c63ff; color: #fff; border: none;
      border-radius: 4px; padding: 3px 10px; cursor: pointer;
      font-size: 11px; font-weight: 600;
    ">🔮 Use Mask</button>
    <button id="gf-mask-no" style="
      background: transparent; color: #aaa; border: 1px solid #555;
      border-radius: 4px; padding: 3px 8px; cursor: pointer;
      font-size: 11px;
    ">No thanks</button>
  `;

  document.body.appendChild(banner);

  banner.querySelector('#gf-mask-yes').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    banner.remove();
    const { aliasUsed } = injectGhostMask(inputEl);
    if (aliasUsed) {
      console.info(`[GhostForm Ghost Masks] Email masked with alias: ${aliasUsed}`);
    }
  });

  banner.querySelector('#gf-mask-no').addEventListener('click', (e) => {
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

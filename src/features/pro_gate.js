/**
 * pro_gate.js — Ghost Form Phase 6: Pro Tier Gate
 *
 * Controls access to Pro-tier features:
 *  - SimpleLogin real alias API
 *  - Multi-device sync
 *  - Priority support badge
 *
 * Pro status is cached in chrome.storage.local and verified against
 * Supabase on session start. Offline-first: cached status is trusted
 * for up to 7 days before re-verification is required.
 */

const PRO_CACHE_KEY = 'gf_pro_status';
const PRO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Returns the cached Pro subscription status.
 * @returns {Promise<{active: boolean, plan: string|null, expiresAt: string|null}>}
 */
export async function getProStatus() {
  return new Promise(resolve => {
    chrome.storage.local.get({ [PRO_CACHE_KEY]: null }, result => {
      const cached = result[PRO_CACHE_KEY];
      if (!cached) {
        resolve({ active: false, plan: null, expiresAt: null });
        return;
      }
      // Check if cache is still fresh
      const age = Date.now() - (cached.cachedAt || 0);
      if (age > PRO_CACHE_TTL_MS) {
        // Stale — still return it but mark for refresh
        resolve({ ...cached, stale: true });
        return;
      }
      resolve(cached);
    });
  });
}

/**
 * Quick boolean check for Pro status.
 * @returns {Promise<boolean>}
 */
export async function isPro() {
  const status = await getProStatus();
  return status.active === true;
}

/**
 * Syncs Pro status from Supabase.
 * Called on extension startup and after Stripe checkout completion.
 *
 * @param {string} supabaseUrl
 * @param {string} accessToken - Supabase JWT
 * @returns {Promise<{active: boolean, plan: string|null, expiresAt: string|null}>}
 */
export async function syncProStatus(supabaseUrl, accessToken) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/profiles?select=is_pro,pro_plan,pro_expires_at`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'apikey': accessToken,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    const profile = rows?.[0];

    const status = {
      active: profile?.is_pro === true,
      plan: profile?.pro_plan || null,
      expiresAt: profile?.pro_expires_at || null,
      cachedAt: Date.now(),
    };

    await new Promise(resolve =>
      chrome.storage.local.set({ [PRO_CACHE_KEY]: status }, resolve)
    );

    return status;
  } catch (err) {
    console.warn('[GhostForm Pro] Failed to sync pro status:', err.message);
    // Return cached on network failure
    return getProStatus();
  }
}

/**
 * Clears Pro status cache (used on logout).
 */
export async function clearProStatus() {
  return new Promise(resolve =>
    chrome.storage.local.remove(PRO_CACHE_KEY, resolve)
  );
}

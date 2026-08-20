/**
 * sync.js — Ghost Form Phase 6: Multi-Device Sync
 *
 * Synchronizes user preferences and whitelist across devices
 * using chrome.storage.sync (limited to 100KB, 8KB per item).
 *
 * Strategy: last-write-wins merge with timestamp-based conflict resolution.
 * Sync is opt-in — disabled by default to respect privacy.
 */

const SYNC_ENABLED_KEY = 'gf_sync_enabled';
const SYNC_TIMESTAMP_KEY = 'gf_sync_ts';

/**
 * Check if multi-device sync is enabled.
 * @returns {Promise<boolean>}
 */
export async function isSyncEnabled() {
  return new Promise(resolve => {
    chrome.storage.local.get({ [SYNC_ENABLED_KEY]: false }, result => {
      resolve(result[SYNC_ENABLED_KEY] === true);
    });
  });
}

/**
 * Enable or disable multi-device sync.
 * @param {boolean} enabled
 */
export async function setSyncEnabled(enabled) {
  await new Promise(resolve =>
    chrome.storage.local.set({ [SYNC_ENABLED_KEY]: enabled }, resolve)
  );
  if (enabled) {
    await pushToSync();
  }
}

/**
 * Pushes local whitelist + preferences to chrome.storage.sync.
 */
export async function pushToSync() {
  const enabled = await isSyncEnabled();
  if (!enabled) return;

  const local = await new Promise(resolve =>
    chrome.storage.local.get({
      userWhitelist: [],
      protectionEnabled: true,
    }, resolve)
  );

  const syncPayload = {
    gf_whitelist: local.userWhitelist || [],
    gf_protection: local.protectionEnabled !== false,
    [SYNC_TIMESTAMP_KEY]: Date.now(),
  };

  await new Promise(resolve =>
    chrome.storage.sync.set(syncPayload, resolve)
  );

  console.log('[GhostForm Sync] Pushed to sync:', {
    whitelistCount: syncPayload.gf_whitelist.length,
  });
}

/**
 * Pulls from chrome.storage.sync and merges into local.
 * Uses last-write-wins based on timestamp.
 */
export async function pullFromSync() {
  const enabled = await isSyncEnabled();
  if (!enabled) return;

  const remote = await new Promise(resolve =>
    chrome.storage.sync.get({
      gf_whitelist: [],
      gf_protection: true,
      [SYNC_TIMESTAMP_KEY]: 0,
    }, resolve)
  );

  const localTs = await new Promise(resolve =>
    chrome.storage.local.get({ gf_local_sync_ts: 0 }, r => resolve(r.gf_local_sync_ts))
  );

  const remoteTs = remote[SYNC_TIMESTAMP_KEY] || 0;

  // Last-write-wins: only apply remote if it's newer
  if (remoteTs > localTs) {
    // Merge whitelists (union)
    const localWl = await new Promise(resolve =>
      chrome.storage.local.get({ userWhitelist: [] }, r => resolve(r.userWhitelist))
    );
    const merged = [...new Set([...localWl, ...remote.gf_whitelist])];

    await new Promise(resolve =>
      chrome.storage.local.set({
        userWhitelist: merged,
        protectionEnabled: remote.gf_protection,
        gf_local_sync_ts: remoteTs,
      }, resolve)
    );

    console.log('[GhostForm Sync] Pulled from sync:', {
      mergedWhitelistCount: merged.length,
    });
  }
}

/**
 * Listens for sync changes from other devices and applies them.
 */
export function startSyncListener() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.gf_whitelist || changes.gf_protection) {
      pullFromSync().catch(err =>
        console.warn('[GhostForm Sync] Pull failed:', err.message)
      );
    }
  });
}

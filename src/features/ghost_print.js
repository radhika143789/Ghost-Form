/**
 * ghost_print.js — Ghost Form Phase 5: Feature 1
 * GhostPrint: Zero-Trust Keystroke Biometric Authenticator
 *
 * Detects anomalous typing patterns on password fields that may indicate:
 *  - A Remote Access Trojan (RAT) programmatically filling the field
 *  - An unauthorized user (different typist) at the keyboard
 *  - A bot or automated script injecting credentials
 *
 * Algorithm:
 *  1. Collect keystroke timing (dwell time + flight time) as the user types.
 *  2. After a "baseline" period (first N keystrokes), build a statistical
 *     profile of the user's typing rhythm.
 *  3. For each subsequent keystroke, compute a Mahalanobis-like distance
 *     from the baseline. If the distance exceeds a threshold, fire an alert.
 *
 * Privacy guarantee:
 *  - Only timing deltas (millisecond numbers) are collected — never the
 *    actual key values or typed characters.
 *  - All data stays in memory; nothing is persisted or sent to a server.
 *  - The baseline is cleared when the tab closes (session-scoped).
 */

// ---------------------------------------------------------------------------
// 1. Configuration
// ---------------------------------------------------------------------------

const MIN_BASELINE_KEYSTROKES = 15;  // Minimum keystrokes to build a baseline
const MAX_BASELINE_KEYSTROKES = 40;  // Stop learning after this many keystrokes
const ANOMALY_THRESHOLD       = 2.8; // Z-score threshold for anomaly detection
const MAX_DWELL_MS            = 800; // Cap dwell times to reduce outlier noise
const MAX_FLIGHT_MS           = 1500;// Cap flight times

// ---------------------------------------------------------------------------
// 2. Per-Field State Manager
// ---------------------------------------------------------------------------

/**
 * Holds timing state for a single password input element.
 * Keyed by a WeakMap so state is GC'd when the element is removed.
 *
 * @typedef {{
 *   lastKeydownTime: number,
 *   lastKeyupTime: number,
 *   lastKey: string,
 *   dwellTimes: number[],
 *   flightTimes: number[],
 *   baseline: { dwellMean: number, dwellStd: number, flightMean: number, flightStd: number }|null,
 *   baselineCommitted: boolean,
 *   keystrokeCount: number,
 *   anomalyFired: boolean,
 * }} FieldState
 */

/** @type {WeakMap<Element, FieldState>} */
const _fieldStates = new WeakMap();

/**
 * Returns (or creates) the biometric state for a given input element.
 *
 * @param {Element} el
 * @returns {FieldState}
 */
function getFieldState(el) {
  if (!_fieldStates.has(el)) {
    _fieldStates.set(el, {
      lastKeydownTime:   0,
      lastKeyupTime:     0,
      lastKey:           '',
      dwellTimes:        [],
      flightTimes:       [],
      baseline:          null,
      baselineCommitted: false, // ✅ Set once; prevents drift from long typing sessions
      keystrokeCount:    0,
      anomalyFired:      false,
    });
  }
  return _fieldStates.get(el);
}

// ---------------------------------------------------------------------------
// 3. Statistical Helpers
// ---------------------------------------------------------------------------

/**
 * Computes mean and standard deviation of an array of numbers.
 *
 * @param {number[]} arr
 * @returns {{ mean: number, std: number }}
 */
function computeStats(arr) {
  if (arr.length === 0) return { mean: 0, std: 0 };

  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((acc, v) => acc + (v - mean) ** 2, 0) / arr.length;
  const std = Math.sqrt(variance);

  return { mean, std };
}

/**
 * Computes a two-feature Z-score distance from the baseline.
 * Combines dwell and flight time deviation into a single scalar.
 *
 * @param {number} dwell  - Current keystroke dwell time (ms).
 * @param {number} flight - Current keystroke flight time (ms).
 * @param {{ dwellMean, dwellStd, flightMean, flightStd }} baseline
 * @returns {number} Combined distance score (higher = more anomalous).
 */
function computeAnomalyDistance(dwell, flight, baseline) {
  const { dwellMean, dwellStd, flightMean, flightStd } = baseline;

  const dwellZ  = dwellStd  > 0 ? Math.abs(dwell  - dwellMean)  / dwellStd  : 0;
  const flightZ = flightStd > 0 ? Math.abs(flight - flightMean) / flightStd : 0;

  // Weighted combination: dwell and flight are roughly equally informative
  return (dwellZ * 0.5 + flightZ * 0.5);
}

// ---------------------------------------------------------------------------
// 4. Baseline Builder
// ---------------------------------------------------------------------------

/**
 * Attempts to build or update the baseline from collected timing data.
 * Baseline is considered stable after MIN_BASELINE_KEYSTROKES samples.
 *
 * @param {FieldState} state
 */
function maybeUpdateBaseline(state) {
  // ✅ Once committed, never rebuild — prevents drift if a different
  // typist uses the same field later in the session.
  if (state.baselineCommitted) return;
  if (state.keystrokeCount < MIN_BASELINE_KEYSTROKES) return;

  const dwellStats  = computeStats(state.dwellTimes);
  const flightStats = computeStats(state.flightTimes);

  state.baseline = {
    dwellMean:  dwellStats.mean,
    dwellStd:   dwellStats.std,
    flightMean: flightStats.mean,
    flightStd:  flightStats.std,
  };

  // Lock the baseline after MIN_BASELINE_KEYSTROKES
  state.baselineCommitted = true;
  console.log('[GhostForm GhostPrint] Baseline committed after', state.keystrokeCount, 'keystrokes.');
}

// ---------------------------------------------------------------------------
// 5. Anomaly Callbacks
// ---------------------------------------------------------------------------

/** @type {Array<(event: {element: Element, score: number, message: string}) => void>} */
const _anomalyListeners = [];

/**
 * Registers a callback to be called when a biometric anomaly is detected.
 * The callback receives { element, score, message }.
 *
 * @param {function} callback
 */
export function onGhostPrintAnomaly(callback) {
  _anomalyListeners.push(callback);
}

/**
 * Fires all registered anomaly listeners.
 *
 * @param {Element} element
 * @param {number} score
 * @param {string} message
 */
function emitAnomaly(element, score, message) {
  const event = { element, score, message };
  for (const cb of _anomalyListeners) {
    try { cb(event); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// 6. Event Handlers
// ---------------------------------------------------------------------------

/**
 * Handles keydown events on a monitored password field.
 * Records the keydown timestamp for dwell time calculation.
 *
 * @param {KeyboardEvent} event
 */
export function handleGhostPrintKeydown(event) {
  const target = event.target;
  if (!isMonitoredField(target)) return;

  // Never capture which key was pressed — only the timestamp
  const state = getFieldState(target);
  state.lastKeydownTime = performance.now();
  state.lastKey = 'KEY'; // Anonymized — we never log the actual key value
}

/**
 * Handles keyup events on a monitored password field.
 * Calculates dwell and flight times, updates baseline, detects anomalies.
 *
 * @param {KeyboardEvent} event
 */
export function handleGhostPrintKeyup(event) {
  const target = event.target;
  if (!isMonitoredField(target)) return;

  const state = getFieldState(target);
  const now   = performance.now();

  // Skip modifier keys — they are not representative of typing rhythm
  if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' ||
      event.key === 'Meta'  || event.key === 'CapsLock' || event.key === 'Tab') {
    return;
  }

  // Save previous keyup time BEFORE overwriting (needed for correct flight time)
  const previousKeyupTime = state.lastKeyupTime;

  // Dwell time = time between keydown and keyup for this key
  const dwell = Math.min(now - state.lastKeydownTime, MAX_DWELL_MS);

  // Flight time = time from previous keyup to current keydown (inter-keystroke gap)
  // FIX: Clamp to 0 to prevent negative flight times during overlapping key presses
  // (e.g., fast typing where the next keydown fires before the previous keyup).
  const flight = previousKeyupTime > 0
    ? Math.max(0, Math.min(state.lastKeydownTime - previousKeyupTime, MAX_FLIGHT_MS))
    : 0;

  state.lastKeyupTime = now;  // Now update after using previousKeyupTime
  state.keystrokeCount++;

  // Only record valid timings (skip very first keystroke for flight)
  if (dwell > 0) state.dwellTimes.push(dwell);
  if (state.dwellTimes.length > MAX_BASELINE_KEYSTROKES) state.dwellTimes.shift();
  if (flight > 0 && state.keystrokeCount > 1) state.flightTimes.push(flight);
  if (state.flightTimes.length > MAX_BASELINE_KEYSTROKES) state.flightTimes.shift();

  // Try to build or update the baseline
  maybeUpdateBaseline(state);

  // Anomaly detection: only runs after baseline is established
  if (!state.baseline || state.anomalyFired) return;
  if (state.keystrokeCount <= MIN_BASELINE_KEYSTROKES) return;

  const distance = computeAnomalyDistance(dwell, flight, state.baseline);

  if (distance > ANOMALY_THRESHOLD) {
    state.anomalyFired = true;
    // Auto-reset after 30s to allow re-detection if anomaly persists
    setTimeout(() => { state.anomalyFired = false; }, 30_000);

    console.warn(
      `[GhostForm GhostPrint] Anomalous typing detected on ${target.name || target.id || 'field'}. ` +
      `Distance: ${distance.toFixed(2)} (threshold: ${ANOMALY_THRESHOLD})`
    );

    emitAnomaly(target, distance, `Typing rhythm anomaly detected (score: ${distance.toFixed(2)})`);
  }
}

// ---------------------------------------------------------------------------
// 7. Field Selector
// ---------------------------------------------------------------------------

/**
 * Returns true if the element is a password field that should be monitored.
 *
 * @param {Element} el
 * @returns {boolean}
 */
function isMonitoredField(el) {
  return (
    el &&
    el.tagName === 'INPUT' &&
    el.type?.toLowerCase() === 'password'
  );
}

/**
 * Attaches GhostPrint listeners to all password fields in the given root.
 * Safe to call multiple times — uses the _fieldStates WeakMap to avoid duplication.
 *
 * @param {Document|ShadowRoot} [root=document]
 */
export function attachGhostPrintListeners(root = document) {
  root.addEventListener('keydown', handleGhostPrintKeydown, true);
  root.addEventListener('keyup',   handleGhostPrintKeyup,   true);
}

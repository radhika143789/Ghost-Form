/**
 * content_features.js — Ghost Form Phase 5 Feature Bundle Entry
 *
 * This file is the Vite entry point that bundles all Phase 5 content-script
 * feature modules into a single file loaded alongside content.js.
 *
 * Each feature is exposed as a namespaced global so content.js can access
 * them via `ghostFormXRay.analyzePageStructure()`, etc. This avoids ES
 * module import issues in content scripts, which run in an isolated world
 * but as plain scripts (no native module resolution at runtime).
 */

import * as activeShield from './features/active_shield.js';
import * as xrayVision   from './features/xray_vision.js';
import * as ghostPrint   from './features/ghost_print.js';
import * as ghostMasks   from './features/ghost_masks.js';
import * as finePrintAI  from './features/fine_print_ai.js';
import * as proGate      from './features/pro_gate.js';
import * as billing      from './features/billing.js';
import * as sync         from './features/sync.js';

// Expose as globals — accessed by content.js
// Using window avoids conflicts with local variable scope
window.ghostFormActiveShield = activeShield;
window.ghostFormXRay         = xrayVision;
window.ghostFormGhostPrint   = ghostPrint;
window.ghostFormMasks        = ghostMasks;
window.ghostFormFinePrint    = finePrintAI;
window.ghostFormProGate      = proGate;
window.ghostFormBilling      = billing;
window.ghostFormSync         = sync;

console.log('[GhostForm] Phase 5+6 feature modules loaded:', [
  'Active Shield',
  'X-Ray Vision',
  'GhostPrint',
  'Ghost Masks',
  'Fine-Print AI',
  'Pro Gate',
  'Billing',
  'Sync',
]);

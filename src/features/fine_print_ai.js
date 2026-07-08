/**
 * fine_print_ai.js — Ghost Form Phase 5: Feature 5
 * Fine-Print AI: Local Consent & Dark Pattern Analyzer
 *
 * Reads legal boilerplate adjacent to a form and summarizes key risk signals
 * using the existing Transformers.js embedding pipeline — zero external LLM
 * calls, all analysis stays on-device.
 *
 * Approach (embedding-based, not generative):
 *  Since we already have the all-MiniLM-L6-v2 embedding model available,
 *  we use semantic similarity to match extracted text against a library of
 *  known "dark pattern" canonical phrases. Matches above a threshold trigger
 *  a specific warning label.
 *
 *  This is intentionally lightweight — the model is designed for embeddings,
 *  not generation. A generative SLM (WebGPU-accelerated) can be substituted
 *  in a future iteration once WebNN stabilizes in Chrome.
 *
 * Zero-knowledge guarantee: no network requests, all inference is local.
 */

// ---------------------------------------------------------------------------
// 1. Dark Pattern Detection Corpus
// ---------------------------------------------------------------------------
// Canonical phrases representing known dark patterns or risky consent clauses.
// Embeddings for these are pre-computed and compared against extracted text.

export const DARK_PATTERN_ANCHORS = [
  {
    id: 'recurring_subscription',
    label: '⚠️ Recurring Subscription',
    description: 'May automatically charge you on a recurring basis.',
    canonicalPhrase: 'By clicking submit you agree to a recurring monthly subscription charge which will renew automatically until you cancel.',
    severity: 'high',
  },
  {
    id: 'data_sale',
    label: '⚠️ Data Sold to Third Parties',
    description: 'Your personal data may be sold to third parties.',
    canonicalPhrase: 'We may share or sell your personal information including name email and browsing data with our affiliated partners and third party advertisers.',
    severity: 'high',
  },
  {
    id: 'arbitration_clause',
    label: '📋 Forced Arbitration',
    description: 'Waives your right to a jury trial or class action.',
    canonicalPhrase: 'By using this service you agree to binding arbitration and waive any right to trial by jury or to participate in a class action lawsuit.',
    severity: 'medium',
  },
  {
    id: 'free_trial_trap',
    label: '⚠️ Free Trial Auto-Converts',
    description: 'Free trial automatically converts to paid without notice.',
    canonicalPhrase: 'Your free trial will automatically convert to a paid subscription and your payment method will be charged unless you cancel before the trial period ends.',
    severity: 'high',
  },
  {
    id: 'location_tracking',
    label: '📍 Continuous Location Tracking',
    description: 'Tracks your location even when the app is not in use.',
    canonicalPhrase: 'We collect your precise geolocation data continuously including when the application is running in the background.',
    severity: 'medium',
  },
  {
    id: 'marketing_consent',
    label: '📧 Pre-checked Marketing Consent',
    description: 'Consent to marketing emails is pre-selected by default.',
    canonicalPhrase: 'I agree to receive promotional emails marketing communications and special offers from our partners.',
    severity: 'low',
  },
];

// ---------------------------------------------------------------------------
// 2. Text Extraction — find consent text adjacent to forms
// ---------------------------------------------------------------------------

const CONSENT_SELECTORS = [
  '[class*="terms"]', '[class*="consent"]', '[class*="privacy"]',
  '[class*="legal"]', '[class*="disclaimer"]', '[id*="terms"]',
  '[id*="consent"]', '[id*="tos"]', 'small', 'label',
  'p', '[class*="policy"]',
];

/**
 * Extracts consent/legal text from elements near form inputs on the page.
 * Limits extraction to prevent memory exhaustion.
 *
 * @param {Document|ShadowRoot} [root=document]
 * @returns {string} Concatenated consent text (max 3000 chars).
 */
export function extractConsentText(root = document) {
  const MAX_CHARS = 3000;
  const parts     = [];
  let   total     = 0;

  // Priority 1: elements specifically annotated as consent/legal text
  for (const selector of CONSENT_SELECTORS) {
    for (const el of root.querySelectorAll(selector)) {
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 20 || text.length > 2000) continue; // Skip micro-text and huge blobs

      parts.push(text);
      total += text.length;
      if (total >= MAX_CHARS) break;
    }
    if (total >= MAX_CHARS) break;
  }

  // Priority 2: text near checkboxes (common for "I agree" patterns)
  if (total < MAX_CHARS) {
    for (const checkbox of root.querySelectorAll('input[type="checkbox"]')) {
      const parent = checkbox.closest('label') || checkbox.parentElement;
      if (!parent) continue;
      const text = (parent.innerText || '').replace(/\s+/g, ' ').trim();
      if (text.length > 10) {
        parts.push(text);
        total += text.length;
      }
      if (total >= MAX_CHARS) break;
    }
  }

  return parts.join(' ').slice(0, MAX_CHARS);
}

// ---------------------------------------------------------------------------
// 3. Analysis Request (sent to offscreen document for ML comparison)
// ---------------------------------------------------------------------------

/**
 * Sends the extracted consent text to the background script for
 * semantic similarity analysis against the dark pattern anchor phrases.
 *
 * This function is called from the content script and uses
 * chrome.runtime.sendMessage to route through background.js →
 * offscreen.js → ml_worker.js.
 *
 * @param {string} consentText - The extracted consent/legal text.
 * @returns {Promise<Array<{id, label, description, score, severity}>>}
 */
export async function analyzeConsentText(consentText) {
  if (!consentText || consentText.length < 30) return [];

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        action:      'ANALYZE_CONSENT',
        text:        consentText,
        hostname:    window.location.hostname,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[GhostForm Fine-Print AI] Message error:', chrome.runtime.lastError.message);
          resolve([]);
          return;
        }
        resolve(response?.findings || []);
      }
    );
  });
}

// ---------------------------------------------------------------------------
// 4. Warning Banner — inject findings into the page
// ---------------------------------------------------------------------------

const FINE_PRINT_BANNER_ID = 'ghost-fine-print-banner';

/**
 * Injects a compact warning banner listing detected dark patterns.
 * Positioned at the bottom of the viewport for minimal intrusion.
 *
 * @param {Array<{label, description, severity}>} findings
 */
export function showFinePrintWarnings(findings) {
  if (!findings || findings.length === 0) return;

  // Remove existing banner if present
  const existing = document.getElementById(FINE_PRINT_BANNER_ID);
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = FINE_PRINT_BANNER_ID;
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Ghost Form Fine-Print AI warnings');
  banner.style.cssText = `
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 2147483647;
    max-width: 340px;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid #6c63ff;
    border-radius: 10px;
    padding: 12px 14px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 12px;
    color: #e0e0e0;
    animation: ghostFadeIn 0.3s ease;
  `;

  const header = document.createElement('div');
  header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;';
  header.innerHTML = `
    <span style="font-weight: 700; font-size: 13px; color: #9d8fff;">
      📜 Fine-Print AI
    </span>
    <button id="gf-fp-close" style="
      background: none; border: none; color: #888; cursor: pointer;
      font-size: 16px; line-height: 1; padding: 0;
    " aria-label="Close">×</button>
  `;
  banner.appendChild(header);

  for (const finding of findings.slice(0, 4)) { // Max 4 warnings
    const item = document.createElement('div');
    item.style.cssText = `
      padding: 5px 0;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    `;

    const severityColor = finding.severity === 'high' ? '#ff6b6b'
      : finding.severity === 'medium' ? '#ffa36b'
      : '#aaa';

    item.innerHTML = `
      <div style="font-weight: 600; color: ${severityColor}; font-size: 11px;">
        ${finding.label}
      </div>
      <div style="color: #bbb; margin-top: 2px; font-size: 11px;">
        ${finding.description}
      </div>
    `;
    banner.appendChild(item);
  }

  document.body.appendChild(banner);

  document.getElementById('gf-fp-close')?.addEventListener('click', () => {
    banner.remove();
  });
}

// ---------------------------------------------------------------------------
// 5. Main Entry Point — called from content.js after ML analysis completes
// ---------------------------------------------------------------------------

/**
 * Runs Fine-Print AI analysis on the current page.
 * Called once per page load after the main ML analysis settles.
 *
 * @param {string} currentStatus - The current Ghost Form page status ('unknown'|'unsafe'|'safe').
 */
export async function runFinePrintAnalysis(currentStatus) {
  // Only run on risky or unknown pages to avoid wasting CPU on trusted sites
  if (currentStatus === 'safe') return;

  const consentText = extractConsentText();
  if (!consentText || consentText.length < 30) return;

  try {
    const findings = await analyzeConsentText(consentText);
    if (findings && findings.length > 0) {
      console.info('[GhostForm Fine-Print AI] Found dark patterns:', findings.map(f => f.label));
      showFinePrintWarnings(findings);
    }
  } catch (err) {
    console.warn('[GhostForm Fine-Print AI] Analysis failed:', err.message);
  }
}

/**
 * xray_vision.js — Ghost Form Phase 5: Feature 2
 * X-Ray Vision: Structural DOM Fingerprinting
 *
 * Catches pixel-perfect phishing pages that render their payload as images,
 * canvas elements, or SVGs to bypass text-based ML detection.
 *
 * Strategy:
 *  1. Build a lightweight "spatial skeleton" of the page — bounding boxes,
 *     element types, z-index layers, and input-to-logo proximity ratios.
 *  2. Compare the skeleton against known brand layout templates using a
 *     cosine-similarity style structural score.
 *  3. Return a risk score (0-1) and the matching brand template, if any.
 *
 * Zero-knowledge guarantee: no network requests, fully local DOM analysis.
 */

// ---------------------------------------------------------------------------
// 1. Brand Layout Templates
// ---------------------------------------------------------------------------
// These are pre-defined structural "fingerprints" of known login pages.
// Each template captures the normalized spatial relationships between
// the logo region, form fields, and submit button.
//
// Values are normalized to viewport dimensions (0.0 – 1.0).
// To add a new brand: visit the page, run extractSkeleton(), and record
// the output here.

const BRAND_TEMPLATES = [
  {
    brand: 'generic_login',
    label: 'Generic Login Page',
    // Characteristics of a typical credential-harvesting login form:
    features: {
      hasPasswordField: true,
      hasEmailOrUsernameField: true,
      inputCount: [1, 4],     // [min, max] inputs on the page
      formCount:  [1, 2],     // [min, max] forms
      hasLogoRegion: true,    // Image or logo-like element near top
      logoToFormProximityNorm: [0, 0.4], // logo is in the top 40% of viewport
      formVerticalCenterNorm: [0.3, 0.7], // form is vertically centered
      submitButtonPresent: true,
      externalLinkCount: [0, 5], // minimal outbound links (phishing pages are sparse)
      textDensityRatio: [0, 0.3], // low text-to-form ratio (mostly form, little prose)
    },
    weight: 1.0,
  },
  {
    brand: 'paypal_style',
    label: 'PayPal-style Login',
    features: {
      hasPasswordField: true,
      hasEmailOrUsernameField: true,
      inputCount: [1, 3],
      formCount:  [1, 1],
      hasLogoRegion: true,
      logoToFormProximityNorm: [0, 0.3],
      formVerticalCenterNorm: [0.25, 0.6],
      submitButtonPresent: true,
      externalLinkCount: [0, 3],
      textDensityRatio: [0, 0.25],
    },
    weight: 0.9,
  },
];

// ---------------------------------------------------------------------------
// 2. Feature Extraction — build the spatial skeleton
// ---------------------------------------------------------------------------

/**
 * Extracts structural features from the current page.
 * All spatial values are normalized to [0, 1] relative to viewport dimensions.
 *
 * @param {Document|ShadowRoot} [root=document]
 * @returns {Object} Feature vector describing the page structure.
 */
export function extractPageSkeleton(root = document) {
  const vw = window.innerWidth  || 1;
  const vh = window.innerHeight || 1;

  // --- Input fields ---
  const allInputs    = Array.from(root.querySelectorAll('input'));
  const passwordFlds = allInputs.filter(i => i.type === 'password');
  const emailFlds    = allInputs.filter(i =>
    i.type === 'email' || i.type === 'text' ||
    /user|login|email|account/i.test(i.name + i.id + i.placeholder)
  );
  const allForms     = Array.from(root.querySelectorAll('form'));

  // --- Submit button ---
  const submitBtn = root.querySelector(
    'button[type="submit"], input[type="submit"], button:not([type])'
  );

  // --- Logo / brand image detection ---
  // Looks for images in the top 40% of viewport, or elements with "logo" in class/id
  const allImgs   = Array.from(root.querySelectorAll('img, svg, [class*="logo"], [id*="logo"]'));
  const logoEl    = allImgs.find(img => {
    const rect = img.getBoundingClientRect();
    return rect.top >= 0 && rect.top < vh * 0.4 && rect.width > 20;
  });

  // --- Form vertical center ---
  let formVerticalCenterNorm = 0.5;
  if (allForms.length > 0) {
    const formRect = allForms[0].getBoundingClientRect();
    formVerticalCenterNorm = ((formRect.top + formRect.height / 2) / vh);
  } else if (passwordFlds.length > 0) {
    const rect = passwordFlds[0].getBoundingClientRect();
    formVerticalCenterNorm = (rect.top / vh);
  }

  // --- Logo-to-form proximity ---
  let logoToFormProximityNorm = 0.5;
  if (logoEl) {
    const logoRect = logoEl.getBoundingClientRect();
    logoToFormProximityNorm = (logoRect.top + logoRect.height / 2) / vh;
  }

  // --- External links ---
  const externalLinks = Array.from(root.querySelectorAll('a[href]')).filter(a => {
    try {
      const href = new URL(a.href, window.location.href);
      return href.hostname !== window.location.hostname;
    } catch (_) { return false; }
  });

  // --- Text density ratio ---
  // Ratio of visible text length to the total count of form elements.
  // Phishing pages have minimal text outside the form.
  const bodyText   = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  const wordCount  = bodyText.split(' ').length;
  const formElCount = allInputs.length + allForms.length + (submitBtn ? 1 : 0);
  const textDensityRatio = Math.min(1, wordCount / Math.max(formElCount * 20, 1) / 10);

  return {
    hasPasswordField:            passwordFlds.length > 0,
    hasEmailOrUsernameField:     emailFlds.length > 0,
    inputCount:                  allInputs.length,
    formCount:                   allForms.length,
    hasLogoRegion:               !!logoEl,
    logoToFormProximityNorm:     Math.max(0, Math.min(1, logoToFormProximityNorm)),
    formVerticalCenterNorm:      Math.max(0, Math.min(1, formVerticalCenterNorm)),
    submitButtonPresent:         !!submitBtn,
    externalLinkCount:           externalLinks.length,
    textDensityRatio:            textDensityRatio,
  };
}

// ---------------------------------------------------------------------------
// 3. Skeleton Matching — score against brand templates
// ---------------------------------------------------------------------------

/**
 * Tests a single numeric value against a [min, max] range.
 * Returns 1.0 if in range, 0.0 if outside.
 *
 * @param {number} value
 * @param {[number, number]} range
 * @returns {number} 0.0 or 1.0
 */
function inRange(value, [min, max]) {
  return value >= min && value <= max ? 1.0 : 0.0;
}

/**
 * Computes a structural similarity score (0-1) between the extracted
 * skeleton and a brand template.
 *
 * @param {Object} skeleton - Output of extractPageSkeleton().
 * @param {Object} template - A BRAND_TEMPLATES entry.
 * @returns {number} Similarity score, 0 = no match, 1 = perfect match.
 */
function scoreAgainstTemplate(skeleton, template) {
  const f = template.features;
  let score = 0;
  let totalWeight = 0;

  const checks = [
    { weight: 2.0, match: skeleton.hasPasswordField === f.hasPasswordField },
    { weight: 1.5, match: skeleton.hasEmailOrUsernameField === f.hasEmailOrUsernameField },
    { weight: 1.0, match: inRange(skeleton.inputCount, f.inputCount) === 1 },
    { weight: 0.8, match: inRange(skeleton.formCount,  f.formCount)  === 1 },
    { weight: 0.7, match: skeleton.hasLogoRegion === f.hasLogoRegion },
    { weight: 1.2, match: inRange(skeleton.logoToFormProximityNorm, f.logoToFormProximityNorm) === 1 },
    { weight: 1.0, match: inRange(skeleton.formVerticalCenterNorm,  f.formVerticalCenterNorm)  === 1 },
    { weight: 1.5, match: skeleton.submitButtonPresent === f.submitButtonPresent },
    { weight: 0.6, match: inRange(skeleton.externalLinkCount, f.externalLinkCount) === 1 },
    { weight: 0.9, match: inRange(skeleton.textDensityRatio,  f.textDensityRatio)  === 1 },
  ];

  for (const { weight, match } of checks) {
    totalWeight += weight;
    if (match) score += weight;
  }

  return totalWeight > 0 ? (score / totalWeight) * template.weight : 0;
}

// ---------------------------------------------------------------------------
// 4. Public API
// ---------------------------------------------------------------------------

const XRAY_HIGH_RISK   = 0.80;
const XRAY_MEDIUM_RISK = 0.60;

/**
 * Runs X-Ray Vision structural analysis on the current page.
 *
 * @returns {{
 *   structuralRisk: 'safe'|'unknown'|'unsafe',
 *   score: number,
 *   matchedTemplate: string|null,
 *   skeleton: Object
 * }}
 */
export function analyzePageStructure() {
  const skeleton = extractPageSkeleton();

  // Score against each template and take the highest
  let topScore    = 0;
  let topTemplate = null;

  for (const template of BRAND_TEMPLATES) {
    const score = scoreAgainstTemplate(skeleton, template);
    if (score > topScore) {
      topScore    = score;
      topTemplate = template.label;
    }
  }

  const roundedScore = parseFloat(topScore.toFixed(4));

  let structuralRisk;
  if (roundedScore >= XRAY_HIGH_RISK) {
    structuralRisk = 'unsafe';
  } else if (roundedScore >= XRAY_MEDIUM_RISK) {
    structuralRisk = 'unknown';
  } else {
    structuralRisk = 'safe';
  }

  return {
    structuralRisk,
    score: roundedScore,
    matchedTemplate: topTemplate,
    skeleton,
  };
}

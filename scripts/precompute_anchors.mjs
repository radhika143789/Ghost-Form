/**
 * precompute_anchors.mjs — Ghost Form ML Utility
 *
 * Pre-computes 384-dimensional L2-normalized sentence embeddings for each
 * brand anchor using the same Xenova/all-MiniLM-L6-v2 (INT8) model that runs
 * in the extension.  Outputs a ready-to-paste JS snippet for ml_worker.js.
 *
 * Usage:
 *   node scripts/precompute_anchors.mjs
 *
 * Output:
 *   scripts/anchor_embeddings.json  — machine-readable JSON
 *   scripts/anchor_snippet.js       — copy-paste snippet for ml_worker.js
 */

import { pipeline } from '@huggingface/transformers';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// Brand anchor definitions — keep this in sync with ml_worker.js BRAND_ANCHORS
// ─────────────────────────────────────────────────────────────────────────────
const BRAND_ANCHORS = {
  paypal: {
    label: 'PayPal Login',
    anchorText: 'PayPal Login - Secure your account, enter your email and password',
  },
  google_accounts: {
    label: 'Google Sign In',
    anchorText: 'Sign in to your Google Account - Enter your email',
  },
  amazon: {
    label: 'Amazon Sign In',
    anchorText: 'Amazon Sign In - Enter your email or mobile number and password',
  },
  microsoft: {
    label: 'Microsoft / Office 365 Sign In',
    anchorText: 'Sign in to your Microsoft account - Enter your email address or phone number',
  },
  apple: {
    label: 'Apple ID Sign In',
    anchorText: 'Sign in with your Apple ID - Enter your Apple ID and password to sign in',
  },
  facebook: {
    label: 'Facebook Login',
    anchorText: 'Facebook - Log in or create an account - Enter your email or phone and password',
  },
  instagram: {
    label: 'Instagram Login',
    anchorText: 'Instagram - Log in - Enter your username email or phone and password',
  },
  netflix: {
    label: 'Netflix Sign In',
    anchorText: 'Netflix - Sign In - Enter your email or phone and password to watch movies',
  },
  chase_bank: {
    label: 'Chase Bank Online Login',
    anchorText: 'Chase Online - Sign in - Enter your username and password to access your account',
  },
  dropbox: {
    label: 'Dropbox Login',
    anchorText: 'Sign in to Dropbox - Enter your email and password',
  },
  linkedin: {
    label: 'LinkedIn Sign In',
    anchorText: 'LinkedIn - Sign In - Enter your email and password to access your professional network',
  },
  twitter_x: {
    label: 'Twitter / X Sign In',
    anchorText: 'Sign in to X - Enter your phone email or username and password',
  },
  wellsfargo: {
    label: 'Wells Fargo Online Banking',
    anchorText: 'Wells Fargo Online - Sign On - Enter your username and password to access your accounts',
  },
  steam: {
    label: 'Steam Sign In',
    anchorText: 'Steam Login - Sign in to your Steam account - Enter your account name and password',
  },
  generic_phish: {
    label: 'Generic Phishing Login',
    anchorText: 'Verify your account - Confirm your identity - Enter your email username and password to continue',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Compute embeddings
// ─────────────────────────────────────────────────────────────────────────────
console.log('[GhostForm Precompute] Loading Xenova/all-MiniLM-L6-v2 (INT8, quantized)...');

const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
  quantized: true,
  progress_callback: (p) => {
    if (p.status === 'downloading') {
      const pct = p.loaded && p.total ? Math.round((p.loaded / p.total) * 100) : '?';
      process.stdout.write(`\r  Downloading ${p.file} … ${pct}%    `);
    }
    if (p.status === 'done') {
      console.log(`\n  ✅ ${p.file} loaded`);
    }
  },
});

console.log('[GhostForm Precompute] Model ready. Computing anchor embeddings...\n');

const results = {};

for (const [key, anchor] of Object.entries(BRAND_ANCHORS)) {
  process.stdout.write(`  Computing: ${anchor.label} ... `);

  const output = await extractor(anchor.anchorText, {
    pooling: 'mean',
    normalize: true,
  });

  // output.data is a Float32Array of 384 dimensions
  const floatArr = Array.from(output.data);

  // Sanity check: all-MiniLM-L6-v2 always produces 384-dim L2-normalized vectors
  if (floatArr.length !== 384) {
    console.error(`\n  ❌ Unexpected embedding size: ${floatArr.length} (expected 384)`);
    process.exit(1);
  }

  // Verify L2 normalization: ||v|| should be ≈ 1.0
  const norm = Math.sqrt(floatArr.reduce((s, v) => s + v * v, 0));
  if (Math.abs(norm - 1.0) > 0.01) {
    console.error(`\n  ❌ Vector not normalized: ||v|| = ${norm.toFixed(6)}`);
    process.exit(1);
  }

  results[key] = {
    label: anchor.label,
    anchorText: anchor.anchorText,
    // Round to 6 decimal places to reduce file size (~40% smaller) while
    // maintaining precision far beyond what cosine similarity needs.
    embedding: floatArr.map(v => parseFloat(v.toFixed(6))),
  };

  console.log(`done  (||v|| = ${norm.toFixed(6)})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Write outputs
// ─────────────────────────────────────────────────────────────────────────────
const jsonPath    = resolve(__dirname, 'anchor_embeddings.json');
const snippetPath = resolve(__dirname, 'anchor_snippet.js');

// 1. Machine-readable JSON
writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf8');
console.log(`\n✅ Saved: ${jsonPath}`);

// 2. Ready-to-paste JavaScript snippet for ml_worker.js
let snippet = `// ── Pre-computed brand anchor embeddings ──────────────────────────────────
// Generated by: node scripts/precompute_anchors.mjs
// Model:        Xenova/all-MiniLM-L6-v2 (INT8 quantized)
// Dimensions:   384
// Pooling:      mean + L2 normalization
// Generated at: ${new Date().toISOString()}
//
// Each Float32Array is a 384-dim L2-normalized sentence embedding.
// Cosine similarity against page text drives the 3-state trust signal.
// ─────────────────────────────────────────────────────────────────────────────

const BRAND_ANCHORS = {\n`;

for (const [key, data] of Object.entries(results)) {
  snippet += `  ${key}: {\n`;
  snippet += `    label: ${JSON.stringify(data.label)},\n`;
  snippet += `    anchorText: ${JSON.stringify(data.anchorText)},\n`;
  snippet += `    embedding: new Float32Array([\n`;

  // Format 8 values per line for readability
  const chunks = [];
  for (let i = 0; i < data.embedding.length; i += 8) {
    chunks.push('      ' + data.embedding.slice(i, i + 8).join(', '));
  }
  snippet += chunks.join(',\n') + '\n';
  snippet += `    ]),\n`;
  snippet += `  },\n`;
}

snippet += `};\n`;

writeFileSync(snippetPath, snippet, 'utf8');
console.log(`✅ Saved: ${snippetPath}`);

console.log('\n📋 Summary:');
console.log(`   Anchors computed: ${Object.keys(results).length}`);
console.log(`   Embedding dim:    384`);
console.log(`   Model:            Xenova/all-MiniLM-L6-v2 (INT8 quantized)`);
console.log('\n🚀 Next step: Copy the BRAND_ANCHORS block from anchor_snippet.js into src/ml_worker.js');

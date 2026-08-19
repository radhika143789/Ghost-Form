/**
 * precompute_anchors_ort.mjs — Ghost Form ML Utility (onnxruntime-web WASM, Node v24)
 *
 * Uses onnxruntime-web with WASM backend — no native bindings required.
 * Downloads the quantized all-MiniLM-L6-v2 ONNX model and tokenizer from HuggingFace,
 * runs inference, and outputs anchor_embeddings.json + anchor_snippet.js.
 *
 * Usage:  node scripts/precompute_anchors_ort.mjs
 */

import { writeFileSync, existsSync, mkdirSync, createWriteStream, readFileSync } from 'fs';

import { resolve, dirname }                                          from 'path';
import { fileURLToPath }                                             from 'url';
import https                                                         from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, '../.model_cache');
if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

// ── Brand Anchors ─────────────────────────────────────────────────────────────
const BRAND_ANCHORS = {
  paypal:          { label: 'PayPal Login',                    anchorText: 'PayPal Login - Secure your account, enter your email and password' },
  google_accounts: { label: 'Google Sign In',                  anchorText: 'Sign in to your Google Account - Enter your email' },
  amazon:          { label: 'Amazon Sign In',                  anchorText: 'Amazon Sign In - Enter your email or mobile number and password' },
  microsoft:       { label: 'Microsoft / Office 365 Sign In',  anchorText: 'Sign in to your Microsoft account - Enter your email address or phone number' },
  apple:           { label: 'Apple ID Sign In',                anchorText: 'Sign in with your Apple ID - Enter your Apple ID and password to sign in' },
  facebook:        { label: 'Facebook Login',                  anchorText: 'Facebook - Log in or create an account - Enter your email or phone and password' },
  instagram:       { label: 'Instagram Login',                 anchorText: 'Instagram - Log in - Enter your username email or phone and password' },
  netflix:         { label: 'Netflix Sign In',                 anchorText: 'Netflix - Sign In - Enter your email or phone and password to watch movies' },
  chase_bank:      { label: 'Chase Bank Online Login',         anchorText: 'Chase Online - Sign in - Enter your username and password to access your account' },
  dropbox:         { label: 'Dropbox Login',                   anchorText: 'Sign in to Dropbox - Enter your email and password' },
  linkedin:        { label: 'LinkedIn Sign In',                anchorText: 'LinkedIn - Sign In - Enter your email and password to access your professional network' },
  twitter_x:       { label: 'Twitter / X Sign In',             anchorText: 'Sign in to X - Enter your phone email or username and password' },
  wellsfargo:      { label: 'Wells Fargo Online Banking',      anchorText: 'Wells Fargo Online - Sign On - Enter your username and password to access your accounts' },
  steam:           { label: 'Steam Sign In',                   anchorText: 'Steam Login - Sign in to your Steam account - Enter your account name and password' },
  generic_phish:   { label: 'Generic Phishing Login',          anchorText: 'Verify your account - Confirm your identity - Enter your email username and password to continue' },
};

// ── Download helper (follows redirects, handles relative Location headers) ────
function dlFile(url, dest) {
  return new Promise((resolve, reject) => {
    if (existsSync(dest)) { resolve(); return; }
    process.stdout.write(`  Downloading ${dest.split(/[/\\]/).pop()} ... `);
    function get(u) {
      const parsedBase = new URL(u);
      https.get(u, (res) => {
        if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location) {
          res.resume();
          // HuggingFace sometimes returns a relative path in Location
          const loc = res.headers.location;
          const next = loc.startsWith('http') ? loc
            : `${parsedBase.protocol}//${parsedBase.host}${loc}`;
          get(next);
          return;
        }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} for ${u}`)); return; }
        const f = createWriteStream(dest);
        res.pipe(f);
        f.on('finish', () => { f.close(); console.log('done'); resolve(); });
        f.on('error',  reject);
      }).on('error', reject);
    }
    get(url);
  });
}

// ── Minimal WordPiece tokenizer (reads tokenizer.json vocab) ─────────────────
function buildTokenizer(tokJson) {
  const vocab  = tokJson.model.vocab;  // { token: id }
  const unkId  = vocab['[UNK]']  ?? 100;
  const clsId  = vocab['[CLS]']  ?? 101;
  const sepId  = vocab['[SEP]']  ?? 102;

  return function tokenize(text, maxLen) {
    const words = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/);
    const ids = [clsId], mask = [1];

    for (const word of words) {
      if (ids.length >= maxLen - 1) break;
      let rem = word, first = true;
      while (rem.length > 0 && ids.length < maxLen - 1) {
        let found = false;
        for (let l = Math.min(rem.length, 20); l > 0; l--) {
          const sub = first ? rem.slice(0, l) : '##' + rem.slice(0, l);
          if (sub in vocab) {
            ids.push(vocab[sub]); mask.push(1);
            rem = rem.slice(l); first = false; found = true; break;
          }
        }
        if (!found) { ids.push(unkId); mask.push(1); rem = rem.slice(1); first = false; }
      }
    }
    ids.push(sepId); mask.push(1);
    while (ids.length < maxLen) { ids.push(0); mask.push(0); }
    return { ids, mask };
  };
}

// ── Mean-pool + L2-normalize ──────────────────────────────────────────────────
function meanPoolNorm(data, mask, seqLen, dim) {
  const v = new Float32Array(dim);
  let cnt = 0;
  for (let t = 0; t < seqLen; t++) {
    if (!mask[t]) continue;
    cnt++;
    for (let d = 0; d < dim; d++) v[d] += data[t * dim + d];
  }
  for (let d = 0; d < dim; d++) v[d] /= cnt;
  let norm = 0;
  for (let d = 0; d < dim; d++) norm += v[d] * v[d];
  norm = Math.sqrt(norm);
  for (let d = 0; d < dim; d++) v[d] /= norm;
  return v;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const BASE = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main';
const modelDest = resolve(CACHE_DIR, 'model_quantized.onnx');
const tokDest   = resolve(CACHE_DIR, 'tokenizer.json');

console.log('[GhostForm Precompute] Fetching model files...\n');
await dlFile(`${BASE}/onnx/model_quantized.onnx`, modelDest);
await dlFile(`${BASE}/tokenizer.json`,             tokDest);

console.log('\n[GhostForm Precompute] Loading onnxruntime-web...');
const ort = await import('onnxruntime-web').then(m => m.default || m);
// ort.env.wasm is the correct path for the default export
ort.env.wasm.numThreads = 1;


// Pass model as raw Buffer — avoids ort-web's fetch() trying file:// scheme in Node
const modelBuffer = readFileSync(modelDest);
const session = await ort.InferenceSession.create(modelBuffer, {
  executionProviders: ['wasm'],
});
console.log('[GhostForm Precompute] Session ready. Input names:', session.inputNames);

const tokRaw   = JSON.parse(readFileSync(tokDest, 'utf8'));
const tokenize = buildTokenizer(tokRaw);


const MAX_LEN = 128, DIM = 384;
const results = {};

console.log('\n[GhostForm Precompute] Computing embeddings...\n');

for (const [key, anchor] of Object.entries(BRAND_ANCHORS)) {
  process.stdout.write(`  ${anchor.label} ... `);

  const { ids, mask } = tokenize(anchor.anchorText, MAX_LEN);

  const mkTensor = (arr) => new ort.Tensor('int64', BigInt64Array.from(arr.map(BigInt)), [1, MAX_LEN]);
  const feeds = {
    input_ids:      mkTensor(ids),
    attention_mask: mkTensor(mask),
    token_type_ids: new ort.Tensor('int64', new BigInt64Array(MAX_LEN), [1, MAX_LEN]),
  };

  const out    = await session.run(feeds);
  const outKey = session.outputNames[0];          // 'last_hidden_state' or '0'
  const lhs    = out[outKey].data;                // Float32Array [1*MAX_LEN*DIM]

  const pooled = meanPoolNorm(lhs, mask, MAX_LEN, DIM);
  const norm   = Math.sqrt(Array.from(pooled).reduce((s, v) => s + v * v, 0));

  console.log(`done  ||v||=${norm.toFixed(6)}`);

  results[key] = {
    label:     anchor.label,
    anchorText: anchor.anchorText,
    embedding: Array.from(pooled).map(v => parseFloat(v.toFixed(6))),
  };
}

// ── Write JSON ────────────────────────────────────────────────────────────────
const jsonPath = resolve(__dirname, 'anchor_embeddings.json');
writeFileSync(jsonPath, JSON.stringify(results, null, 2));
console.log(`\n✅ ${jsonPath}`);

// ── Write JS snippet for ml_worker.js ────────────────────────────────────────
const snippetPath = resolve(__dirname, 'anchor_snippet.js');
let s = `// Pre-computed brand anchor embeddings — ${new Date().toISOString()}\n`;
s += `// Model: Xenova/all-MiniLM-L6-v2 (INT8 WASM) | 384-dim | mean-pool + L2\n\n`;
s += `const BRAND_ANCHORS = {\n`;

for (const [key, d] of Object.entries(results)) {
  s += `  ${key}: {\n`;
  s += `    label: ${JSON.stringify(d.label)},\n`;
  s += `    anchorText: ${JSON.stringify(d.anchorText)},\n`;
  s += `    embedding: new Float32Array([\n`;
  for (let i = 0; i < d.embedding.length; i += 8) {
    s += '      ' + d.embedding.slice(i, i + 8).join(', ') + (i + 8 < d.embedding.length ? ',' : '') + '\n';
  }
  s += `    ]),\n  },\n`;
}
s += `};\n`;

writeFileSync(snippetPath, s);
console.log(`✅ ${snippetPath}`);
console.log(`\n📋 ${Object.keys(results).length} anchors — ready to inject into src/ml_worker.js`);

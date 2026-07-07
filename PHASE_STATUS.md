# Ghost Form — Project Walkthrough & Phase Status

**Current Phase:** ✅ Phase 3 Active (Security Hardening Complete)

---

## Phase 1 — Foundation (MVP)
**Status:** ✅ Completed

- `manifest.json` — Manifest V3 skeleton with core permissions
- `background.js` — Hardcoded domain blocklist (mock threat API)
- `content.js` — Focus-event listeners + neon red CSS warning on inputs
- `popup.html/css/js` — Trust status UI (Green / Red)

---

## Phase 2 — Security, Performance & Infrastructure
**Status:** ✅ Completed

- **Cloudflare Worker Proxy** (`cloudflare-worker/worker.js`) — Serverless edge proxy that hides Threat API keys, handles CORS, and falls back gracefully on upstream failure
- **Smart Yellow State** — Extension stays silent on Unknown domains until high-risk Regex triggers (password format, Luhn-validated credit card)
- **MutationObserver** — Intercepts dynamically injected forms and Shadow DOM inputs added after page load
- **Debounced Regex Engine** — 300ms debounce on `input` events prevents UI stutter
- **"Ignore for this session"** — `sessionStorage` flag dismisses warnings without permanent whitelisting
- **User Whitelist** (`options.html/js/css`) — Persistent domain whitelist via `chrome.storage.local`
- **Privacy Policy** (`PRIVACY_POLICY.md`) — Zero-knowledge declaration for Chrome Web Store submission
- **`chrome.storage.session` Cache** — Prevents redundant API calls per browsing session

---

## Phase 3 — On-Device Machine Learning
**Status:** ✅ Active / In Progress

- **Vite Build Pipeline** (`vite.config.js`, `package.json`) — Bundles `src/background.js` and `src/ml_worker.js` into `dist/` as ESM
- **ML Web Worker** (`src/ml_worker.js`) — Runs `Xenova/all-MiniLM-L6-v2` (quantized INT8, ~23MB) entirely in-browser via ONNX Runtime WebAssembly
  - Lazy singleton initialization with progress callbacks
  - Pre-computes brand anchor embeddings (PayPal, Google, Amazon) at runtime
  - Cosine similarity ranking against all anchors per page
- **Background Orchestrator** (`src/background.js`) — Spawns, manages, and crash-recovers the ML Worker
  - Timeout guard on all inference calls (30s default)
  - Interprets similarity scores into 3-state status: `safe / unknown / unsafe`
- **DOM Sanitizer** (`safeExtractText` in `content.js`) — Clones DOM, strips script/style/hidden tags, hard-caps output at **2,000 chars** to prevent ML memory exhaustion
- **Circuit Breaker** (`src/background.js`) — Per-tab token-bucket rate limiter (max 1 inference/second/tab); stale entries pruned every 60s
- **Strict CSP** — `object-src 'none'`, `worker-src 'self'`, `default-src 'none'`, `wasm-unsafe-eval` for ONNX
- **Landing Page** (`index.html`) — Full marketing page with Tailwind CSS via CDN

---

## Known Pending Items (Phase 3 Completion)
- `npm run build` — Must be run once to generate the `dist/` folder before loading the extension
- Brand anchor vectors in `src/ml_worker.js` — Replace `null` with pre-computed embeddings from a Node.js script
- Replace proxy placeholder URL in `manifest.json` and `src/background.js` with your deployed Cloudflare Worker URL
- Add extension icons (`icons/icon16.png`, `icon48.png`, `icon128.png`) for Chrome Web Store submission

---

## File Map

| File | Phase | Role |
|---|---|---|
| `manifest.json` | All | Extension declaration & permissions |
| `background.js` | 1-2 | Legacy service worker (pre-ML) |
| `src/background.js` | 3 | Phase 3 service worker (ML orchestrator) |
| `src/ml_worker.js` | 3 | On-device ML inference Web Worker |
| `content.js` | All | Form interception, sanitizer, warnings |
| `content.css` | All | Injected warning styles |
| `popup.html/css/js` | All | Extension popup (3-state UI) |
| `options.html/css/js` | 2-3 | User whitelist manager |
| `cloudflare-worker/worker.js` | 2-3 | Serverless API key proxy |
| `vite.config.js` | 3 | Bundler config for ESM output |
| `package.json` | 3 | Node dependencies (Transformers.js, Vite, Jest) |
| `background.test.js` | 2-3 | Jest unit tests (cache + fallback logic) |
| `index.html` | 3 | Public landing page |
| `PRIVACY_POLICY.md` | 2-3 | Chrome Web Store legal requirement |
| `README.md` | All | Developer setup guide |

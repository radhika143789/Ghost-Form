# Ghost Form — Project Walkthrough & Phase Status

**Current Phase:** ✅ Phase 6 Active (Pro Tier)

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

- **Cloudflare Worker Proxy** (`cloudflare-worker/worker.js`) — Serverless edge proxy
- **Smart Yellow State** — Extension stays silent on Unknown until high-risk Regex triggers
- **MutationObserver** — Intercepts dynamically injected forms and Shadow DOM inputs
- **User Whitelist** (`options.html/js/css`) — Persistent domain whitelist
- **`chrome.storage.session` Cache** — Prevents redundant API calls per session

---

## Phase 3 — On-Device Machine Learning
**Status:** ✅ Completed

- **Vite Build Pipeline** — Bundles `src/background.js` and `src/ml_worker.js` into `dist/`
- **ML Web Worker** (`src/ml_worker.js`) — Runs `all-MiniLM-L6-v2` (quantized INT8, ~23MB) via ONNX WASM
- **Pre-baked Brand Anchors** — 15 brand anchor embeddings (384-dim Float32Array) pre-computed and baked in
- **Circuit Breaker** — Per-tab rate limiter + global concurrency lock
- **Strict CSP** — `wasm-unsafe-eval` for ONNX, strict `connect-src`

---

## Phase 4 — Auth & Telemetry
**Status:** ✅ Completed

- **Supabase Auth** (`auth.html/js`) — Email/password + social login
- **Threat Telemetry** — Privacy-first reporting (domain + level only, no PII)
- **Session Token Management** — JWT refresh with 1h expiry
- **Dashboard** (`dashboard.html/js`) — Local threat history viewer

---

## Phase 5 — Advanced Feature Modules
**Status:** ✅ Completed

- **X-Ray Vision** (`src/features/xray_vision.js`) — Structural DOM fingerprinting, scores sent to popup via background cache
- **GhostPrint** (`src/features/ghost_print.js`) — Keystroke biometric anomaly detection
- **Active Shield** (`src/features/active_shield.js`) — Clickjack interceptor with visible banner warnings
- **Ghost Masks** (`src/features/ghost_masks.js`) — Ephemeral email alias injection with visible offer UI
- **Fine-Print AI** (`src/features/fine_print_ai.js`) — Dark pattern detection with dismiss button
- **Admin Dashboard** (`admin-dashboard/`) — React+Vite threat analytics dashboard

---

## Phase 6 — Pro Tier (Alias API, Billing, Multi-device)
**Status:** 🟡 In Progress (~100% code done)

- **Pro Gate** (`src/features/pro_gate.js`) — `isPro()`, `getProStatus()`, `syncProStatus()` with 7-day offline cache
- **Stripe Billing** (`src/features/billing.js`) — `openCheckout()`, `openBillingPortal()` via Supabase Edge Function
- **Supabase Edge Function** (`supabase/functions/create-checkout/index.ts`) — Stripe Checkout session + Portal creation
- **Multi-device Sync** (`src/features/sync.js`) — `chrome.storage.sync` whitelist + preferences sync with last-write-wins
- **Popup Pro UI** — Pro badge, upgrade card with monthly/annual plans
- **Options Pro UI** — Subscription management, alias history, sync toggle, billing portal
- **Plans:** Pro Monthly ($4.99/mo), Pro Annual ($39.99/yr, 33% savings)

### Pending Deployment Items (Phase 6)
- Deploy Supabase Edge Function: `supabase functions deploy create-checkout`
- Set Stripe secrets: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`
- Create Stripe products + prices in Stripe Dashboard
- Add `stripe_customer_id`, `is_pro`, `pro_plan`, `pro_expires_at` columns to `profiles` table
- Stripe webhook for `customer.subscription.updated` → update `profiles.is_pro`

---

## File Map

| File | Phase | Role |
|---|---|---|
| `manifest.json` | All | Extension declaration & permissions |
| `src/background.js` | 3-6 | Service worker (ML orchestrator, telemetry, Pro proxy) |
| `src/ml_worker.js` | 3 | On-device ML inference (384-dim brand anchors) |
| `content.js` | All | Form interception, warnings, X-Ray/GhostPrint wiring |
| `src/content_features.js` | 5-6 | Vite bundle entry for all feature modules |
| `src/features/xray_vision.js` | 5 | Structural DOM fingerprinting |
| `src/features/ghost_print.js` | 5 | Keystroke biometric anomaly detection |
| `src/features/active_shield.js` | 5 | Clickjack interceptor |
| `src/features/ghost_masks.js` | 5 | Ephemeral email alias injection |
| `src/features/fine_print_ai.js` | 5 | Dark pattern consent analysis |
| `src/features/pro_gate.js` | 6 | Pro subscription gate |
| `src/features/billing.js` | 6 | Stripe checkout integration |
| `src/features/sync.js` | 6 | Multi-device sync |
| `supabase/functions/create-checkout/index.ts` | 6 | Stripe Edge Function |
| `popup.html/css/js` | All | Extension popup (Pro-aware) |
| `options.html/css/js` | 2-6 | Settings (whitelist, Pro, sync, alias history) |
| `admin-dashboard/` | 5 | React threat analytics dashboard |

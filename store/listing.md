# Ghost Form — Chrome Web Store Listing

## Short Description (132 chars)
Privacy-first anti-phishing extension. On-device AI detects phishing forms before you type. Zero data leaves your browser.

## Detailed Description

**Ghost Form** is the only Chrome extension that protects you from phishing attacks using 100% on-device machine learning — your data never leaves your browser.

### 🧠 How It Works

Ghost Form uses a compact AI model (Xenova/all-MiniLM-L6-v2, ~23MB, running entirely in your browser via ONNX WebAssembly) to analyze the text on every page you visit. It compares the page to known brand login signatures using cosine similarity — and warns you instantly if it looks like a PayPal, Google, Amazon, Microsoft, Apple, or 11 other brand impersonation.

### 🛡️ 5-Layer Protection System

1. **🧠 On-Device ML** — Semantic similarity against 15 brand anchor vectors. Zero network calls.
2. **🏗️ X-Ray Vision** — Structural DOM fingerprinting. Compares form structure, field counts, and button text against 11 known brand templates.
3. **🖱️ Active Shield** — Detects clickjacking attempts using invisible overlays and transparent iframes.
4. **📜 Fine-Print AI** — Reads consent text for dark patterns: hidden subscriptions, data sale clauses, forced arbitration.
5. **⌨️ GhostPrint** — Keystroke biometric analysis detects bot-driven form autofill attacks.

### 🔒 Ghost Masks — Protect Your Real Email
On unknown or risky sites, Ghost Form offers to inject a random email alias (ghost_a3f2b1@ghostform.shield) into the form instead of your real email. The real input never sees your actual address.

### 📊 What Gets Analyzed
- Page visible text (up to 2,000 chars, extracted locally)
- DOM form structure (field count, types, labels)
- Consent text near submit buttons
- Keystroke timing patterns (biometrics never leave device)

### 🔐 Privacy Guarantees
- ✅ No keystrokes ever stored or transmitted
- ✅ No form data ever sent anywhere
- ✅ All ML inference runs in WebAssembly locally
- ✅ Threat telemetry: only domain name + risk level (never page content)
- ✅ Open-source on GitHub

### ⚙️ Permissions Used
- `activeTab` — Read the current tab URL to check status
- `scripting` — Inject the content script that watches forms
- `storage` — Save your whitelist and preferences locally
- `offscreen` — Host the ML Web Worker in a stable context
- `tabs` — Show the popup with current tab info
- `host_permissions: <all_urls>` — Monitor form fields on any site you visit

## Category
Security

## Tags / Keywords
phishing, anti-phishing, privacy, security, machine learning, AI, form protection, password safety, identity protection, browser security

## Languages
English

## Developer
Ghost Form Team

## Website
https://ghostform.shield

## Privacy Policy URL
https://github.com/radhika143789/Ghost-Form/blob/main/PRIVACY_POLICY.md

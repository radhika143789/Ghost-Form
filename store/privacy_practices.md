# Ghost Form — Privacy Practices Declaration

## For Chrome Web Store Privacy Tab

### Data Collection

| Data Type | Collected? | Notes |
|---|---|---|
| Personally identifiable information | ❌ No | Never |
| Health information | ❌ No | Never |
| Financial and payment information | ❌ No | Never |
| Authentication information | ❌ No | Passwords never touched |
| Personal communications | ❌ No | Never |
| Location | ❌ No | Never |
| Web history | ❌ No | Never |
| User activity | ❌ No | Never |
| **Website content** | ⚠️ Partial | Domain name + risk level only (anonymized) |

### Data Usage

The ONLY data transmitted off-device:
- The **domain name** of a page flagged as a phishing threat (e.g., `paypal-secure-login.xyz`)
- The **risk level** (`Red` or `Yellow`)
- A **timestamp** and random **extension install ID** (not linked to any user account)

This is used solely to build an aggregate threat intelligence feed.
**No page content, no form data, no keystrokes, no user credentials are ever transmitted.**

### Permissions Justification

| Permission | Justification |
|---|---|
| `activeTab` | Required to read the current page URL for threat status display in the popup |
| `scripting` | Required to inject the content script that monitors form fields on pages you visit |
| `storage` | Required to save your domain whitelist and user preferences locally on your device |
| `offscreen` | Required by Chrome MV3 to host the ML Web Worker in a stable context (service workers cannot directly run WASM long-term) |
| `tabs` | Required to display the active tab's domain and risk level in the extension popup |
| `<all_urls>` | Required because phishing attacks can appear on any domain. Ghost Form must be able to analyze forms on any site you visit to provide protection. |

### Third-Party Services

| Service | Purpose | Data Sent |
|---|---|---|
| Supabase | Aggregate threat telemetry (optional, can be disabled) | Domain + risk level only |
| HuggingFace CDN | Download the ML model (~23MB) on first install | None (model cached locally after first download) |
| SimpleLogin (optional, Pro) | Generate email alias for Ghost Masks Pro | API request only when user explicitly clicks 'Use Mask' |

### Data Retention
- All local data: Cleared when extension is uninstalled
- Telemetry (Supabase): 90-day rolling window, auto-deleted
- User session: Stored in chrome.storage.local, cleared on logout

### Single Purpose
Ghost Form has a single purpose: protecting users from submitting credentials or personal information into phishing forms. Every permission is necessary to fulfill this purpose.

# Ghost Form

Ghost Form is a privacy-first Chrome Extension designed to prevent users from accidentally typing sensitive data (like passwords or credit card numbers) into forms on phishing or unverified websites.

## Architecture

Ghost Form operates on a **Zero-Knowledge Security** paradigm. It uses local, client-side regular expressions to evaluate typed data structures and determine risk levels dynamically without ever transmitting your keystrokes to an external server. 

### Key Components:
- **Manifest V3:** Modern and performant extension architecture.
- **Service Worker (`background.js`):** Intercepts domain queries and checks them against a Threat Intelligence API using a highly scalable Cloudflare Worker proxy.
- **Content Script (`content.js`):** Injects non-intrusive UI warnings on potentially dangerous inputs using debounced regex analysis and Shadow DOM traversal.
- **Serverless Proxy:** Cloudflare worker that securely stores Threat API keys and handles cross-origin requests.

## How to Install (Developer Mode)

1. Clone or download this repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Toggle the **Developer mode** switch in the top right corner.
4. Click **Load unpacked** in the top left corner.
5. Select the folder containing these project files.
6. The extension will now be loaded and ready to test!

## Deployment Setup

Ghost Form relies on a Cloudflare Worker to securely interface with threat APIs. 
To deploy your own proxy:
1. Navigate to the `cloudflare-worker` directory.
2. Deploy the `worker.js` script to your Cloudflare account.
3. Configure the `THREAT_API_KEY` environment variable in your Cloudflare dashboard.
4. Update the proxy URL in `manifest.json` and `background.js` to point to your deployed worker.

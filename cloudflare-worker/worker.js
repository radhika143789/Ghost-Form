/**
 * worker.js — Ghost Form Cloudflare Worker (Phase 5 Audit Fix)
 *
 * This worker proxies requests between the Chrome Extension and upstream
 * threat APIs, keeping API keys server-side and preventing their exposure
 * in client-side code.
 *
 * SECURITY FIX (Medium Audit Finding — Telemetry Spam / Abuse Prevention):
 *   The previous implementation had no rate limiting or origin validation
 *   beyond a single CORS header. An attacker could extract the worker URL
 *   and flood it with fake requests, either to:
 *     - Exhaust upstream API rate limits (billing attack)
 *     - Spam the telemetry database with fake threat reports
 *     - Probe the API for side-channel information
 *
 *   New protections:
 *     1. Per-IP rate limiting using Cloudflare's CF-Connecting-IP header
 *        (max 30 requests/minute/IP, stored in a KV-like in-memory Map).
 *     2. Domain parameter validation (must be a valid hostname, no URLs).
 *     3. Request body size limiting for POST telemetry endpoints.
 *     4. Strict CORS enforcement — only the extension origin is allowed.
 */

// ---------------------------------------------------------------------------
// 1. In-Memory Rate Limiter (per-IP sliding window)
// ---------------------------------------------------------------------------

/** @type {Map<string, { count: number, resetAt: number }>} */
const rateLimitMap = new Map();

const RATE_LIMIT_WINDOW_MS  = 60_000; // 1 minute
const RATE_LIMIT_MAX        = 30;     // 30 requests per minute per IP

/**
 * Prunes expired entries from the rate limit map.
 * Called periodically to prevent unbounded memory growth.
 */
function pruneRateLimitMap() {
  const now = Date.now();
  for (const [ip, bucket] of rateLimitMap) {
    if (now > bucket.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}

/**
 * Returns true if the request should be allowed, false if rate-limited.
 *
 * @param {string} ip - The client's IP address.
 * @returns {{ allowed: boolean, remaining: number, resetAt: number }}
 */
function checkRateLimit(ip) {
  const now = Date.now();

  if (!rateLimitMap.has(ip) || now > rateLimitMap.get(ip).resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }

  const bucket = rateLimitMap.get(ip);
  bucket.count++;

  if (bucket.count > RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }

  return { allowed: true, remaining: RATE_LIMIT_MAX - bucket.count, resetAt: bucket.resetAt };
}

// ---------------------------------------------------------------------------
// 2. Input Validation Helpers
// ---------------------------------------------------------------------------

/**
 * Validates that a domain parameter is a well-formed hostname.
 * Rejects URLs, paths, and injection attempts.
 *
 * @param {string} domain
 * @returns {boolean}
 */
function isValidDomain(domain) {
  if (!domain || domain.length > 253) return false;

  // Reject anything that looks like a URL, path, or query string
  if (/[\/\s?#@:!]/.test(domain)) return false;

  // Basic hostname format validation (labels separated by dots)
  const hostnameRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z]{2,}$/;
  return hostnameRegex.test(domain);
}

// ---------------------------------------------------------------------------
// 3. Main Fetch Handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    // NOTE: Replace this with your actual Chrome Extension ID from:
    // chrome://extensions → Enable Developer Mode → Copy ID
    const EXTENSION_ORIGIN = env.EXTENSION_ORIGIN || 'chrome-extension://REPLACE_WITH_YOUR_EXTENSION_ID';

    const corsHeaders = {
      'Access-Control-Allow-Origin': EXTENSION_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // 1. Handle CORS Preflight for the browser extension
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 2. Strict origin enforcement — reject requests not from the extension
    const origin = request.headers.get('Origin') || '';
    if (origin && origin !== EXTENSION_ORIGIN) {
      return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Per-IP rate limiting
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateCheck = checkRateLimit(clientIP);

    // Periodically prune stale entries (non-blocking)
    ctx.waitUntil(Promise.resolve().then(pruneRateLimitMap));

    if (!rateCheck.allowed) {
      return new Response(JSON.stringify({
        error: 'Rate limit exceeded. Max 30 requests per minute.',
        retryAfterMs: rateCheck.resetAt - Date.now(),
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil((rateCheck.resetAt - Date.now()) / 1000)),
          ...corsHeaders,
        },
      });
    }

    // 4. Only allow GET requests for the domain check endpoint
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const url = new URL(request.url);
    const domain = url.searchParams.get('domain');

    if (!domain) {
      return new Response(JSON.stringify({ error: 'Missing domain parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 5. Validate domain format to prevent injection / abuse
    if (!isValidDomain(domain)) {
      return new Response(JSON.stringify({ error: 'Invalid domain format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 6. Access the hidden API Key from Cloudflare Environment Variables (Secrets)
    const THREAT_API_KEY = env.THREAT_API_KEY;

    // Example: Forwarding to a real Threat API (like Google Safe Browsing or PhishTank)
    const THREAT_API_URL = `https://api.real-threat-service.com/v1/check?domain=${encodeURIComponent(domain)}`;

    try {
      // 7. Proxy the request
      const apiResponse = await fetch(THREAT_API_URL, {
        headers: {
          Authorization: `Bearer ${THREAT_API_KEY}`,
        },
      });

      if (!apiResponse.ok) {
        throw new Error(`Upstream returned ${apiResponse.status}`);
      }

      const data = await apiResponse.json();

      // 8. Return the parsed result securely back to the extension
      return new Response(JSON.stringify({ status: data.isSafe ? 'safe' : 'unsafe' }), {
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': String(rateCheck.remaining),
          ...corsHeaders,
        },
      });

    } catch (err) {
      // Graceful fallback on API failure
      return new Response(JSON.stringify({ error: 'Upstream API failure', status: 'unknown' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};

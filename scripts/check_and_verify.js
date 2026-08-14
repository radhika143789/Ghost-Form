/**
 * check_and_verify.js
 * -------------------
 * Ghost-Form - Website Verification Pipeline
 *
 * Reads domains from urls_to_check.txt (or CLI args), runs a set of
 * lightweight HTTP checks on each one, and appends every site that passes
 * all checks to verified_list.json and verified_list.txt.
 *
 * Usage:
 *   node scripts/check_and_verify.js                       # reads urls_to_check.txt
 *   node scripts/check_and_verify.js google.com paypal.com # ad-hoc list
 *
 * Checks performed:
 *   - Domain resolves and is reachable (HTTP/HTTPS request)
 *   - Final URL uses HTTPS (after redirects)
 *   - HTTP status is 2xx or 3xx (not 4xx/5xx)
 *   - Response time is under MAX_RESPONSE_MS threshold
 *   - Site is not already in the verified list (dedup)
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const URLS_FILE     = path.join(ROOT, 'urls_to_check.txt');
const VERIFIED_JSON = path.join(ROOT, 'verified_list.json');
const VERIFIED_TXT  = path.join(ROOT, 'verified_list.txt');

const MAX_RESPONSE_MS = 8_000;   // sites taking longer than this fail
const REQUEST_TIMEOUT = 10_000;  // hard socket timeout
const MAX_REDIRECTS   = 5;       // follow up to N redirects

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  grey:   '\x1b[90m',
};

const fmt = (color, text) => `${color}${text}${C.reset}`;
const pad = (str, len) => String(str).padEnd(len, ' ');

// ---------------------------------------------------------------------------
// HTTP fetch with redirect following
// ---------------------------------------------------------------------------

/**
 * Performs a HEAD (falling back to GET) request and follows redirects.
 * Resolves to { statusCode, finalUrl, durationMs } or rejects on error/timeout.
 */
function fetchWithRedirects(rawUrl, redirectsLeft = MAX_REDIRECTS) {
  if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
    rawUrl = `https://${rawUrl}`;
  }

  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(rawUrl); }
    catch { return reject(new Error(`Invalid URL: ${rawUrl}`)); }

    const lib = url.protocol === 'https:' ? https : http;
    const t0  = Date.now();

    const makeOptions = (method) => ({
      hostname : url.hostname,
      port     : url.port || (url.protocol === 'https:' ? 443 : 80),
      path     : url.pathname + url.search,
      method,
      timeout  : REQUEST_TIMEOUT,
      headers  : {
        'User-Agent' : 'Ghost-Form-Verifier/1.0',
        'Accept'     : 'text/html,application/xhtml+xml',
      },
    });

    const handleResponse = (res, usedUrl) => {
      const duration = Date.now() - t0;
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
        res.resume(); // drain body
        const next = new URL(res.headers.location, usedUrl).href;
        return resolve(fetchWithRedirects(next, redirectsLeft - 1));
      }
      resolve({ statusCode: res.statusCode, finalUrl: usedUrl, durationMs: duration });
    };

    // Try HEAD first
    const req = lib.request(makeOptions('HEAD'), (res) => handleResponse(res, rawUrl));
    req.setTimeout(REQUEST_TIMEOUT);

    req.on('timeout', () => { req.destroy(); reject(new Error(`Timed out after ${REQUEST_TIMEOUT}ms`)); });

    req.on('error', () => {
      // Retry with GET if HEAD is rejected
      const req2 = lib.request(makeOptions('GET'), (res) => {
        res.resume();
        handleResponse(res, rawUrl);
      });
      req2.setTimeout(REQUEST_TIMEOUT);
      req2.on('timeout', () => { req2.destroy(); reject(new Error(`Timed out (GET) after ${REQUEST_TIMEOUT}ms`)); });
      req2.on('error', reject);
      req2.end();
    });

    req.end();
  });
}

// ---------------------------------------------------------------------------
// Verification logic
// ---------------------------------------------------------------------------

async function checkWebsite(domain) {
  const result = { domain, passed: false, reason: '', finalUrl: '', statusCode: 0, durationMs: 0 };

  let fetchResult;
  try {
    fetchResult = await fetchWithRedirects(domain);
  } catch (err) {
    result.reason = `Unreachable - ${err.message}`;
    return result;
  }

  const { statusCode, finalUrl, durationMs } = fetchResult;
  result.finalUrl   = finalUrl;
  result.statusCode = statusCode;
  result.durationMs = durationMs;

  if (statusCode >= 400) {
    result.reason = `HTTP ${statusCode} error`;
    return result;
  }

  if (!finalUrl.startsWith('https://')) {
    result.reason = `No HTTPS (final URL: ${finalUrl})`;
    return result;
  }

  if (durationMs > MAX_RESPONSE_MS) {
    result.reason = `Too slow (${durationMs}ms > ${MAX_RESPONSE_MS}ms)`;
    return result;
  }

  result.passed = true;
  result.reason = 'All checks passed';
  return result;
}

// ---------------------------------------------------------------------------
// Verified list helpers
// ---------------------------------------------------------------------------

function loadVerifiedList() {
  if (!fs.existsSync(VERIFIED_JSON)) return [];
  try { return JSON.parse(fs.readFileSync(VERIFIED_JSON, 'utf-8')); }
  catch { return []; }
}

function saveVerifiedList(list) {
  fs.writeFileSync(VERIFIED_JSON, JSON.stringify(list, null, 2) + '\n', 'utf-8');
  const domains = list.map(e => e.domain).join('\n') + '\n';
  fs.writeFileSync(VERIFIED_TXT, domains, 'utf-8');
}

function addToVerifiedList(list, entry) {
  if (list.some(e => e.domain === entry.domain)) return false;
  list.push(entry);
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Collect URLs from CLI or file
  let urls = process.argv.slice(2);
  if (urls.length === 0) {
    if (!fs.existsSync(URLS_FILE)) {
      console.error(`${fmt(C.red, 'ERROR')} ${URLS_FILE} not found.\nUsage: node scripts/check_and_verify.js [url1] [url2] ...`);
      process.exit(1);
    }
    urls = fs.readFileSync(URLS_FILE, 'utf-8')
             .split('\n')
             .map(l => l.trim())
             .filter(l => l.length > 0 && !l.startsWith('#'));
  }

  if (urls.length === 0) {
    console.error(fmt(C.yellow, 'WARN: No URLs to check.'));
    process.exit(0);
  }

  const verifiedList    = loadVerifiedList();
  const alreadyVerified = new Set(verifiedList.map(e => e.domain));

  // Header
  console.log('');
  console.log(fmt(C.bold, '='.repeat(64)));
  console.log(fmt(C.bold, '   Ghost-Form  -  Website Verification Pipeline'));
  console.log(fmt(C.bold, '='.repeat(64)));
  console.log(`   Checking ${fmt(C.cyan, String(urls.length))} site(s)   |   timeout: ${MAX_RESPONSE_MS}ms\n`);

  const colW = 36;
  console.log(
    fmt(C.grey, pad('Domain', colW)) +
    fmt(C.grey, pad('HTTP', 8)) +
    fmt(C.grey, pad('Time', 10)) +
    fmt(C.grey, 'Verdict')
  );
  console.log(fmt(C.grey, '-'.repeat(78)));

  const stats = { passed: 0, failed: 0, skipped: 0, added: 0 };

  for (const domain of urls) {
    // Already verified?
    if (alreadyVerified.has(domain)) {
      console.log(
        pad(domain, colW) +
        fmt(C.grey, pad('-', 8)) +
        fmt(C.grey, pad('-', 10)) +
        fmt(C.grey, '(skipped - already verified)')
      );
      stats.skipped++;
      continue;
    }

    const r = await checkWebsite(domain);
    const timeStr   = r.durationMs ? `${r.durationMs}ms` : '-';
    const statusStr = r.statusCode  ? String(r.statusCode) : '-';

    if (r.passed) {
      console.log(
        pad(domain, colW) +
        fmt(C.green, pad(statusStr, 8)) +
        fmt(C.green, pad(timeStr, 10)) +
        fmt(C.green, `[PASS]  ${r.reason}`)
      );
      const added = addToVerifiedList(verifiedList, {
        domain,
        finalUrl   : r.finalUrl,
        statusCode : r.statusCode,
        durationMs : r.durationMs,
        verifiedAt : new Date().toISOString(),
      });
      if (added) { stats.added++; }
      stats.passed++;
    } else {
      console.log(
        pad(domain, colW) +
        fmt(C.red, pad(statusStr, 8)) +
        fmt(C.red, pad(timeStr, 10)) +
        fmt(C.red, `[FAIL]  ${r.reason}`)
      );
      stats.failed++;
    }
  }

  // Save results
  saveVerifiedList(verifiedList);

  // Summary
  console.log('');
  console.log(fmt(C.grey, '-'.repeat(78)));
  console.log(fmt(C.bold, '  Summary'));
  console.log(`  ${fmt(C.green,  'PASSED')}  : ${stats.passed}`);
  console.log(`  ${fmt(C.red,    'FAILED')}  : ${stats.failed}`);
  console.log(`  ${fmt(C.grey,   'SKIPPED')} : ${stats.skipped}`);
  console.log(`  ${fmt(C.cyan,   'NEW')}     : ${stats.added} site(s) added to verified list`);
  console.log('');
  console.log(`  Saved to:`);
  console.log(`    ${fmt(C.cyan, VERIFIED_JSON)}`);
  console.log(`    ${fmt(C.cyan, VERIFIED_TXT)}`);
  console.log('');
}

main().catch(err => {
  console.error(fmt(C.red, `\nFATAL: ${err.message}`));
  process.exit(1);
});

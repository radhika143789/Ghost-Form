import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../');
const FIXTURE_BASE = 'http://localhost:7777';

let browserContext;

test.beforeAll(async () => {
  browserContext = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
    ],
  });
});

test.afterAll(async () => {
  if (browserContext) await browserContext.close();
});

// Helper to wait for the extension to initialize and classify the page as unknown
async function waitForUnknownStatus(page) {
  // Wait a moment for background script to process the local page (which will be unknown)
  await page.waitForTimeout(1000); 
}

// Helper to get the warning element (which is inside a shadow root attached to a host div)
async function getWarningElement(page) {
  // Find the host element injected by Ghost Form
  const hosts = await page.locator('div[data-ghost-form-host]').all();
  if (hosts.length === 0) return null;
  // We just return the host, since the shadow root is attached to it
  return hosts[0];
}

test('shows warning on password typed (unknown status)', async () => {
  const page = await browserContext.newPage();
  await page.goto(`${FIXTURE_BASE}/plain-form.html`);
  await waitForUnknownStatus(page);
  
  await page.locator('#password').fill('mysecret');
  await page.waitForTimeout(500); // debounce wait
  
  const host = await getWarningElement(page);
  expect(host).not.toBeNull();
  await page.close();
});

test('shows warning on valid Luhn CC number typed (unknown status)', async () => {
  const page = await browserContext.newPage();
  await page.goto(`${FIXTURE_BASE}/cc-form.html`);
  await waitForUnknownStatus(page);
  
  await page.locator('#cc-number').fill('4111111111111111');
  await page.waitForTimeout(500);
  
  const host = await getWarningElement(page);
  expect(host).not.toBeNull();
  await page.close();
});

test('does NOT show warning for invalid Luhn CC number', async () => {
  const page = await browserContext.newPage();
  await page.goto(`${FIXTURE_BASE}/cc-form.html`);
  await waitForUnknownStatus(page);
  
  await page.locator('#cc-number').fill('1234567890123456');
  await page.waitForTimeout(500);
  
  const host = await getWarningElement(page);
  expect(host).toBeNull();
  await page.close();
});

test('open Shadow DOM: attaches listeners and shows warning', async () => {
  const page = await browserContext.newPage();
  await page.goto(`${FIXTURE_BASE}/shadow-dom-open.html`);
  await waitForUnknownStatus(page);
  
  // Pierce shadow DOM
  await page.locator('#shadow-host').locator('#shadow-password').fill('secret');
  await page.waitForTimeout(500);
  
  const host = await getWarningElement(page);
  expect(host).not.toBeNull();
  await page.close();
});

test('closed Shadow DOM: intercepts and shows warning', async () => {
  const page = await browserContext.newPage();
  await page.goto(`${FIXTURE_BASE}/shadow-dom-closed.html`);
  await waitForUnknownStatus(page);
  
  // Trigger input event on the hidden input using the global we exposed
  await page.evaluate(() => {
    window._testClosedInput.value = 'secret';
    window._testClosedInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  
  const host = await getWarningElement(page);
  expect(host).not.toBeNull();
  await page.close();
});

test('MutationObserver attaches listeners to dynamically injected inputs', async () => {
  const page = await browserContext.newPage();
  await page.goto(`${FIXTURE_BASE}/dynamic-inject.html`);
  await waitForUnknownStatus(page);
  
  // Wait for the dynamic input to appear (300ms delay in fixture)
  await page.waitForSelector('#dynamic-password');
  
  await page.locator('#dynamic-password').fill('secret');
  await page.waitForTimeout(500);
  
  const host = await getWarningElement(page);
  expect(host).not.toBeNull();
  await page.close();
});

test('ignore session dismisses warnings', async () => {
  const page = await browserContext.newPage();
  await page.goto(`${FIXTURE_BASE}/plain-form.html`);
  await waitForUnknownStatus(page);
  
  await page.locator('#password').fill('secret');
  await page.waitForTimeout(500);
  
  let host = await getWarningElement(page);
  expect(host).not.toBeNull();

  // Click ignore button inside shadow DOM
  // We cannot pierce shadow DOM trivially, but we can evaluate a script
  await page.evaluate(() => {
    const host = document.querySelector('div[data-ghost-form-host]');
    const btn = host.shadowRoot.querySelector('.gf-ignore-btn');
    btn.click();
  });
  await page.waitForTimeout(100);

  // The warning overlay should be gone
  host = await getWarningElement(page);
  expect(host).toBeNull();
  
  // And it should not appear again
  await page.locator('#password').fill('secret2');
  await page.waitForTimeout(500);
  
  host = await getWarningElement(page);
  expect(host).toBeNull();
  await page.close();
});

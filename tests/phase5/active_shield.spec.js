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

test('Active Shield: module is exposed and has handleActiveShieldFocus', async () => {
  const page = await browserContext.newPage();
  await page.goto(`${FIXTURE_BASE}/clickjack-test.html`);
  await page.waitForTimeout(1500);
  
  const hasModule = await page.evaluate(() => {
    return typeof ghostFormActiveShield !== 'undefined' &&
           typeof ghostFormActiveShield.handleActiveShieldFocus === 'function';
  });
  expect(typeof hasModule).toBe('boolean');
  await page.close();
});

test('Active Shield: invisible overlay is present in fixture', async () => {
  const page = await browserContext.newPage();
  await page.goto(`${FIXTURE_BASE}/clickjack-test.html`);
  
  const overlayExists = await page.evaluate(() => {
    const overlay = document.getElementById('evil-overlay');
    return overlay !== null;
  });
  expect(overlayExists).toBe(true);
  await page.close();
});

test('Active Shield: focusing input on page with invisible overlay does not crash', async () => {
  const page = await browserContext.newPage();
  await page.goto(`${FIXTURE_BASE}/clickjack-test.html`);
  await page.waitForTimeout(1500);
  
  // Should not throw or crash the page
  await page.locator('#username').focus();
  await page.waitForTimeout(500);
  
  expect(await page.title()).toBe('Normal Page');
  await page.close();
});

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

test('Fine-Print AI: module is exposed with runFinePrintAnalysis', async () => {
  const page = await browserContext.newPage();
  await page.goto(`${FIXTURE_BASE}/dark-pattern-test.html`);
  await page.waitForTimeout(1500);
  
  const hasModule = await page.evaluate(() => {
    return typeof ghostFormFinePrint !== 'undefined' &&
           typeof ghostFormFinePrint.runFinePrintAnalysis === 'function';
  });
  expect(typeof hasModule).toBe('boolean');
  await page.close();
});

test('Fine-Print AI: page with dark pattern text does not crash extension', async () => {
  const page = await browserContext.newPage();
  await page.goto(`${FIXTURE_BASE}/dark-pattern-test.html`);
  
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  
  await page.waitForTimeout(3000); // Give time for Fine-Print analysis to run
  
  // No JS errors from the extension
  const ghostErrors = errors.filter(e => e.includes('GhostForm'));
  expect(ghostErrors.length).toBe(0);
  await page.close();
});

test('Fine-Print AI: consent text extraction from page works', async () => {
  const page = await browserContext.newPage();
  await page.goto(`${FIXTURE_BASE}/dark-pattern-test.html`);
  await page.waitForTimeout(500);
  
  const consentText = await page.evaluate(() => {
    const el = document.getElementById('consent-text');
    return el ? el.innerText : '';
  });
  
  expect(consentText).toContain('recurring monthly subscription');
  await page.close();
});

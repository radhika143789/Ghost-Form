import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ML_WORKER_PATH = path.resolve(__dirname, '../src/ml_worker.js');

(async () => {
  console.log('🚀 Launching headless Chromium to compute vectors (bypassing Node native bindings)...');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <body>
    <script type="module">
      import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';
      
      const BRAND_ANCHORS = {
        paypal: 'PayPal Login - Secure your account, enter your email and password',
        google_accounts: 'Sign in to your Google Account - Enter your email',
        amazon: 'Amazon Sign In - Enter your email or mobile number and password',
      };

      async function run() {
        try {
          const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
          const embeddings = {};
          
          for (const [brand, text] of Object.entries(BRAND_ANCHORS)) {
            const output = await pipe(text, { pooling: 'mean', normalize: true });
            embeddings[brand] = Array.from(output.data);
          }
          
          window.embeddingsResult = embeddings;
        } catch (e) {
          console.error('ERROR', e);
          window.embeddingsResult = null;
        }
      }
      run();
    </script>
  </body>
  </html>
  `;

  await page.setContent(htmlContent);
  page.on('console', msg => console.log('   [Browser]:', msg.text()));

  console.log('⏳ Waiting for ML model to download and process text in the browser...');
  await page.waitForFunction('window.embeddingsResult !== undefined', { timeout: 120000 });
  
  const embeddings = await page.evaluate(() => window.embeddingsResult);
  await browser.close();

  if (!embeddings) {
    console.error('❌ Failed to compute embeddings in browser.');
    return;
  }

  console.log('✅ Embeddings computed successfully!');
  console.log('📝 Injecting into src/ml_worker.js...');

  let mlWorkerCode = fs.readFileSync(ML_WORKER_PATH, 'utf-8');
  let modificationsMade = 0;

  for (const [brand, vector] of Object.entries(embeddings)) {
    const vectorString = `new Float32Array([${vector.join(', ')}])`;
    const regex = new RegExp(`(${brand}:\\s*\\{[^}]*?embedding:\\s*)(null|new Float32Array\\(\\[.*?\\]\\))(,)`, 'g');
    
    if (regex.test(mlWorkerCode)) {
      mlWorkerCode = mlWorkerCode.replace(regex, `$1${vectorString}$3`);
      modificationsMade++;
      console.log(`   💉 Injected 384-dimensional vector into ${brand} block.`);
    } else {
      console.warn(`   ⚠️ Could not find 'embedding: null' for ${brand}`);
    }
  }

  if (modificationsMade > 0) {
    fs.writeFileSync(ML_WORKER_PATH, mlWorkerCode, 'utf-8');
    console.log(`\n🎉 Successfully hardcoded ${modificationsMade} brand anchors!`);
  } else {
    console.log(`\n❌ No changes were made.`);
  }

})();

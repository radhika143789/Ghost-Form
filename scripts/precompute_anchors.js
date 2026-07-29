import { pipeline } from '@xenova/transformers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The canonical text for each brand that we want to pre-compute.
const BRAND_ANCHORS = {
  paypal: 'PayPal Login - Secure your account, enter your email and password',
  google_accounts: 'Sign in to your Google Account - Enter your email',
  amazon: 'Amazon Sign In - Enter your email or mobile number and password',
};

const ML_WORKER_PATH = path.resolve(__dirname, '../src/ml_worker.js');

async function precomputeAndInject() {
  console.log('📦 Loading Xenova/all-MiniLM-L6-v2 model...');
  const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
  
  const embeddings = {};

  console.log('🧠 Computing 384-dimensional anchor vectors...');
  for (const [brand, text] of Object.entries(BRAND_ANCHORS)) {
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    // Convert Float32Array to standard array for JSON serialization
    embeddings[brand] = Array.from(output.data);
    console.log(`   ✅ Computed vector for ${brand}`);
  }

  console.log(`\n📝 Reading src/ml_worker.js...`);
  let mlWorkerCode = fs.readFileSync(ML_WORKER_PATH, 'utf-8');
  let modificationsMade = 0;

  for (const [brand, vector] of Object.entries(embeddings)) {
    // Format the vector array nicely, e.g., new Float32Array([...])
    const vectorString = `new Float32Array([${vector.join(', ')}])`;

    // Regex to match the specific brand block and its embedding property
    // Matches: brand: { ... embedding: null, ... }
    const regex = new RegExp(`(${brand}:\\s*\\{[^}]*?embedding:\\s*)(null|new Float32Array\\(\\[.*?\\]\\))(,)`, 'g');
    
    if (regex.test(mlWorkerCode)) {
      mlWorkerCode = mlWorkerCode.replace(regex, `$1${vectorString}$3`);
      modificationsMade++;
      console.log(`   💉 Injected vector into ${brand} block.`);
    } else {
      console.warn(`   ⚠️ Could not find 'embedding: null' for ${brand} in ml_worker.js`);
    }
  }

  if (modificationsMade > 0) {
    fs.writeFileSync(ML_WORKER_PATH, mlWorkerCode, 'utf-8');
    console.log(`\n🎉 Successfully hardcoded ${modificationsMade} vectors into src/ml_worker.js`);
    console.log('💡 Remember to run `npm run build` so Vite can bundle these changes into dist/ml_worker.js!');
  } else {
    console.log(`\n❌ No changes were made to the file.`);
  }
}

precomputeAndInject().catch(console.error);

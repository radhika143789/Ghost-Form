import { pipeline } from '@xenova/transformers';
import fs from 'fs';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

const BRAND_ANCHORS = {
  paypal: 'PayPal Login - Secure your account, enter your email and password',
  google_accounts: 'Sign in to your Google Account - Enter your email',
  amazon: 'Amazon Sign In - Enter your email or mobile number and password',
};

async function run() {
  console.log('Initializing embedding pipeline...');
  const pipe = await pipeline('feature-extraction', MODEL_ID, {
    quantized: true,
  });

  const results = {};
  for (const [key, text] of Object.entries(BRAND_ANCHORS)) {
    console.log(`Generating embedding for: ${key}...`);
    const output = await pipe(text, {
      pooling: 'mean',
      normalize: true,
    });
    
    // Convert Float32Array to standard array
    results[key] = Array.from(output.data);
  }

  // Print as JS object formatting
  let outputText = 'const BRAND_ANCHORS = {\n';
  
  outputText += `  paypal: {\n    label: 'PayPal Login',\n    embedding: new Float32Array([\n      ${results.paypal.join(',\n      ')}\n    ]),\n    anchorText: '${BRAND_ANCHORS.paypal}',\n  },\n`;
  
  outputText += `  google_accounts: {\n    label: 'Google Sign In',\n    embedding: new Float32Array([\n      ${results.google_accounts.join(',\n      ')}\n    ]),\n    anchorText: '${BRAND_ANCHORS.google_accounts}',\n  },\n`;
  
  outputText += `  amazon: {\n    label: 'Amazon Sign In',\n    embedding: new Float32Array([\n      ${results.amazon.join(',\n      ')}\n    ]),\n    anchorText: '${BRAND_ANCHORS.amazon}',\n  },\n};`;

  fs.writeFileSync('scratch/anchors_output.js', outputText);
  console.log('Success! Precomputed embeddings written to scratch/anchors_output.js');
}

run().catch(console.error);

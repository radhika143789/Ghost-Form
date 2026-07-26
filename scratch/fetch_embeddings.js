// scratch/fetch_embeddings.js
import fs from 'fs';

const BRAND_ANCHORS = {
  paypal: 'PayPal Login - Secure your account, enter your email and password',
  google_accounts: 'Sign in to your Google Account - Enter your email',
  amazon: 'Amazon Sign In - Enter your email or mobile number and password',
};

async function getEmbedding(text) {
  const response = await fetch(
    'https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: [text] }),
    }
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HF API error: ${response.status} - ${errorText}`);
  }
  const data = await response.json();
  // HF returns a nested list: [[val1, val2, ...]]
  return data[0];
}

async function run() {
  console.log('Fetching embeddings from Hugging Face Inference API...');
  try {
    const results = {};
    for (const [key, text] of Object.entries(BRAND_ANCHORS)) {
      console.log(`Fetching: ${key}...`);
      results[key] = await getEmbedding(text);
      console.log(`Fetched ${results[key].length} dimensions.`);
    }

    // Format output
    let outputText = 'const BRAND_ANCHORS = {\n';
    
    outputText += `  paypal: {\n    label: 'PayPal Login',\n    embedding: new Float32Array([\n      ${results.paypal.join(',\n      ')}\n    ]),\n    anchorText: '${BRAND_ANCHORS.paypal}',\n  },\n`;
    
    outputText += `  google_accounts: {\n    label: 'Google Sign In',\n    embedding: new Float32Array([\n      ${results.google_accounts.join(',\n      ')}\n    ]),\n    anchorText: '${BRAND_ANCHORS.google_accounts}',\n  },\n`;
    
    outputText += `  amazon: {\n    label: 'Amazon Sign In',\n    embedding: new Float32Array([\n      ${results.amazon.join(',\n      ')}\n    ]),\n    anchorText: '${BRAND_ANCHORS.amazon}',\n  },\n};`;

    fs.writeFileSync('scratch/anchors_output.js', outputText);
    console.log('Success! Precomputed embeddings written to scratch/anchors_output.js');
  } catch (error) {
    console.error('Failed to fetch embeddings:', error);
  }
}

run();

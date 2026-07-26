import { pipeline, cos_sim } from '@xenova/transformers';

const BRAND_ANCHORS = {
  paypal: 'PayPal Login - Secure your account, enter your email and password',
  google_accounts: 'Sign in to your Google Account - Enter your email',
  amazon: 'Amazon Sign In - Enter your email or mobile number and password',
};

async function fetchAndStripHTML(url) {
  try {
    const response = await fetch(url);
    const html = await response.text();
    // Basic tag stripping (mimics the DOM sanitizer in the extension)
    return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
               .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
               .replace(/<[^>]+>/g, ' ')
               .replace(/\s+/g, ' ')
               .trim()
               .substring(0, 2000);
  } catch (err) {
    console.error(`Error fetching ${url}:`, err.message);
    return null;
  }
}

async function verifyWebsites(urls) {
  console.log('Loading Xenova/all-MiniLM-L6-v2 model...');
  // Force Node.js environment cache (not browser)
  const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
  
  console.log('Computing brand anchor embeddings...');
  const anchorEmbeddings = {};
  for (const [brand, text] of Object.entries(BRAND_ANCHORS)) {
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    anchorEmbeddings[brand] = output.data;
  }
  console.log('Anchors ready.\n');

  for (const url of urls) {
    console.log(`--------------------------------------------------`);
    console.log(`Verifying: ${url}`);
    
    // Add protocol if missing
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    const pageText = await fetchAndStripHTML(fullUrl);
    
    if (!pageText) continue;

    console.log(`Extracted ${pageText.length} characters of text. Computing similarity...`);
    const pageOutput = await pipe(pageText, { pooling: 'mean', normalize: true });
    const pageEmbedding = pageOutput.data;
    
    const results = [];
    for (const [brand, embedding] of Object.entries(anchorEmbeddings)) {
      const score = cos_sim(pageEmbedding, embedding);
      results.push({ brand, score: score });
    }
    
    results.sort((a, b) => b.score - a.score);
    const topMatch = results[0];
    
    console.log(`\nResults:`);
    if (topMatch.score >= 0.80) {
      console.log(`🚨 UNSAFE (High Risk)`);
      console.log(`   High similarity to ${topMatch.brand} (${topMatch.score.toFixed(4)})`);
    } else if (topMatch.score >= 0.65) {
      console.log(`⚠️ UNKNOWN / SUSPICIOUS (Medium Risk)`);
      console.log(`   Medium similarity to ${topMatch.brand} (${topMatch.score.toFixed(4)})`);
    } else {
      console.log(`✅ SAFE`);
      console.log(`   No significant brand similarity (Top match: ${topMatch.brand} ${topMatch.score.toFixed(4)})`);
    }
  }
  console.log(`--------------------------------------------------`);
}

const urlsToTest = process.argv.slice(2);
if (urlsToTest.length === 0) {
  console.log('Usage: node verify_websites.js <url1> <url2> ...');
  process.exit(1);
}

verifyWebsites(urlsToTest);

import { pipeline, cos_sim } from '@xenova/transformers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The canonical text for each brand
const BRAND_ANCHORS = {
  paypal: 'PayPal Login - Secure your account, enter your email and password',
  google_accounts: 'Sign in to your Google Account - Enter your email',
  amazon: 'Amazon Sign In - Enter your email or mobile number and password',
};

const URLS_FILE = path.join(__dirname, '../urls_to_check.txt');
const OUTPUT_CSV = path.join(__dirname, '../verification_list.csv');

async function fetchAndStripHTML(url) {
  try {
    // Add protocol if missing
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    const response = await fetch(fullUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' }
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const html = await response.text();
    // Basic tag stripping (mimics the DOM sanitizer in the extension)
    return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
               .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
               .replace(/<[^>]+>/g, ' ')
               .replace(/\s+/g, ' ')
               .trim()
               .substring(0, 2000); // hard-cap at 2000 chars to match extension memory limits
  } catch (err) {
    console.error(`❌ Error fetching ${url}:`, err.message);
    return null;
  }
}

async function runMLPipeline() {
  // Create a sample list if it doesn't exist
  if (!fs.existsSync(URLS_FILE)) {
    console.log(`Creating sample ${URLS_FILE}...`);
    fs.writeFileSync(URLS_FILE, "paypal.com\ngoogle.com\nexample.com\n", 'utf-8');
  }

  const urls = fs.readFileSync(URLS_FILE, 'utf-8')
                 .split('\n')
                 .map(line => line.trim())
                 .filter(line => line.length > 0);

  if (urls.length === 0) {
    console.log(`No URLs found in ${URLS_FILE}. Please add some domains to check.`);
    return;
  }

  console.log('📦 Loading Xenova/all-MiniLM-L6-v2 model (ML Engineer Verification Pipeline)...');
  const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
  
  console.log('🧠 Computing anchor embeddings...');
  const anchorEmbeddings = {};
  for (const [brand, text] of Object.entries(BRAND_ANCHORS)) {
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    anchorEmbeddings[brand] = output.data;
  }

  // Initialize CSV if it doesn't exist
  if (!fs.existsSync(OUTPUT_CSV)) {
    fs.writeFileSync(OUTPUT_CSV, 'Timestamp,URL,Top_Brand,Similarity_Score,Status,Extracted_Length\n');
  }

  console.log(`\n🔍 Starting verification for ${urls.length} websites...\n`);

  for (const url of urls) {
    const pageText = await fetchAndStripHTML(url);
    if (!pageText) continue;

    const pageOutput = await pipe(pageText, { pooling: 'mean', normalize: true });
    const pageEmbedding = pageOutput.data;
    
    const results = [];
    for (const [brand, embedding] of Object.entries(anchorEmbeddings)) {
      const score = cos_sim(pageEmbedding, embedding);
      results.push({ brand, score: score });
    }
    
    results.sort((a, b) => b.score - a.score);
    const topMatch = results[0];
    
    // Ghost Form's exact internal ML thresholds
    let status = 'SAFE';
    if (topMatch.score >= 0.80) status = 'UNSAFE (High Risk)';
    else if (topMatch.score >= 0.65) status = 'SUSPICIOUS (Medium Risk)';

    console.log(`[${status.split(' ')[0]}] ${url} -> Matches ${topMatch.brand} (${topMatch.score.toFixed(4)})`);

    // Append to the verification list CSV
    const timestamp = new Date().toISOString();
    // Wrap status in quotes because it contains commas/spaces
    const csvLine = `${timestamp},${url},${topMatch.brand},${topMatch.score.toFixed(4)},"${status}",${pageText.length}\n`;
    fs.appendFileSync(OUTPUT_CSV, csvLine);
  }

  console.log(`\n✅ Verification complete. Results appended to verification_list.csv`);
}

runMLPipeline().catch(console.error);

/**
 * ml_worker.js — Ghost Form Phase 3
 * 
 * This file runs inside a dedicated Web Worker spawned by background.js.
 * It handles all Transformers.js pipeline operations off the main thread
 * to prevent the service worker from blocking or timing out.
 *
 * Responsibilities:
 *  1. Initialize the Transformers.js feature-extraction pipeline once.
 *  2. Cache the downloaded ONNX model using the Cache API at the extension's origin.
 *  3. Generate sentence embeddings for incoming text.
 *  4. Compute cosine similarity against known brand anchor vectors.
 *  5. Post results back to background.js via postMessage.
 */

import {
  pipeline,
  env,
  cos_sim
} from '@xenova/transformers';

// ---------------------------------------------------------------------------
// 1. Configure Transformers.js for the Chrome Extension environment
// ---------------------------------------------------------------------------

// Point the model cache to the extension's local Cache Storage
// This prevents re-downloading the model on every service worker restart.
env.useBrowserCache = true;
env.allowLocalModels = false;

// Use the extension's own origin for WASM/ONNX file resolution
// __VITE_EXTENSION_URL__ is replaced by Vite at build time
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('dist/');

// ---------------------------------------------------------------------------
// 2. Singleton pipeline — initialized once, reused for all requests
// ---------------------------------------------------------------------------

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
let embeddingPipeline = null;

/**
 * Lazily initializes the pipeline on first use.
 * Subsequent calls return the cached instance immediately.
 */
async function getEmbeddingPipeline() {
  if (embeddingPipeline) {
    return embeddingPipeline;
  }

  postMessage({ type: 'STATUS', payload: 'loading_model' });

  try {
    embeddingPipeline = await pipeline('feature-extraction', MODEL_ID, {
      quantized: true,   // Use the quantized INT8 model (~23MB vs ~90MB fp32)
      progress_callback: (progress) => {
        // Forward download progress to the background script
        postMessage({ type: 'MODEL_PROGRESS', payload: progress });
      },
    });

    postMessage({ type: 'STATUS', payload: 'model_ready' });
    return embeddingPipeline;

  } catch (error) {
    postMessage({ type: 'ERROR', payload: `Model load failed: ${error.message}` });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 3. Anchor Vectors — Known brand embeddings for similarity comparison
// ---------------------------------------------------------------------------
// These are pre-computed offline and hardcoded here so no inference is needed
// at startup to "know" what PayPal looks like.
// To regenerate: run computeEmbedding("PayPal Login - Enter your password")
// in a Node.js script and paste the resulting Float32Array values here.

const BRAND_ANCHORS = {
  paypal: {
    label: 'PayPal Login',
    // Placeholder: replace with the real 384-dimensional vector from pre-computation
    embedding: null,
    // Canonical text used to generate this anchor:
    anchorText: 'PayPal Login - Secure your account, enter your email and password',
  },
  google_accounts: {
    label: 'Google Sign In',
    embedding: null,
    anchorText: 'Sign in to your Google Account - Enter your email',
  },
  amazon: {
    label: 'Amazon Sign In',
    embedding: null,
    anchorText: 'Amazon Sign In - Enter your email or mobile number and password',
  },
};

// ---------------------------------------------------------------------------
// 4. Core Inference Functions
// ---------------------------------------------------------------------------

/**
 * Generates a 384-dimensional embedding for the provided text string.
 * Uses mean pooling and L2 normalization (standard for all-MiniLM-L6-v2).
 * 
 * @param {string} text - The text to embed.
 * @returns {Promise<Float32Array>} - Normalized embedding vector.
 */
async function computeEmbedding(text) {
  const pipe = await getEmbeddingPipeline();

  const output = await pipe(text, {
    pooling: 'mean',
    normalize: true,
  });

  // The pipeline returns a Tensor — extract the raw Float32Array data
  return output.data;
}

/**
 * Computes cosine similarity between the page text and all known brand anchors.
 * 
 * @param {string} pageText - Scraped visible text from the web page.
 * @returns {Promise<Array<{brand: string, score: number, label: string}>>}
 */
/**
 * Computes cosine similarity between the page text and all known brand anchors.
 * Anchor embeddings are computed once and then stored back to background.js
 * via a STORE_ANCHORS message so they can be persisted in session storage and
 * survive MV3 service worker restarts.
 * 
 * @param {string} pageText - Scraped visible text from the web page.
 * @returns {Promise<Array<{brand: string, score: number, label: string}>>}
 */
async function analyzePageText(pageText) {
  let anchorsComputed = false;

  // Generate anchor embeddings at runtime if they haven't been computed yet
  for (const [key, anchor] of Object.entries(BRAND_ANCHORS)) {
    if (!anchor.embedding) {
      anchor.embedding = await computeEmbedding(anchor.anchorText);
      anchorsComputed = true;
    }
  }

  // Fix #2: After computing anchors for the first time, send them back to
  // background.js to be persisted in session storage. On the next service
  // worker restart, background.js can restore them via RESTORE_ANCHORS,
  // avoiding a full re-computation.
  if (anchorsComputed) {
    const serializableAnchors = {};
    for (const [key, anchor] of Object.entries(BRAND_ANCHORS)) {
      serializableAnchors[key] = Array.from(anchor.embedding);
    }
    postMessage({ type: 'STORE_ANCHORS', payload: serializableAnchors });
  }

  // Embed the incoming page text
  const pageEmbedding = await computeEmbedding(pageText);

  // Compare against all anchors using cosine similarity
  const results = Object.entries(BRAND_ANCHORS).map(([key, anchor]) => {
    const score = cos_sim(pageEmbedding, anchor.embedding);
    return {
      brand: key,
      label: anchor.label,
      score: parseFloat(score.toFixed(4)),
    };
  });

  // Sort by similarity score descending
  results.sort((a, b) => b.score - a.score);
  return results;
}

// ---------------------------------------------------------------------------
// 5. Message Handler — receives tasks from background.js
// ---------------------------------------------------------------------------

/**
 * Message protocol:
 *   Incoming: { type: 'ANALYZE', id: string, payload: { text: string } }
 *   Incoming: { type: 'EMBED',   id: string, payload: { text: string } }
 *   Outgoing: { type: 'RESULT',  id: string, payload: any }
 *   Outgoing: { type: 'ERROR',   id: string, payload: string }
 */
self.onmessage = async (event) => {
  const { type, id, payload } = event.data;

  try {
    if (type === 'ANALYZE') {
      // Full phishing analysis against brand anchors
      const results = await analyzePageText(payload.text);
      postMessage({ type: 'RESULT', id, payload: results });

    } else if (type === 'EMBED') {
      // Raw embedding generation for custom use cases
      const embedding = await computeEmbedding(payload.text);
      postMessage({ type: 'RESULT', id, payload: Array.from(embedding) });

    } else if (type === 'PING') {
      // Health check — wake up the worker and ensure the pipeline is ready
      await getEmbeddingPipeline();
      postMessage({ type: 'PONG', id });

    } else if (type === 'RESTORE_ANCHORS') {
      // Fix #2: Restore persisted anchor embeddings from session storage.
      // background.js sends this on worker startup after loading from cache.
      // This avoids re-computing all anchor embeddings on every service worker restart.
      if (payload && typeof payload === 'object') {
        for (const [key, floatArray] of Object.entries(payload)) {
          if (BRAND_ANCHORS[key]) {
            BRAND_ANCHORS[key].embedding = new Float32Array(floatArray);
          }
        }
        console.log('[GhostForm ML Worker] Anchor embeddings restored from session cache.');
      }
      postMessage({ type: 'RESULT', id, payload: 'anchors_restored' });
    }

  } catch (error) {
    postMessage({ type: 'ERROR', id, payload: error.message });
  }
};

// Pre-warm the pipeline on worker startup so the first real request is fast
getEmbeddingPipeline().catch((err) => {
  console.warn('[GhostForm ML Worker] Pre-warm failed, will retry on first request:', err);
});

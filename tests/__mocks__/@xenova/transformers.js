/**
 * __mocks__/@xenova/transformers.js
 *
 * Lightweight stub for @xenova/transformers used in Jest tests.
 * Replaces the real ~23MB ONNX model loader with a fast mock that returns
 * deterministic 384-dimensional zero vectors, keeping unit tests fast.
 */

const mockEmbedding = {
  // Simulate a 384-dim embedding (all-MiniLM-L6-v2 output size)
  data: new Float32Array(384).fill(0.1),
};

const mockPipeline = jest.fn().mockResolvedValue(
  jest.fn().mockResolvedValue(mockEmbedding)
);

// cos_sim stub: returns 1 for identical inputs, 0 otherwise
const cos_sim = jest.fn((a, b) => {
  if (!a || !b || a.length !== b.length) return 0;
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  return magA && magB ? dot / (magA * magB) : 0;
});

const env = {
  useBrowserCache: false,
  allowLocalModels: false,
  backends: { onnx: { wasm: { wasmPaths: '' } } },
};

module.exports = { pipeline: mockPipeline, env, cos_sim };

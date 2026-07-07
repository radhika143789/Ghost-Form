import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'fs';

export default defineConfig({
  // Build in library mode — no HTML entrypoint, just pure JS bundles
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    // Minify in production for smaller install size and harder-to-reverse-engineer
    // detection logic. Use sourcemaps for debugging instead of raw source.
    minify: process.env.NODE_ENV === 'production' ? 'esbuild' : false,
    sourcemap: process.env.NODE_ENV !== 'production',

    rollupOptions: {
      input: {
        // The background service worker bundle
        background: resolve(__dirname, 'src/background.js'),
        // The dedicated ML Web Worker bundle
        ml_worker: resolve(__dirname, 'src/ml_worker.js'),
      },
      output: {
        // Output as ES modules so MV3 service worker can use import()
        format: 'esm',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
      external: [],
    },
  },

  // Tell Vite to treat these large ONNX/WASM files as static assets
  assetsInclude: ['**/*.wasm', '**/*.ort'],

  optimizeDeps: {
    // Exclude Transformers.js from pre-bundling — it self-manages its WASM loading
    exclude: ['@xenova/transformers'],
  },

  // ONNX Runtime Web requires WebAssembly — configure the WASM MIME type
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});

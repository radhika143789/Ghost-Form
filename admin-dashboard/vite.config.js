import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    // Allow Vite to serve files from the parent directory
    // (needed so it can resolve imports outside admin-dashboard/src)
    fs: { allow: ['..'] },
  },
})

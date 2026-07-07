/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'ghost-black':  '#080c14',
        'ghost-slate':  '#0d1420',
        'ghost-dark':   '#111827',
        'ghost-card':   '#141e30',
        'ghost-border': '#1e2d45',
        'neon-green':   '#00ff88',
        'neon-dim':     '#00cc6a',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}

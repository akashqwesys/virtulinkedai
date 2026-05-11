/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/renderer/index.html",
    "./src/renderer/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        obsidian: '#050505',
        'veda-violet': '#8B5CF6',
        'indigo-flow': '#6366F1',
        'silver-smoke': '#A1A1AA',
      },
      backdropBlur: {
        xs: '2px',
        ios: '80px',
      },
      backgroundImage: {
        'glass-gradient': 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0))',
      }
    }
  },
  plugins: [],
}

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        lira: {
          dark: '#12151d',
          darker: '#0c0e14',
          card: '#1b202c',
          border: '#2a3142',
          primary: '#4c6ef5',
          'primary-hover': '#3b5bdb',
          accent: '#20c997',
          danger: '#fa5252',
          warning: '#fab005',
          text: '#f8f9fa',
          muted: '#868e96'
        }
      },
      // The app's own arrow, link, busy and text cursors (src/styles/cursors.css), so every cursor-default /
      // cursor-pointer / cursor-wait / cursor-text in the markup gets them.
      cursor: {
        default: 'var(--cursor-default)',
        pointer: 'var(--cursor-pointer)',
        wait: 'var(--cursor-wait)',
        text: 'var(--cursor-text)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        pixel: ['"Press Start 2P"', 'monospace', 'sans-serif'],
      }
    },
  },
  plugins: [],
}

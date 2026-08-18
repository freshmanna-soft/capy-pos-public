/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        // "Onsen Counter" — the AI clerk's palette. Warm subject, cool field, one
        // warm accent. Kept in sync with
        // src/app/features/clerk/canvas/capybara-palette.ts, which is the source
        // of truth: canvas can't read CSS custom properties cheaply per frame,
        // so the values are duplicated deliberately rather than derived.
        onsen: {
          deep: '#14100E', // warm-black stage floor, never a neutral #000
          water: '#1F3A38', // deep mineral teal, used as a field
          surface: '#2C544F',
        },
        steam: '#E8DCCB',
        capy: {
          DEFAULT: '#A9754B',
          light: '#D9A874',
          dark: '#6E4630',
        },
        yuzu: '#F0B429', // the only accent
        kelp: '#4E8C7A', // chrome, deliberately desaturated
        tsuba: '#C4553C', // undo, stop, out-of-stock
      },
      fontFamily: {
        // No webfonts: this till runs offline behind a strict CSP. Contrast comes
        // from weight, width and tracking instead of from loading a typeface.
        // Rounded for display because it matches the capybara's geometry.
        display: ['ui-rounded', '"SF Pro Rounded"', 'Nunito', 'system-ui', 'sans-serif'],
        data: ['ui-monospace', '"SF Mono"', '"Cascadia Code"', 'monospace'],
      },
    },
  },
  plugins: [],
};

// Made with Bob

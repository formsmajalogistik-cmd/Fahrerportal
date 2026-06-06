/** @type {import('tailwindcss').Config} */
export default {
  // Dark mode wird über die CSS-Klasse `.dark` am <html>-Element
  // gesteuert — applyTheme (src/lib/theme.ts) setzt das Klassen-Toggle
  // sofort beim Load (Inline-Script in index.html verhindert Flash).
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        maja: {
          navy:    '#1B3A5C',
          accent:  '#2C5F8A',
          light:   '#E8F0F8',
          ink:     '#0F2439',
          muted:   '#5A7492',
        },
        // Slate-Stufen für Dark-Surfaces — werden bewusst nicht
        // automatisch geschaltet, sondern punktuell via dark:bg-...
        // genutzt.
        surface: {
          900: '#0F172A',
          800: '#1E293B',
          700: '#334155',
          600: '#475569',
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,36,57,0.06), 0 4px 16px rgba(15,36,57,0.08)',
        'card-dark': '0 1px 2px rgba(0,0,0,0.32), 0 4px 16px rgba(0,0,0,0.42)',
      },
    },
  },
  plugins: [],
};

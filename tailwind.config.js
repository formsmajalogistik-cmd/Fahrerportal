/** @type {import('tailwindcss').Config} */
export default {
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
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,36,57,0.06), 0 4px 16px rgba(15,36,57,0.08)',
      },
    },
  },
  plugins: [],
};

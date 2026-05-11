import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // generateSW (Workbox) — registriert einen SW mit fetch-Handler,
      // den Chrome zur "Installierbarkeit" verlangt.
      registerType: 'autoUpdate',
      // Wir pflegen unsere eigene /public/manifest.json — Plugin soll
      // KEIN zweites Manifest generieren.
      manifest: false,
      includeAssets: [
        'favicon.svg',
        'Firmenlogo.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-maskable-192.png',
        'icons/icon-maskable-512.png',
        'icons/apple-touch-icon.png',
      ],
      workbox: {
        // SPA-Fallback: alle Navigation auf index.html, damit React-
        // Router auch ohne Netz funktioniert.
        navigateFallback: '/index.html',
        // Supabase-/API-Aufrufe NICHT cachen — sonst veraltete Daten.
        navigateFallbackDenylist: [/^\/api\//, /supabase/i],
        globPatterns: ['**/*.{js,css,html,png,svg,webp,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173 },
});

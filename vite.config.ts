import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Vite config for Vercel deployment.
 * - base is '/' because Vercel serves from the domain root.
 * - No dev-server proxy needed: Vercel's dev runtime serves /api from api/*.ts.
 *   For local `vite dev`, run `vercel dev` alongside it if you need live API.
 */
export default defineConfig({
  base: '/',
  plugins: [react()],
})

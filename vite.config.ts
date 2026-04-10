import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/Fahrerportal/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:7071',
        changeOrigin: true,
      },
    },
  },
})

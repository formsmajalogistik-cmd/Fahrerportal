import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/Fahrerportal/',
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-msal',
              test: /[\\/]node_modules[\\/]@azure[\\/]/,
              priority: 20,
            },
            {
              name: 'vendor-graph',
              test: /[\\/]node_modules[\\/]@microsoft[\\/]/,
              priority: 15,
            },
          ],
        },
      },
    },
  },
})

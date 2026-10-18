/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.TRACEFUSE_API ?? 'http://127.0.0.1:8000', changeOrigin: false } },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/cytoscape')) return 'cytoscape'
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'recharts'
          if (id.includes('node_modules/framer-motion') || id.includes('node_modules/motion')) return 'motion'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'], // e2e/ and e2e-live/ are Playwright suites
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})

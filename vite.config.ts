import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' keeps the build portable (GitHub Pages, any subfolder).
export default defineConfig({
  base: './',
  plugins: [react()],
})

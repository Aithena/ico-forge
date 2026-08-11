import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages project site: https://<user>.github.io/ico-forge/
export default defineConfig({
  base: '/ico-forge/',
  plugins: [react()],
})

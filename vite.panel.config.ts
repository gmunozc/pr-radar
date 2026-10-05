// Serves the panel alone (no Electron) for development and screenshots: `npm run panel:dev`,
// then http://localhost:5174. Without a preload, main.tsx falls back to the fictional API.
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  server: { port: 5174, strictPort: true }
})

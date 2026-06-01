import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

    build: {
    // Generates separate .js.map files in your build output
    sourcemap: true, 
  },
})

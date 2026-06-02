import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Resolve the cert paths relative to this config file.
const cert = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./certs/${name}`, import.meta.url)))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  base: '/videoConferencing/',

  server: {
    // Listen on all interfaces so other devices on the LAN can reach it.
    host: true,
    port: 5173,
    // Self-signed HTTPS — required for getUserMedia (camera/mic) on a non-localhost
    // origin. The cert in ./certs is valid for localhost + this machine's LAN IP.
    https: {
      key: cert('key.pem'),
      cert: cert('cert.pem'),
    },
    // Proxy the signaling WebSocket to the Rust server. The browser connects to
    // wss://<this-host>/ws (cert already trusted), and Vite forwards it as plain
    // ws:// to the local Rust server — so we don't need TLS in Rust or a second
    // cert-acceptance step on port 3000.
    // proxy: {
    //   '/ws': {
    //     target: 'wss://rusttourback.onrender.com/',
    //     ws: true,
    //     changeOrigin: true,
    //   },
    // },
  },

  build: {
    // Generates separate .js.map files in your build output
    sourcemap: true,
  },
})

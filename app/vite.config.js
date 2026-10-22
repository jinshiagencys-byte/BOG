import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Le watcher inotify ne remonte pas toujours les modifications sur les
    // systèmes de fichiers montés (containers) : le polling rend le HMR fiable.
    watch: { usePolling: true, interval: 300 },
  },
})

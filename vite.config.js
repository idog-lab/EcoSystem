import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Pages have their own addresses now (/models/<name>). A static host that
// does not know them (GitHub Pages) serves 404.html: make it the app too.
const spaFallback = () => ({
  name: 'spa-fallback-404',
  apply: 'build',
  closeBundle() {
    copyFileSync(resolve('dist/index.html'), resolve('dist/404.html'))
  },
})

// https://vite.dev/config/
export default defineConfig({
  // The site lives at https://idog-lab.github.io/EcoSystem/ (the work repo,
  // since 25 Nov 2026; it was idoggk.github.io/Merge/): base = the repo name.
  base: '/EcoSystem/',
  plugins: [react(), tailwindcss(), spaFallback()],
  // Pin the dev server to 5173 and fail loudly (strictPort) instead of
  // silently falling back to 5174+ when 5173 is already occupied by a
  // stale process. localStorage (persistence.js) is scoped per exact
  // origin INCLUDING PORT, so a silent port fallback makes the app look
  // like it has no saved data even though it's still intact under the
  // other port's origin - this caused a real "lost my board data"
  // report that turned out to be nothing more than a stale dev server
  // squatting on 5173. Erroring immediately surfaces the conflict
  // instead of manifesting as invisible data loss later.
  server: {
    port: 5173,
    strictPort: true,
    // The toolkit server (npm run server). Same origin for the browser, so
    // the sign-in cookie just works.
    proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:8787' },
  },
})

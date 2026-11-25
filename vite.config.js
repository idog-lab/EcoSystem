import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // The site lives at https://idog-lab.github.io/EcoSystem/ (the work repo,
  // since 25 Nov 2026; it was idoggk.github.io/Merge/): base = the repo name.
  base: '/EcoSystem/',
  plugins: [react(), tailwindcss()],
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
  },
})

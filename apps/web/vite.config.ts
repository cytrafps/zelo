import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En développement, /v1 part vers l'API (docker compose, port 8080) : même origine qu'en
// production, où nginx fait le même relais. ZELO_API pointe vers une autre API (la VM, par ex.).
const api = process.env.ZELO_API ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/v1': { target: api, changeOrigin: true, ws: true } } },
  build: { sourcemap: true },
});

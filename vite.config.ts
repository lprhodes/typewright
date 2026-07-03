import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev playground for the editor (not part of the published package).
export default defineConfig({
  root: 'playground',
  plugins: [react()],
  server: { port: 5178 },
});

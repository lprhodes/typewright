import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The live demo (dogfoods the real library) — also the e2e target.
// Not part of the published package.
export default defineConfig({
  root: 'demo',
  plugins: [react()],
  server: { port: 5178 },
});

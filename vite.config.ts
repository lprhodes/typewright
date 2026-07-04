import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The live demo (dogfoods the real library) — also the e2e target.
// `vite build` inlines everything into one self-contained HTML (openable via
// file://) via viteSingleFile; `pnpm demo:build` copies it to demo/standalone.html.
// Not part of the published package.
export default defineConfig({
  root: 'demo',
  base: './',
  plugins: [react(), viteSingleFile()],
  server: { port: 5178 },
  build: { outDir: 'dist', emptyOutDir: true },
});

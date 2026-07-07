import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'react/index': 'src/react/index.ts',
    'core/index': 'src/core/index.ts',
    'streaming/index': 'src/streaming/index.ts',
    'mdx/index': 'src/mdx/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: true,
  // The MDX transform peers are OPTIONAL and dynamically imported — never bundled.
  external: ['react', 'react-dom', 'esbuild-wasm', '@swc/wasm-web'],
});

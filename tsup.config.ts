import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'react/index': 'src/react/index.ts',
    'core/index': 'src/core/index.ts',
    'streaming/index': 'src/streaming/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: true,
  external: ['react', 'react-dom'],
});

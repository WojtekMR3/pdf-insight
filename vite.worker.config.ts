import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist-worker',
    lib: { entry: 'server/worker.ts', formats: ['es'], fileName: 'worker' },
    minify: true,
  },
});

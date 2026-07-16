import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Loaded via file:// inside the shell window — assets must be relative.
  base: './',
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
  },
});

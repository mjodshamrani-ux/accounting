import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss()] } },
  server: { host: '127.0.0.1', watch: { usePolling: true } },
  worker: {
    format: 'es',
    rolldownOptions: { output: { codeSplitting: false } },
  },
  build: { target: 'es2022', sourcemap: false },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    strictPort: true,
    fs: {
      deny: ['.env', '.env.*', '.dev.vars', '.dev.vars.*', '*.{crt,pem}', '**/.git/**', '**/.wrangler/**'],
    },
  },
});

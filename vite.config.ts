import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { unplugin as stylex } from '@stylexjs/unplugin';

export default defineConfig({
  optimizeDeps: {
    exclude: ['@lenso/ui', '@lenso/tokens', '@lenso/glass'],
    include: [
      'use-sync-external-store/shim',
      'use-sync-external-store/shim/with-selector',
    ],
  },
  plugins: [
    stylex.vite({
      dev: false,
      runtimeInjection: false,
      useCSSLayers: false,
      lightningcssOptions: { exclude: 4 },
      unstable_moduleResolution: {
        type: 'commonJS',
        rootDir: import.meta.dirname,
      },
    }),
    react(),
  ],
  server: {
    host: '0.0.0.0',
    port: 5179,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
    },
  },
});

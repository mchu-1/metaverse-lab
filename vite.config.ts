import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  base: '/metaverse-lab/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  // Define process.env for browser compatibility
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': JSON.stringify({}),
  },
  build: {
    // Build the transition as a standalone bundle that can be loaded into index.html
    lib: {
      entry: resolve(__dirname, 'src/fx/index.tsx'),
      name: 'WorldTransition',
      fileName: 'fx',
      formats: ['es'],
    },
    rollupOptions: {
      // Externalize deps that shouldn't be bundled
      external: [],
      output: {
        // Provide global variables to use in the UMD build for externalized deps
        globals: {},
      },
    },
    outDir: 'dist',
  },
  // Dev server configuration
  server: {
    port: 3000,
    open: false,
  },
});

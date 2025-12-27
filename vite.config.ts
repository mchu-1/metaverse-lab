import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib';
  
  return {
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
      // Conditional Lib Configuration
      ...(isLib ? {
        lib: {
          entry: resolve(__dirname, 'src/fx/index.tsx'),
          name: 'WorldTransition',
          fileName: 'fx',
          formats: ['es'],
        }
      } : {
        // App Build Configuration
        outDir: 'dist',
        rollupOptions: {
           // Ensure index.html is the entry point (default, but good to be explicit if needed)
        }
      }),
      // Shared build options
      outDir: 'dist',
    },
    // Dev server configuration
    server: {
      port: 3000,
      open: false,
    },
  };
});

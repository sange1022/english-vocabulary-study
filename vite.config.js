import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/english-vocabulary-study/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('conversationSeed')) return 'spoken-vocabulary';
          if (id.includes('toeflBookSeed')) return 'toefl-book-vocabulary';
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
});

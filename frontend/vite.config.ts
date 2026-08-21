import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react') || id.includes('@remix-run/router')) return 'vendor-react';
          if (id.includes('@dnd-kit')) return 'vendor-dnd';
          if (id.includes('date-fns')) return 'vendor-date';
          if (id.includes('zustand')) return 'vendor-state';
          return undefined;
        },
      },
    },
  },
});

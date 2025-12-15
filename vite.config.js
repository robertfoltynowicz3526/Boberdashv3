import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@fullcalendar/core/index.css', replacement: path.resolve(__dirname, 'src/fullcalendar-shims/core.css') },
      { find: '@fullcalendar/daygrid/index.css', replacement: path.resolve(__dirname, 'src/fullcalendar-shims/daygrid.css') },
      { find: /^@fullcalendar\/core$/, replacement: path.resolve(__dirname, 'src/fullcalendar-shims/core.js') },
      { find: /^@fullcalendar\/daygrid$/, replacement: path.resolve(__dirname, 'src/fullcalendar-shims/daygrid.js') },
      { find: /^@fullcalendar\/interaction$/, replacement: path.resolve(__dirname, 'src/fullcalendar-shims/interaction.js') },
    ],
  },
  build: {
    sourcemap: true,
  },
});
import { defineConfig } from '@neon/config/v1';

export default defineConfig({
  functions: {
    api: {
      name: 'Sistema de Mantenimiento Industrial API',
      source: './backend/functions/api.ts',
    },
  },
});

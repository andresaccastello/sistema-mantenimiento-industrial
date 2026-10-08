import { serve } from '@hono/node-server';
import app from './functions/api.ts';

const port = 3000;
console.log(`🚀 Servidor backend Hono corriendo en http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port
});

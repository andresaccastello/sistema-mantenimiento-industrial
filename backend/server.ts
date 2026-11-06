import { serve } from '@hono/node-server';
import app from './functions/api.ts';
import { procesarEnvios } from './functions/avisos/procesarEnvios.ts';

const port = 3000;
console.log(`🚀 Servidor backend Hono corriendo en http://localhost:${port}`);

if (process.env.EMAIL_TRANSPORTE) {
  setInterval(() => {
    procesarEnvios().catch((err) => console.error('Error al procesar envíos de avisos:', err));
  }, 60000);
}

serve({
  fetch: app.fetch,
  port
});

import { serve } from '@hono/node-server';
import app from './functions/api.ts';
import { procesarEnvios } from './functions/avisos/procesarEnvios.ts';
import { procesarVencimientos } from './functions/preventivos/vencimientos.ts';

const port = 3000;
console.log(`🚀 Servidor backend Hono corriendo en http://localhost:${port}`);

if (process.env.EMAIL_TRANSPORTE) {
  setInterval(async () => {
    // PV5, 4: primero los vencimientos, igual que el programado; si fallan, los envíos igual
    try {
      await procesarVencimientos();
    } catch (err) {
      console.error('Error al procesar los vencimientos:', err);
    }
    procesarEnvios().catch((err) => console.error('Error al procesar envíos de avisos:', err));
  }, 60000);
}

serve({
  fetch: app.fetch,
  port
});

import { serve } from '@hono/node-server';
import app from './functions/api.ts';
import { procesarEnvios } from './functions/avisos/procesarEnvios.ts';
import { procesarVencimientos } from './functions/preventivos/vencimientos.ts';

const port = 3000;

/** Lo programado: solo arranca cuando el servidor ya escucha (MQ1, 5). */
function arrancarProgramado() {
  if (!process.env.EMAIL_TRANSPORTE) return;
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

const server = serve(
  {
    fetch: app.fetch,
    port,
  },
  () => {
    console.log(`🚀 Servidor backend Hono corriendo en http://localhost:${port}`);
    arrancarProgramado();
  }
);

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`El puerto ${port} ya está en uso: cerrá el otro servidor`);
    process.exit(1);
  }
  throw err;
});

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { pool } from './db.ts';
import authApp from './auth.ts';
import sectoresApp from './sectores.ts';
import maquinasApp from './maquinas.ts';

import { JWT_SECRET } from './config.ts';

const app = new Hono();

const allowedOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
app.use('*', cors({ origin: allowedOrigin }));


// Montar endpoints
app.route('/api/auth', authApp);
app.route('/api/sectores', sectoresApp);
app.route('/api/maquinas', maquinasApp);

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'sistema-mantenimiento-industrial-api',
  });
});

app.get('/health/db', async (c) => {
  try {
    await pool.query('SELECT 1');
    return c.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    return c.json({ status: 'error', database: 'disconnected' }, 500);
  }
});

export default app;

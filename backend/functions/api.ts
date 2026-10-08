import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { pool } from './db.ts';
import authApp from './auth.ts';
import sectoresApp from './sectores.ts';
import maquinasApp from './maquinas.ts';

const app = new Hono();

app.use('*', cors());

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
  const { rows } = await pool.query(
    'SELECT NOW() AS database_time, current_database() AS database_name'
  );

  return c.json({
    status: 'ok',
    database: 'connected',
    ...rows[0],
  });
});

export default app;

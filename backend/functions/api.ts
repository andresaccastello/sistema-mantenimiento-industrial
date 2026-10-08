import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { pool } from './db.ts';
import authApp from './auth.ts';

const app = new Hono();

app.use('*', cors());

// Montar endpoints de autenticación
app.route('/api/auth', authApp);

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

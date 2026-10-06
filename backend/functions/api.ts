import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Pool } from 'pg';

const app = new Hono();

app.use('*', cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

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

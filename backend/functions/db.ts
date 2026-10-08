import pg from 'pg';
const { Pool } = pg;

// Exportamos un pool singleton
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: true // Habilitamos SSL sin omitir validación de certificados
});

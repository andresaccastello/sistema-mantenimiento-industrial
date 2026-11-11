import pg from 'pg';
const { Pool } = pg;

// Exportamos un pool singleton
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: true, // Habilitamos SSL sin omitir validación de certificados
  keepAlive: true,
});

/** Una conexión cortada: se avisa con el código, nunca con la cadena de conexión ni el error entero. */
function avisar(err: Error & { code?: string }): void {
  console.error(`[base] Se cortó una conexión (${err.code ?? err.message}); se descarta.`);
}

// Las conexiones inactivas dentro del pool
pool.on('error', avisar);
// Las tomadas con pool.connect(): queda puesto en cada conexión nueva, durante toda su vida
pool.on('connect', (cliente) => cliente.on('error', avisar));

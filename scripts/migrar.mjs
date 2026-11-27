// PUB1, 3: aplica las migraciones de database/migrations/ a la base de DATABASE_URL.
//
//   node --env-file=<archivo> scripts/migrar.mjs --desde 005 [--hasta 026] [--si]
//
// Muestra solo el nombre de la base, el usuario y el id del endpoint (ep-…), nunca la cadena de
// conexión ni el resto del host. Pide
// escribir MIGRAR antes de aplicar, salvo con --si. Cada archivo trae su BEGIN y su COMMIT, y al
// primer error frena. No toca datos que no estén en las migraciones ni borra nada.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const carpeta = path.join(raiz, 'database', 'migrations');
const USO = 'Uso: node --env-file=<archivo> scripts/migrar.mjs --desde 005 [--hasta 026] [--si]';

function salir(mensaje) {
  console.error(mensaje);
  process.exit(1);
}

/** Saca de un mensaje la cadena de conexión y sus partes: host, usuario y contraseña. */
function sinSecretos(texto) {
  let t = String(texto);
  const url = process.env.DATABASE_URL || '';
  if (url) t = t.split(url).join('[conexión]');
  try {
    const u = new URL(url);
    for (const parte of [u.hostname, u.password, u.username].filter((p) => p && p.length >= 3)) {
      t = t.split(parte).join('[oculto]');
      t = t.split(decodeURIComponent(parte)).join('[oculto]');
    }
  } catch {
    // sin una URL válida no hay partes que sacar
  }
  return t.replace(/postgres(?:ql)?:\/\/[^\s'"]+/g, '[conexión]');
}

/**
 * El id del endpoint de Neon (ep-…): la primera parte del host, sin "-pooler". El resto del host
 * no se muestra. Es lo que se compara en la consola de Neon para saber a qué rama se conectó.
 */
function endpointDe(url) {
  try {
    const primera = new URL(url).hostname.split('.')[0];
    return /^ep-[a-z0-9-]+$/.test(primera) ? primera.replace(/-pooler$/, '') : null;
  } catch {
    return null;
  }
}

function leerArgumentos(argv) {
  const opciones = { desde: null, hasta: null, si: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--si') opciones.si = true;
    else if (a === '--desde' || a === '--hasta') {
      const valor = argv[++i];
      if (!valor || !/^\d{3}$/.test(valor)) salir(`${a} lleva un número de tres cifras, como 005.\n${USO}`);
      opciones[a.slice(2)] = Number(valor);
    } else salir(`No conozco el argumento ${a}.\n${USO}`);
  }
  if (opciones.desde === null) salir(`Falta --desde.\n${USO}`);
  if (opciones.hasta !== null && opciones.hasta < opciones.desde) salir('--hasta no puede ser menor que --desde.');
  return opciones;
}

const opciones = leerArgumentos(process.argv.slice(2));

// 1. Los archivos del rango, en orden
const archivos = fs
  .readdirSync(carpeta)
  .filter((f) => /^\d{3}_.+\.sql$/.test(f))
  .filter((f) => {
    const n = Number(f.slice(0, 3));
    return n >= opciones.desde && (opciones.hasta === null || n <= opciones.hasta);
  })
  .sort();
if (archivos.length === 0) salir('No hay migraciones en ese rango.');

console.log(`Migraciones a aplicar (${archivos.length}):`);
for (const f of archivos) console.log(`  ${f}`);

if (!process.env.DATABASE_URL) salir('\nFalta DATABASE_URL: pasá el archivo con --env-file.');

// 2. La conexión: solo el nombre de la base y el usuario
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: true });
try {
  await client.connect();
} catch (err) {
  salir(`\nNo se pudo conectar: ${sinSecretos(err.message)}`);
}

let codigo = 0;
try {
  const { rows } = await client.query('SELECT current_database() AS base, current_user AS usuario');
  console.log(`\nBase: ${rows[0].base}`);
  console.log(`Usuario: ${rows[0].usuario}`);
  console.log(`Endpoint: ${endpointDe(process.env.DATABASE_URL) ?? 'no se reconoce (el host no es de Neon)'}`);

  // 3. La confirmación
  if (!opciones.si) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const respuesta = await rl.question('\nEscribí MIGRAR para aplicarlas: ');
    rl.close();
    if (respuesta.trim() !== 'MIGRAR') {
      console.log('No se aplicó nada.');
      process.exitCode = 1;
      throw null;
    }
  }

  // 4. Cada archivo, con su propio BEGIN y COMMIT; al primer error, frena
  console.log('');
  for (const f of archivos) {
    const sql = fs.readFileSync(path.join(carpeta, f), 'utf8');
    try {
      await client.query(sql);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`✖ ${f}`);
      console.error(`  ${sinSecretos(err.message)}`);
      console.error('Se frenó acá: los archivos siguientes no se aplicaron.');
      codigo = 1;
      throw null;
    }
    console.log(`✔ ${f}`);
  }

  // 5. Cómo quedó
  const usuarios = await client.query('SELECT count(*)::int AS n FROM usuarios');
  const admin = await client.query(`SELECT EXISTS (SELECT 1 FROM usuarios WHERE legajo = 'ADMIN001') AS existe`);
  const columna = await client.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'usuarios' AND column_name = 'es_sistema') AS existe`
  );
  const sistema = columna.rows[0].existe
    ? (await client.query('SELECT EXISTS (SELECT 1 FROM usuarios WHERE es_sistema) AS existe')).rows[0].existe
    : null;
  console.log(`\nUsuarios: ${usuarios.rows[0].n}`);
  console.log(`ADMIN001: ${admin.rows[0].existe ? 'existe' : 'NO existe'}`);
  console.log(`Usuario del sistema: ${sistema === null ? 'la columna es_sistema todavía no existe' : sistema ? 'existe' : 'NO existe'}`);
} catch (err) {
  if (err !== null) {
    console.error(`\nError: ${sinSecretos(err.message ?? err)}`);
    codigo = 1;
  }
} finally {
  await client.end().catch(() => {});
}
process.exit(codigo || process.exitCode || 0);

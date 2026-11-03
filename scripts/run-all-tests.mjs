import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const logDir = path.join(rootDir, 'docs', 'evidencia');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Cargar .env para conectar a la misma base que las pruebas
if (!process.env.DATABASE_URL && fs.existsSync(path.join(rootDir, '.env'))) {
  if (process.loadEnvFile) {
    process.loadEnvFile(path.join(rootDir, '.env'));
  } else {
    const envContent = fs.readFileSync(path.join(rootDir, '.env'), 'utf8');
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          process.env[key] = val.replace(/^["']|["']$/g, '');
        }
      }
    }
  }
}

function sanitizarMensajeError(err) {
  let msg = err && err.message ? err.message : String(err);
  if (process.env.DATABASE_URL) {
    msg = msg.split(process.env.DATABASE_URL).join('[REDACTED]');
  }
  msg = msg.replace(/postgres(?:ql)?:\/\/[^\s'"]+/g, '[REDACTED]');
  return msg;
}

const TABLAS_CONTROL = [
  'usuarios',
  'sectores',
  'maquinas',
  'intervenciones',
  'usuario_permiso',
  'notificaciones',
  'auditoria_permisos',
  'repuestos',
  'plantas',
  'criticidades',
  'tipos_equipo',
];

async function contarFilas() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: true,
  });
  await client.connect();
  try {
    const resultado = {};
    for (const tabla of TABLAS_CONTROL) {
      const resExiste = await client.query(
        'SELECT to_regclass($1) IS NOT NULL AS existe',
        [`public.${tabla}`]
      );
      if (resExiste.rows[0]?.existe) {
        const resCount = await client.query(`SELECT COUNT(*)::integer AS total FROM ${tabla}`);
        resultado[tabla] = Number(resCount.rows[0].total);
      } else {
        resultado[tabla] = null;
      }
    }
    return resultado;
  } finally {
    await client.end();
  }
}

function verificarTablasExisten(recuento) {
  for (const tabla of TABLAS_CONTROL) {
    if (recuento[tabla] === null || recuento[tabla] === undefined) {
      throw new Error(`relation "${tabla}" does not exist`);
    }
  }
}

function calcularDiferencias(recInicial, recPostMig, recFinal) {
  const diffs = {};
  for (const tabla of TABLAS_CONTROL) {
    const base = recInicial[tabla] !== null ? recInicial[tabla] : recPostMig[tabla];
    diffs[tabla] = recFinal[tabla] - base;
  }
  return diffs;
}

function formatearLineaDatos(diffs) {
  const partes = TABLAS_CONTROL.map((tabla) => `${tabla} ${diffs[tabla]}`).join(', ');
  return `[test:todo] Datos que quedaron: ${partes}\n`;
}

// Argumento de etapa: npm run test:todo -- etapa-8.1 -> process.argv[2] = 'etapa-8.1'
const etapaArg = process.argv[2]?.trim();
const logFileName = etapaArg ? `${etapaArg}-pruebas.log` : 'ultima-corrida.log';
const logFile = path.join(logDir, logFileName);
const logStream = fs.createWriteStream(logFile, { flags: 'w' });

// Descubrimiento automático de suites en backend/tests/*.test.ts
// Regla: Las suites de migración (migration_*.test.ts) se ejecutan primero en orden numérico/alfabético,
// seguidas por el resto de las suites de negocio ordenadas alfabéticamente.
const testsDir = path.join(rootDir, 'backend', 'tests');
const allTestFiles = fs
  .readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.ts'));

const migrationTestFiles = allTestFiles
  .filter((f) => f.startsWith('migration_'))
  .sort()
  .map((f) => path.join('backend', 'tests', f).replace(/\\/g, '/'));

const standardTestFiles = allTestFiles
  .filter((f) => !f.startsWith('migration_'))
  .sort()
  .map((f) => path.join('backend', 'tests', f).replace(/\\/g, '/'));

const testFiles = [...migrationTestFiles, ...standardTestFiles];

const headerMessage = `[test:todo] Suites descubiertas (${testFiles.length}) en orden de ejecución:\n` +
  testFiles.map((f, i) => `  ${i + 1}. ${f}`).join('\n') +
  `\n\n[test:todo] Iniciando corrida completa en serie (--test-concurrency=1)...\n` +
  `[test:todo] Salida en tiempo real y registro en: ${logFile}\n\n`;

process.stdout.write(headerMessage);
logStream.write(headerMessage);

function runGroup(groupFiles, groupName) {
  return new Promise((resolve, reject) => {
    if (groupFiles.length === 0) {
      return resolve({ code: 0, tests: 0, pass: 0, fail: 0 });
    }
    const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const args = ['tsx', '--env-file=.env', '--test', '--test-concurrency=1', '--test-reporter=spec', ...groupFiles];

    const child = spawn(cmd, args, {
      cwd: rootDir,
      shell: process.platform === 'win32',
    });

    let groupOutput = '';

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      logStream.write(chunk);
      groupOutput += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      logStream.write(chunk);
      groupOutput += chunk.toString();
    });

    child.on('close', (code) => {
      const testsMatches = [...groupOutput.matchAll(/ℹ\s+tests\s+(\d+)/g)];
      const passMatches = [...groupOutput.matchAll(/ℹ\s+pass\s+(\d+)/g)];
      const failMatches = [...groupOutput.matchAll(/ℹ\s+fail\s+(\d+)/g)];

      const tests = testsMatches.length > 0 ? parseInt(testsMatches[testsMatches.length - 1][1], 10) : 0;
      const pass = passMatches.length > 0 ? parseInt(passMatches[passMatches.length - 1][1], 10) : 0;
      const fail = failMatches.length > 0 ? parseInt(failMatches[failMatches.length - 1][1], 10) : 0;

      resolve({
        code: code ?? 0,
        tests,
        pass,
        fail,
      });
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  let recInicial = null;
  try {
    recInicial = await contarFilas();
  } catch (err) {
    const errLine = `[test:todo] No se pudo controlar los datos que quedaron: ${sanitizarMensajeError(err)}\n`;
    process.stdout.write(errLine);
    logStream.write(errLine);
    logStream.end(() => {
      process.exit(1);
    });
    return;
  }

  // 1. Ejecutar grupo de migraciones
  const resMig = await runGroup(migrationTestFiles, 'migraciones');
  if (resMig.code !== 0) {
    const totalLine = `\n[test:todo] Total: ${resMig.tests} pruebas, ${resMig.pass} correctas, ${resMig.fail} fallidas (migraciones: ${resMig.tests}, negocio: 0)\n`;
    process.stdout.write(totalLine);
    logStream.write(totalLine);

    try {
      const recFinalMig = await contarFilas();
      verificarTablasExisten(recFinalMig);
      const diffs = calcularDiferencias(recInicial, recFinalMig, recFinalMig);
      const datosLinea = formatearLineaDatos(diffs);
      process.stdout.write(datosLinea);
      logStream.write(datosLinea);
    } catch (err) {
      const errLine = `[test:todo] No se pudo controlar los datos que quedaron: ${sanitizarMensajeError(err)}\n`;
      process.stdout.write(errLine);
      logStream.write(errLine);
    }

    logStream.end(() => {
      console.log(`[test:todo] Finalizado con fallos en migraciones (código: ${resMig.code})`);
      process.exit(resMig.code);
    });
    return;
  }

  let recPostMig = null;
  try {
    recPostMig = await contarFilas();
    verificarTablasExisten(recPostMig);
  } catch (err) {
    const errLine = `[test:todo] No se pudo controlar los datos que quedaron: ${sanitizarMensajeError(err)}\n`;
    process.stdout.write(errLine);
    logStream.write(errLine);
    logStream.end(() => {
      process.exit(1);
    });
    return;
  }

  // 2. Ejecutar grupo de negocio
  const resStd = await runGroup(standardTestFiles, 'negocio');

  const totalTests = resMig.tests + resStd.tests;
  const totalPass = resMig.pass + resStd.pass;
  const totalFail = resMig.fail + resStd.fail;

  const totalLine = `\n[test:todo] Total: ${totalTests} pruebas, ${totalPass} correctas, ${totalFail} fallidas (migraciones: ${resMig.tests}, negocio: ${resStd.tests})\n`;
  process.stdout.write(totalLine);
  logStream.write(totalLine);

  let recFinal = null;
  try {
    recFinal = await contarFilas();
    verificarTablasExisten(recFinal);
  } catch (err) {
    const errLine = `[test:todo] No se pudo controlar los datos que quedaron: ${sanitizarMensajeError(err)}\n`;
    process.stdout.write(errLine);
    logStream.write(errLine);
    logStream.end(() => {
      process.exit(1);
    });
    return;
  }

  const diffs = calcularDiferencias(recInicial, recPostMig, recFinal);
  const datosLinea = formatearLineaDatos(diffs);
  process.stdout.write(datosLinea);
  logStream.write(datosLinea);

  const huboDatosQueQuedaron = TABLAS_CONTROL.some((tabla) => diffs[tabla] !== 0);

  const exitCode = resStd.code !== 0 ? resStd.code : (huboDatosQueQuedaron ? 1 : 0);

  logStream.end(() => {
    console.log(`[test:todo] Finalizado con código de salida: ${exitCode}`);
    process.exit(exitCode);
  });
}

main().catch((err) => {
  console.error('[test:todo] Error fatal:', err);
  process.exit(1);
});

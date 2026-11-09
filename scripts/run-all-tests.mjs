import { spawn, execSync } from 'node:child_process';
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
  'proveedores',
  'movimientos_stock',
  'intervencion_repuestos',
  'intervencion_costos',
  'pedidos_repuesto',
  'plantas',
  'criticidades',
  'tipos_equipo',
  'planes_mantenimiento',
  'plan_tareas',
  'intervencion_tareas',
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
const fileFilter = process.env.TEST_FILES_FILTER;
const allTestFiles = fs
  .readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.ts'))
  .filter((f) => !fileFilter || f.includes(fileFilter));

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

function runFile(testFile) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'npx.cmd' : 'npx';
    const args = [
      'tsx',
      '--env-file=.env',
      '--test',
      '--test-reporter=spec',
      '--test-timeout=1800000',
      '--test-force-exit',
      testFile,
    ];

    const child = spawn(cmd, args, {
      cwd: rootDir,
      shell: isWin,
      detached: !isWin,
      env: {
        ...process.env,
        EMAIL_TRANSPORTE: 'simulado',
      },
    });

    let output = '';
    const TIMEOUT_INACTIVIDAD_MS = Number(process.env.TEST_TODO_WATCHDOG_MS) || (20 * 60 * 1000);
    const nMinutos = TIMEOUT_INACTIVIDAD_MS % 60000 === 0
      ? String(TIMEOUT_INACTIVIDAD_MS / 60000)
      : String(Number((TIMEOUT_INACTIVIDAD_MS / 60000).toFixed(2)));

    let timer = null;
    let cortado = false;

    function matarProceso() {
      if (!child || !child.pid) return;
      if (isWin) {
        try {
          execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
        } catch (_e) {}
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (_e) {
          try {
            child.kill('SIGKILL');
          } catch (_e2) {}
        }
      }
    }

    function reiniciarTimer() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        cortado = true;
        const msg = `\n[test:todo] CORTADO: ${nMinutos} minutos sin salida en ${testFile}\n`;
        process.stdout.write(msg);
        logStream.write(msg);
        matarProceso();
      }, TIMEOUT_INACTIVIDAD_MS);
    }

    reiniciarTimer();

    child.stdout.on('data', (chunk) => {
      reiniciarTimer();
      process.stdout.write(chunk);
      logStream.write(chunk);
      output += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      reiniciarTimer();
      process.stderr.write(chunk);
      logStream.write(chunk);
      output += chunk.toString();
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);

      const testsMatches = [...output.matchAll(/ℹ\s+tests\s+(\d+)/g)];
      const passMatches = [...output.matchAll(/ℹ\s+pass\s+(\d+)/g)];
      const failMatches = [...output.matchAll(/ℹ\s+fail\s+(\d+)/g)];
      const cancelledMatches = [...output.matchAll(/ℹ\s+cancelled\s+(\d+)/g)];

      let tests = testsMatches.length > 0 ? parseInt(testsMatches[testsMatches.length - 1][1], 10) : 0;
      let pass = passMatches.length > 0 ? parseInt(passMatches[passMatches.length - 1][1], 10) : 0;
      let fail = failMatches.length > 0 ? parseInt(failMatches[failMatches.length - 1][1], 10) : 0;
      let cancelled = cancelledMatches.length > 0 ? parseInt(cancelledMatches[cancelledMatches.length - 1][1], 10) : 0;

      if (cortado) {
        fail = fail > 0 ? fail : 1;
        if (tests === 0) tests = 1;
      }

      if (code !== 0 && fail === 0 && cancelled === 0 && !cortado) {
        fail = 1;
        if (tests === 0) tests = 1;
      }

      const fallidasEfectivas = fail + cancelled;

      resolve({
        file: testFile,
        code: cortado || code !== 0 || fallidasEfectivas > 0 ? 1 : 0,
        tests,
        pass,
        fail,
        cancelled,
        fallidasEfectivas,
        cortado,
      });
    });

    child.on('error', (_err) => {
      if (timer) clearTimeout(timer);
      resolve({
        file: testFile,
        code: 1,
        tests: 1,
        pass: 0,
        fail: 1,
        cancelled: 0,
        fallidasEfectivas: 1,
        cortado: false,
      });
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

  const problemas = [];
  let migTests = 0;
  let migPass = 0;
  let migFail = 0;

  // 1. Ejecutar suites de migración (un proceso por archivo)
  for (const file of migrationTestFiles) {
    const res = await runFile(file);
    migTests += res.tests;
    migPass += res.pass;
    migFail += res.fallidasEfectivas;
    if (res.fallidasEfectivas > 0 || res.cortado || res.code !== 0) {
      problemas.push(res);
    }
  }

  let recPostMig = null;
  try {
    recPostMig = await contarFilas();
    verificarTablasExisten(recPostMig);
  } catch (err) {
    const errLine = `[test:todo] No se pudo controlar los datos que quedaron: ${sanitizarMensajeError(err)}\n`;
    process.stdout.write(errLine);
    logStream.write(errLine);
  }

  let stdTests = 0;
  let stdPass = 0;
  let stdFail = 0;

  // 2. Ejecutar suites estándar de negocio (un proceso por archivo)
  for (const file of standardTestFiles) {
    const res = await runFile(file);
    stdTests += res.tests;
    stdPass += res.pass;
    stdFail += res.fallidasEfectivas;
    if (res.fallidasEfectivas > 0 || res.cortado || res.code !== 0) {
      problemas.push(res);
    }
  }

  const totalTests = migTests + stdTests;
  const totalPass = migPass + stdPass;
  const totalFail = migFail + stdFail;

  const totalLine = `\n[test:todo] Total: ${totalTests} pruebas, ${totalPass} correctas, ${totalFail} fallidas (migraciones: ${migTests}, negocio: ${stdTests})\n`;
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
  }

  let huboDatosQueQuedaron = false;
  if (recInicial && recPostMig && recFinal) {
    const diffs = calcularDiferencias(recInicial, recPostMig, recFinal);
    const datosLinea = formatearLineaDatos(diffs);
    process.stdout.write(datosLinea);
    logStream.write(datosLinea);
    huboDatosQueQuedaron = TABLAS_CONTROL.some((tabla) => diffs[tabla] !== 0);
  }

  // Si hubo problemas (fallas o cortes), una línea por archivo con problema
  if (problemas.length > 0) {
    for (const p of problemas) {
      const probLine = `[test:todo] Con problemas: ${p.file} (fallidas: ${p.fail}, canceladas: ${p.cancelled}, cortado: ${p.cortado ? 'sí' : 'no'})\n`;
      process.stdout.write(probLine);
      logStream.write(probLine);
    }
  }

  const exitCode = problemas.length > 0 || huboDatosQueQuedaron ? 1 : 0;

  logStream.end(() => {
    console.log(`[test:todo] Finalizado con código de salida: ${exitCode}`);
    process.exit(exitCode);
  });
}

main().catch((err) => {
  console.error('[test:todo] Error fatal:', err);
  process.exit(1);
});

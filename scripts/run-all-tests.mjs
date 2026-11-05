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

function construirMapaTitulos(archivos) {
  const mapa = new Map();
  for (const archivo of archivos) {
    try {
      const contenido = fs.readFileSync(path.join(rootDir, archivo), 'utf-8');
      const match = contenido.match(/(?:test|describe)\s*\(\s*['"]([^'"]+)['"]/);
      if (match) {
        mapa.set(match[1].trim(), archivo);
      }
    } catch (_e) {}
  }
  return mapa;
}

function runGroup(groupFiles, groupName) {
  return new Promise((resolve, reject) => {
    if (groupFiles.length === 0) {
      return resolve({ code: 0, tests: 0, pass: 0, fail: 0 });
    }
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'npx.cmd' : 'npx';
    const args = [
      'tsx',
      '--env-file=.env',
      '--test',
      '--test-concurrency=1',
      '--test-reporter=spec',
      '--test-timeout=1800000',
      '--test-force-exit',
      ...groupFiles,
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

    let groupOutput = '';
    let ultimoArchivo = groupFiles[0] || '';
    const mapaTitulos = construirMapaTitulos(groupFiles);

    const TIMEOUT_INACTIVIDAD_MS = Number(process.env.TEST_TODO_WATCHDOG_MS) || (20 * 60 * 1000);
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
        const msg = `\n[test:todo] CORTADO: 20 minutos sin salida. Último archivo: ${ultimoArchivo}\n`;
        process.stdout.write(msg);
        logStream.write(msg);
        matarProceso();
      }, TIMEOUT_INACTIVIDAD_MS);
    }

    reiniciarTimer();

    child.stdout.on('data', (chunk) => {
      reiniciarTimer();
      const str = chunk.toString();
      process.stdout.write(chunk);
      logStream.write(chunk);
      groupOutput += str;

      for (const [titulo, archivo] of mapaTitulos) {
        if (str.includes(titulo)) {
          ultimoArchivo = archivo;
          break;
        }
      }
      for (const f of groupFiles) {
        if (str.includes(f) || str.includes(f.replace(/\//g, '\\'))) {
          ultimoArchivo = f;
          break;
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      reiniciarTimer();
      const str = chunk.toString();
      process.stderr.write(chunk);
      logStream.write(chunk);
      groupOutput += str;
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);

      const testsMatches = [...groupOutput.matchAll(/ℹ\s+tests\s+(\d+)/g)];
      const passMatches = [...groupOutput.matchAll(/ℹ\s+pass\s+(\d+)/g)];
      const failMatches = [...groupOutput.matchAll(/ℹ\s+fail\s+(\d+)/g)];

      const tests = testsMatches.length > 0 ? parseInt(testsMatches[testsMatches.length - 1][1], 10) : 0;
      const pass = passMatches.length > 0 ? parseInt(passMatches[passMatches.length - 1][1], 10) : 0;
      let fail = failMatches.length > 0 ? parseInt(failMatches[failMatches.length - 1][1], 10) : 0;

      if (cortado) {
        fail = fail > 0 ? fail : 1;
      }

      resolve({
        code: cortado ? 1 : (code ?? 0),
        tests: cortado && tests === 0 ? 1 : tests,
        pass,
        fail,
        cortado,
      });
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
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

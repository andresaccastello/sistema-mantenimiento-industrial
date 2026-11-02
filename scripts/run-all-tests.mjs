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

async function contarFilas() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: true,
  });
  await client.connect();
  try {
    const res = await client.query(`
      SELECT 
        (SELECT COUNT(*)::integer FROM usuarios) AS usuarios,
        (SELECT COUNT(*)::integer FROM sectores) AS sectores,
        (SELECT COUNT(*)::integer FROM maquinas) AS maquinas,
        (SELECT COUNT(*)::integer FROM intervenciones) AS intervenciones
    `);
    const row = res.rows[0];
    return {
      usuarios: Number(row.usuarios),
      sectores: Number(row.sectores),
      maquinas: Number(row.maquinas),
      intervenciones: Number(row.intervenciones),
    };
  } finally {
    await client.end();
  }
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
    console.error('[test:todo] Error al contar filas iniciales:', err.message);
  }

  // 1. Ejecutar grupo de migraciones
  const resMig = await runGroup(migrationTestFiles, 'migraciones');
  if (resMig.code !== 0) {
    const totalLine = `\n[test:todo] Total: ${resMig.tests} pruebas, ${resMig.pass} correctas, ${resMig.fail} fallidas (migraciones: ${resMig.tests}, negocio: 0)\n`;
    process.stdout.write(totalLine);
    logStream.write(totalLine);

    if (recInicial) {
      try {
        const recFinal = await contarFilas();
        const diffUsuarios = recFinal.usuarios - recInicial.usuarios;
        const diffSectores = recFinal.sectores - recInicial.sectores;
        const diffMaquinas = recFinal.maquinas - recInicial.maquinas;
        const diffIntervenciones = recFinal.intervenciones - recInicial.intervenciones;
        const datosLinea = `[test:todo] Datos que quedaron: usuarios ${diffUsuarios}, sectores ${diffSectores}, maquinas ${diffMaquinas}, intervenciones ${diffIntervenciones}\n`;
        process.stdout.write(datosLinea);
        logStream.write(datosLinea);
      } catch {}
    }

    logStream.end(() => {
      console.log(`[test:todo] Finalizado con fallos en migraciones (código: ${resMig.code})`);
      process.exit(resMig.code);
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
  if (recInicial) {
    try {
      recFinal = await contarFilas();
    } catch (err) {
      console.error('[test:todo] Error al contar filas finales:', err.message);
    }
  }

  let huboDatosQueQuedaron = false;
  if (recInicial && recFinal) {
    const diffUsuarios = recFinal.usuarios - recInicial.usuarios;
    const diffSectores = recFinal.sectores - recInicial.sectores;
    const diffMaquinas = recFinal.maquinas - recInicial.maquinas;
    const diffIntervenciones = recFinal.intervenciones - recInicial.intervenciones;

    const datosLinea = `[test:todo] Datos que quedaron: usuarios ${diffUsuarios}, sectores ${diffSectores}, maquinas ${diffMaquinas}, intervenciones ${diffIntervenciones}\n`;
    process.stdout.write(datosLinea);
    logStream.write(datosLinea);

    if (diffUsuarios !== 0 || diffSectores !== 0 || diffMaquinas !== 0 || diffIntervenciones !== 0) {
      huboDatosQueQuedaron = true;
    }
  }

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

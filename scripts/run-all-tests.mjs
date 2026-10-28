import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const logDir = path.join(rootDir, 'docs', 'evidencia');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
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
  // 1. Ejecutar grupo de migraciones
  const resMig = await runGroup(migrationTestFiles, 'migraciones');
  if (resMig.code !== 0) {
    const totalLine = `\n[test:todo] Total: ${resMig.tests} pruebas, ${resMig.pass} correctas, ${resMig.fail} fallidas (migraciones: ${resMig.tests}, negocio: 0)\n`;
    process.stdout.write(totalLine);
    logStream.write(totalLine);
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

  logStream.end(() => {
    console.log(`[test:todo] Finalizado con código de salida: ${resStd.code}`);
    process.exit(resStd.code);
  });
}

main().catch((err) => {
  console.error('[test:todo] Error fatal:', err);
  process.exit(1);
});

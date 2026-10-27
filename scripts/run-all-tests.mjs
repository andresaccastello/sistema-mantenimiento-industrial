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
      return resolve(0);
    }
    const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const args = ['tsx', '--env-file=.env', '--test', '--test-concurrency=1', ...groupFiles];

    const child = spawn(cmd, args, {
      cwd: rootDir,
      shell: process.platform === 'win32',
    });

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      logStream.write(chunk);
    });

    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      logStream.write(chunk);
    });

    child.on('close', (code) => {
      resolve(code ?? 0);
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  // 1. Ejecutar grupo de migraciones
  const codeMig = await runGroup(migrationTestFiles, 'migraciones');
  if (codeMig !== 0) {
    logStream.end(() => {
      console.log(`\n[test:todo] Finalizado con fallos en migraciones (código: ${codeMig})`);
      process.exit(codeMig);
    });
    return;
  }

  // 2. Ejecutar grupo de negocio
  const codeStd = await runGroup(standardTestFiles, 'negocio');
  logStream.end(() => {
    console.log(`\n[test:todo] Finalizado con código de salida: ${codeStd}`);
    process.exit(codeStd);
  });
}

main().catch((err) => {
  console.error('[test:todo] Error fatal:', err);
  process.exit(1);
});

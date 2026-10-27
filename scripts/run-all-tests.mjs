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

// Argumento de etapa: npm run test:todo -- etapa-8 -> process.argv[2] = 'etapa-8'
const etapaArg = process.argv[2]?.trim();
const logFileName = etapaArg ? `${etapaArg}-pruebas.log` : 'ultima-corrida.log';
const logFile = path.join(logDir, logFileName);
const logStream = fs.createWriteStream(logFile, { flags: 'w' });

// Descubrimiento automático de todas las suites en backend/tests/*.test.ts ordenadas alfabéticamente
const testsDir = path.join(rootDir, 'backend', 'tests');
const testFiles = fs
  .readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.ts'))
  .sort()
  .map((f) => path.join('backend', 'tests', f).replace(/\\/g, '/'));

const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = ['tsx', '--env-file=.env', '--test', '--test-concurrency=1', ...testFiles];

console.log(`[test:todo] Suites descubiertas (${testFiles.length}):\n${testFiles.map((f) => `  - ${f}`).join('\n')}\n`);
console.log(`[test:todo] Iniciando corrida completa en serie (--test-concurrency=1)...`);
console.log(`[test:todo] Salida en tiempo real y registro en: ${logFile}\n`);

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
  logStream.end(() => {
    console.log(`\n[test:todo] Finalizado con código de salida: ${code ?? 0}`);
    process.exit(code ?? 0);
  });
});

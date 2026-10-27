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

const logFile = path.join(logDir, 'etapa-u1-pruebas.log');
const logStream = fs.createWriteStream(logFile, { flags: 'w' });

const testFiles = [
  'backend/tests/migration_003.test.ts',
  'backend/tests/migration_005.test.ts',
  'backend/tests/migration_006.test.ts',
  'backend/tests/migration_007.test.ts',
  'backend/tests/migration_008.test.ts',
  'backend/tests/migration_009.test.ts',
  'backend/tests/migration_010.test.ts',
  'backend/tests/permisos_granulares.test.ts',
  'backend/tests/intervenciones.test.ts',
  'backend/tests/motor_estados.test.ts',
  'backend/tests/motor_cierres.test.ts',
  'backend/tests/reapertura_eliminacion.test.ts',
  'backend/tests/notificaciones.test.ts',
  'backend/tests/usuarios.test.ts',
  'backend/tests/crud.test.ts',
];

const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = ['tsx', '--env-file=.env', '--test', '--test-concurrency=1', ...testFiles];

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

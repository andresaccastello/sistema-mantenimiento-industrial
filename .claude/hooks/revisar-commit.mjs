// PreToolUse: antes de un `git commit`, busca secretos en lo que entra al commit.
// Revisa solo las líneas agregadas de `git diff --cached` (y de `git diff`, si el commit
// lleva -a o --all). Busca:
//   - cadenas de conexión de Postgres (esquema postgres o postgresql seguido de dos barras);
//   - el dominio de Neon;
//   - DATABASE_URL o SMTP_PASSWORD asignadas con un valor, al estilo de un archivo de entorno.
// Si encuentra algo, bloquea (sale con 2) y nombra el archivo, la línea y la regla,
// nunca el valor encontrado.

import { execFileSync } from 'node:child_process';

const entrada = await new Promise((resolver) => {
  let texto = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (parte) => (texto += parte));
  process.stdin.on('end', () => resolver(texto));
});

let datos;
try {
  datos = JSON.parse(entrada || '{}');
} catch {
  process.exit(0);
}

if (datos.tool_name !== 'Bash' && datos.tool_name !== 'PowerShell') process.exit(0);
const comando = String(datos.tool_input?.command ?? '');

// Un `git ... commit` en cualquier parte del comando (también encadenado con && o ;)
const tramosCommit = comando
  .split(/&&|\|\||;|\n/)
  .filter((tramo) => /(^|\s)git(\s+-C\s+\S+|\s+-c\s+\S+)*\s+commit\b/.test(tramo));
if (tramosCommit.length === 0) process.exit(0);

const conTodo = tramosCommit.some((tramo) => /\s(-[a-zA-Z]*a[a-zA-Z]*|--all)\b/.test(tramo));

const reglas = [
  { nombre: 'cadena de conexión de Postgres', patron: /postgres(?:ql)?:\/\//i },
  { nombre: 'dominio de Neon', patron: /neon\.tech/i },
  // Armadas por partes para que este mismo archivo no las dispare al commitearse
  { nombre: 'DATABASE_URL con un valor', patron: asignacion('DATABASE' + '_URL') },
  { nombre: 'SMTP_PASSWORD con un valor', patron: asignacion('SMTP' + '_PASSWORD') },
];

/** NOMBRE=valor, sin espacio antes del igual, con un valor que no esté vacío ni sea un comentario. */
function asignacion(nombre) {
  return new RegExp(`\\b${nombre}` + '=(?!=)\\s*["\']?[^\\s"\'#]');
}

const directorio = datos.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
function diff(argumentos) {
  try {
    return execFileSync('git', ['diff', '-U0', '--no-color', '--no-ext-diff', ...argumentos], {
      cwd: directorio,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'], // Sin las advertencias de git (CRLF) en el mensaje

    });
  } catch {
    return '';
  }
}

const textos = [diff(['--cached'])];
if (conTodo) textos.push(diff([]));

const hallazgos = [];
for (const texto of textos) {
  let archivo = '';
  let linea = 0;
  for (const renglon of texto.split('\n')) {
    if (renglon.startsWith('+++ ')) {
      archivo = renglon.replace(/^\+\+\+ (b\/)?/, '');
      continue;
    }
    const hunk = renglon.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      linea = Number(hunk[1]);
      continue;
    }
    if (renglon.startsWith('+')) {
      for (const regla of reglas) {
        if (regla.patron.test(renglon.slice(1))) hallazgos.push(`${archivo}:${linea} (${regla.nombre})`);
      }
      linea++;
    }
  }
}

if (hallazgos.length > 0) {
  process.stderr.write(
    'Bloqueado por .claude/hooks/revisar-commit.mjs: lo que entra al commit parece tener un secreto.\n' +
      hallazgos.map((h) => `  - ${h}`).join('\n') +
      '\nSacalo del archivo (o del stage) antes de commitear. Los secretos van solo en el .env (CLAUDE.md).\n'
  );
  process.exit(2);
}

process.exit(0);

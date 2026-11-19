// PreToolUse: no se lee ni se toca el .env (CLAUDE.md, "Seguridad").
// Bloquea Read, Edit, Write, MultiEdit, NotebookEdit y Grep sobre .env o .env.<algo>
// (salvo .env.example), y los comandos de Bash o PowerShell que lo nombren.
// `--env-file=.env` sí pasa: ahí lo lee el proceso (tsx, node), no la herramienta.
// Sale con 2 para bloquear: Claude Code le muestra el mensaje de stderr al modelo.

import path from 'node:path';

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
  process.exit(0); // Sin una entrada que entender, no se bloquea nada
}

const herramienta = datos.tool_name ?? '';
const parametros = datos.tool_input ?? {};

/** Un nombre de archivo .env o .env.<algo>, salvo .env.example. */
const esEnv = (nombre) => /^\.env(\..+)?$/i.test(nombre) && nombre.toLowerCase() !== '.env.example';

function bloquear(motivo) {
  process.stderr.write(`Bloqueado por .claude/hooks/proteger-env.mjs: ${motivo} El .env no se lee ni se toca (CLAUDE.md).\n`);
  process.exit(2);
}

if (['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep'].includes(herramienta)) {
  const ruta = parametros.file_path ?? parametros.notebook_path ?? parametros.path ?? '';
  if (ruta && esEnv(path.basename(String(ruta)))) {
    bloquear(`${herramienta} sobre ${path.basename(String(ruta))}.`);
  }
}

if (herramienta === 'Bash' || herramienta === 'PowerShell') {
  // Se saca --env-file=.env y --env-file .env, que no leen el archivo desde la herramienta
  const comando = String(parametros.command ?? '').replace(/--env-file(=|\s+)\S+/gi, ' ');
  // .env como palabra: precedido y seguido por un separador de ruta, comilla, espacio u operador
  const patron = /(^|[\s"'`/\\=<>|;&(,:])(\.env(?:\.[\w.-]+)?)(?=$|[\s"'`|;&)<>,])/gi;
  for (const coincidencia of comando.matchAll(patron)) {
    if (esEnv(coincidencia[2])) {
      bloquear(`el comando nombra ${coincidencia[2]}.`);
    }
  }
}

process.exit(0);

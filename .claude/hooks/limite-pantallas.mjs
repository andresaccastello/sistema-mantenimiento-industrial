// PostToolUse: las pantallas de frontend/src/pantallas/ tienen hasta 500 líneas (CLAUDE.md).
// Después de Edit, MultiEdit o Write sobre una de ellas, si pasa de 500 avisa al modelo
// (sale con 2: el cambio ya está hecho, el mensaje le llega a Claude para que lo corrija).

import fs from 'node:fs';

const LIMITE = 500;

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

const ruta = String(datos.tool_input?.file_path ?? '');
if (!/(^|[\\/])frontend[\\/]src[\\/]pantallas[\\/][^\\/]+\.tsx$/i.test(ruta)) process.exit(0);

let texto;
try {
  texto = fs.readFileSync(ruta, 'utf8');
} catch {
  process.exit(0); // Si ya no existe, no hay nada que contar
}

// Como `wc -l`: cuenta los saltos de línea
const lineas = (texto.match(/\n/g) ?? []).length;
if (lineas > LIMITE) {
  const nombre = ruta.split(/[\\/]/).pop();
  process.stderr.write(
    `Aviso de .claude/hooks/limite-pantallas.mjs: ${nombre} tiene ${lineas} líneas y el límite de una pantalla es ${LIMITE} (CLAUDE.md). ` +
      'Pasá diálogos o partes a componentes/<área>/.\n'
  );
  process.exit(2);
}

process.exit(0);

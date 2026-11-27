import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const args = process.argv.slice(2);
let empresa = null;
let logoPath = null;
let sinLogo = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--empresa' && args[i + 1]) {
    empresa = args[++i];
  } else if (args[i] === '--logo' && args[i + 1]) {
    logoPath = args[++i];
  } else if (args[i] === '--sin-logo') {
    sinLogo = true;
  }
}

if (empresa === null && logoPath === null && !sinLogo) {
  console.log('Uso: npm run marca:cargar -- [--empresa "Nombre S.A."] [--logo ruta/al/logo.png] [--sin-logo]');
  process.exit(0);
}

function detectarTipoImagen(buf) {
  if (buf.length >= 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buf.length >= 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

let logoBuffer = null;
let logoTipo = null;

if (logoPath) {
  const resolvedPath = path.isAbsolute(logoPath) ? logoPath : path.resolve(process.cwd(), logoPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: El archivo de logo no existe en la ruta especificada: ${resolvedPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(resolvedPath);
  if (stat.size > 307200) {
    console.error(`Error: El archivo de logo supera el tamaño máximo permitido de 300 KB (${stat.size} bytes)`);
    process.exit(1);
  }

  logoBuffer = fs.readFileSync(resolvedPath);
  logoTipo = detectarTipoImagen(logoBuffer);

  if (!logoTipo) {
    console.error('Error: Tipo de archivo de imagen no válido. Solo se admiten archivos PNG, JPEG o WebP (detectado por encabezado binario).');
    process.exit(1);
  }
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('Error: Variable DATABASE_URL no encontrada en el entorno o en el archivo .env');
  process.exit(1);
}

const url = new URL(dbUrl);
console.log(`Conectando a base de datos en host: ${url.host}, base: ${url.pathname.replace(/^\//, '')}`);

const client = new pg.Client({
  connectionString: dbUrl,
  ssl: true,
});

async function main() {
  await client.connect();

  try {
    const updates = [];
    const params = [];

    if (empresa !== null) {
      params.push(empresa.trim());
      updates.push(`nombre_empresa = $${params.length}`);
    }

    if (sinLogo) {
      updates.push('logo = NULL');
      updates.push('logo_tipo = NULL');
    } else if (logoBuffer !== null && logoTipo !== null) {
      params.push(logoBuffer);
      updates.push(`logo = $${params.length}`);
      params.push(logoTipo);
      updates.push(`logo_tipo = $${params.length}`);
    }

    updates.push('actualizado_en = NOW()');

    const query = `UPDATE configuracion_sistema SET ${updates.join(', ')} WHERE id = 1`;
    const res = await client.query(query, params);

    if (res.rowCount !== 1) {
      console.error('Error: Falta aplicar la migración 012');
      process.exit(1);
    }

    console.log('Configuración de marca actualizada correctamente.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Error al actualizar marca:', err.message);
  process.exit(1);
});

import { defineConfig } from '@neon/config/v1';

// PUB1, 2: `neon deploy` solo le pasa a la función las variables declaradas acá. Los valores no
// van en el repositorio: se leen de process.env al desplegar (`neon deploy --env <archivo>`).
// DATABASE_URL no va: Neon la inyecta sola, la de la rama donde se despliega.
const VARIABLES_FUNCION = [
  'JWT_SECRET',
  'EMAIL_TRANSPORTE',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USUARIO',
  'SMTP_PASSWORD',
  'SMTP_SEGURO',
  'EMAIL_REMITENTE',
  'APP_URL_PUBLICA',
  'CORS_ORIGIN',
];

// Las que no están definidas no se declaran, así neon.ts se puede leer sin el archivo de secretos
const env: Record<string, string> = {};
for (const nombre of VARIABLES_FUNCION) {
  const valor = process.env[nombre];
  if (valor !== undefined && valor !== '') env[nombre] = valor;
}

export default defineConfig({
  functions: {
    api: {
      name: 'Sistema de Mantenimiento Industrial API',
      source: './backend/functions/api.ts',
      env,
    },
  },
  triggers: {
    'avisos-envios': {
      type: 'schedule',
      function: 'api',
      cron: '* * * * *',
      functionPath: '/api/avisos/procesar',
    },
  },
});

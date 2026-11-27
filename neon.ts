import { defineConfig } from '@neon/config/v1';

// PUB1, 2: `neon deploy` solo le pasa a la función las variables declaradas acá. Los valores no
// van en el repositorio: se leen de process.env al desplegar (`neon deploy --env <archivo>`).
// DATABASE_URL no va: Neon la inyecta sola, la de la rama donde se despliega.

/** Sin estas, el despliegue falla antes de cambiar nada. */
const obligatoria = (valor: string | undefined) => ({ value: valor, required: true as const });
/** Sin estas, el despliegue deja el valor que ya tenía la función (SMTP no hace falta con el correo simulado). */
const opcional = (valor: string | undefined) => ({ value: valor, required: false as const, onUndefined: 'skip' as const });

export default defineConfig({
  functions: {
    api: {
      name: 'Sistema de Mantenimiento Industrial API',
      source: './backend/functions/api.ts',
      env: {
        JWT_SECRET: obligatoria(process.env.JWT_SECRET),
        EMAIL_TRANSPORTE: obligatoria(process.env.EMAIL_TRANSPORTE),
        APP_URL_PUBLICA: obligatoria(process.env.APP_URL_PUBLICA),
        SMTP_HOST: opcional(process.env.SMTP_HOST),
        SMTP_PORT: opcional(process.env.SMTP_PORT),
        SMTP_USUARIO: opcional(process.env.SMTP_USUARIO),
        SMTP_PASSWORD: opcional(process.env.SMTP_PASSWORD),
        SMTP_SEGURO: opcional(process.env.SMTP_SEGURO),
        EMAIL_REMITENTE: opcional(process.env.EMAIL_REMITENTE),
        CORS_ORIGIN: opcional(process.env.CORS_ORIGIN),
      },
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

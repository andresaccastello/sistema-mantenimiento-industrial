import nodemailer from 'nodemailer';

export interface MensajeEmail {
  para: string;
  asunto: string;
  texto: string;
  html: string;
}

export interface TransporteEmail {
  enviar(m: MensajeEmail): Promise<void>;
}

export interface EstadoEmail {
  configurado: boolean;
  transporte: 'smtp' | 'simulado' | null;
  remitente: string | null;
}

// Estado en memoria para transporte simulado
const mensajesEnMemoria: MensajeEmail[] = [];
let fallaSimuladaActiva = false;

export function mensajesSimulados(): MensajeEmail[] {
  return [...mensajesEnMemoria];
}

export function limpiarMensajesSimulados(): void {
  mensajesEnMemoria.length = 0;
}

export function simularFallaEmail(activa: boolean): void {
  fallaSimuladaActiva = activa;
}

/**
 * Sanitiza cualquier mensaje de error eliminando credenciales
 * y recortando a un máximo de 500 caracteres.
 */
export function sanitizarError(error: any): string {
  let texto = '';
  if (error instanceof Error) {
    texto = error.message || String(error);
  } else if (typeof error === 'string') {
    texto = error;
  } else {
    texto = String(error ?? 'Error desconocido');
  }

  const smtpUser = process.env.SMTP_USUARIO;
  if (smtpUser && smtpUser.trim().length > 0) {
    texto = texto.split(smtpUser).join('***');
  }

  const smtpPass = process.env.SMTP_PASSWORD;
  if (smtpPass && smtpPass.trim().length > 0) {
    texto = texto.split(smtpPass).join('***');
  }

  return texto.slice(0, 500);
}

/**
 * Retorna el estado actual del transporte de correo.
 * Nunca expone usuario ni contraseña.
 */
export function estadoEmail(): EstadoEmail {
  const tipo = process.env.EMAIL_TRANSPORTE;

  if (tipo === 'simulado') {
    return {
      configurado: true,
      transporte: 'simulado',
      remitente: process.env.EMAIL_REMITENTE || 'Avisos de Prueba <avisos@sistema.local>',
    };
  }

  if (tipo === 'smtp') {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT;
    const user = process.env.SMTP_USUARIO;
    const pass = process.env.SMTP_PASSWORD;
    const remitente = process.env.EMAIL_REMITENTE;

    const configurado = Boolean(
      host && host.trim().length > 0 &&
      port && port.trim().length > 0 &&
      user && user.trim().length > 0 &&
      pass && pass.trim().length > 0 &&
      remitente && remitente.trim().length > 0
    );

    return {
      configurado,
      transporte: configurado ? 'smtp' : null,
      remitente: configurado ? remitente! : null,
    };
  }

  return {
    configurado: false,
    transporte: null,
    remitente: null,
  };
}

/**
 * Obtiene la instancia activa de TransporteEmail según la configuración.
 */
export function obtenerTransporteEmail(): TransporteEmail | null {
  const estado = estadoEmail();
  if (!estado.configurado) {
    return null;
  }

  if (estado.transporte === 'simulado') {
    return {
      async enviar(m: MensajeEmail): Promise<void> {
        if (fallaSimuladaActiva) {
          const pass = process.env.SMTP_PASSWORD || 'secret-pass';
          throw new Error(`Falla simulada en envío de correo (password: ${pass})`);
        }
        mensajesEnMemoria.push({ ...m });
      },
    };
  }

  if (estado.transporte === 'smtp') {
    const host = process.env.SMTP_HOST!;
    const port = Number(process.env.SMTP_PORT);
    const secure = process.env.SMTP_SEGURO === 'true' || port === 465;
    const user = process.env.SMTP_USUARIO!;
    const pass = process.env.SMTP_PASSWORD!;
    const remitente = process.env.EMAIL_REMITENTE!;

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
    });

    return {
      async enviar(m: MensajeEmail): Promise<void> {
        await transporter.sendMail({
          from: remitente,
          to: m.para,
          subject: m.asunto,
          text: m.texto,
          html: m.html,
        });
      },
    };
  }

  return null;
}


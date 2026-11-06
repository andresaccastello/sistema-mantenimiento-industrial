import { Context } from 'hono';

export class ErrorNegocio extends Error {
  public status: number;
  public codigo: string;
  public mensaje: string;
  public detalles?: Record<string, any>;

  constructor(status: number, codigo: string, mensaje: string, detalles?: Record<string, any>) {
    super(mensaje);
    this.name = 'ErrorNegocio';
    this.status = status;
    this.codigo = codigo;
    this.mensaje = mensaje;
    this.detalles = detalles;
  }
}

export const responderError = (c: Context, error: unknown) => {
  if (error instanceof ErrorNegocio) {
    const body: Record<string, any> = {
      error: error.mensaje,
      codigo: error.codigo,
      ...(error.detalles || {}),
    };
    return c.json(body, error.status as any);
  }

  console.error('Error no controlado en operación de intervenciones:', error);
  return c.json(
    {
      error: 'Error interno del servidor',
      codigo: 'ERROR_INTERNO',
    },
    500
  );
};

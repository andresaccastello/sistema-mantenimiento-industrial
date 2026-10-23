import { Context } from 'hono';

export class ErrorNegocio extends Error {
  public status: number;
  public codigo: string;
  public mensaje: string;

  constructor(status: number, codigo: string, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorNegocio';
    this.status = status;
    this.codigo = codigo;
    this.mensaje = mensaje;
  }
}

export const responderError = (c: Context, error: unknown) => {
  if (error instanceof ErrorNegocio) {
    return c.json(
      {
        error: error.mensaje,
        codigo: error.codigo,
      },
      error.status as any
    );
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

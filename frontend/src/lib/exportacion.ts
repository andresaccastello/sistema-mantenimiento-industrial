/**
 * MQ1, 4.3: exportar el historial de intervenciones con los filtros puestos.
 */
import { ApiError } from './errores';
import { paramsListado, type FiltrosIntervenciones } from './listado';

export const RUTA_EXPORTACION = '/api/intervenciones/exportar';
export const MAXIMO_EXPORTACION = 5000;

/** Los mismos parámetros que el listado, sin la paginación. */
export function paramsExportacion(filtros: FiltrosIntervenciones): Record<string, string | number | boolean> {
  const { limit: _limit, offset: _offset, ...resto } = paramsListado(filtros, 1);
  return resto;
}

/** La URL relativa, con los parámetros en un orden fijo. */
export function urlExportacion(params: Record<string, string | number | boolean | null | undefined>): string {
  const q = new URLSearchParams();
  for (const clave of Object.keys(params).sort()) {
    const valor = params[clave];
    if (valor === undefined || valor === null || valor === '') continue;
    q.set(clave, String(valor));
  }
  const texto = q.toString();
  return texto ? `${RUTA_EXPORTACION}?${texto}` : RUTA_EXPORTACION;
}

function conMiles(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** "Son 7.320 intervenciones; acotá el filtro (máximo 5.000)". */
export function mensajeDemasiadas(total: number, maximo = MAXIMO_EXPORTACION): string {
  return `Son ${conMiles(total)} intervenciones; acotá el filtro (máximo ${conMiles(maximo)})`;
}

/** El mensaje de un error al exportar: el de DEMASIADOS_RESULTADOS con su total; si no, null. */
export function mensajeErrorExportacion(err: unknown): string | null {
  if (err instanceof ApiError && err.codigo === 'DEMASIADOS_RESULTADOS') {
    const datos = (err.datos ?? {}) as { total?: unknown; maximo?: unknown };
    const total = typeof datos.total === 'number' ? datos.total : null;
    const maximo = typeof datos.maximo === 'number' ? datos.maximo : MAXIMO_EXPORTACION;
    return total !== null ? mensajeDemasiadas(total, maximo) : err.message;
  }
  return null;
}

/** El nombre que manda el servidor en Content-Disposition; si no viene, uno con la fecha de hoy. */
export function nombreArchivoExportacion(disposicion: string | null, hoy: Date): string {
  const m = disposicion?.match(/filename="?([^";]+)"?/);
  if (m) return m[1];
  const dia = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  return `intervenciones-${dia}.csv`;
}

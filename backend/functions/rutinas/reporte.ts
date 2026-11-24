import { Context } from 'hono';
import { pool } from '../db.ts';
import { getUserScope } from '../middleware.ts';
import { parseId } from '../validations.ts';
import { ErrorNegocio, responderError } from '../intervenciones/errores.ts';
import { validarIntervaloReporte } from '../intervalos.ts';
import { getUsuarioContext } from '../preventivos/comun.ts';
import { COLUMNAS_RUTINA, FROM_RUTINA, ORDEN_MAQUINA, periodosEsperados, resumir, rutinaDeFila } from './comun.ts';

/** RT1, 2.3: como mucho 92 días. */
const DIAS_MAXIMO = 92;

function idFiltro(c: Context, nombre: string): number | null {
  const raw = c.req.query(nombre);
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  const id = parseId(raw);
  if (!id) throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `El ${nombre} debe ser un entero válido`);
  return id;
}

/**
 * GET /api/reportes/rutinas?desde=&hasta=&planta_id=&sector_id=&maquina_id=
 * El cumplimiento de las tareas de rutina (RT1, 2.3), con el alcance de REPORTES_CONSULTAR.
 */
export async function reporteRutinas(c: Context) {
  try {
    const usuario = getUsuarioContext(c);
    const scope = getUserScope(c, 'REPORTES_CONSULTAR');

    const intervalo = await validarIntervaloReporte(pool, c.req.query('desde'), c.req.query('hasta'));
    const plantaId = idFiltro(c, 'planta_id');
    const sectorId = idFiltro(c, 'sector_id');
    const maquinaId = idFiltro(c, 'maquina_id');

    // Las fechas de la instalación, y el tope de días
    const resF = await pool.query(
      `WITH z AS (
         SELECT COALESCE((SELECT zona_horaria FROM configuracion_sistema WHERE id = 1), 'America/Argentina/Buenos_Aires') AS tz
       )
       SELECT to_char(($1::timestamptz AT TIME ZONE z.tz)::date, 'YYYY-MM-DD') AS desde,
              to_char(($2::timestamptz AT TIME ZONE z.tz)::date, 'YYYY-MM-DD') AS hasta,
              to_char(hoy_instalacion(), 'YYYY-MM-DD') AS hoy,
              ($2::timestamptz - $1::timestamptz) > make_interval(days => $3) AS excede
       FROM z`,
      [intervalo.desde, intervalo.hasta, DIAS_MAXIMO]
    );
    const { desde, hasta, hoy, excede } = resF.rows[0];
    if (excede) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `El intervalo no puede superar los ${DIAS_MAXIMO} días`);
    }

    const vacio = { desde, hasta, hoy, resumen: resumir([]), rutinas: [] };
    if (scope !== 'TODAS') {
      if (usuario.sectores.length === 0) return c.json(vacio);
      if (sectorId !== null && !usuario.sectores.includes(sectorId)) return c.json(vacio);
    }

    const params: unknown[] = [desde, hasta];
    const cond = ['m.activo', 'r.vigente_desde <= $2::date', '(r.baja_en IS NULL OR r.baja_en >= $1::date)'];
    if (scope !== 'TODAS') {
      params.push(usuario.sectores);
      cond.push(`m.sector_id = ANY($${params.length}::bigint[])`);
    }
    if (sectorId !== null) {
      params.push(sectorId);
      cond.push(`m.sector_id = $${params.length}`);
    }
    if (plantaId !== null) {
      params.push(plantaId);
      cond.push(`s.planta_id = $${params.length}`);
    }
    if (maquinaId !== null) {
      params.push(maquinaId);
      cond.push(`m.id = $${params.length}`);
    }

    const res = await pool.query(
      `SELECT ${COLUMNAS_RUTINA}
       ${FROM_RUTINA}
       WHERE ${cond.join(' AND ')}
       ORDER BY ${ORDEN_MAQUINA}, r.frecuencia, r.descripcion, r.id`,
      params
    );
    const periodos = await periodosEsperados(pool, res.rows.map((x) => Number(x.id)), desde, hasta);

    const rutinas = res.rows.map((x) => {
      const propios = periodos.filter((p) => p.rutina_id === Number(x.id));
      return {
        ...rutinaDeFila(x),
        resumen: resumir(propios.map((p) => p.estado)),
        periodos: propios.map((p) => ({
          periodo: p.periodo,
          estado: p.estado,
          usuario: p.registro?.usuario ?? null,
          hecha_en: p.registro?.hecha_en ?? null,
          nota: p.registro?.nota ?? null,
        })),
      };
    });

    return c.json({ desde, hasta, hoy, resumen: resumir(periodos.map((p) => p.estado)), rutinas });
  } catch (error) {
    return responderError(c, error);
  }
}

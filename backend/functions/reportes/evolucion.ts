import { Context } from 'hono';
import { pool } from '../db.ts';
import { getUserScope } from '../middleware.ts';
import { responderError, ErrorNegocio } from '../intervenciones/errores.ts';
import { validarIntervaloReporte } from '../intervalos.ts';
import {
  CostoPorTipo,
  cuentasIntervenciones,
  disponibilidadDe,
  fueraDeAlcance,
  inactividadAcumulada,
  leerSectorYPlanta,
  maquinasDeIndicadores,
  minutosEntre,
  totalesCostos,
} from './cuentas.ts';
import {
  AGRUPACIONES_EVOLUCION,
  AgrupacionEvolucion,
  agrupacionPorOmision,
  armarPeriodos,
} from './periodos.ts';

/** La zona de la instalación, la misma que usa hoy_instalacion(). */
const SQL_ZONA = `COALESCE((SELECT zona_horaria FROM configuracion_sistema WHERE id = 1), 'America/Argentina/Buenos_Aires')`;

interface CostoPeriodo extends CostoPorTipo {
  total: number;
}

interface PeriodoEvolucion {
  inicio: string;
  fin: string;
  fallas: number;
  correctivas_finalizadas: number;
  preventivas_finalizadas: number;
  inactividad_minutos: number;
  disponibilidad: number | null;
  costo: CostoPeriodo | null;
}

const COSTO_CERO: CostoPeriodo = {
  repuestos: 0,
  mano_obra: 0,
  servicio_externo: 0,
  transporte: 0,
  otro: 0,
  ajuste: 0,
  total: 0,
};

function leerAgrupar(c: Context): AgrupacionEvolucion | null {
  const raw = c.req.query('agrupar');
  if (raw === undefined || raw.trim() === '') return null;
  const valor = raw.trim();
  if (!(AGRUPACIONES_EVOLUCION as readonly string[]).includes(valor)) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El parámetro agrupar debe ser: mes o semana');
  }
  return valor as AgrupacionEvolucion;
}

/**
 * GR1, 1: GET /api/reportes/evolucion?desde=&hasta=&planta_id=&sector_id=&agrupar=mes|semana
 * Las cuentas de /indicadores y /costos, partidas en semanas (de lunes a domingo) o meses
 * calendario, según la fecha local de la instalación. Usa las mismas funciones que esos dos
 * reportes (reportes/cuentas.ts); los períodos del medio son [inicio, fin) y el último es
 * [inicio, hasta], así la suma de los períodos es el total de siempre.
 */
export async function reporteEvolucion(c: Context) {
  try {
    const permisos = ((c.get as any)('userPermissionsMap') as Record<string, unknown>) || {};
    const sectores = ((c.get as any)('userSectores') as number[]) || [];
    const scope = getUserScope(c, 'REPORTES_CONSULTAR');
    const veCostos = 'COSTOS_VER' in permisos;

    const { desde, hasta } = await validarIntervaloReporte(pool, c.req.query('desde'), c.req.query('hasta'));
    const { sectorId, plantaId } = leerSectorYPlanta(c);
    const agruparPedido = leerAgrupar(c);

    // Las fechas locales de desde y hasta. Un hasta justo a la medianoche cierra el día anterior.
    const resFechas = await pool.query(
      `SELECT to_char(($1::timestamptz AT TIME ZONE z.zona), 'YYYY-MM-DD') AS fecha_desde,
              to_char((($2::timestamptz - INTERVAL '1 microsecond') AT TIME ZONE z.zona), 'YYYY-MM-DD') AS fecha_hasta,
              EXTRACT(EPOCH FROM ($2::timestamptz - $1::timestamptz)) / 60 AS minutos
       FROM (SELECT ${SQL_ZONA} AS zona) z`,
      [desde, hasta]
    );
    const f = resFechas.rows[0];
    const agrupar = agruparPedido ?? agrupacionPorOmision(Number(f.minutos));
    const fechas = armarPeriodos(f.fecha_desde, f.fecha_hasta, agrupar);

    // Los instantes de cada período: la medianoche local de su primer día; el primero empieza en desde
    const resInicios = await pool.query(
      `SELECT (u.fecha::date::timestamp AT TIME ZONE z.zona) AS ts
       FROM unnest($1::text[]) WITH ORDINALITY AS u(fecha, n), (SELECT ${SQL_ZONA} AS zona) z
       ORDER BY u.n`,
      [fechas.map((p) => p.inicio)]
    );
    const inicios = resInicios.rows.map((r: any, i: number) => (i === 0 ? desde : new Date(r.ts).toISOString()));
    const fines = inicios.map((_, i) => (i < inicios.length - 1 ? inicios[i + 1] : hasta));
    const esUltimo = (i: number) => i === fechas.length - 1;

    const alcance = { scope, sectores };
    const vacio = (): PeriodoEvolucion[] =>
      fechas.map((p) => ({
        inicio: p.inicio,
        fin: p.fin,
        fallas: 0,
        correctivas_finalizadas: 0,
        preventivas_finalizadas: 0,
        inactividad_minutos: 0,
        disponibilidad: null,
        costo: veCostos ? { ...COSTO_CERO } : null,
      }));

    if (fueraDeAlcance(alcance, sectorId)) {
      return c.json({ desde, hasta, agrupar, periodos: vacio() });
    }

    const maquinaIds = await maquinasDeIndicadores(pool, alcance, sectorId, plantaId);
    const hayMaquinas = maquinaIds.length > 0;

    const [cuentas, minutos, acumulada, costos] = await Promise.all([
      hayMaquinas
        ? Promise.all(fechas.map((_, i) => cuentasIntervenciones(pool, maquinaIds, inicios[i], fines[i], esUltimo(i))))
        : null,
      hayMaquinas ? Promise.all(fechas.map((_, i) => minutosEntre(pool, inicios[i], fines[i]))) : null,
      hayMaquinas ? inactividadAcumulada(pool, maquinaIds, desde, fines) : null,
      // El costo no depende de las máquinas activas: /costos cuenta también las inactivas
      veCostos
        ? Promise.all(
            fechas.map((_, i) => totalesCostos(pool, alcance, sectorId, plantaId, inicios[i], fines[i], esUltimo(i)))
          )
        : null,
    ]);

    const periodos: PeriodoEvolucion[] = fechas.map((p, i) => {
      const inactividad = acumulada ? acumulada[i] - (i > 0 ? acumulada[i - 1] : 0) : 0;
      const costo = costos ? { ...costos[i].por_tipo, total: costos[i].total } : null;
      return {
        inicio: p.inicio,
        fin: p.fin,
        fallas: cuentas ? cuentas[i].fallas : 0,
        correctivas_finalizadas: cuentas ? cuentas[i].correctivas_finalizadas : 0,
        preventivas_finalizadas: cuentas ? cuentas[i].preventivas_finalizadas : 0,
        inactividad_minutos: inactividad,
        disponibilidad: minutos ? disponibilidadDe(inactividad, minutos[i] * maquinaIds.length) : null,
        costo,
      };
    });

    return c.json({ desde, hasta, agrupar, periodos });
  } catch (error) {
    return responderError(c, error);
  }
}

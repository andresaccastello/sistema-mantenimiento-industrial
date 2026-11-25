import { pool } from '../db.ts';
import { parseId } from '../validations.ts';
import { ErrorNegocio } from './errores.ts';
import { validarFechaISO } from './fechas.ts';
import { UsuarioVisibilidad } from './visibilidad.ts';

/**
 * Los filtros del listado de intervenciones, con su visibilidad (INTERVENCIONES_VER y su alcance).
 * Los usan GET /api/intervenciones y la exportación (MQ1, 2.2), así filtran igual.
 *
 * Devuelve el WHERE y sus parámetros, sobre i (intervenciones), m (maquinas), s (sectores) y
 * ti (tipos_intervencion). Con alcance SECTORES y sin sectores, vacio: no hay nada que ver.
 */
export async function armarFiltrosListado(
  c: any,
  usuario: UsuarioVisibilidad,
  userScope: string
): Promise<{ whereClause: string; params: any[]; vacio: boolean }> {
  const sinAsignar = c.req.query('sin_asignar') === 'true';
  const incluirEliminadas = c.req.query('incluir_eliminadas') === 'true';

  if (incluirEliminadas) {
    if (!('INTERVENCIONES_ELIMINAR' in usuario.permisos)) {
      throw new ErrorNegocio(
        403,
        'PERMISO_INSUFICIENTE',
        'No posees permiso para consultar intervenciones eliminadas'
      );
    }
  }

  // 1. Validación de los filtros
  const estadoParam = c.req.query('estado');
  let estadosFiltro: string[] | null = null;
  if (estadoParam !== undefined && estadoParam !== null && estadoParam.trim() !== '') {
    const tokens = estadoParam.split(',').map((s: string) => s.trim());
    const estadosValidos = ['PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS', 'FINALIZADA', 'CANCELADA'];
    for (const tok of tokens) {
      if (!estadosValidos.includes(tok)) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `Estado de intervención inválido: ${tok}`);
      }
    }
    estadosFiltro = tokens;
  }

  const maquinaIdParam = c.req.query('maquina_id');
  let maquinaIdFiltro: number | null = null;
  if (maquinaIdParam !== undefined && maquinaIdParam !== null && maquinaIdParam.trim() !== '') {
    const parsed = parseId(maquinaIdParam);
    if (!parsed) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El parámetro maquina_id debe ser un número entero positivo');
    }
    maquinaIdFiltro = parsed;
  }

  const sectorIdParam = c.req.query('sector_id');
  let sectorIdFiltro: number | null = null;
  if (sectorIdParam !== undefined && sectorIdParam !== null && sectorIdParam.trim() !== '') {
    const parsed = parseId(sectorIdParam);
    if (!parsed) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El parámetro sector_id debe ser un número entero positivo');
    }
    sectorIdFiltro = parsed;
  }

  const plantaIdParam = c.req.query('planta_id');
  let plantaIdFiltro: number | null = null;
  if (plantaIdParam !== undefined && plantaIdParam !== null && plantaIdParam.trim() !== '') {
    const parsed = parseId(plantaIdParam);
    if (!parsed) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El parámetro planta_id debe ser un número entero positivo');
    }
    plantaIdFiltro = parsed;
  }

  const tipoParam = c.req.query('tipo');
  let tipoFiltro: string | null = null;
  if (tipoParam !== undefined && tipoParam !== null && tipoParam.trim() !== '') {
    const tTrim = tipoParam.trim().toUpperCase();
    if (tTrim !== 'CORRECTIVO' && tTrim !== 'PREVENTIVO') {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `Tipo de intervención inválido: ${tipoParam}`);
    }
    tipoFiltro = tTrim;
  }

  const responsableIdParam = c.req.query('responsable_id');
  let responsableIdFiltro: number | null = null;
  if (responsableIdParam !== undefined && responsableIdParam !== null && responsableIdParam.trim() !== '') {
    const parsed = parseId(responsableIdParam);
    if (!parsed) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El parámetro responsable_id debe ser un número entero positivo');
    }
    responsableIdFiltro = parsed;
  }

  const miasParam = c.req.query('mias');
  const filtrarMias = miasParam === 'true';

  const desdeParam = c.req.query('desde');
  let desdeFiltro: string | null = null;
  if (desdeParam !== undefined && desdeParam !== null && desdeParam.trim() !== '') {
    desdeFiltro = await validarFechaISO(pool, desdeParam.trim(), 'desde');
  }

  const hastaParam = c.req.query('hasta');
  let hastaFiltro: string | null = null;
  if (hastaParam !== undefined && hastaParam !== null && hastaParam.trim() !== '') {
    hastaFiltro = await validarFechaISO(pool, hastaParam.trim(), 'hasta');
  }

  const qParam = c.req.query('q');
  let qFiltro: string | null = null;
  if (qParam !== undefined && qParam !== null) {
    const qTrim = qParam.trim();
    if (qTrim.length < 2 || qTrim.length > 100) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El parámetro de búsqueda q debe tener entre 2 y 100 caracteres');
    }
    qFiltro = qTrim;
  }

  // 2. Construcción de condiciones WHERE
  const conditions: string[] = [];
  const params: any[] = [];

  if (!incluirEliminadas) {
    conditions.push('i.eliminado_en IS NULL');
  }

  if (userScope === 'PROPIAS') {
    params.push(usuario.id);
    conditions.push(`(i.creado_por_usuario_id = $${params.length} OR i.responsable_usuario_id = $${params.length})`);
  } else if (userScope === 'SECTORES') {
    if (usuario.sectores.length === 0) {
      return { whereClause: '', params: [], vacio: true };
    }
    params.push(usuario.sectores);
    conditions.push(`m.sector_id = ANY($${params.length})`);
  }

  if (sinAsignar) {
    conditions.push("i.responsable_usuario_id IS NULL AND i.estado = 'PENDIENTE'");
  }

  if (estadosFiltro) {
    params.push(estadosFiltro);
    conditions.push(`i.estado = ANY($${params.length})`);
  }

  if (maquinaIdFiltro !== null) {
    params.push(maquinaIdFiltro);
    conditions.push(`i.maquina_id = $${params.length}`);
  }

  if (sectorIdFiltro !== null) {
    params.push(sectorIdFiltro);
    conditions.push(`m.sector_id = $${params.length}`);
  }

  if (plantaIdFiltro !== null) {
    params.push(plantaIdFiltro);
    conditions.push(`s.planta_id = $${params.length}`);
  }

  if (tipoFiltro !== null) {
    params.push(tipoFiltro);
    conditions.push(`ti.codigo = $${params.length}`);
  }

  if (responsableIdFiltro !== null) {
    params.push(responsableIdFiltro);
    conditions.push(`i.responsable_usuario_id = $${params.length}`);
  }

  if (filtrarMias) {
    params.push(usuario.id);
    conditions.push(`i.responsable_usuario_id = $${params.length}`);
  }

  if (desdeFiltro !== null) {
    params.push(desdeFiltro);
    conditions.push(`i.fecha_creacion >= $${params.length}::timestamptz`);
  }

  if (hastaFiltro !== null) {
    params.push(hastaFiltro);
    conditions.push(`i.fecha_creacion <= $${params.length}::timestamptz`);
  }

  if (qFiltro !== null) {
    params.push(`%${qFiltro}%`);
    conditions.push(`(i.descripcion ILIKE $${params.length} OR m.nombre ILIKE $${params.length} OR m.codigo ILIKE $${params.length})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params, vacio: false };
}

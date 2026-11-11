import { Hono } from 'hono';
import pg from 'pg';
import { pool } from './db.ts';
import { requirePermission } from './middleware.ts';
import { ErrorNegocio, responderError } from './intervenciones/errores.ts';
import { bloquearIntervencion } from './intervenciones/bloqueos.ts';
import { UsuarioVisibilidad, puedeVerIntervencion } from './intervenciones/visibilidad.ts';
import { registrarAuditoria } from './intervenciones/auditoria.ts';
import { recalcularCostosIntervencion } from './intervenciones/costos.ts';
import { parseIdRuta, validarIdCuerpo, formatearCantidad } from './repuestos/validaciones.ts';

/**
 * Etapa C1, sección 4: renglones de costo de la intervención.
 * Un Hono sin middleware propio, montado al final de intervenciones.ts.
 */
const intervencionCostosApp = new Hono();

const TIPOS_COSTO = ['MANO_OBRA', 'SERVICIO_EXTERNO', 'TRANSPORTE', 'OTRO', 'AJUSTE'] as const;
type TipoCosto = (typeof TIPOS_COSTO)[number];

const ETIQUETA_TIPO: Record<TipoCosto, string> = {
  MANO_OBRA: 'Mano de obra',
  SERVICIO_EXTERNO: 'Servicio externo',
  TRANSPORTE: 'Transporte',
  OTRO: 'Otro',
  AJUSTE: 'Ajuste',
};

function etiquetaTipo(tipo: string): string {
  return (ETIQUETA_TIPO as Record<string, string>)[tipo] ?? tipo;
}

/** La descripción que lleva una mano de obra cuando no se escribe ninguna. */
const DESCRIPCION_MANO_OBRA = 'Mano de obra';

/**
 * Texto del renglón para la auditoría, sin importes ni valor hora (C1.1, sección 5).
 * - MANO_OBRA: "Mano de obra — <persona o proveedor>, <horas> h", y ": <descripción>"
 *   al final si no es la de omisión.
 * - Los demás: "<tipo> — <descripción>".
 * Se llama dentro de la transacción, con el renglón ya escrito o bloqueado.
 */
async function textoRenglonAuditoria(client: pg.PoolClient, renglonId: number): Promise<string> {
  const res = await client.query(
    `SELECT c.tipo, c.descripcion, c.horas,
            per.nombre AS per_nombre, per.apellido AS per_apellido, prov.nombre AS prov_nombre
     FROM intervencion_costos c
     LEFT JOIN usuarios per ON per.id = c.usuario_id
     LEFT JOIN proveedores prov ON prov.id = c.proveedor_id
     WHERE c.id = $1`,
    [renglonId]
  );
  const r = res.rows[0];
  if (r.tipo !== 'MANO_OBRA') {
    return `${etiquetaTipo(r.tipo)} — ${r.descripcion}`;
  }
  const quien =
    r.per_nombre !== null
      ? [r.per_nombre, r.per_apellido].filter((x: string | null) => x).join(' ')
      : String(r.prov_nombre);
  const detalle = r.descripcion !== DESCRIPCION_MANO_OBRA ? `: ${r.descripcion}` : '';
  return `${etiquetaTipo(r.tipo)} — ${quien}, ${formatearCantidad(r.horas)} h${detalle}`;
}

function getUsuarioContext(c: any): UsuarioVisibilidad {
  return {
    id: (c.get as any)('userId') as number,
    permisos: ((c.get as any)('userPermissionsMap') as Record<string, any>) || {},
    sectores: ((c.get as any)('userSectores') as number[]) || [],
  };
}

function veCostosC1(usuario: UsuarioVisibilidad): boolean {
  return 'COSTOS_VER' in usuario.permisos;
}

/**
 * Tabla de la sección 4.1. La usan el GET, el POST y la anulación.
 */
export function permisosCostos(
  usuario: UsuarioVisibilidad,
  intervencion: { estado: string }
): { puede_registrar: boolean; puede_anular: boolean } {
  const registra = 'COSTOS_REGISTRAR' in usuario.permisos;
  const corrige = 'INTERVENCIONES_CORREGIR' in usuario.permisos;

  switch (intervencion.estado) {
    case 'EN_PROCESO':
    case 'EN_ESPERA_REPUESTOS':
      return { puede_registrar: registra, puede_anular: registra };
    case 'FINALIZADA':
      return { puede_registrar: registra && corrige, puede_anular: registra && corrige };
    case 'CANCELADA':
      return { puede_registrar: false, puede_anular: registra && corrige };
    default:
      // PENDIENTE: no hay costos que cargar ni que anular
      return { puede_registrar: false, puede_anular: false };
  }
}

// -------------------------------------------------------------
// Validaciones de números (sección 4.3)
// -------------------------------------------------------------

function validarDecimal(
  val: unknown,
  campo: string,
  opciones: { decimales: number; maxAbs: number }
): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `El campo ${campo} debe ser un número`);
  }
  if (Math.abs(val) > opciones.maxAbs) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `El campo ${campo} supera el máximo permitido`);
  }
  const fijo = Number(val.toFixed(opciones.decimales));
  if (Math.abs(val - fijo) > 1e-9) {
    throw new ErrorNegocio(
      422,
      'DATOS_INVALIDOS',
      `El campo ${campo} no puede tener más de ${opciones.decimales} decimales`
    );
  }
  return fijo;
}

function presente(val: unknown): boolean {
  return val !== undefined && val !== null;
}

// -------------------------------------------------------------
// Formato de respuesta
// -------------------------------------------------------------

const SQL_RENGLON_COMPLETO = `
  SELECT
    c.*,
    per.id AS per_id, per.nombre AS per_nombre, per.apellido AS per_apellido,
    prov.id AS prov_id, prov.nombre AS prov_nombre,
    reg.id AS reg_user_id, reg.nombre AS reg_user_nombre, reg.apellido AS reg_user_apellido,
    anul.id AS anul_user_id, anul.nombre AS anul_user_nombre, anul.apellido AS anul_user_apellido
  FROM intervencion_costos c
  LEFT JOIN usuarios per ON per.id = c.usuario_id
  LEFT JOIN proveedores prov ON prov.id = c.proveedor_id
  LEFT JOIN usuarios reg ON reg.id = c.registrado_por_usuario_id
  LEFT JOIN usuarios anul ON anul.id = c.anulado_por_usuario_id
`;

function persona(id: unknown, nombre: unknown, apellido: unknown) {
  return id ? { id: Number(id), nombre: String(nombre), apellido: apellido ? String(apellido) : null } : null;
}

function armarRenglon(row: any, veCostos: boolean) {
  return {
    id: Number(row.id),
    tipo: row.tipo,
    descripcion: row.descripcion,
    importe: veCostos ? Number(row.importe) : null,
    valor_hora: veCostos && row.valor_hora !== null ? Number(row.valor_hora) : null,
    horas: row.tipo === 'MANO_OBRA' && row.horas !== null ? Number(row.horas) : null,
    persona: persona(row.per_id, row.per_nombre, row.per_apellido),
    proveedor: row.prov_id ? { id: Number(row.prov_id), nombre: row.prov_nombre } : null,
    motivo: row.motivo || null,
    registrado_por: persona(row.reg_user_id, row.reg_user_nombre, row.reg_user_apellido),
    registrado_en: row.registrado_en,
    anulado: row.anulado_en !== null,
    anulado_por: persona(row.anul_user_id, row.anul_user_nombre, row.anul_user_apellido),
    anulado_en: row.anulado_en || null,
    motivo_anulacion: row.motivo_anulacion || null,
  };
}

async function leerRenglon(id: number, veCostos: boolean) {
  const res = await pool.query(`${SQL_RENGLON_COMPLETO} WHERE c.id = $1`, [id]);
  return armarRenglon(res.rows[0], veCostos);
}

async function leerJson(c: any): Promise<any> {
  try {
    const body = await c.req.json();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('no es un objeto');
    }
    return body;
  } catch {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Cuerpo JSON inválido');
  }
}

// -------------------------------------------------------------
// 4.2 GET /:id/costos
// -------------------------------------------------------------

intervencionCostosApp.get('/:id/costos', requirePermission('INTERVENCIONES_VER'), async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (!id) {
      throw new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
    }
    const usuario = getUsuarioContext(c);

    // Sin bloquear filas, como el GET de repuestos
    const resI = await pool.query(
      `SELECT i.id, i.estado, i.responsable_usuario_id, i.creado_por_usuario_id, i.eliminado_en,
              i.costo_repuestos, i.costo_total_estimado, m.sector_id
       FROM intervenciones i
       JOIN maquinas m ON m.id = i.maquina_id
       WHERE i.id = $1`,
      [id]
    );
    if (resI.rows.length === 0 || resI.rows[0].eliminado_en !== null) {
      throw new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
    }
    const intervencion = resI.rows[0];
    const visible = puedeVerIntervencion(usuario, {
      creado_por_usuario_id: Number(intervencion.creado_por_usuario_id),
      responsable_usuario_id: intervencion.responsable_usuario_id
        ? Number(intervencion.responsable_usuario_id)
        : null,
      sector_id: Number(intervencion.sector_id),
    });
    if (!visible) {
      throw new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
    }

    const veCostos = veCostosC1(usuario);
    const { puede_registrar, puede_anular } = permisosCostos(usuario, intervencion);

    const resR = await pool.query(
      `${SQL_RENGLON_COMPLETO} WHERE c.intervencion_id = $1 ORDER BY c.registrado_en ASC, c.id ASC`,
      [id]
    );
    const renglones = resR.rows.map((row) => armarRenglon(row, veCostos));

    const resSum = await pool.query(
      `SELECT
         COALESCE(SUM(importe) FILTER (WHERE tipo = 'MANO_OBRA'), 0) AS mano_obra,
         COALESCE(SUM(importe) FILTER (WHERE tipo = 'SERVICIO_EXTERNO'), 0) AS servicio_externo,
         COALESCE(SUM(importe) FILTER (WHERE tipo = 'TRANSPORTE'), 0) AS transporte,
         COALESCE(SUM(importe) FILTER (WHERE tipo = 'OTRO'), 0) AS otro,
         COALESCE(SUM(importe) FILTER (WHERE tipo = 'AJUSTE'), 0) AS ajuste,
         COALESCE(SUM(horas) FILTER (WHERE tipo = 'MANO_OBRA'), 0) AS horas_mano_obra
       FROM intervencion_costos
       WHERE intervencion_id = $1 AND anulado_en IS NULL`,
      [id]
    );
    const s = resSum.rows[0];

    const resumen = veCostos
      ? {
          repuestos: Number(intervencion.costo_repuestos),
          mano_obra: Number(s.mano_obra),
          servicio_externo: Number(s.servicio_externo),
          transporte: Number(s.transporte),
          otro: Number(s.otro),
          ajuste: Number(s.ajuste),
          total: Number(intervencion.costo_total_estimado),
        }
      : null;

    return c.json(
      {
        renglones,
        resumen,
        horas_mano_obra: Number(s.horas_mano_obra),
        ve_costos: veCostos,
        puede_registrar,
        puede_anular,
      },
      200
    );
  } catch (err) {
    return responderError(c, err);
  }
});

// -------------------------------------------------------------
// 4.3 POST /:id/costos
// -------------------------------------------------------------

interface RenglonValidado {
  tipo: TipoCosto;
  descripcion: string;
  usuarioId: number | null;
  proveedorId: number | null;
  horas: number | null;
  valorHora: number | null;
  importe: number | null;
  motivo: string | null;
}

function validarRenglon(body: any, finalizada: boolean): RenglonValidado {
  // tipo
  if (typeof body.tipo !== 'string' || !(TIPOS_COSTO as readonly string[]).includes(body.tipo)) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El tipo de costo no es válido');
  }
  const tipo = body.tipo as TipoCosto;
  const esManoObra = tipo === 'MANO_OBRA';

  // motivo: en AJUSTE y con la intervención FINALIZADA, al menos 5 caracteres
  if (presente(body.motivo) && typeof body.motivo !== 'string') {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El motivo debe ser texto');
  }
  const motivoTrim = typeof body.motivo === 'string' ? body.motivo.trim() : '';
  if ((tipo === 'AJUSTE' || finalizada) && motivoTrim.length < 5) {
    throw new ErrorNegocio(422, 'MOTIVO_REQUERIDO', 'Debe indicar un motivo de al menos 5 caracteres');
  }
  if (motivoTrim.length > 500) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El motivo no puede superar los 500 caracteres');
  }

  // descripcion
  if (presente(body.descripcion) && typeof body.descripcion !== 'string') {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La descripción debe ser texto');
  }
  let descripcion = typeof body.descripcion === 'string' ? body.descripcion.trim() : '';
  if (descripcion === '' && esManoObra) {
    descripcion = DESCRIPCION_MANO_OBRA;
  }
  if (descripcion.length < 3 || descripcion.length > 200) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La descripción debe tener entre 3 y 200 caracteres');
  }

  // usuario_id: solo MANO_OBRA
  let usuarioId: number | null = null;
  if (presente(body.usuario_id)) {
    if (!esManoObra) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La persona solo va en un renglón de mano de obra');
    }
    usuarioId = validarIdCuerpo(body.usuario_id, 'DATOS_INVALIDOS', 'usuario_id');
  }

  // proveedor_id: no va en AJUSTE
  let proveedorId: number | null = null;
  if (presente(body.proveedor_id)) {
    if (tipo === 'AJUSTE') {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Un ajuste no lleva proveedor');
    }
    proveedorId = validarIdCuerpo(body.proveedor_id, 'DATOS_INVALIDOS', 'proveedor_id');
  }

  if (esManoObra && (usuarioId === null) === (proveedorId === null)) {
    throw new ErrorNegocio(
      422,
      'DATOS_INVALIDOS',
      'La mano de obra lleva exactamente una persona interna o un proveedor'
    );
  }

  // horas: obligatorias en MANO_OBRA, y solo ahí
  let horas: number | null = null;
  if (esManoObra) {
    if (!presente(body.horas)) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Indique las horas de mano de obra');
    }
    horas = validarDecimal(body.horas, 'horas', { decimales: 2, maxAbs: 1000 });
    if (horas <= 0) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Las horas deben ser mayores que 0');
    }
  } else if (presente(body.horas)) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Las horas solo van en un renglón de mano de obra');
  }

  // valor_hora: opcional, solo en MANO_OBRA
  let valorHora: number | null = null;
  if (presente(body.valor_hora)) {
    if (!esManoObra) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El valor hora solo va en un renglón de mano de obra');
    }
    valorHora = validarDecimal(body.valor_hora, 'valor_hora', { decimales: 2, maxAbs: 10000000 });
    if (valorHora < 0) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El valor hora no puede ser negativo');
    }
  }

  // importe: obligatorio si no hay valor_hora; con valor_hora lo calcula la API
  let importe: number | null = null;
  if (valorHora !== null) {
    if (presente(body.importe)) {
      throw new ErrorNegocio(
        422,
        'DATOS_INVALIDOS',
        'Con valor hora, el importe lo calcula el sistema: no se manda'
      );
    }
  } else {
    if (!presente(body.importe)) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Indique el importe');
    }
    importe = validarDecimal(body.importe, 'importe', { decimales: 2, maxAbs: 1000000000 });
    if (tipo === 'AJUSTE') {
      if (importe === 0) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Un ajuste no puede ser 0');
      }
    } else if (importe < 0) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El importe no puede ser negativo');
    }
  }

  return {
    tipo,
    descripcion,
    usuarioId,
    proveedorId,
    horas,
    valorHora,
    importe,
    motivo: motivoTrim === '' ? null : motivoTrim,
  };
}

// -------------------------------------------------------------
// Lo que comparten el POST de uno y el lote (C1.2, sección 2.3).
// Todo corre dentro de la transacción abierta por quien llama.
// -------------------------------------------------------------

/**
 * Bloquea máquina e intervención, controla la visibilidad, el estado (409) y los
 * permisos de la tabla 4.1 (403).
 */
async function abrirCargaCostos(
  client: pg.PoolClient,
  id: number,
  usuario: UsuarioVisibilidad
): Promise<{ finalizada: boolean }> {
  const { intervencion } = await bloquearIntervencion(client, id, usuario);

  if (intervencion.estado === 'PENDIENTE' || intervencion.estado === 'CANCELADA') {
    throw new ErrorNegocio(409, 'ESTADO_NO_PERMITE_COSTOS', 'El estado de la intervención no permite cargar costos');
  }
  const { puede_registrar } = permisosCostos(usuario, intervencion);
  if (!puede_registrar) {
    throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tiene permiso para cargar costos en esta intervención');
  }
  return { finalizada: intervencion.estado === 'FINALIZADA' };
}

/**
 * Valida un renglón: los datos, el tope del importe calculado, y la persona y el
 * proveedor (FOR SHARE). Lanza el primer error que encuentra.
 */
async function prepararRenglon(client: pg.PoolClient, body: any, finalizada: boolean): Promise<RenglonValidado> {
  const r = validarRenglon(body, finalizada);

  // El importe calculado tiene el mismo máximo que el cargado a mano,
  // comparado en SQL con el mismo ROUND del INSERT
  if (r.valorHora !== null) {
    const resTope = await client.query(
      'SELECT ROUND($1::numeric * $2::numeric, 2) > 1000000000 AS excede',
      [r.horas, r.valorHora]
    );
    if (resTope.rows[0].excede) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El importe de la mano de obra supera el máximo permitido');
    }
  }

  if (r.usuarioId !== null) {
    const resU = await client.query('SELECT id, activo FROM usuarios WHERE id = $1 FOR SHARE', [r.usuarioId]);
    if (resU.rows.length === 0 || !resU.rows[0].activo) {
      throw new ErrorNegocio(422, 'PERSONA_INVALIDA', 'La persona no existe o está inactiva');
    }
  }
  if (r.proveedorId !== null) {
    const resP = await client.query('SELECT id, activo FROM proveedores WHERE id = $1 FOR SHARE', [r.proveedorId]);
    if (resP.rows.length === 0 || !resP.rows[0].activo) {
      throw new ErrorNegocio(422, 'PROVEEDOR_INVALIDO', 'El proveedor no existe o está inactivo');
    }
  }
  return r;
}

/** Inserta un renglón ya validado. Con valor hora, el importe se calcula en SQL. */
async function insertarRenglon(
  client: pg.PoolClient,
  intervencionId: number,
  r: RenglonValidado,
  usuarioId: number
): Promise<number> {
  const resIns = await client.query(
    `INSERT INTO intervencion_costos (
       intervencion_id, tipo, descripcion, importe, motivo,
       usuario_id, proveedor_id, horas, valor_hora, registrado_por_usuario_id
     ) VALUES (
       $1, $2, $3,
       CASE WHEN $8::numeric IS NULL THEN $4::numeric ELSE ROUND($7::numeric * $8::numeric, 2) END,
       $5, $6, $9, $7::numeric, $8::numeric, $10
     )
     RETURNING id`,
    [
      intervencionId,
      r.tipo,
      r.descripcion,
      r.importe,
      r.motivo,
      r.usuarioId,
      r.horas,
      r.valorHora,
      r.proveedorId,
      usuarioId,
    ]
  );
  return Number(resIns.rows[0].id);
}

/** Auditoría del alta con la intervención finalizada, sin importes. */
async function auditarAlta(
  client: pg.PoolClient,
  intervencionId: number,
  renglonId: number,
  motivo: string | null,
  usuarioId: number
): Promise<void> {
  await registrarAuditoria(client, {
    intervencionId,
    tipoEvento: 'CORRECCION_COSTO',
    campo: 'costos',
    valorNuevo: `Se agregó: ${await textoRenglonAuditoria(client, renglonId)}`,
    motivo,
    usuarioId,
  });
}

intervencionCostosApp.post('/:id/costos', async (c) => {
  const client: pg.PoolClient = await pool.connect();
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (!id) {
      throw new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
    }
    const usuario = getUsuarioContext(c);
    const body = await leerJson(c);

    await client.query('BEGIN');

    // 1 y 2. Bloqueo, visibilidad, estado y permisos
    const { finalizada } = await abrirCargaCostos(client, id, usuario);

    // 3. Datos
    const r = await prepararRenglon(client, body, finalizada);

    // 4. Inserta el renglón
    const renglonId = await insertarRenglon(client, id, r, usuario.id);

    // 5. Recalcula (puede dar TOTAL_NEGATIVO y revertir todo)
    await recalcularCostosIntervencion(client, id);

    // 6. Auditoría, sin importes
    if (finalizada) {
      await auditarAlta(client, id, renglonId, r.motivo, usuario.id);
    }

    await client.query('COMMIT');

    return c.json(await leerRenglon(renglonId, veCostosC1(usuario)), 201);
  } catch (err) {
    await client.query('ROLLBACK');
    return responderError(c, err);
  } finally {
    client.release();
  }
});

// -------------------------------------------------------------
// C1.2: POST /:id/costos/lote (varios renglones en una transacción)
// -------------------------------------------------------------

const MAXIMO_LOTE = 5;

/** Un error de un renglón del lote, con su posición en el arreglo. */
function conIndice(err: unknown, indice: number): unknown {
  if (err instanceof ErrorNegocio) {
    return new ErrorNegocio(err.status, err.codigo, err.mensaje, { ...(err.detalles || {}), indice });
  }
  return err;
}

intervencionCostosApp.post('/:id/costos/lote', async (c) => {
  const client: pg.PoolClient = await pool.connect();
  try {
    // 1. Id de la ruta
    const id = parseIdRuta(c.req.param('id'));
    if (!id) {
      throw new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
    }
    const usuario = getUsuarioContext(c);

    // 2. Forma del cuerpo, antes de abrir la transacción
    const body = await leerJson(c);
    const cuerpos: unknown = body.renglones;
    if (!Array.isArray(cuerpos) || cuerpos.length < 1 || cuerpos.length > MAXIMO_LOTE) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `Debe mandar entre 1 y ${MAXIMO_LOTE} renglones`);
    }
    cuerpos.forEach((cuerpo, indice) => {
      if (cuerpo === null || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Cada renglón debe ser un objeto', { indice });
      }
    });

    await client.query('BEGIN');

    // 3. Bloqueo, visibilidad, estado y permisos, como el POST de uno
    const { finalizada } = await abrirCargaCostos(client, id, usuario);

    // 4. Cada renglón, en orden: el primer error corta, con su indice
    const renglones: RenglonValidado[] = [];
    for (let indice = 0; indice < cuerpos.length; indice++) {
      try {
        renglones.push(await prepararRenglon(client, cuerpos[indice], finalizada));
      } catch (err) {
        throw conIndice(err, indice);
      }
    }

    // 5. Inserta todos, en orden
    const ids: number[] = [];
    for (const r of renglones) {
      ids.push(await insertarRenglon(client, id, r, usuario.id));
    }

    // 6. Recalcula una sola vez (TOTAL_NEGATIVO y TOTAL_FUERA_DE_RANGO, sin indice)
    await recalcularCostosIntervencion(client, id);

    // 7. Auditoría, una por renglón y en orden
    if (finalizada) {
      for (let i = 0; i < ids.length; i++) {
        await auditarAlta(client, id, ids[i], renglones[i].motivo, usuario.id);
      }
    }

    await client.query('COMMIT');

    const veCostos = veCostosC1(usuario);
    const respuesta = [];
    for (const renglonId of ids) {
      respuesta.push(await leerRenglon(renglonId, veCostos));
    }
    return c.json({ renglones: respuesta }, 201);
  } catch (err) {
    await client.query('ROLLBACK');
    return responderError(c, err);
  } finally {
    client.release();
  }
});

// -------------------------------------------------------------
// 4.5 POST /:id/costos/:renglonId/anular
// -------------------------------------------------------------

intervencionCostosApp.post('/:id/costos/:renglonId/anular', async (c) => {
  const client: pg.PoolClient = await pool.connect();
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (!id) {
      throw new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
    }
    const renglonId = parseIdRuta(c.req.param('renglonId'));
    if (!renglonId) {
      throw new ErrorNegocio(404, 'RENGLON_NO_ENCONTRADO', 'Renglón de costo no encontrado');
    }
    const usuario = getUsuarioContext(c);
    const body = await leerJson(c);

    const motivoTrim = typeof body.motivo === 'string' ? body.motivo.trim() : '';
    if (motivoTrim.length < 5) {
      throw new ErrorNegocio(422, 'MOTIVO_REQUERIDO', 'Debe indicar un motivo de al menos 5 caracteres');
    }
    if (motivoTrim.length > 500) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El motivo no puede superar los 500 caracteres');
    }

    await client.query('BEGIN');

    // 1. Bloqueo de máquina e intervención, y visibilidad
    const { intervencion } = await bloquearIntervencion(client, id, usuario);

    // 2. Estado y permisos (tabla 4.1)
    if (intervencion.estado === 'PENDIENTE') {
      throw new ErrorNegocio(409, 'ESTADO_NO_PERMITE_COSTOS', 'El estado de la intervención no permite anular costos');
    }
    const { puede_anular } = permisosCostos(usuario, intervencion);
    if (!puede_anular) {
      throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tiene permiso para anular costos en esta intervención');
    }

    // 3. El renglón, bloqueado antes de mirarlo
    const resR = await client.query(
      'SELECT id, intervencion_id, tipo, descripcion, anulado_en FROM intervencion_costos WHERE id = $1 FOR UPDATE',
      [renglonId]
    );
    if (resR.rows.length === 0 || Number(resR.rows[0].intervencion_id) !== id) {
      throw new ErrorNegocio(404, 'RENGLON_NO_ENCONTRADO', 'Renglón de costo no encontrado en esta intervención');
    }
    const renglon = resR.rows[0];
    if (renglon.anulado_en !== null) {
      throw new ErrorNegocio(409, 'RENGLON_YA_ANULADO', 'El renglón ya fue anulado');
    }

    // 4. Anulación
    await client.query(
      `UPDATE intervencion_costos
       SET anulado_en = NOW(), anulado_por_usuario_id = $1, motivo_anulacion = $2
       WHERE id = $3`,
      [usuario.id, motivoTrim, renglonId]
    );

    // 5. Recalcula (puede dar TOTAL_NEGATIVO y revertir todo)
    await recalcularCostosIntervencion(client, id);

    // 6. Auditoría, sin importes
    if (intervencion.estado === 'FINALIZADA' || intervencion.estado === 'CANCELADA') {
      await registrarAuditoria(client, {
        intervencionId: id,
        tipoEvento: 'CORRECCION_COSTO',
        campo: 'costos',
        valorNuevo: `Se anuló: ${await textoRenglonAuditoria(client, renglonId)}`,
        motivo: motivoTrim,
        usuarioId: usuario.id,
      });
    }

    await client.query('COMMIT');

    return c.json(await leerRenglon(renglonId, veCostosC1(usuario)), 200);
  } catch (err) {
    await client.query('ROLLBACK');
    return responderError(c, err);
  } finally {
    client.release();
  }
});

export default intervencionCostosApp;

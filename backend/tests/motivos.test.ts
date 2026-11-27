import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';
import app from '../functions/api.ts';
import { JWT_SECRET } from '../functions/config.ts';
import { validarMotivo } from '../functions/validations.ts';
import { ErrorNegocio } from '../functions/intervenciones/errores.ts';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (MOTIVOS TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

async function getTokenForUser(user: { id: number; legajo: string; sesion_version: number }) {
  return await sign(
    {
      sub: String(user.id),
      legajo: user.legajo,
      sv: user.sesion_version,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    JWT_SECRET,
    'HS256'
  );
}

interface Respuesta {
  status: number;
  cuerpo: any;
}

async function pedir(method: string, path: string, token: string | null, body?: unknown): Promise<Respuesta> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await app.request(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const texto = await r.text();
  let cuerpo: any = texto;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    // no es JSON
  }
  return { status: r.status, cuerpo };
}

/** Un motivo de `largo` caracteres que empieza con la clave de la ruta, para encontrarlo en la base. */
const motivoDe = (clave: string, largo: number) => `MO ${clave} `.padEnd(largo, 'x');

/** El código y el mensaje del error de validarMotivo, o null si no tira. */
function errorDe(valor: unknown, mensaje?: string): [string, string] | null {
  try {
    validarMotivo(valor, mensaje);
    return null;
  } catch (err) {
    assert.ok(err instanceof ErrorNegocio, String(err));
    assert.strictEqual(err.status, 422);
    return [err.codigo, err.mensaje];
  }
}

// =========================================================================
// MO-03: validarMotivo sola
// =========================================================================
test('MO-03: validarMotivo sola', () => {
  const requerido: [string, string] = ['MOTIVO_REQUERIDO', 'Debe indicar un motivo de al menos 5 caracteres'];
  const largo: [string, string] = ['DATOS_INVALIDOS', 'El motivo no puede superar los 500 caracteres'];

  assert.deepStrictEqual(errorDe('abcd'), requerido, '4 caracteres');
  assert.strictEqual(validarMotivo('abcde'), 'abcde', '5 caracteres');
  assert.strictEqual(validarMotivo('a'.repeat(500)), 'a'.repeat(500), '500 caracteres');
  assert.deepStrictEqual(errorDe('a'.repeat(501)), largo, '501 caracteres');
  assert.deepStrictEqual(errorDe('          '), requerido, 'Solo espacios');
  assert.deepStrictEqual(errorDe(12345), requerido, 'Un número');
  assert.deepStrictEqual(errorDe(null), requerido, 'null');
  assert.deepStrictEqual(errorDe(undefined), requerido, 'Sin motivo');

  // Recorta, y los espacios de los extremos no cuentan para el tope
  assert.strictEqual(validarMotivo('  abcde  '), 'abcde');
  assert.strictEqual(validarMotivo(`  ${'a'.repeat(500)}  `), 'a'.repeat(500));
  assert.deepStrictEqual(errorDe('  abcd  '), requerido, '4 caracteres con espacios');
  // El mensaje de la ruta
  assert.deepStrictEqual(errorDe('ab', 'Indicá un motivo de al menos 5 caracteres'), [
    'MOTIVO_REQUERIDO',
    'Indicá un motivo de al menos 5 caracteres',
  ]);
});

test('Etapa C3 — El motivo: mismo límite en todos lados (MO-01 y MO-02)', async (t) => {
  let client = await pool.connect();

  const createdPlantaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdUsuarioIds: number[] = [];
  const createdRepuestoIds: number[] = [];

  try {
    const suf = Date.now();
    const passHash = await bcrypt.hash('pass123', 10);

    const perfilMap: Record<string, number> = {};
    for (const r of (await client.query('SELECT id, nombre FROM perfiles')).rows) {
      perfilMap[r.nombre] = Number(r.id);
    }
    const permMap: Record<string, number> = {};
    for (const r of (await client.query('SELECT id, codigo FROM permisos')).rows) {
      permMap[r.codigo] = Number(r.id);
    }
    const hoy: string = (await client.query(`SELECT to_char(hoy_instalacion(), 'YYYY-MM-DD') AS hoy`)).rows[0].hoy;
    const critNormal = Number((await client.query(
      'SELECT id FROM criticidades WHERE NOT prioridad_alta AND activo ORDER BY orden, id LIMIT 1'
    )).rows[0].id);

    // Planta, sector y usuarios
    const pl = Number((await client.query(
      'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`MO_PL_${suf}`]
    )).rows[0].id);
    createdPlantaIds.push(pl);
    const s1 = Number((await client.query(
      'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`MO_S1_${suf}`, pl]
    )).rows[0].id);
    createdSectorIds.push(s1);

    let numeroUsuario = 0;
    async function crearUsuario(clave: string, perfil: string, activo = true) {
      numeroUsuario++;
      const res = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
         VALUES ($1, $2, 'MO', $3, $4, $5, 1) RETURNING id, legajo, sesion_version`,
        [`MO_${clave}${numeroUsuario}_${suf}`, clave, passHash, perfilMap[perfil], activo]
      );
      const u = res.rows[0];
      const id = Number(u.id);
      createdUsuarioIds.push(id);
      await client.query('INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)', [id, s1]);
      return { id, token: await getTokenForUser({ id, legajo: u.legajo, sesion_version: Number(u.sesion_version) }) };
    }
    const A = await crearUsuario('Admin', 'ADMINISTRADOR');
    const R = await crearUsuario('Resp', 'RESPONSABLE_MANTENIMIENTO');
    const R2 = await crearUsuario('RespDos', 'RESPONSABLE_MANTENIMIENTO');

    // Repuesto con stock
    const rRep = await pedir('POST', '/api/repuestos', R.token, {
      codigo: `MO_P1_${suf}`, nombre: `MO Repuesto ${suf}`, lleva_stock: true, stock_inicial: 100, costo_unitario: 100,
    });
    assert.strictEqual(rRep.status, 201, JSON.stringify(rRep.cuerpo));
    const repId = Number(rRep.cuerpo.id);
    createdRepuestoIds.push(repId);

    // Helpers
    let numeroMaquina = 0;
    async function crearMaquina() {
      numeroMaquina++;
      const id = Number((await client.query(
        `INSERT INTO maquinas (codigo, nombre, sector_id, criticidad_id, activo)
         VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
        [`MO_M${numeroMaquina}_${suf}`, `Maquina MO ${numeroMaquina}`, s1, critNormal]
      )).rows[0].id);
      createdMaquinaIds.push(id);
      return id;
    }
    async function ok(r: Promise<Respuesta>, contexto: string) {
      const res = await r;
      assert.ok(res.status >= 200 && res.status < 300, `${contexto}: ${res.status} ${JSON.stringify(res.cuerpo)}`);
      return res.cuerpo;
    }
    async function crearIntervencion() {
      const m = await crearMaquina();
      const d = await ok(pedir('POST', '/api/intervenciones', A.token, { maquina_id: m, descripcion: 'Falla prueba MO' }), 'crear');
      return Number(d.id);
    }
    const iniciar = (id: number) => ok(pedir('POST', `/api/intervenciones/${id}/iniciar`, R.token, { estado_esperado: 'PENDIENTE' }), 'iniciar');
    const finalizar = (id: number) =>
      ok(
        pedir('POST', `/api/intervenciones/${id}/finalizar`, R.token, {
          estado_esperado: 'EN_PROCESO', trabajo_realizado: 'Trabajo MO', ejecucion: 'INTERNA',
        }),
        'finalizar'
      );
    async function enProceso() {
      const id = await crearIntervencion();
      await iniciar(id);
      return id;
    }
    async function finalizada() {
      const id = await enProceso();
      await finalizar(id);
      return id;
    }
    const asignar = (id: number, usuarioId: number) =>
      ok(pedir('PUT', `/api/intervenciones/${id}/responsable`, A.token, { usuario_id: usuarioId, estado_esperado: 'PENDIENTE' }), 'asignar');

    /** Todo lo de una intervención: la fila y sus tablas hijas. */
    const fotoIntervencion = async (id: number) =>
      (await client.query(
        `SELECT
           (SELECT row_to_json(i) FROM intervenciones i WHERE i.id = $1) AS intervencion,
           (SELECT json_agg(row_to_json(x) ORDER BY x.id) FROM intervencion_costos x WHERE x.intervencion_id = $1) AS costos,
           (SELECT json_agg(row_to_json(x) ORDER BY x.id) FROM intervencion_repuestos x WHERE x.intervencion_id = $1) AS repuestos,
           (SELECT json_agg(row_to_json(x) ORDER BY x.id) FROM pedidos_repuesto x WHERE x.intervencion_id = $1) AS pedidos,
           (SELECT json_agg(row_to_json(x) ORDER BY x.id) FROM intervencion_tareas x WHERE x.intervencion_id = $1) AS tareas,
           (SELECT count(*)::int FROM intervencion_auditoria x WHERE x.intervencion_id = $1) AS auditoria,
           (SELECT count(*)::int FROM historial_estados_intervencion x WHERE x.intervencion_id = $1) AS historial,
           (SELECT count(*)::int FROM notificaciones x WHERE x.intervencion_id = $1) AS notificaciones,
           (SELECT cantidad_disponible FROM repuestos WHERE id = $2) AS stock`,
        [id, repId]
      )).rows[0];
    const fotoUsuario = async (id: number) =>
      (await client.query(
        `SELECT
           (SELECT row_to_json(u) FROM usuarios u WHERE u.id = $1) AS usuario,
           (SELECT json_agg(row_to_json(x) ORDER BY x.id) FROM usuario_permiso x WHERE x.usuario_id = $1) AS excepciones,
           (SELECT count(*)::int FROM auditoria_permisos x WHERE x.sobre_usuario_id = $1) AS auditoria`,
        [id]
      )).rows[0];

    /** Si el texto quedó guardado, entero, en alguna de las columnas que guardan un motivo. */
    async function guardado(texto: string): Promise<boolean> {
      const r = await client.query(
        `SELECT EXISTS (SELECT 1 FROM intervencion_costos WHERE strpos(motivo, $1) > 0 OR strpos(motivo_anulacion, $1) > 0)
             OR EXISTS (SELECT 1 FROM intervencion_repuestos WHERE strpos(motivo_anulacion, $1) > 0)
             OR EXISTS (SELECT 1 FROM pedidos_repuesto WHERE strpos(motivo_cancelacion, $1) > 0)
             OR EXISTS (SELECT 1 FROM lecturas_medidor WHERE strpos(motivo_anulacion, $1) > 0)
             OR EXISTS (SELECT 1 FROM intervenciones WHERE strpos(motivo_eliminacion, $1) > 0)
             OR EXISTS (SELECT 1 FROM intervencion_auditoria WHERE strpos(motivo, $1) > 0)
             OR EXISTS (SELECT 1 FROM historial_estados_intervencion WHERE strpos(observacion, $1) > 0)
             OR EXISTS (SELECT 1 FROM historial_estados_maquina WHERE strpos(motivo, $1) > 0)
             OR EXISTS (SELECT 1 FROM usuario_permiso WHERE strpos(motivo, $1) > 0)
             OR EXISTS (SELECT 1 FROM auditoria_permisos WHERE strpos(detalle, $1) > 0) AS hay`,
        [texto]
      );
      return r.rows[0].hay === true;
    }

    interface Caso {
      /** Prepara los datos y devuelve cómo llamar a la ruta y cómo sacar la foto de lo que cambiaría. */
      preparar: () => Promise<{ llamar: (motivo: string) => Promise<Respuesta>; foto: () => Promise<unknown> }>;
    }

    const casos: Record<string, Caso> = {
      'POST /api/intervenciones/:id/costos': {
        preparar: async () => {
          const id = await enProceso();
          return {
            llamar: (motivo) =>
              pedir('POST', `/api/intervenciones/${id}/costos`, R.token, { tipo: 'AJUSTE', descripcion: 'Ajuste MO', importe: 10, motivo }),
            foto: () => fotoIntervencion(id),
          };
        },
      },
      'POST /api/intervenciones/:id/costos/lote': {
        preparar: async () => {
          const id = await enProceso();
          return {
            llamar: (motivo) =>
              pedir('POST', `/api/intervenciones/${id}/costos/lote`, R.token, {
                renglones: [{ tipo: 'AJUSTE', descripcion: 'Ajuste MO', importe: 10, motivo }],
              }),
            foto: () => fotoIntervencion(id),
          };
        },
      },
      'POST /api/intervenciones/:id/costos/:renglonId/anular': {
        preparar: async () => {
          const id = await enProceso();
          const d = await ok(
            pedir('POST', `/api/intervenciones/${id}/costos`, R.token, { tipo: 'OTRO', descripcion: 'Insumos MO', importe: 100 }),
            'costo'
          );
          return {
            llamar: (motivo) => pedir('POST', `/api/intervenciones/${id}/costos/${d.id}/anular`, R.token, { motivo }),
            foto: () => fotoIntervencion(id),
          };
        },
      },
      'POST /api/intervenciones/:id/repuestos (FINALIZADA)': {
        preparar: async () => {
          const id = await finalizada();
          return {
            llamar: (motivo) => pedir('POST', `/api/intervenciones/${id}/repuestos`, A.token, { repuesto_id: repId, cantidad: 1, motivo }),
            foto: () => fotoIntervencion(id),
          };
        },
      },
      'POST /api/intervenciones/:id/repuestos/:consumoId/anular': {
        preparar: async () => {
          const id = await enProceso();
          const d = await ok(pedir('POST', `/api/intervenciones/${id}/repuestos`, R.token, { repuesto_id: repId, cantidad: 1 }), 'consumo');
          return {
            llamar: (motivo) => pedir('POST', `/api/intervenciones/${id}/repuestos/${d.id}/anular`, R.token, { motivo }),
            foto: () => fotoIntervencion(id),
          };
        },
      },
      'POST /api/intervenciones/:id/pedidos/:pedidoId/cancelar': {
        preparar: async () => {
          const id = await enProceso();
          const d = await ok(pedir('POST', `/api/intervenciones/${id}/pedidos`, R.token, { descripcion: 'Rodamiento MO', cantidad: 1 }), 'pedido');
          return {
            llamar: (motivo) => pedir('POST', `/api/intervenciones/${id}/pedidos/${d.id}/cancelar`, R.token, { motivo }),
            foto: () => fotoIntervencion(id),
          };
        },
      },
      'PATCH /api/intervenciones/:id/tareas/:tareaId (FINALIZADA)': {
        preparar: async () => {
          const m = await crearMaquina();
          const p = await ok(
            pedir('POST', '/api/planes', A.token, {
              maquina_id: m,
              nombre: 'Plan MO',
              anticipacion_dias: 7,
              tareas: [{ accion: 'Tarea MO', frecuencia_valor: 1, frecuencia_unidad: 'MESES', primera_fecha: hoy }],
            }),
            'plan'
          );
          const g = await ok(pedir('POST', `/api/planes/${p.id}/generar`, A.token), 'generar');
          const id = Number(g.intervencion.id);
          await iniciar(id);
          await finalizar(id);
          return {
            llamar: (motivo) => pedir('PATCH', `/api/intervenciones/${id}/tareas/${g.tareas[0].id}`, A.token, { hecha: true, motivo }),
            foto: () => fotoIntervencion(id),
          };
        },
      },
      'POST /api/medidores/:id/lecturas/:lecturaId/anular': {
        preparar: async () => {
          const m = await crearMaquina();
          const med = await ok(pedir('POST', '/api/medidores', A.token, { maquina_id: m, nombre: 'Horómetro MO', unidad: 'horas' }), 'medidor');
          const lec = await ok(pedir('POST', `/api/medidores/${med.id}/lecturas`, A.token, { valor: 10 }), 'lectura');
          return {
            llamar: (motivo) => pedir('POST', `/api/medidores/${med.id}/lecturas/${lec.id}/anular`, A.token, { motivo }),
            foto: async () =>
              (await client.query(
                `SELECT (SELECT json_agg(row_to_json(x) ORDER BY x.id) FROM lecturas_medidor x WHERE x.medidor_id = $1) AS lecturas,
                        (SELECT row_to_json(x) FROM medidores x WHERE x.id = $1) AS medidor`,
                [med.id]
              )).rows[0],
          };
        },
      },
      'POST /api/maquinas/:id/estado': {
        preparar: async () => {
          const m = await crearMaquina();
          return {
            llamar: (motivo) => pedir('POST', `/api/maquinas/${m}/estado`, A.token, { accion: 'FUERA_DE_SERVICIO', motivo }),
            foto: async () =>
              (await client.query(
                `SELECT (SELECT row_to_json(x) FROM maquinas x WHERE x.id = $1) AS maquina,
                        (SELECT count(*)::int FROM historial_estados_maquina x WHERE x.maquina_id = $1) AS historial`,
                [m]
              )).rows[0],
          };
        },
      },
      'PUT /api/intervenciones/:id/responsable (reasignar)': {
        preparar: async () => {
          const id = await crearIntervencion();
          await asignar(id, R.id);
          return {
            llamar: (motivo) =>
              pedir('PUT', `/api/intervenciones/${id}/responsable`, A.token, { usuario_id: R2.id, estado_esperado: 'PENDIENTE', motivo }),
            foto: () => fotoIntervencion(id),
          };
        },
      },
      'DELETE /api/intervenciones/:id/responsable': {
        preparar: async () => {
          const id = await crearIntervencion();
          await asignar(id, R.id);
          return {
            llamar: (motivo) => pedir('DELETE', `/api/intervenciones/${id}/responsable`, A.token, { estado_esperado: 'PENDIENTE', motivo }),
            foto: () => fotoIntervencion(id),
          };
        },
      },
      'POST /api/intervenciones/:id/cancelar': {
        preparar: async () => {
          const id = await crearIntervencion();
          return {
            llamar: (motivo) => pedir('POST', `/api/intervenciones/${id}/cancelar`, A.token, { estado_esperado: 'PENDIENTE', motivo }),
            foto: () => fotoIntervencion(id),
          };
        },
      },
      'POST /api/intervenciones/:id/reabrir': {
        preparar: async () => {
          const id = await finalizada();
          return {
            llamar: (motivo) =>
              pedir('POST', `/api/intervenciones/${id}/reabrir`, A.token, { estado_esperado: 'FINALIZADA', motivo, maquina_detenida: false }),
            foto: () => fotoIntervencion(id),
          };
        },
      },
      'POST /api/intervenciones/:id/eliminar': {
        preparar: async () => {
          const id = await crearIntervencion();
          return {
            llamar: (motivo) => pedir('POST', `/api/intervenciones/${id}/eliminar`, A.token, { estado_esperado: 'PENDIENTE', motivo }),
            foto: () => fotoIntervencion(id),
          };
        },
      },
      'POST /api/usuarios/:id/desactivar': {
        preparar: async () => {
          const u = await crearUsuario('Op', 'OPERARIO');
          return {
            llamar: (motivo) => pedir('POST', `/api/usuarios/${u.id}/desactivar`, A.token, { motivo }),
            foto: () => fotoUsuario(u.id),
          };
        },
      },
      'POST /api/usuarios/:id/reactivar': {
        preparar: async () => {
          const u = await crearUsuario('Op', 'OPERARIO', false);
          return {
            llamar: (motivo) => pedir('POST', `/api/usuarios/${u.id}/reactivar`, A.token, { motivo }),
            foto: () => fotoUsuario(u.id),
          };
        },
      },
      'PUT /api/usuarios/:id/excepciones/:codigo': {
        preparar: async () => {
          const u = await crearUsuario('Op', 'OPERARIO');
          return {
            llamar: (motivo) =>
              pedir('PUT', `/api/usuarios/${u.id}/excepciones/INTERVENCIONES_VER`, A.token, { efecto: 'CONCEDER', alcance: 'SECTORES', motivo }),
            foto: () => fotoUsuario(u.id),
          };
        },
      },
      'DELETE /api/usuarios/:id/excepciones/:codigo': {
        preparar: async () => {
          const u = await crearUsuario('Op', 'OPERARIO');
          await client.query(
            `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
             VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Excepción previa MO', $3)`,
            [u.id, permMap['INTERVENCIONES_VER'], A.id]
          );
          return {
            llamar: (motivo) => pedir('DELETE', `/api/usuarios/${u.id}/excepciones/INTERVENCIONES_VER`, A.token, { motivo }),
            foto: () => fotoUsuario(u.id),
          };
        },
      },
    };

    // =========================================================================
    // MO-01: Cada ruta con motivo, con 501 caracteres
    // =========================================================================
    await t.test('MO-01: Cada ruta con 501 caracteres da 422 y no cambia nada', async () => {
      let n = 0;
      for (const [ruta, caso] of Object.entries(casos)) {
        n++;
        const { llamar, foto } = await caso.preparar();
        const motivo = motivoDe(`01-${n}`, 501);
        const antes = await foto();
        const r = await llamar(motivo);
        assert.deepStrictEqual(
          [r.status, r.cuerpo.codigo, r.cuerpo.error],
          [422, 'DATOS_INVALIDOS', 'El motivo no puede superar los 500 caracteres'],
          `${ruta}: ${JSON.stringify(r.cuerpo)}`
        );
        assert.deepStrictEqual(await foto(), antes, `${ruta}: no cambia nada`);
        assert.strictEqual(await guardado(motivo.slice(0, 500)), false, `${ruta}: el motivo no se guardó`);
      }
    });

    // =========================================================================
    // MO-02: La misma, con 500 caracteres
    // =========================================================================
    await t.test('MO-02: Cada ruta con 500 caracteres se acepta y se guarda entero', async () => {
      let n = 0;
      for (const [ruta, caso] of Object.entries(casos)) {
        n++;
        const { llamar } = await caso.preparar();
        const motivo = motivoDe(`02-${n}`, 500);
        const r = await llamar(motivo);
        assert.ok(r.status >= 200 && r.status < 300, `${ruta}: ${r.status} ${JSON.stringify(r.cuerpo)}`);
        assert.strictEqual(await guardado(motivo), true, `${ruta}: el motivo se guardó entero`);
      }
    });
  } finally {
    client = await clienteSano(client);
    // Limpieza: solo lo que creó esta prueba
    try {
      const maquinas = createdMaquinaIds;
      const intIds = maquinas.length > 0
        ? (await client.query('SELECT id FROM intervenciones WHERE maquina_id = ANY($1)', [maquinas])).rows.map((r) => Number(r.id))
        : [];
      if (intIds.length > 0) {
        await client.query('DELETE FROM intervencion_costos WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM pedidos_repuesto WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query(
          'DELETE FROM intervencion_tarea_repuestos WHERE intervencion_tarea_id IN (SELECT id FROM intervencion_tareas WHERE intervencion_id = ANY($1))',
          [intIds]
        );
        await client.query('DELETE FROM intervencion_repuestos WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM intervencion_tareas WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM movimientos_stock WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE intervencion_id = ANY($1))', [intIds]);
        await client.query('DELETE FROM notificaciones WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM intervencion_auditoria WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM documentos WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM intervencion_periodos_detencion WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM historial_estados_maquina WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM intervenciones WHERE id = ANY($1)', [intIds]);
      }
      if (createdRepuestoIds.length > 0) {
        await client.query('DELETE FROM intervencion_repuestos WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM movimientos_stock WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM repuesto_costos WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM repuestos WHERE id = ANY($1)', [createdRepuestoIds]);
      }
      if (maquinas.length > 0) {
        await client.query(
          'DELETE FROM lecturas_medidor WHERE medidor_id IN (SELECT id FROM medidores WHERE maquina_id = ANY($1))',
          [maquinas]
        );
        await client.query('DELETE FROM medidores WHERE maquina_id = ANY($1)', [maquinas]);
        await client.query(
          `DELETE FROM plan_tarea_repuestos WHERE plan_tarea_id IN (
             SELECT t.id FROM plan_tareas t JOIN planes_mantenimiento p ON p.id = t.plan_id WHERE p.maquina_id = ANY($1)
           )`,
          [maquinas]
        );
        await client.query(
          'DELETE FROM plan_tareas WHERE plan_id IN (SELECT id FROM planes_mantenimiento WHERE maquina_id = ANY($1))',
          [maquinas]
        );
        await client.query('DELETE FROM planes_mantenimiento WHERE maquina_id = ANY($1)', [maquinas]);
        await client.query('DELETE FROM intervencion_periodos_detencion WHERE maquina_id = ANY($1)', [maquinas]);
        await client.query('DELETE FROM historial_estados_maquina WHERE maquina_id = ANY($1)', [maquinas]);
        await client.query('DELETE FROM maquinas WHERE id = ANY($1)', [maquinas]);
      }
      if (createdUsuarioIds.length > 0) {
        await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE usuario_id = ANY($1))', [createdUsuarioIds]);
        await client.query('DELETE FROM notificaciones WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM usuario_sector WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query(
          'DELETE FROM auditoria_permisos WHERE sobre_usuario_id = ANY($1) OR realizado_por_usuario_id = ANY($1)',
          [createdUsuarioIds]
        );
        await client.query('DELETE FROM usuario_permiso WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [createdUsuarioIds]);
      }
      if (createdSectorIds.length > 0) {
        await client.query('DELETE FROM sectores WHERE id = ANY($1)', [createdSectorIds]);
      }
      if (createdPlantaIds.length > 0) {
        await client.query('DELETE FROM plantas WHERE id = ANY($1)', [createdPlantaIds]);
      }
    } finally {
      client.release();
    }
  }
});

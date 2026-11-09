import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { pool } from '../functions/db.ts';
import app from '../functions/api.ts';
import { JWT_SECRET } from '../functions/config.ts';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (IDS TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

/** Un id de 20 dígitos: no entra en bigint ni es un entero seguro. */
const GRANDE = '12345678901234567890';
/** En el cuerpo: 1e20, un entero que no es seguro. */
const GRANDE_CUERPO = 1e20;

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
  cuerpo: unknown;
}

async function pedir(method: string, path: string, token: string, body?: unknown): Promise<Respuesta> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await app.request(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const texto = await r.text();
  let cuerpo: unknown = texto;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    // no es JSON: se compara el texto
  }
  return { status: r.status, cuerpo };
}

/** Pide con 0 y con el id grande, y exige la misma respuesta y nunca 500. */
async function mismaRespuesta(
  descripcion: string,
  hacer: (valor: string) => Promise<Respuesta>
): Promise<Respuesta> {
  const conCero = await hacer('0');
  const conGrande = await hacer(GRANDE);
  assert.notStrictEqual(conGrande.status, 500, `${descripcion}: 500 con el id grande: ${JSON.stringify(conGrande.cuerpo)}`);
  assert.notStrictEqual(conCero.status, 500, `${descripcion}: 500 con 0: ${JSON.stringify(conCero.cuerpo)}`);
  assert.deepStrictEqual(conGrande, conCero, `${descripcion}: la respuesta con el id grande no es la de 0`);
  return conGrande;
}

/** Formas raras de escribir un id que existe, como texto: para la ruta y la consulta. */
const formasTexto = (id: number): string[] => [`+${id}`, `${id}.0`, ` ${id}`, `0x${id.toString(16)}`, 'true', `[${id}]`];
/** En el cuerpo: las mismas, con true y [id] como valores JSON. */
const formasCuerpo = (id: number): unknown[] => [`+${id}`, `${id}.0`, ` ${id}`, `0x${id.toString(16)}`, true, [id]];

interface Esperado {
  status: number;
  codigo: string;
  error: string;
}

/** Con 0 da el error esperado; con cada forma rara, exactamente lo mismo. */
async function igualQueCero(
  descripcion: string,
  esperado: Esperado,
  cero: unknown,
  formas: unknown[],
  hacer: (valor: any) => Promise<Respuesta>
) {
  const conCero = await hacer(cero);
  assert.strictEqual(conCero.status, esperado.status, `${descripcion} con 0: ${JSON.stringify(conCero.cuerpo)}`);
  assert.strictEqual((conCero.cuerpo as any).codigo, esperado.codigo, `${descripcion} con 0`);
  assert.strictEqual((conCero.cuerpo as any).error, esperado.error, `${descripcion} con 0`);
  for (const forma of formas) {
    const r = await hacer(forma);
    assert.deepStrictEqual(r, conCero, `${descripcion} con ${JSON.stringify(forma)}: ${r.status} ${JSON.stringify(r.cuerpo)}`);
  }
}

test('Ids fuera de rango (ID-01 a ID-05)', async (t) => {
  const client = await pool.connect();

  const createdPlantaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdUsuarioIds: number[] = [];
  const createdProveedorIds: number[] = [];
  const createdRepuestoIds: number[] = [];
  const createdIntervencionIds: number[] = [];
  const suf = Date.now();

  try {
    const passHash = await bcrypt.hash('pass123', 10);
    const perfilMap: Record<string, number> = {};
    for (const r of (await client.query('SELECT id, nombre FROM perfiles')).rows) {
      perfilMap[r.nombre] = Number(r.id);
    }

    // Planta, sector y máquina
    const plId = Number((await client.query(
      'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`ID_PL_${suf}`]
    )).rows[0].id);
    createdPlantaIds.push(plId);
    const sId = Number((await client.query(
      'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`ID_S_${suf}`, plId]
    )).rows[0].id);
    createdSectorIds.push(sId);
    const mId = Number((await client.query(
      'INSERT INTO maquinas (codigo, nombre, sector_id, activo) VALUES ($1, $2, $3, TRUE) RETURNING id',
      [`ID_M_${suf}`, `Maquina ID ${suf}`, sId]
    )).rows[0].id);
    createdMaquinaIds.push(mId);

    // Usuarios: A administrador, R responsable del sector, O operario del sector
    async function crearUsuario(clave: string, nombre: string, perfil: string) {
      const res = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
         VALUES ($1, $2, 'ID', $3, $4, TRUE, 1) RETURNING id, legajo, sesion_version`,
        [`ID_${clave}_${suf}`, nombre, passHash, perfilMap[perfil]]
      );
      const u = res.rows[0];
      const id = Number(u.id);
      createdUsuarioIds.push(id);
      return { id, token: await getTokenForUser({ id, legajo: u.legajo, sesion_version: Number(u.sesion_version) }) };
    }
    const A = await crearUsuario('A', 'Admin', 'ADMINISTRADOR');
    const R = await crearUsuario('R', 'Resp', 'RESPONSABLE_MANTENIMIENTO');
    const O = await crearUsuario('O', 'Operario', 'OPERARIO');
    for (const u of [R, O]) {
      await client.query('INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)', [u.id, sId]);
    }

    // Proveedor y repuesto
    const rProv = await pedir('POST', '/api/proveedores', R.token, { nombre: `ID Proveedor ${suf}` });
    assert.strictEqual(rProv.status, 201, JSON.stringify(rProv.cuerpo));
    const provId = Number((rProv.cuerpo as any).id);
    createdProveedorIds.push(provId);

    const rRep = await pedir('POST', '/api/repuestos', R.token, {
      codigo: `ID_R1_${suf}`,
      nombre: `ID Repuesto ${suf}`,
      lleva_stock: true,
      stock_inicial: 10,
      costo_unitario: 100,
    });
    assert.strictEqual(rRep.status, 201, JSON.stringify(rRep.cuerpo));
    const repId = Number((rRep.cuerpo as any).id);
    createdRepuestoIds.push(repId);

    // Intervención en proceso: la reporta O y la inicia R
    const rInt = await pedir('POST', '/api/intervenciones', O.token, { maquina_id: mId, descripcion: 'Falla prueba ID' });
    assert.strictEqual(rInt.status, 201, JSON.stringify(rInt.cuerpo));
    const intId = Number((rInt.cuerpo as any).id);
    createdIntervencionIds.push(intId);
    const rIni = await pedir('POST', `/api/intervenciones/${intId}/iniciar`, R.token, { estado_esperado: 'PENDIENTE' });
    assert.strictEqual(rIni.status, 200, JSON.stringify(rIni.cuerpo));

    const otro = { tipo: 'OTRO', descripcion: 'Insumos varios', importe: 100 };

    // =========================================================================
    // ID-01: En la ruta
    // =========================================================================
    await t.test('ID-01: En la ruta', async () => {
      // [método, ruta con X en lugar del id, cuerpo]
      const rutas: Array<[string, string, unknown?]> = [
        // Las de la sección 1
        ['GET', '/api/maquinas/X'],
        ['GET', '/api/intervenciones/X'],
        ['GET', '/api/intervenciones/X/costos'],
        ['GET', '/api/intervenciones/X/repuestos'],
        ['GET', '/api/usuarios/X'],
        ['GET', '/api/repuestos/X'],
        ['GET', '/api/sectores/X'],
        ['POST', '/api/intervenciones/X/costos', otro],
        ['POST', '/api/intervenciones/X/costos/lote', { renglones: [otro] }],
        // Sectores
        ['PUT', '/api/sectores/X', { nombre: 'Sector ID' }],
        ['DELETE', '/api/sectores/X'],
        // Máquinas
        ['PUT', '/api/maquinas/X', { nombre: 'Maquina ID' }],
        ['DELETE', '/api/maquinas/X'],
        ['GET', '/api/maquinas/X/detenciones-abiertas'],
        ['POST', '/api/maquinas/X/confirmar-recuperacion', {}],
        ['POST', '/api/maquinas/X/estado', {}],
        ['GET', '/api/maquinas/X/inactividad'],
        // Intervenciones
        ['GET', '/api/intervenciones/X/responsables-habilitados'],
        ['POST', '/api/intervenciones/X/tomar', {}],
        ['PUT', '/api/intervenciones/X/responsable', { usuario_id: R.id }],
        ['DELETE', '/api/intervenciones/X/responsable'],
        ['POST', '/api/intervenciones/X/iniciar', { estado_esperado: 'PENDIENTE' }],
        ['POST', '/api/intervenciones/X/espera-repuestos', {}],
        ['POST', '/api/intervenciones/X/reanudar', {}],
        ['POST', '/api/intervenciones/X/finalizar', {}],
        ['POST', '/api/intervenciones/X/resolver-ahora', {}],
        ['POST', '/api/intervenciones/X/cancelar', {}],
        ['POST', '/api/intervenciones/X/registrar-detencion', {}],
        ['POST', '/api/intervenciones/X/reabrir', {}],
        ['POST', '/api/intervenciones/X/eliminar', {}],
        ['PATCH', '/api/intervenciones/X', {}],
        // Costos y repuestos de la intervención, con el segundo id de la ruta
        ['POST', `/api/intervenciones/${intId}/costos/X/anular`, { motivo: 'Prueba de ids' }],
        ['POST', '/api/intervenciones/X/costos/1/anular', { motivo: 'Prueba de ids' }],
        ['POST', '/api/intervenciones/X/repuestos', { repuesto_id: repId, cantidad: 1 }],
        ['POST', `/api/intervenciones/${intId}/repuestos/X/anular`, { motivo: 'Prueba de ids' }],
        ['GET', '/api/intervenciones/X/pedidos'],
        ['POST', '/api/intervenciones/X/pedidos', {}],
        ['PATCH', `/api/intervenciones/${intId}/pedidos/X`, {}],
        ['POST', `/api/intervenciones/${intId}/pedidos/X/recibir`, {}],
        ['POST', `/api/intervenciones/${intId}/pedidos/X/cancelar`, {}],
        // Notificaciones
        ['POST', '/api/notificaciones/X/leer', {}],
        // Usuarios
        ['GET', '/api/usuarios/X/auditoria'],
        ['PATCH', '/api/usuarios/X', {}],
        ['POST', '/api/usuarios/X/desactivar', {}],
        ['POST', '/api/usuarios/X/reactivar', {}],
        ['POST', '/api/usuarios/X/restablecer-password', {}],
        ['PUT', '/api/usuarios/X/excepciones/COSTOS_VER', {}],
        ['DELETE', '/api/usuarios/X/excepciones/COSTOS_VER'],
        // Catálogos
        ['PUT', '/api/criticidades/X', { nombre: 'Criticidad ID' }],
        ['DELETE', '/api/criticidades/X'],
        ['PUT', '/api/tipos-equipo/X', { nombre: 'Tipo ID' }],
        ['DELETE', '/api/tipos-equipo/X'],
        ['PUT', '/api/plantas/X', { nombre: 'Planta ID' }],
        ['DELETE', '/api/plantas/X'],
        // Proveedores
        ['PUT', '/api/proveedores/X', { nombre: 'Proveedor ID' }],
        ['DELETE', '/api/proveedores/X'],
        // Repuestos
        ['PUT', '/api/repuestos/X', {}],
        ['DELETE', '/api/repuestos/X'],
        ['GET', '/api/repuestos/X/movimientos'],
        ['POST', '/api/repuestos/X/movimientos', {}],
        ['GET', '/api/repuestos/X/usos'],
        ['GET', '/api/repuestos/X/costos'],
      ];

      for (const [metodo, ruta, cuerpo] of rutas) {
        await mismaRespuesta(`${metodo} ${ruta}`, (valor) => pedir(metodo, ruta.replace('X', valor), A.token, cuerpo));
      }

      // Nada cambió en la intervención de la prueba
      const resI = await client.query('SELECT estado FROM intervenciones WHERE id = $1', [intId]);
      assert.strictEqual(resI.rows[0].estado, 'EN_PROCESO');
    });

    // =========================================================================
    // ID-02: En la consulta
    // =========================================================================
    await t.test('ID-02: En la consulta', async () => {
      await mismaRespuesta('GET /api/intervenciones?maquina_id=', (valor) =>
        pedir('GET', `/api/intervenciones?maquina_id=${valor}`, A.token)
      );
      await mismaRespuesta('GET /api/tablero?planta_id=', (valor) =>
        pedir('GET', `/api/tablero?planta_id=${valor}`, A.token)
      );
    });

    // =========================================================================
    // ID-03: En el cuerpo, con 1e20
    // =========================================================================
    await t.test('ID-03: En el cuerpo, con 1e20', async () => {
      const contar = async () => {
        const r = await client.query(
          `SELECT
             (SELECT count(*)::int FROM intervencion_costos WHERE intervencion_id = $1) AS renglones,
             (SELECT count(*)::int FROM intervencion_repuestos WHERE intervencion_id = $1) AS consumos,
             (SELECT count(*)::int FROM repuestos WHERE codigo LIKE $2) AS repuestos,
             (SELECT proveedor_id FROM repuestos WHERE id = $3) AS proveedor_del_repuesto,
             (SELECT count(*)::int FROM intervenciones WHERE maquina_id = $4) AS intervenciones,
             (SELECT costo_total_estimado FROM intervenciones WHERE id = $1) AS total`,
          [intId, `ID\\_%\\_${suf}`, repId, mId]
        );
        return r.rows[0];
      };
      const antes = await contar();
      assert.strictEqual(antes.repuestos, 1);
      assert.strictEqual(antes.intervenciones, 1);

      /** Con 0 y con 1e20 en el campo: la misma respuesta, el código esperado y nunca 500. */
      const enCuerpo = async (
        descripcion: string,
        esperado: { status: number; codigo: string; indice?: number },
        hacer: (valor: number) => Promise<Respuesta>
      ) => {
        const conCero = await hacer(0);
        const conGrande = await hacer(GRANDE_CUERPO);
        assert.strictEqual(conGrande.status, esperado.status, `${descripcion}: ${JSON.stringify(conGrande.cuerpo)}`);
        assert.strictEqual((conGrande.cuerpo as any).codigo, esperado.codigo, `${descripcion}: ${JSON.stringify(conGrande.cuerpo)}`);
        if (esperado.indice !== undefined) {
          assert.strictEqual((conGrande.cuerpo as any).indice, esperado.indice, descripcion);
        }
        assert.deepStrictEqual(conGrande, conCero, `${descripcion}: la respuesta con 1e20 no es la de 0`);
      };

      const costo = (body: unknown) => pedir('POST', `/api/intervenciones/${intId}/costos`, R.token, body);
      const lote = (body: unknown) => pedir('POST', `/api/intervenciones/${intId}/costos/lote`, R.token, body);
      const invalido = { status: 422, codigo: 'DATOS_INVALIDOS' };

      // Costos: usuario_id y proveedor_id, en el POST de uno
      await enCuerpo('costo usuario_id', invalido, (v) =>
        costo({ tipo: 'MANO_OBRA', usuario_id: v, horas: 1, importe: 100 })
      );
      await enCuerpo('costo proveedor_id', invalido, (v) => costo({ ...otro, proveedor_id: v }));

      // Y en el lote, con indice
      await enCuerpo('lote usuario_id', { ...invalido, indice: 1 }, (v) =>
        lote({ renglones: [otro, { tipo: 'MANO_OBRA', usuario_id: v, horas: 1, importe: 100 }] })
      );
      await enCuerpo('lote proveedor_id', { ...invalido, indice: 0 }, (v) =>
        lote({ renglones: [{ ...otro, proveedor_id: v }, otro] })
      );

      // repuesto_id del consumo
      await enCuerpo('consumo repuesto_id', invalido, (v) =>
        pedir('POST', `/api/intervenciones/${intId}/repuestos`, R.token, { repuesto_id: v, cantidad: 1 })
      );

      // proveedor_id de un repuesto, al crearlo y al modificarlo
      const proveedorInvalido = { status: 422, codigo: 'PROVEEDOR_INVALIDO' };
      await enCuerpo('repuesto nuevo proveedor_id', proveedorInvalido, (v) =>
        pedir('POST', '/api/repuestos', R.token, {
          codigo: `ID_R2_${suf}`,
          nombre: `ID Repuesto 2 ${suf}`,
          lleva_stock: false,
          costo_unitario: 10,
          proveedor_id: v,
        })
      );
      await enCuerpo('repuesto modificado proveedor_id', proveedorInvalido, (v) =>
        pedir('PUT', `/api/repuestos/${repId}`, R.token, { proveedor_id: v })
      );

      // maquina_id al reportar una falla
      await enCuerpo('falla maquina_id', { status: 400, codigo: 'DATOS_INVALIDOS' }, (v) =>
        pedir('POST', '/api/intervenciones', O.token, { maquina_id: v, descripcion: 'Falla prueba ID' })
      );

      // No se guardó nada
      assert.deepStrictEqual(await contar(), antes);
    });

    // =========================================================================
    // ID-04: Formatos raros con el id de algo que existe
    // =========================================================================
    await t.test('ID-04: Formatos raros con el id de algo que existe', async () => {
      const enc = (v: string) => encodeURIComponent(v);

      // Una notificación de A, sin leer
      const notifId = Number((await client.query(
        `INSERT INTO notificaciones (usuario_id, tipo_evento, prioridad, titulo, mensaje, generada_por_usuario_id)
         VALUES ($1, 'INTERVENCION_ASIGNADA', 'NORMAL', 'Notificacion prueba ID', 'Texto', $2) RETURNING id`,
        [A.id, O.id]
      )).rows[0].id);

      // Un período de detención abierto en la intervención de la prueba
      const rDet = await pedir('POST', `/api/intervenciones/${intId}/registrar-detencion`, R.token, {
        estado_esperado: 'EN_PROCESO',
        observacion: 'Detencion prueba ID',
      });
      assert.strictEqual(rDet.status, 200, JSON.stringify(rDet.cuerpo));
      const periodoId = Number((await client.query(
        'SELECT id FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL', [intId]
      )).rows[0].id);

      const ordenCriticidades = async () =>
        (await client.query('SELECT id, orden FROM criticidades ORDER BY orden, id')).rows.map((r) => ({
          id: Number(r.id),
          orden: Number(r.orden),
        }));

      const estado = async () => {
        const r = await client.query(
          `SELECT
             (SELECT leida_en FROM notificaciones WHERE id = $1) AS notificacion_leida,
             (SELECT count(*)::int FROM intervenciones WHERE maquina_id = $2) AS intervenciones,
             (SELECT count(*)::int FROM sectores WHERE nombre = $3) AS sectores,
             (SELECT responsable_usuario_id FROM intervenciones WHERE id = $4) AS responsable,
             (SELECT count(*)::int FROM usuarios WHERE legajo = $5) AS usuarios,
             (SELECT hasta FROM intervencion_periodos_detencion WHERE id = $6) AS periodo_hasta`,
          [notifId, mId, `ID_S2_${suf}`, intId, `ID_N_${suf}`, periodoId]
        );
        return { ...r.rows[0], criticidades: await ordenCriticidades() };
      };
      const antes = await estado();
      assert.strictEqual(antes.notificacion_leida, null);
      assert.strictEqual(antes.periodo_hasta, null);
      assert.ok(antes.criticidades.length > 0);

      // En la ruta
      await igualQueCero('GET /api/maquinas/X', { status: 400, codigo: 'DATOS_INVALIDOS', error: 'ID inválido' },
        '0', formasTexto(mId), (v: string) => pedir('GET', `/api/maquinas/${enc(v)}`, A.token));
      await igualQueCero('POST /api/notificaciones/X/leer',
        { status: 422, codigo: 'DATOS_INVALIDOS', error: 'Identificador de notificación inválido' },
        '0', formasTexto(notifId), (v: string) => pedir('POST', `/api/notificaciones/${enc(v)}/leer`, A.token, {}));

      // En la consulta
      await igualQueCero('GET /api/intervenciones?maquina_id=',
        { status: 422, codigo: 'DATOS_INVALIDOS', error: 'El parámetro maquina_id debe ser un número entero positivo' },
        '0', formasTexto(mId), (v: string) => pedir('GET', `/api/intervenciones?maquina_id=${enc(v)}`, A.token));

      // En el cuerpo: maquina_id al reportar una falla
      await igualQueCero('falla maquina_id',
        { status: 400, codigo: 'DATOS_INVALIDOS', error: 'El ID de la máquina es obligatorio y debe ser un número entero positivo' },
        0, formasCuerpo(mId),
        (v) => pedir('POST', '/api/intervenciones', O.token, { maquina_id: v, descripcion: 'Falla prueba ID' }));

      // planta_id de un sector nuevo
      await igualQueCero('sector nuevo planta_id',
        { status: 400, codigo: 'DATOS_INVALIDOS', error: 'La planta indicada no existe o está inactiva' },
        0, formasCuerpo(plId),
        (v) => pedir('POST', '/api/sectores', A.token, { nombre: `ID_S2_${suf}`, planta_id: v }));

      // usuario_id del responsable
      await igualQueCero('responsable usuario_id',
        { status: 400, codigo: 'DATOS_INVALIDOS', error: 'El usuario_id a asignar es requerido y debe ser un número entero' },
        0, formasCuerpo(R.id),
        (v) => pedir('PUT', `/api/intervenciones/${intId}/responsable`, A.token, { usuario_id: v, estado_esperado: 'EN_PROCESO' }));

      // perfil_id y sectores de un usuario nuevo
      const usuarioNuevo = (cambios: Record<string, unknown>) =>
        pedir('POST', '/api/usuarios', A.token, {
          legajo: `ID_N_${suf}`,
          nombre: 'Nuevo',
          apellido: 'ID',
          perfil_id: perfilMap['OPERARIO'],
          sectores: [sId],
          password_temporal: 'Temporal123',
          ...cambios,
        });
      await igualQueCero('usuario nuevo perfil_id',
        { status: 422, codigo: 'DATOS_INVALIDOS', error: 'El perfil_id es obligatorio y debe ser válido' },
        0, formasCuerpo(perfilMap['OPERARIO']), (v) => usuarioNuevo({ perfil_id: v }));
      await igualQueCero('usuario nuevo sectores',
        { status: 422, codigo: 'DATOS_INVALIDOS', error: 'Uno o más identificadores de sector son inválidos' },
        0, formasCuerpo(sId), (v) => usuarioNuevo({ sectores: [v] }));

      // periodo_ids
      await igualQueCero('confirmar recuperación periodo_ids',
        { status: 422, codigo: 'DATOS_INVALIDOS', error: 'La lista de periodo_ids contiene valores inválidos o repetidos' },
        0, formasCuerpo(periodoId),
        (v) => pedir('POST', `/api/maquinas/${mId}/confirmar-recuperacion`, A.token, { periodo_ids: [v] }));

      // Los ids del orden de un catálogo: el primero, escrito de otra forma
      const ids = antes.criticidades.map((c: { id: number }) => c.id);
      await igualQueCero('orden de criticidades',
        { status: 400, codigo: 'DATOS_INVALIDOS', error: 'Cada ID debe ser un entero positivo' },
        0, formasCuerpo(ids[0]),
        (v) => pedir('PUT', '/api/criticidades/orden', A.token, { ids: [v, ...ids.slice(1)] }));

      // No se guardó nada
      assert.deepStrictEqual(await estado(), antes);
    });

    // =========================================================================
    // ID-05: Límites y desplazamientos
    // =========================================================================
    await t.test('ID-05: Límites y desplazamientos', async () => {
      /** Cada valor da la respuesta de dato inválido del listado, la misma que la referencia, y nunca 500. */
      const invalidos = async (
        descripcion: string,
        esperado: { status: number; codigo: string },
        referencia: string,
        valores: string[],
        ruta: (valor: string) => string
      ) => {
        const conReferencia = await pedir('GET', ruta(referencia), A.token);
        assert.strictEqual(conReferencia.status, esperado.status, `${descripcion}=${referencia}: ${JSON.stringify(conReferencia.cuerpo)}`);
        assert.strictEqual((conReferencia.cuerpo as any).codigo, esperado.codigo, `${descripcion}=${referencia}`);
        for (const valor of valores) {
          const r = await pedir('GET', ruta(valor), A.token);
          assert.notStrictEqual(r.status, 500, `${descripcion}=${valor}: 500: ${JSON.stringify(r.cuerpo)}`);
          assert.deepStrictEqual(r, conReferencia, `${descripcion}=${valor}: ${r.status} ${JSON.stringify(r.cuerpo)}`);
        }
      };

      await invalidos('GET /api/configuracion/avisos/envios?offset', { status: 400, codigo: 'DATOS_INVALIDOS' },
        '-1', ['1e20', GRANDE], (v) => `/api/configuracion/avisos/envios?offset=${v}`);
      await invalidos('GET /api/usuarios/:id/auditoria?offset', { status: 400, codigo: 'DATOS_INVALIDOS' },
        '-1', [GRANDE, '1e20'], (v) => `/api/usuarios/${A.id}/auditoria?offset=${v}`);
      await invalidos('GET /api/repuestos/:id/movimientos?limite', { status: 422, codigo: 'DATOS_INVALIDOS' },
        '0', ['1.5', '0.0001', 'abc', GRANDE], (v) => `/api/repuestos/${repId}/movimientos?limite=${v}`);
      await invalidos('GET /api/intervenciones?offset', { status: 422, codigo: 'DATOS_INVALIDOS' },
        '-1', ['1e20', GRANDE], (v) => `/api/intervenciones?offset=${v}`);

      // Los movimientos siguen andando sin limite y con más de 500
      for (const sufijo of ['', '?limite=1', '?limite=501']) {
        const r = await pedir('GET', `/api/repuestos/${repId}/movimientos${sufijo}`, A.token);
        assert.strictEqual(r.status, 200, `movimientos${sufijo}: ${JSON.stringify(r.cuerpo)}`);
      }
    });
  } finally {
    // Limpieza: solo lo que creó esta prueba
    try {
      if (createdIntervencionIds.length > 0) {
        await client.query('DELETE FROM intervencion_costos WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM pedidos_repuesto WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervencion_repuestos WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
      }
      // Un repuesto que no debía crearse, si se hubiera creado
      const resExtra = await client.query('SELECT id FROM repuestos WHERE codigo = $1', [`ID_R2_${suf}`]);
      for (const r of resExtra.rows) createdRepuestoIds.push(Number(r.id));
      if (createdRepuestoIds.length > 0) {
        await client.query('DELETE FROM intervencion_repuestos WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM movimientos_stock WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM repuesto_costos WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM repuestos WHERE id = ANY($1)', [createdRepuestoIds]);
      }
      if (createdProveedorIds.length > 0) {
        await client.query('DELETE FROM proveedores WHERE id = ANY($1)', [createdProveedorIds]);
      }
      // Intervenciones que no debían crearse, si se hubieran creado
      if (createdMaquinaIds.length > 0) {
        const resInt = await client.query('SELECT id FROM intervenciones WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
        for (const r of resInt.rows) {
          if (!createdIntervencionIds.includes(Number(r.id))) createdIntervencionIds.push(Number(r.id));
        }
      }
      if (createdIntervencionIds.length > 0) {
        await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE intervencion_id = ANY($1))', [createdIntervencionIds]);
        await client.query('DELETE FROM notificaciones WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervencion_auditoria WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM documentos WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM movimientos_stock WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervencion_periodos_detencion WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM historial_estados_maquina WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervenciones WHERE id = ANY($1)', [createdIntervencionIds]);
      }
      if (createdMaquinaIds.length > 0) {
        await client.query('DELETE FROM intervencion_periodos_detencion WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
        await client.query('DELETE FROM historial_estados_maquina WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
        await client.query('DELETE FROM maquinas WHERE id = ANY($1)', [createdMaquinaIds]);
      }
      // Un usuario y un sector que no debían crearse, si se hubieran creado
      const resUsrExtra = await client.query('SELECT id FROM usuarios WHERE legajo = $1', [`ID_N_${suf}`]);
      for (const r of resUsrExtra.rows) createdUsuarioIds.push(Number(r.id));
      const resSecExtra = await client.query('SELECT id FROM sectores WHERE nombre = $1', [`ID_S2_${suf}`]);
      for (const r of resSecExtra.rows) createdSectorIds.push(Number(r.id));
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

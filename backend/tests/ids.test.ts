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

test('Ids fuera de rango (ID-01 a ID-03)', async (t) => {
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

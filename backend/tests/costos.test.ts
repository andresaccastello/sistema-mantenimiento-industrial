import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { pool } from '../functions/db.ts';
import app from '../functions/api.ts';
import { JWT_SECRET } from '../functions/config.ts';
import { mismaForma } from './contrato.ts';
import {
  costosIntervencionEjemplo,
  renglonCreadoEjemplo,
  personasCostosEjemplo,
  reporteCostosEjemplo,
} from '../../frontend/src/api/contrato-costos.ts';

// Timeout de bloqueo para las pruebas de concurrencia
process.env.LOCK_TIMEOUT = '3s';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (COSTOS TESTS)');
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

async function getJson(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, { method: 'GET', headers });
}

async function postJson(path: string, body?: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

test('Etapa C1 — Costos de la intervención y reporte de costos (CO-01 a CO-15)', async (t) => {
  const client = await pool.connect();

  const createdPlantaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdUsuarioIds: number[] = [];
  const createdProveedorIds: number[] = [];
  const createdRepuestoIds: number[] = [];
  const createdIntervencionIds: number[] = [];

  try {
    const suf = Date.now();
    const passHash = await bcrypt.hash('pass123', 10);

    // 1. Perfiles y permisos
    const perfilMap: Record<string, number> = {};
    for (const r of (await client.query('SELECT id, nombre FROM perfiles')).rows) {
      perfilMap[r.nombre] = Number(r.id);
    }
    const permMap: Record<string, number> = {};
    for (const r of (await client.query('SELECT id, codigo FROM permisos')).rows) {
      permMap[r.codigo] = Number(r.id);
    }

    // 2. Plantas y sectores (PL1 con S1, PL2 con S2), y máquinas M1 en S1 y M2 en S2
    const pl1Id = Number((await client.query(
      'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`CO_PL1_${suf}`]
    )).rows[0].id);
    createdPlantaIds.push(pl1Id);
    const s1Id = Number((await client.query(
      'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`CO_S1_${suf}`, pl1Id]
    )).rows[0].id);
    createdSectorIds.push(s1Id);
    const pl2Id = Number((await client.query(
      'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`CO_PL2_${suf}`]
    )).rows[0].id);
    createdPlantaIds.push(pl2Id);
    const s2Id = Number((await client.query(
      'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`CO_S2_${suf}`, pl2Id]
    )).rows[0].id);
    createdSectorIds.push(s2Id);

    const m1Id = Number((await client.query(
      'INSERT INTO maquinas (codigo, nombre, sector_id, activo) VALUES ($1, $2, $3, TRUE) RETURNING id',
      [`CO_M1_${suf}`, `Maquina CO 1 ${suf}`, s1Id]
    )).rows[0].id);
    createdMaquinaIds.push(m1Id);
    const m2Id = Number((await client.query(
      'INSERT INTO maquinas (codigo, nombre, sector_id, activo) VALUES ($1, $2, $3, TRUE) RETURNING id',
      [`CO_M2_${suf}`, `Maquina CO 2 ${suf}`, s2Id]
    )).rows[0].id);
    createdMaquinaIds.push(m2Id);

    // 3. Usuarios
    async function crearUsuario(clave: string, nombre: string, perfil: string, activo = true) {
      const res = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
         VALUES ($1, $2, 'CO', $3, $4, $5, 1) RETURNING id, legajo, sesion_version`,
        [`CO_${clave}_${suf}`, nombre, passHash, perfilMap[perfil], activo]
      );
      const u = res.rows[0];
      const id = Number(u.id);
      createdUsuarioIds.push(id);
      return { id, user: { id, legajo: u.legajo, sesion_version: Number(u.sesion_version) } };
    }
    async function asignarSectores(usuarioId: number, sectores: number[]) {
      for (const s of sectores) {
        await client.query('INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)', [usuarioId, s]);
      }
    }

    // R: RESPONSABLE_MANTENIMIENTO (COSTOS_REGISTRAR y COSTOS_VER, sin INTERVENCIONES_CORREGIR)
    const R = await crearUsuario('R', 'Resp', 'RESPONSABLE_MANTENIMIENTO');
    await asignarSectores(R.id, [s1Id, s2Id]);
    const tokenR = await getTokenForUser(R.user);

    // A: ADMINISTRADOR
    const A = await crearUsuario('A', 'Admin', 'ADMINISTRADOR');
    const tokenA = await getTokenForUser(A.user);

    // T: como R, con DENEGAR de COSTOS_VER y COSTOS_REGISTRAR
    const T = await crearUsuario('T', 'Tecnico', 'RESPONSABLE_MANTENIMIENTO');
    await asignarSectores(T.id, [s1Id, s2Id]);
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'DENEGAR', 'Sin costos', $3), ($1, $4, 'DENEGAR', 'Sin costos', $3)`,
      [T.id, permMap['COSTOS_VER'], A.id, permMap['COSTOS_REGISTRAR']]
    );
    const tokenT = await getTokenForUser(T.user);

    // O: OPERARIO que crea las intervenciones
    const O = await crearUsuario('O', 'Operario', 'OPERARIO');
    await asignarSectores(O.id, [s1Id, s2Id]);
    const tokenO = await getTokenForUser(O.user);

    // O2: OPERARIO que no ve ninguna
    const O2 = await crearUsuario('O2', 'OperarioDos', 'OPERARIO');
    const tokenO2 = await getTokenForUser(O2.user);

    // X: OPERARIO con CONCEDER de REPORTES_CONSULTAR en alcance SECTORES (solo S2) y de COSTOS_VER
    const X = await crearUsuario('X', 'OperarioX', 'OPERARIO');
    await asignarSectores(X.id, [s2Id]);
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Reportes para X', $3),
              ($1, $4, 'CONCEDER', 'TODAS', 'Costos para X', $3)`,
      [X.id, permMap['REPORTES_CONSULTAR'], A.id, permMap['COSTOS_VER']]
    );
    const tokenX = await getTokenForUser(X.user);

    // CR: OPERARIO con solo COSTOS_REGISTRAR, para /api/proveedores/opciones (CO-13)
    const CR = await crearUsuario('CR', 'Cargador', 'OPERARIO');
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'CONCEDER', 'Carga de costos', $3)`,
      [CR.id, permMap['COSTOS_REGISTRAR'], A.id]
    );
    const tokenCR = await getTokenForUser(CR.user);

    // P: la persona de la mano de obra. Pi: inactiva, para los errores.
    const P = await crearUsuario('P', 'Persona', 'OPERARIO');
    const Pi = await crearUsuario('Pi', 'PersonaInactiva', 'OPERARIO', false);

    // 4. Proveedor y repuesto (costo 100, con stock)
    const resProv = await postJson('/api/proveedores', { nombre: `CO Proveedor ${suf}` }, tokenR);
    assert.strictEqual(resProv.status, 201);
    const provId = Number((await resProv.json()).id);
    createdProveedorIds.push(provId);

    const resRep = await postJson(
      '/api/repuestos',
      { codigo: `CO_P1_${suf}`, nombre: `CO Repuesto ${suf}`, lleva_stock: true, stock_inicial: 100, costo_unitario: 100 },
      tokenR
    );
    assert.strictEqual(resRep.status, 201);
    const repId = Number((await resRep.json()).id);
    createdRepuestoIds.push(repId);

    // Helpers
    async function crearIntervencion(maquinaId: number) {
      const res = await postJson('/api/intervenciones', { maquina_id: maquinaId, descripcion: 'Falla prueba CO' }, tokenO);
      assert.strictEqual(res.status, 201);
      const id = Number((await res.json()).id);
      createdIntervencionIds.push(id);
      return id;
    }
    async function iniciar(id: number) {
      const r = await postJson(`/api/intervenciones/${id}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);
      assert.strictEqual(r.status, 200);
    }
    async function enProceso(maquinaId = m1Id) {
      const id = await crearIntervencion(maquinaId);
      await iniciar(id);
      return id;
    }
    async function finalizar(id: number) {
      const r = await postJson(
        `/api/intervenciones/${id}/finalizar`,
        { estado_esperado: 'EN_PROCESO', trabajo_realizado: 'Reparación completada', ejecucion: 'INTERNA' },
        tokenR
      );
      assert.strictEqual(r.status, 200);
    }
    async function cancelar(id: number) {
      const r = await postJson(
        `/api/intervenciones/${id}/cancelar`,
        { estado_esperado: 'EN_PROCESO', motivo: 'Cancelada prueba CO' },
        tokenR
      );
      assert.strictEqual(r.status, 200);
    }
    const costo = (id: number, body: any, token: string) => postJson(`/api/intervenciones/${id}/costos`, body, token);
    const anular = (id: number, renglonId: number, body: any, token: string) =>
      postJson(`/api/intervenciones/${id}/costos/${renglonId}/anular`, body, token);
    async function costoOk(id: number, body: any, token = tokenR) {
      const r = await costo(id, body, token);
      const d = await r.json();
      assert.strictEqual(r.status, 201, JSON.stringify(d));
      return d;
    }
    async function costosDb(id: number) {
      const r = await client.query(
        'SELECT costo_repuestos, costo_mano_obra, costo_total_estimado FROM intervenciones WHERE id = $1',
        [id]
      );
      return {
        repuestos: Number(r.rows[0].costo_repuestos),
        manoObra: Number(r.rows[0].costo_mano_obra),
        total: Number(r.rows[0].costo_total_estimado),
      };
    }
    async function cantidadRenglones(id: number) {
      const r = await client.query('SELECT count(*)::int AS n FROM intervencion_costos WHERE intervencion_id = $1', [id]);
      return Number(r.rows[0].n);
    }
    const otro = (importe: number) => ({ tipo: 'OTRO', descripcion: 'Insumos varios', importe });

    // =========================================================================
    // CO-01: Estados
    // =========================================================================
    await t.test('CO-01: Estados', async () => {
      const id = await crearIntervencion(m1Id);

      const rPend = await costo(id, otro(100), tokenR);
      assert.strictEqual(rPend.status, 409);
      assert.strictEqual((await rPend.json()).codigo, 'ESTADO_NO_PERMITE_COSTOS');

      await iniciar(id);
      assert.strictEqual((await costo(id, otro(100), tokenR)).status, 201);

      const rEsp = await postJson(
        `/api/intervenciones/${id}/espera-repuestos`,
        { estado_esperado: 'EN_PROCESO', observacion: 'Falta un repuesto para seguir' },
        tokenR
      );
      assert.strictEqual(rEsp.status, 200);
      assert.strictEqual((await costo(id, otro(100), tokenR)).status, 201);

      const rRean = await postJson(`/api/intervenciones/${id}/reanudar`, { estado_esperado: 'EN_ESPERA_REPUESTOS' }, tokenR);
      assert.strictEqual(rRean.status, 200);
      await cancelar(id);

      const rCanc = await costo(id, otro(100), tokenR);
      assert.strictEqual(rCanc.status, 409);
      assert.strictEqual((await rCanc.json()).codigo, 'ESTADO_NO_PERMITE_COSTOS');

      // Eliminada: 404
      const idElim = await crearIntervencion(m1Id);
      const rElim = await postJson(
        `/api/intervenciones/${idElim}/eliminar`,
        { estado_esperado: 'PENDIENTE', motivo: 'Eliminada prueba CO-01' },
        tokenA
      );
      assert.strictEqual(rElim.status, 200);
      const rElimCosto = await costo(idElim, otro(100), tokenR);
      assert.strictEqual(rElimCosto.status, 404);
      assert.strictEqual((await rElimCosto.json()).codigo, 'INTERVENCION_NO_ENCONTRADA');
    });

    // =========================================================================
    // CO-02 y CO-03: Mano de obra interna con valor hora, y externa
    // =========================================================================
    let idMO = 0;
    let renglonInternoId = 0;
    await t.test('CO-02: Mano de obra interna con valor hora', async () => {
      idMO = await enProceso();
      const d = await costoOk(idMO, { tipo: 'MANO_OBRA', usuario_id: P.id, horas: 2.5, valor_hora: 1200 });
      renglonInternoId = d.id;
      assert.strictEqual(d.importe, 3000);
      assert.strictEqual(d.valor_hora, 1200);
      assert.strictEqual(d.horas, 2.5);
      assert.strictEqual(d.descripcion, 'Mano de obra');
      assert.deepStrictEqual(d.persona, { id: P.id, nombre: 'Persona', apellido: 'CO' });
      assert.strictEqual(d.proveedor, null);

      const c = await costosDb(idMO);
      assert.strictEqual(c.manoObra, 3000);
      assert.strictEqual(c.total, c.repuestos + 3000);
    });

    await t.test('CO-03: Mano de obra externa', async () => {
      const d = await costoOk(idMO, {
        tipo: 'MANO_OBRA',
        proveedor_id: provId,
        horas: 4,
        importe: 20000,
        descripcion: 'Servicio de bobinado',
      });
      assert.strictEqual(d.valor_hora, null);
      assert.strictEqual(d.importe, 20000);
      assert.strictEqual(d.horas, 4);
      assert.strictEqual(d.persona, null);
      assert.deepStrictEqual(d.proveedor, { id: provId, nombre: `CO Proveedor ${suf}` });

      const c = await costosDb(idMO);
      assert.strictEqual(c.manoObra, 23000);
      assert.strictEqual(c.total, c.repuestos + 23000);
    });

    // =========================================================================
    // CO-04: Validaciones de mano de obra
    // =========================================================================
    await t.test('CO-04: Validaciones de mano de obra', async () => {
      const antes = await cantidadRenglones(idMO);
      const casos: Array<[string, any, string]> = [
        ['sin horas', { tipo: 'MANO_OBRA', usuario_id: P.id, importe: 100 }, 'DATOS_INVALIDOS'],
        ['usuario y proveedor', { tipo: 'MANO_OBRA', usuario_id: P.id, proveedor_id: provId, horas: 1, importe: 100 }, 'DATOS_INVALIDOS'],
        ['sin persona ni proveedor', { tipo: 'MANO_OBRA', horas: 1, importe: 100 }, 'DATOS_INVALIDOS'],
        ['valor_hora e importe', { tipo: 'MANO_OBRA', usuario_id: P.id, horas: 1, valor_hora: 100, importe: 100 }, 'DATOS_INVALIDOS'],
        ['horas 0', { tipo: 'MANO_OBRA', usuario_id: P.id, horas: 0, importe: 100 }, 'DATOS_INVALIDOS'],
        ['horas con 3 decimales', { tipo: 'MANO_OBRA', usuario_id: P.id, horas: 1.255, importe: 100 }, 'DATOS_INVALIDOS'],
        ['usuario inactivo', { tipo: 'MANO_OBRA', usuario_id: Pi.id, horas: 1, importe: 100 }, 'PERSONA_INVALIDA'],
        ['horas en TRANSPORTE', { tipo: 'TRANSPORTE', descripcion: 'Flete', horas: 1, importe: 100 }, 'DATOS_INVALIDOS'],
        ['usuario_id en OTRO', { tipo: 'OTRO', descripcion: 'Insumos', usuario_id: P.id, importe: 100 }, 'DATOS_INVALIDOS'],
        ['usuario_id: true', { tipo: 'MANO_OBRA', usuario_id: true, horas: 1, importe: 100 }, 'DATOS_INVALIDOS'],
      ];
      for (const [nombre, body, codigo] of casos) {
        const r = await costo(idMO, body, tokenR);
        assert.strictEqual(r.status, 422, nombre);
        assert.strictEqual((await r.json()).codigo, codigo, nombre);
      }
      assert.strictEqual(await cantidadRenglones(idMO), antes, 'No se guardó ningún renglón');
    });

    // =========================================================================
    // CO-05: Otros tipos
    // =========================================================================
    await t.test('CO-05: Otros tipos', async () => {
      const id = await enProceso();
      const dServ = await costoOk(id, { tipo: 'SERVICIO_EXTERNO', descripcion: 'Rebobinado', proveedor_id: provId, importe: 5000 });
      assert.strictEqual(dServ.proveedor.id, provId);
      await costoOk(id, { tipo: 'TRANSPORTE', descripcion: 'Flete', importe: 500 });
      await costoOk(id, otro(150));

      for (const tipo of ['SERVICIO_EXTERNO', 'TRANSPORTE', 'OTRO']) {
        const r = await costo(id, { tipo, descripcion: 'Importe negativo', importe: -10 }, tokenR);
        assert.strictEqual(r.status, 422, tipo);
      }

      const dAj = await costoOk(id, { tipo: 'AJUSTE', descripcion: 'Bonificación', importe: -1000, motivo: 'Bonificación acordada' });
      assert.strictEqual(dAj.importe, -1000);

      const rSinMot = await costo(id, { tipo: 'AJUSTE', descripcion: 'Bonificación', importe: -100 }, tokenR);
      assert.strictEqual(rSinMot.status, 422);
      assert.strictEqual((await rSinMot.json()).codigo, 'MOTIVO_REQUERIDO');

      const rCero = await costo(id, { tipo: 'AJUSTE', descripcion: 'Ajuste nulo', importe: 0, motivo: 'Ajuste en cero' }, tokenR);
      assert.strictEqual(rCero.status, 422);

      assert.strictEqual((await costosDb(id)).total, 4650);
    });

    // =========================================================================
    // CO-06: El total nunca es negativo
    // =========================================================================
    await t.test('CO-06: El total nunca es negativo', async () => {
      const id = await enProceso();
      const r1500 = await costoOk(id, otro(1500));

      const rNeg = await costo(id, { tipo: 'AJUSTE', descripcion: 'Descuento', importe: -2000, motivo: 'Descuento grande' }, tokenR);
      assert.strictEqual(rNeg.status, 409);
      const dNeg = await rNeg.json();
      assert.strictEqual(dNeg.codigo, 'TOTAL_NEGATIVO');
      assert.strictEqual(dNeg.total_resultante, -500);
      assert.strictEqual(await cantidadRenglones(id), 1, 'No se guardó nada');
      assert.strictEqual((await costosDb(id)).total, 1500);

      await costoOk(id, { tipo: 'AJUSTE', descripcion: 'Descuento', importe: -1000, motivo: 'Descuento acordado' });
      assert.strictEqual((await costosDb(id)).total, 500);

      const rAnul = await anular(id, r1500.id, { motivo: 'Se cargó mal' }, tokenR);
      assert.strictEqual(rAnul.status, 409);
      assert.strictEqual((await rAnul.json()).codigo, 'TOTAL_NEGATIVO');
      assert.strictEqual((await costosDb(id)).total, 500);

      // Otra intervención: consumo de 1000 y AJUSTE de −800; anular el consumo da 409 y el stock no cambia
      const id2 = await enProceso();
      const rCons = await postJson(`/api/intervenciones/${id2}/repuestos`, { repuesto_id: repId, cantidad: 10 }, tokenR);
      assert.strictEqual(rCons.status, 201);
      const consumo = await rCons.json();
      await costoOk(id2, { tipo: 'AJUSTE', descripcion: 'Descuento', importe: -800, motivo: 'Descuento del proveedor' });
      assert.strictEqual((await costosDb(id2)).total, 200);

      const stockAntes = Number((await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [repId])).rows[0].cantidad_disponible);
      const rAnulCons = await postJson(`/api/intervenciones/${id2}/repuestos/${consumo.id}/anular`, { motivo: 'Se cargó mal' }, tokenR);
      assert.strictEqual(rAnulCons.status, 409);
      assert.strictEqual((await rAnulCons.json()).codigo, 'TOTAL_NEGATIVO');
      const stockDespues = Number((await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [repId])).rows[0].cantidad_disponible);
      assert.strictEqual(stockDespues, stockAntes, 'El stock no cambia');
      const resCons = await client.query('SELECT anulado_en FROM intervencion_repuestos WHERE id = $1', [consumo.id]);
      assert.strictEqual(resCons.rows[0].anulado_en, null, 'El consumo sigue vigente');
      assert.strictEqual((await costosDb(id2)).total, 200);
    });

    // =========================================================================
    // CO-07: Anular
    // =========================================================================
    await t.test('CO-07: Anular', async () => {
      const id = await enProceso();
      const r300 = await costoOk(id, otro(300));
      await costoOk(id, otro(200));
      assert.strictEqual((await costosDb(id)).total, 500);

      const rSin = await anular(id, r300.id, {}, tokenR);
      assert.strictEqual(rSin.status, 422);
      assert.strictEqual((await rSin.json()).codigo, 'MOTIVO_REQUERIDO');

      const rOk = await anular(id, r300.id, { motivo: 'Se cargó dos veces' }, tokenR);
      assert.strictEqual(rOk.status, 200);
      const dOk = await rOk.json();
      assert.strictEqual(dOk.anulado, true);
      assert.strictEqual(dOk.motivo_anulacion, 'Se cargó dos veces');
      assert.strictEqual(dOk.anulado_por.id, R.id);
      assert.strictEqual((await costosDb(id)).total, 200);

      const rOtra = await anular(id, r300.id, { motivo: 'Otra vez lo mismo' }, tokenR);
      assert.strictEqual(rOtra.status, 409);
      assert.strictEqual((await rOtra.json()).codigo, 'RENGLON_YA_ANULADO');

      // Un renglón de otra intervención
      const idOtra = await enProceso();
      const rAjeno = await costoOk(idOtra, otro(50));
      const rNo = await anular(id, rAjeno.id, { motivo: 'No es de esta' }, tokenR);
      assert.strictEqual(rNo.status, 404);
      assert.strictEqual((await rNo.json()).codigo, 'RENGLON_NO_ENCONTRADO');
    });

    // =========================================================================
    // CO-08: FINALIZADA
    // =========================================================================
    await t.test('CO-08: Intervención finalizada', async () => {
      const id = await enProceso();
      await finalizar(id);

      const body = {
        tipo: 'MANO_OBRA',
        usuario_id: P.id,
        horas: 2,
        valor_hora: 1500,
        descripcion: 'Ajuste de guías',
      };

      const rR = await costo(id, { ...body, motivo: 'Faltó cargar horas' }, tokenR);
      assert.strictEqual(rR.status, 403);
      assert.strictEqual((await rR.json()).codigo, 'PERMISO_INSUFICIENTE');

      const rSin = await costo(id, body, tokenA);
      assert.strictEqual(rSin.status, 422);
      assert.strictEqual((await rSin.json()).codigo, 'MOTIVO_REQUERIDO');

      const d = await costoOk(id, { ...body, motivo: 'Faltó cargar horas' }, tokenA);
      assert.strictEqual(d.importe, 3000);

      const auditoria = async () =>
        (await client.query(
          `SELECT valor_anterior, valor_nuevo, motivo FROM intervencion_auditoria
           WHERE intervencion_id = $1 AND tipo_evento = 'CORRECCION_COSTO' AND campo_modificado = 'costos'
           ORDER BY id`,
          [id]
        )).rows;

      const aud1 = await auditoria();
      assert.strictEqual(aud1.length, 1);
      assert.strictEqual(aud1[0].valor_nuevo, 'Se agregó: Mano de obra — Ajuste de guías');
      assert.strictEqual(aud1[0].motivo, 'Faltó cargar horas');

      const rAnul = await anular(id, d.id, { motivo: 'Horas mal cargadas' }, tokenA);
      assert.strictEqual(rAnul.status, 200);

      const aud2 = await auditoria();
      assert.strictEqual(aud2.length, 2);
      assert.strictEqual(aud2[1].valor_nuevo, 'Se anuló: Mano de obra — Ajuste de guías');
      assert.strictEqual(aud2[1].motivo, 'Horas mal cargadas');

      // Sin el importe ni el valor hora en ningún texto
      for (const fila of aud2) {
        const texto = `${fila.valor_anterior ?? ''} ${fila.valor_nuevo ?? ''} ${fila.motivo ?? ''}`;
        for (const numero of ['3000', '3.000', '1500', '1.500']) {
          assert.ok(!texto.includes(numero), `La auditoría no muestra ${numero}: ${texto}`);
        }
      }
    });

    // =========================================================================
    // CO-09: CANCELADA
    // =========================================================================
    await t.test('CO-09: Intervención cancelada', async () => {
      const id = await enProceso();
      const r = await costoOk(id, otro(100));
      await cancelar(id);

      const rR = await anular(id, r.id, { motivo: 'Ya no corresponde' }, tokenR);
      assert.strictEqual(rR.status, 403);

      const rA = await anular(id, r.id, { motivo: 'Ya no corresponde' }, tokenA);
      assert.strictEqual(rA.status, 200);
    });

    // =========================================================================
    // CO-10: Permisos y visibilidad
    // =========================================================================
    await t.test('CO-10: Permisos y visibilidad', async () => {
      // O: no carga, y ve horas pero no importes
      const rPost = await costo(idMO, otro(100), tokenO);
      assert.strictEqual(rPost.status, 403);

      const rGet = await getJson(`/api/intervenciones/${idMO}/costos`, tokenO);
      assert.strictEqual(rGet.status, 200);
      const dGet = await rGet.json();
      assert.strictEqual(dGet.ve_costos, false);
      assert.strictEqual(dGet.resumen, null);
      assert.ok(dGet.renglones.length >= 2);
      for (const r of dGet.renglones) {
        assert.strictEqual(r.importe, null);
        assert.strictEqual(r.valor_hora, null);
      }
      const interno = dGet.renglones.find((r: any) => r.id === renglonInternoId);
      assert.strictEqual(interno.horas, 2.5);
      assert.strictEqual(dGet.horas_mano_obra, 6.5);

      // O2: 404
      const rO2 = await getJson(`/api/intervenciones/${idMO}/costos`, tokenO2);
      assert.strictEqual(rO2.status, 404);

      // Las banderas coinciden con lo que responden el POST y la anulación
      const idProc = await enProceso();
      const idFin = await enProceso();
      await finalizar(idFin);

      const usuarios: Array<[string, string]> = [['R', tokenR], ['A', tokenA], ['O', tokenO]];
      for (const [estado, id] of [['EN_PROCESO', idProc], ['FINALIZADA', idFin]] as Array<[string, number]>) {
        for (const [nombre, token] of usuarios) {
          const g = await (await getJson(`/api/intervenciones/${id}/costos`, token)).json();

          const rp = await costo(id, { ...otro(10), motivo: 'Corrección de prueba' }, token);
          assert.strictEqual(rp.status === 201, g.puede_registrar, `${nombre} en ${estado}: puede_registrar ${g.puede_registrar}, POST ${rp.status}`);

          // Un renglón para intentar anular: el propio o uno de A
          const renglon = rp.status === 201 ? await rp.json() : await costoOk(id, { ...otro(10), motivo: 'Corrección de prueba' }, tokenA);
          const ra = await anular(id, renglon.id, { motivo: 'Anulación de prueba' }, token);
          assert.strictEqual(ra.status === 200, g.puede_anular, `${nombre} en ${estado}: puede_anular ${g.puede_anular}, anular ${ra.status}`);
        }
      }
    });

    // =========================================================================
    // CO-11: Repuestos y renglones juntos
    // =========================================================================
    await t.test('CO-11: Repuestos y renglones juntos', async () => {
      const id = await enProceso();
      const rCons = await postJson(`/api/intervenciones/${id}/repuestos`, { repuesto_id: repId, cantidad: 2 }, tokenR);
      assert.strictEqual(rCons.status, 201);
      await costoOk(id, { tipo: 'MANO_OBRA', usuario_id: P.id, horas: 2.5, valor_hora: 1200 });
      await costoOk(id, { tipo: 'TRANSPORTE', descripcion: 'Flete', importe: 500 });
      await costoOk(id, { tipo: 'AJUSTE', descripcion: 'Descuento', importe: -200, motivo: 'Descuento acordado' });

      const d = await (await getJson(`/api/intervenciones/${id}/costos`, tokenR)).json();
      assert.deepStrictEqual(d.resumen, {
        repuestos: 200,
        mano_obra: 3000,
        servicio_externo: 0,
        transporte: 500,
        otro: 0,
        ajuste: -200,
        total: 3500,
      });
      assert.strictEqual((await costosDb(id)).total, 3500);
    });

    // =========================================================================
    // CO-12: Concurrencia
    // =========================================================================
    await t.test('CO-12: Concurrencia', async () => {
      const id = await enProceso();
      const r = await costoOk(id, otro(1000));
      const [a1, a2] = await Promise.all([
        anular(id, r.id, { motivo: 'Anulación concurrente' }, tokenR),
        anular(id, r.id, { motivo: 'Anulación concurrente' }, tokenA),
      ]);
      const estados = [a1.status, a2.status].sort();
      assert.deepStrictEqual(estados, [200, 409]);
      const perdedor = a1.status === 409 ? a1 : a2;
      assert.strictEqual((await perdedor.json()).codigo, 'RENGLON_YA_ANULADO');

      const id2 = await enProceso();
      await costoOk(id2, otro(1000));
      const ajuste = { tipo: 'AJUSTE', descripcion: 'Descuento', importe: -600, motivo: 'Descuento concurrente' };
      const [p1, p2] = await Promise.all([costo(id2, ajuste, tokenR), costo(id2, ajuste, tokenA)]);
      assert.deepStrictEqual([p1.status, p2.status].sort(), [201, 409]);
      const rechazo = p1.status === 409 ? p1 : p2;
      assert.strictEqual((await rechazo.json()).codigo, 'TOTAL_NEGATIVO');
      assert.strictEqual((await costosDb(id2)).total, 400);
      const ajustes = await client.query(
        `SELECT count(*)::int AS n FROM intervencion_costos WHERE intervencion_id = $1 AND tipo = 'AJUSTE'`,
        [id2]
      );
      assert.strictEqual(Number(ajustes.rows[0].n), 1);
    });

    // =========================================================================
    // CO-13: Personas
    // =========================================================================
    await t.test('CO-13: Personas', async () => {
      const rR = await getJson('/api/costos/personas', tokenR);
      assert.strictEqual(rR.status, 200);
      const personas = await rR.json();
      const ids = personas.map((p: any) => p.id);
      assert.ok(ids.includes(P.id), 'Incluye a P');
      assert.ok(!ids.includes(Pi.id), 'No incluye al inactivo');
      const inactivos = await client.query('SELECT count(*)::int AS n FROM usuarios WHERE id = ANY($1) AND activo = FALSE', [ids]);
      assert.strictEqual(Number(inactivos.rows[0].n), 0, 'Solo usuarios activos');
      const p = personas.find((x: any) => x.id === P.id);
      assert.deepStrictEqual(p, { id: P.id, nombre: 'Persona', apellido: 'CO', legajo: `CO_P_${suf}` });

      assert.strictEqual((await getJson('/api/costos/personas', tokenT)).status, 403);
      assert.strictEqual((await getJson('/api/costos/personas', tokenO)).status, 403);

      assert.strictEqual((await getJson('/api/proveedores/opciones', tokenCR)).status, 200);
    });

    // =========================================================================
    // CO-14: Reporte
    // =========================================================================
    const desdeFijo = '2025-09-01T00:00:00.000Z';
    const hastaFijo = '2025-09-11T00:00:00.000Z';
    const reporte = (token: string, extra = '') =>
      getJson(`/api/reportes/costos?desde=${encodeURIComponent(desdeFijo)}&hasta=${encodeURIComponent(hastaFijo)}${extra}`, token);

    await t.test('CO-14: Reporte', async () => {
      // M1: consumo de 200, mano de obra de P de 2 h por 3000 y transporte de 500
      const idM1 = await enProceso(m1Id);
      const rCons = await postJson(`/api/intervenciones/${idM1}/repuestos`, { repuesto_id: repId, cantidad: 2 }, tokenR);
      assert.strictEqual(rCons.status, 201);
      const consumo = await rCons.json();
      const mo1 = await costoOk(idM1, { tipo: 'MANO_OBRA', usuario_id: P.id, horas: 2, importe: 3000 });
      const tr1 = await costoOk(idM1, { tipo: 'TRANSPORTE', descripcion: 'Flete', importe: 500 });
      // Uno anulado, que no cuenta
      const anulado = await costoOk(idM1, otro(999));
      assert.strictEqual((await anular(idM1, anulado.id, { motivo: 'No corresponde' }, tokenR)).status, 200);

      // M2: mano de obra externa de 4 h por 20000, y uno fuera del período
      const idM2 = await enProceso(m2Id);
      const mo2 = await costoOk(idM2, { tipo: 'MANO_OBRA', proveedor_id: provId, horas: 4, importe: 20000 });
      const fuera = await costoOk(idM2, otro(777));

      // Fechas corridas por SQL
      await client.query(`UPDATE intervencion_repuestos SET creado_en = '2025-09-05T12:00:00.000Z' WHERE id = $1`, [consumo.id]);
      await client.query(
        `UPDATE intervencion_costos SET registrado_en = '2025-09-05T12:00:00.000Z' WHERE id = ANY($1)`,
        [[mo1.id, tr1.id, anulado.id, mo2.id]]
      );
      await client.query(`UPDATE intervencion_costos SET registrado_en = '2025-08-15T12:00:00.000Z' WHERE id = $1`, [fuera.id]);

      const rGen = await reporte(tokenR);
      assert.strictEqual(rGen.status, 200);
      const d = await rGen.json();
      assert.strictEqual(d.total, 23700);
      assert.strictEqual(d.intervenciones, 2);
      assert.deepStrictEqual(d.por_tipo, {
        repuestos: 200,
        mano_obra: 23000,
        servicio_externo: 0,
        transporte: 500,
        otro: 0,
        ajuste: 0,
      });
      assert.strictEqual(d.por_maquina.length, 2);
      assert.strictEqual(d.por_maquina[0].maquina.id, m2Id);
      assert.strictEqual(d.por_maquina[0].total, 20000);
      assert.deepStrictEqual(
        {
          id: d.por_maquina[1].maquina.id,
          repuestos: d.por_maquina[1].repuestos,
          mano_obra: d.por_maquina[1].mano_obra,
          otros: d.por_maquina[1].otros,
          total: d.por_maquina[1].total,
        },
        { id: m1Id, repuestos: 200, mano_obra: 3000, otros: 500, total: 3700 }
      );
      assert.strictEqual(d.horas_por_persona.length, 2);
      assert.strictEqual(d.horas_por_persona[0].proveedor.id, provId);
      assert.strictEqual(d.horas_por_persona[0].persona, null);
      assert.strictEqual(d.horas_por_persona[0].horas, 4);
      assert.strictEqual(d.horas_por_persona[0].importe, 20000);
      assert.strictEqual(d.horas_por_persona[1].persona.id, P.id);
      assert.strictEqual(d.horas_por_persona[1].proveedor, null);
      assert.strictEqual(d.horas_por_persona[1].horas, 2);
      assert.strictEqual(d.horas_por_persona[1].importe, 3000);

      // Con planta y con sector: solo lo de cada uno
      const dPl1 = await (await reporte(tokenR, `&planta_id=${pl1Id}`)).json();
      assert.strictEqual(dPl1.total, 3700);
      assert.deepStrictEqual(dPl1.por_maquina.map((m: any) => m.maquina.id), [m1Id]);
      const dS2 = await (await reporte(tokenR, `&sector_id=${s2Id}`)).json();
      assert.strictEqual(dS2.total, 20000);
      assert.deepStrictEqual(dS2.por_maquina.map((m: any) => m.maquina.id), [m2Id]);

      // X: solo M2
      const rX = await reporte(tokenX);
      assert.strictEqual(rX.status, 200);
      const dX = await rX.json();
      assert.strictEqual(dX.total, 20000);
      assert.deepStrictEqual(dX.por_maquina.map((m: any) => m.maquina.id), [m2Id]);

      // T: 403
      const rT = await reporte(tokenT);
      assert.strictEqual(rT.status, 403);
      assert.strictEqual((await rT.json()).codigo, 'PERMISO_INSUFICIENTE');

      // desde posterior a hasta: 422
      const rInv = await getJson(
        `/api/reportes/costos?desde=${encodeURIComponent(hastaFijo)}&hasta=${encodeURIComponent(desdeFijo)}`,
        tokenR
      );
      assert.strictEqual(rInv.status, 422);
    });

    // =========================================================================
    // CO-15: Contrato
    // =========================================================================
    await t.test('CO-15: Contrato de las cuatro respuestas', async () => {
      const id = await enProceso();
      // El primer renglón, como el del ejemplo: mano de obra interna con valor hora, motivo y anulada
      const primero = await costoOk(
        id,
        { tipo: 'MANO_OBRA', usuario_id: P.id, horas: 2.5, valor_hora: 1200, descripcion: 'Cambio de rodamientos', motivo: 'Horas del sábado' },
        tokenA
      );
      assert.strictEqual((await anular(id, primero.id, { motivo: 'Se cargó dos veces' }, tokenA)).status, 200);
      await costoOk(id, { tipo: 'MANO_OBRA', usuario_id: P.id, horas: 2.5, valor_hora: 1200 }, tokenA);
      await costoOk(id, { tipo: 'TRANSPORTE', descripcion: 'Flete del motor', importe: 500 }, tokenA);
      await costoOk(id, otro(150), tokenA);
      await costoOk(id, { tipo: 'AJUSTE', descripcion: 'Bonificación', importe: -200, motivo: 'Bonificación acordada' }, tokenA);

      const verificar = (ruta: string, real: unknown, ejemplo: unknown) => {
        const diferencias = mismaForma(real, ejemplo);
        assert.deepStrictEqual(diferencias, [], `${ruta}:\n${diferencias.join('\n')}`);
      };

      // POST de un renglón
      const rPost = await costo(
        id,
        { tipo: 'SERVICIO_EXTERNO', descripcion: 'Alineación láser', proveedor_id: provId, importe: 12000, motivo: 'Pedido por calidad' },
        tokenA
      );
      assert.strictEqual(rPost.status, 201);
      verificar('POST /api/intervenciones/:id/costos', await rPost.json(), renglonCreadoEjemplo);

      // GET de la intervención
      const rGet = await getJson(`/api/intervenciones/${id}/costos`, tokenA);
      assert.strictEqual(rGet.status, 200);
      verificar('GET /api/intervenciones/:id/costos', await rGet.json(), costosIntervencionEjemplo);

      // Personas
      const rPer = await getJson('/api/costos/personas', tokenA);
      assert.strictEqual(rPer.status, 200);
      verificar('GET /api/costos/personas', await rPer.json(), personasCostosEjemplo);

      // Reporte (el período de CO-14)
      const rRep = await reporte(tokenA);
      assert.strictEqual(rRep.status, 200);
      verificar('GET /api/reportes/costos', await rRep.json(), reporteCostosEjemplo);
    });
  } finally {
    // Limpieza: solo lo que creó esta prueba
    try {
      if (createdIntervencionIds.length > 0) {
        await client.query('DELETE FROM intervencion_costos WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM pedidos_repuesto WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervencion_repuestos WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
      }
      if (createdRepuestoIds.length > 0) {
        await client.query('DELETE FROM intervencion_repuestos WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM movimientos_stock WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM repuesto_costos WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM repuestos WHERE id = ANY($1)', [createdRepuestoIds]);
      }
      if (createdProveedorIds.length > 0) {
        await client.query('DELETE FROM proveedores WHERE id = ANY($1)', [createdProveedorIds]);
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

import { test } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sign } from 'hono/jwt';
import app from '../functions/api.ts';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';
import { JWT_SECRET } from '../functions/config.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (REPORTES TESTS)');
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

test('Etapa F5 — Indicadores y reportes (RP-01 a RP-07)', async (t) => {
  let client = await pool.connect();

  const createdPlantaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdIntervencionIds: number[] = [];
  const createdUsuarioIds: number[] = [];

  const testSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // Período fijo de 10 días en el pasado (T0 a T10)
  const T0 = '2025-06-01T00:00:00Z';
  const T10 = '2025-06-11T00:00:00Z';

  let adminToken = '';
  let operarioToken = '';
  let userSectores1Token = '';
  let userSectores2Token = '';

  let planta1Id = 0;
  let planta2Id = 0;
  let planta3Id = 0;

  let sector1Id = 0;
  let sector2Id = 0;

  let maquinaAId = 0;
  let maquinaBId = 0;
  let maquinaCId = 0;

  let tipoCorrectivoId = 1;
  let tipoPreventivoId = 2;

  try {
    // 1. Obtener tipos de intervención
    const resTipos = await client.query('SELECT id, codigo FROM tipos_intervencion');
    for (const r of resTipos.rows) {
      if (r.codigo === 'CORRECTIVO') tipoCorrectivoId = Number(r.id);
      if (r.codigo === 'PREVENTIVO') tipoPreventivoId = Number(r.id);
    }

    // 2. Obtener perfiles
    const resPerfiles = await client.query('SELECT id, nombre FROM perfiles');
    let adminPerfilId = 0;
    let respPerfilId = 0;
    let operarioPerfilId = 0;
    for (const r of resPerfiles.rows) {
      if (r.nombre === 'ADMINISTRADOR') adminPerfilId = Number(r.id);
      if (r.nombre === 'RESPONSABLE_MANTENIMIENTO') respPerfilId = Number(r.id);
      if (r.nombre === 'OPERARIO') operarioPerfilId = Number(r.id);
    }

    // 3. Crear plantas
    const resP1 = await client.query(
      "INSERT INTO plantas (nombre, descripcion, activo) VALUES ($1, $2, TRUE) RETURNING id",
      ['Planta RP1 ' + testSuffix, 'P1-' + testSuffix]
    );
    planta1Id = Number(resP1.rows[0].id);
    createdPlantaIds.push(planta1Id);

    const resP2 = await client.query(
      "INSERT INTO plantas (nombre, descripcion, activo) VALUES ($1, $2, TRUE) RETURNING id",
      ['Planta RP2 ' + testSuffix, 'P2-' + testSuffix]
    );
    planta2Id = Number(resP2.rows[0].id);
    createdPlantaIds.push(planta2Id);

    const resP3 = await client.query(
      "INSERT INTO plantas (nombre, descripcion, activo) VALUES ($1, $2, TRUE) RETURNING id",
      ['Planta RP3 ' + testSuffix, 'P3-' + testSuffix]
    );
    planta3Id = Number(resP3.rows[0].id);
    createdPlantaIds.push(planta3Id);

    // 4. Crear sectores
    const resS1 = await client.query(
      "INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id",
      ['Sector S1 ' + testSuffix, planta1Id]
    );
    sector1Id = Number(resS1.rows[0].id);
    createdSectorIds.push(sector1Id);

    const resS2 = await client.query(
      "INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id",
      ['Sector S2 ' + testSuffix, planta2Id]
    );
    sector2Id = Number(resS2.rows[0].id);
    createdSectorIds.push(sector2Id);

    // 5. Crear máquinas activas
    const resMA = await client.query(
      "INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ($1, $2, $3, 'OPERATIVA', TRUE) RETURNING id",
      ['Máquina A ' + testSuffix, 'MAQ-A-' + testSuffix, sector1Id]
    );
    maquinaAId = Number(resMA.rows[0].id);
    createdMaquinaIds.push(maquinaAId);

    const resMB = await client.query(
      "INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ($1, $2, $3, 'OPERATIVA', TRUE) RETURNING id",
      ['Máquina B ' + testSuffix, 'MAQ-B-' + testSuffix, sector1Id]
    );
    maquinaBId = Number(resMB.rows[0].id);
    createdMaquinaIds.push(maquinaBId);

    const resMC = await client.query(
      "INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ($1, $2, $3, 'OPERATIVA', TRUE) RETURNING id",
      ['Máquina C ' + testSuffix, 'MAQ-C-' + testSuffix, sector2Id]
    );
    maquinaCId = Number(resMC.rows[0].id);
    createdMaquinaIds.push(maquinaCId);

    // 6. Crear usuarios
    // 6a. Admin
    const resAdmin = await client.query(
      `INSERT INTO usuarios (nombre, apellido, legajo, email, password_hash, perfil_id, activo, sesion_version, debe_cambiar_password)
       VALUES ('Admin', 'RP', $1, $2, 'hash', $3, TRUE, 1, FALSE) RETURNING id, legajo, sesion_version`,
      ['ADM-' + testSuffix, `admin_${testSuffix}@test.com`, adminPerfilId]
    );
    const adminUser = resAdmin.rows[0];
    createdUsuarioIds.push(Number(adminUser.id));
    adminToken = await getTokenForUser({ id: Number(adminUser.id), legajo: adminUser.legajo, sesion_version: adminUser.sesion_version });

    // 6b. Operario (sin permiso REPORTES_CONSULTAR)
    const resOperario = await client.query(
      `INSERT INTO usuarios (nombre, apellido, legajo, email, password_hash, perfil_id, activo, sesion_version, debe_cambiar_password)
       VALUES ('Operario', 'RP', $1, $2, 'hash', $3, TRUE, 1, FALSE) RETURNING id, legajo, sesion_version`,
      ['OP-' + testSuffix, `op_${testSuffix}@test.com`, operarioPerfilId]
    );
    const opUser = resOperario.rows[0];
    createdUsuarioIds.push(Number(opUser.id));
    operarioToken = await getTokenForUser({ id: Number(opUser.id), legajo: opUser.legajo, sesion_version: opUser.sesion_version });

    // 6c. UserSectores1 (con REPORTES_CONSULTAR en SECTORES, asignado a S1)
    const resUS1 = await client.query(
      `INSERT INTO usuarios (nombre, apellido, legajo, email, password_hash, perfil_id, activo, sesion_version, debe_cambiar_password)
       VALUES ('UserSectores1', 'RP', $1, $2, 'hash', $3, TRUE, 1, FALSE) RETURNING id, legajo, sesion_version`,
      ['US1-' + testSuffix, `us1_${testSuffix}@test.com`, respPerfilId]
    );
    const us1User = resUS1.rows[0];
    const us1Id = Number(us1User.id);
    createdUsuarioIds.push(us1Id);
    await client.query('INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)', [us1Id, sector1Id]);

    // 6d. UserSectores2 (con REPORTES_CONSULTAR en SECTORES, asignado a S2, sin S1)
    const resUS2 = await client.query(
      `INSERT INTO usuarios (nombre, apellido, legajo, email, password_hash, perfil_id, activo, sesion_version, debe_cambiar_password)
       VALUES ('UserSectores2', 'RP', $1, $2, 'hash', $3, TRUE, 1, FALSE) RETURNING id, legajo, sesion_version`,
      ['US2-' + testSuffix, `us2_${testSuffix}@test.com`, respPerfilId]
    );
    const us2User = resUS2.rows[0];
    const us2Id = Number(us2User.id);
    createdUsuarioIds.push(us2Id);
    await client.query('INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)', [us2Id, sector2Id]);

    // Conceder REPORTES_CONSULTAR con alcance SECTORES para US1 y US2
    const resPermRep = await client.query("SELECT id FROM permisos WHERE codigo = 'REPORTES_CONSULTAR'");
    const permRepId = Number(resPermRep.rows[0].id);
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
       VALUES
         ($1, $3, 'CONCEDER', 'SECTORES', 'Test alcance S1', $4),
         ($2, $3, 'CONCEDER', 'SECTORES', 'Test alcance S2', $4)`,
      [us1Id, us2Id, permRepId, Number(adminUser.id)]
    );

    userSectores1Token = await getTokenForUser({ id: us1Id, legajo: us1User.legajo, sesion_version: us1User.sesion_version });
    userSectores2Token = await getTokenForUser({ id: us2Id, legajo: us2User.legajo, sesion_version: us2User.sesion_version });

    // 7. Cargar intervenciones del escenario base
    // Máquina A:
    // C1: correctiva finalizada, con una detención de 120 minutos
    // fecha_creacion: 2025-06-02 08:00:00Z
    // fecha_inicio: 2025-06-02 09:00:00Z -> espera: 60 min
    // fecha_finalizacion: 2025-06-02 12:00:00Z -> duracion_neta: 180 min
    const resC1 = await client.query(
      `INSERT INTO intervenciones (
         maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion,
         estado, ejecucion, trabajo_realizado, fecha_creacion, fecha_inicio, fecha_finalizacion
       ) VALUES ($1, $2, $3, 'C1 Correctiva Finalizada', 'FINALIZADA', 'INTERNA', 'Reparado',
         '2025-06-02 08:00:00Z', '2025-06-02 09:00:00Z', '2025-06-02 12:00:00Z') RETURNING id`,
      [maquinaAId, tipoCorrectivoId, adminUser.id]
    );
    const c1Id = Number(resC1.rows[0].id);
    createdIntervencionIds.push(c1Id);

    await client.query(
      `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, cambiado_en, fecha_efectiva)
       VALUES
         ($1, NULL, 'PENDIENTE', $2, '2025-06-02 08:00:00Z', NULL),
         ($1, 'PENDIENTE', 'EN_PROCESO', $2, '2025-06-02 09:00:00Z', '2025-06-02 09:00:00Z'),
         ($1, 'EN_PROCESO', 'FINALIZADA', $2, '2025-06-02 12:00:00Z', '2025-06-02 12:00:00Z')`,
      [c1Id, adminUser.id]
    );

    await client.query(
      `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, hasta, abierto_por_usuario_id, confirmado_por_usuario_id)
       VALUES ($1, $2, '2025-06-02 09:30:00Z', '2025-06-02 11:30:00Z', $3, $3)`,
      [c1Id, maquinaAId, adminUser.id]
    );

    // C2: correctiva abierta, sin detención
    // fecha_creacion: 2025-06-03 10:00:00Z
    const resC2 = await client.query(
      `INSERT INTO intervenciones (
         maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion,
         estado, ejecucion, fecha_creacion
       ) VALUES ($1, $2, $3, 'C2 Correctiva Abierta', 'EN_PROCESO', 'INTERNA',
         '2025-06-03 10:00:00Z') RETURNING id`,
      [maquinaAId, tipoCorrectivoId, adminUser.id]
    );
    const c2Id = Number(resC2.rows[0].id);
    createdIntervencionIds.push(c2Id);

    await client.query(
      `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, cambiado_en, fecha_efectiva)
       VALUES
         ($1, NULL, 'PENDIENTE', $2, '2025-06-03 10:00:00Z', NULL),
         ($1, 'PENDIENTE', 'EN_PROCESO', $2, '2025-06-03 10:30:00Z', '2025-06-03 10:30:00Z')`,
      [c2Id, adminUser.id]
    );

    // C3: correctiva cancelada
    // fecha_creacion: 2025-06-04 10:00:00Z
    const resC3 = await client.query(
      `INSERT INTO intervenciones (
         maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion,
         estado, ejecucion, fecha_creacion
       ) VALUES ($1, $2, $3, 'C3 Correctiva Cancelada', 'CANCELADA', 'INTERNA',
         '2025-06-04 10:00:00Z') RETURNING id`,
      [maquinaAId, tipoCorrectivoId, adminUser.id]
    );
    const c3Id = Number(resC3.rows[0].id);
    createdIntervencionIds.push(c3Id);

    await client.query(
      `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, cambiado_en, fecha_efectiva, observacion)
       VALUES
         ($1, NULL, 'PENDIENTE', $2, '2025-06-04 10:00:00Z', NULL, NULL),
         ($1, 'PENDIENTE', 'CANCELADA', $2, '2025-06-04 10:30:00Z', '2025-06-04 10:30:00Z', 'Cancelada por prueba')`,
      [c3Id, adminUser.id]
    );

    // Máquina B:
    // P1: preventiva finalizada, con una detención de 60 minutos
    // fecha_creacion: 2025-06-05 08:00:00Z
    // fecha_inicio: 2025-06-05 08:30:00Z
    // fecha_finalizacion: 2025-06-05 10:30:00Z
    const resP1Int = await client.query(
      `INSERT INTO intervenciones (
         maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion,
         estado, ejecucion, trabajo_realizado, fecha_creacion, fecha_inicio, fecha_finalizacion
       ) VALUES ($1, $2, $3, 'P1 Preventiva Finalizada', 'FINALIZADA', 'INTERNA', 'Mantenimiento Preventivo',
         '2025-06-05 08:00:00Z', '2025-06-05 08:30:00Z', '2025-06-05 10:30:00Z') RETURNING id`,
      [maquinaBId, tipoPreventivoId, adminUser.id]
    );
    const p1IntId = Number(resP1Int.rows[0].id);
    createdIntervencionIds.push(p1IntId);

    await client.query(
      `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, cambiado_en, fecha_efectiva)
       VALUES
         ($1, NULL, 'PENDIENTE', $2, '2025-06-05 08:00:00Z', NULL),
         ($1, 'PENDIENTE', 'EN_PROCESO', $2, '2025-06-05 08:30:00Z', '2025-06-05 08:30:00Z'),
         ($1, 'EN_PROCESO', 'FINALIZADA', $2, '2025-06-05 10:30:00Z', '2025-06-05 10:30:00Z')`,
      [p1IntId, adminUser.id]
    );

    await client.query(
      `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, hasta, abierto_por_usuario_id, confirmado_por_usuario_id)
       VALUES ($1, $2, '2025-06-05 08:30:00Z', '2025-06-05 09:30:00Z', $3, $3)`,
      [p1IntId, maquinaBId, adminUser.id]
    );

    // Máquina C (en otra planta P2):
    // C_other: correctiva finalizada en el período que NO debe contar cuando se filtra por P1
    const resCOther = await client.query(
      `INSERT INTO intervenciones (
         maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion,
         estado, ejecucion, trabajo_realizado, fecha_creacion, fecha_inicio, fecha_finalizacion
       ) VALUES ($1, $2, $3, 'C Other en P2', 'FINALIZADA', 'INTERNA', 'Reparado C',
         '2025-06-06 08:00:00Z', '2025-06-06 09:00:00Z', '2025-06-06 12:00:00Z') RETURNING id`,
      [maquinaCId, tipoCorrectivoId, adminUser.id]
    );
    const cOtherId = Number(resCOther.rows[0].id);
    createdIntervencionIds.push(cOtherId);

    await client.query(
      `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, cambiado_en, fecha_efectiva)
       VALUES
         ($1, NULL, 'PENDIENTE', $2, '2025-06-06 08:00:00Z', NULL),
         ($1, 'PENDIENTE', 'EN_PROCESO', $2, '2025-06-06 09:00:00Z', '2025-06-06 09:00:00Z'),
         ($1, 'EN_PROCESO', 'FINALIZADA', $2, '2025-06-06 12:00:00Z', '2025-06-06 12:00:00Z')`,
      [cOtherId, adminUser.id]
    );

    await client.query(
      `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, hasta, abierto_por_usuario_id, confirmado_por_usuario_id)
       VALUES ($1, $2, '2025-06-06 09:00:00Z', '2025-06-06 11:00:00Z', $3, $3)`,
      [cOtherId, maquinaCId, adminUser.id]
    );

    // =========================================================================
    // RP-01: Permiso
    // =========================================================================
    await t.test('RP-01: Sin REPORTES_CONSULTAR: 403 en /indicadores', async () => {
      const resp = await app.request(`/api/reportes/indicadores?desde=${T0}&hasta=${T10}`, {
        headers: { Authorization: `Bearer ${operarioToken}` },
      });
      assert.strictEqual(resp.status, 403);
    });

    // =========================================================================
    // RP-02: Escenario base, con planta_id = P1
    // =========================================================================
    await t.test('RP-02: Escenario base, con planta_id = P1', async () => {
      const resp = await app.request(
        `/api/reportes/indicadores?desde=${T0}&hasta=${T10}&planta_id=${planta1Id}`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();

      // maquinas 2 y minutos_periodo 28800
      assert.strictEqual(json.maquinas, 2);
      assert.strictEqual(json.minutos_periodo, 28800);

      // inactividad_minutos 180, correctiva 120 y preventiva 60
      assert.strictEqual(json.inactividad_minutos, 180);
      assert.strictEqual(json.inactividad_correctiva_minutos, 120);
      assert.strictEqual(json.inactividad_preventiva_minutos, 60);

      // disponibilidad igual a round(1 - 180/28800, 4) = 0.9938
      assert.strictEqual(json.disponibilidad, 0.9938);

      // fallas 2, porque C3 no cuenta
      assert.strictEqual(json.fallas, 2);

      // correctivas_finalizadas 1 y preventivas_finalizadas 1
      assert.strictEqual(json.correctivas_finalizadas, 1);
      assert.strictEqual(json.preventivas_finalizadas, 1);

      // mttr_minutos y respuesta_promedio_minutos iguales a los de C1 en v_intervencion_tiempos
      assert.strictEqual(json.mttr_minutos, 180);
      assert.strictEqual(json.respuesta_promedio_minutos, 60);

      // mtbf_horas = round((28800 - 120) / 2 / 60, 1) = 239.0
      assert.strictEqual(json.mtbf_horas, 239);
    });

    // =========================================================================
    // RP-03: Filtros
    // =========================================================================
    await t.test('RP-03: Filtros (sector_id de S1, alcance SECTORES, planta sin máquinas, inválidos)', async () => {
      // 1. sector_id de S1: lo mismo que RP-02
      const respS1 = await app.request(
        `/api/reportes/indicadores?desde=${T0}&hasta=${T10}&sector_id=${sector1Id}`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(respS1.status, 200);
      const jsonS1 = await respS1.json();
      assert.strictEqual(jsonS1.maquinas, 2);
      assert.strictEqual(jsonS1.inactividad_minutos, 180);
      assert.strictEqual(jsonS1.disponibilidad, 0.9938);
      assert.strictEqual(jsonS1.fallas, 2);
      assert.strictEqual(jsonS1.mttr_minutos, 180);

      // 2. Sin filtros, con usuario de alcance SECTORES cuyo único sector es S1: lo mismo
      const respUS1 = await app.request(
        `/api/reportes/indicadores?desde=${T0}&hasta=${T10}`,
        { headers: { Authorization: `Bearer ${userSectores1Token}` } }
      );
      assert.strictEqual(respUS1.status, 200);
      const jsonUS1 = await respUS1.json();
      assert.strictEqual(jsonUS1.maquinas, 2);
      assert.strictEqual(jsonUS1.inactividad_minutos, 180);
      assert.strictEqual(jsonUS1.disponibilidad, 0.9938);
      assert.strictEqual(jsonUS1.fallas, 2);

      // 3. planta_id de otra planta sin máquinas (P3): maquinas 0, promedios y disponibilidad en null
      const respP3 = await app.request(
        `/api/reportes/indicadores?desde=${T0}&hasta=${T10}&planta_id=${planta3Id}`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(respP3.status, 200);
      const jsonP3 = await respP3.json();
      assert.strictEqual(jsonP3.maquinas, 0);
      assert.strictEqual(jsonP3.minutos_periodo, 0);
      assert.strictEqual(jsonP3.inactividad_minutos, 0);
      assert.strictEqual(jsonP3.disponibilidad, null);
      assert.strictEqual(jsonP3.fallas, 0);
      assert.strictEqual(jsonP3.correctivas_finalizadas, 0);
      assert.strictEqual(jsonP3.preventivas_finalizadas, 0);
      assert.strictEqual(jsonP3.mttr_minutos, null);
      assert.strictEqual(jsonP3.respuesta_promedio_minutos, null);
      assert.strictEqual(jsonP3.mtbf_horas, null);

      // 4. planta_id=abc: 422
      const respInvalido = await app.request(
        `/api/reportes/indicadores?desde=${T0}&hasta=${T10}&planta_id=abc`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(respInvalido.status, 422);
    });

    // =========================================================================
    // RP-04: Alcance
    // =========================================================================
    await t.test('RP-04: Usuario con alcance SECTORES sin S1 pide sector_id de S1 -> maquinas 0', async () => {
      const resp = await app.request(
        `/api/reportes/indicadores?desde=${T0}&hasta=${T10}&sector_id=${sector1Id}`,
        { headers: { Authorization: `Bearer ${userSectores2Token}` } }
      );
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();
      assert.strictEqual(json.maquinas, 0);
      assert.strictEqual(json.disponibilidad, null);
      assert.strictEqual(json.fallas, 0);
    });

    // =========================================================================
    // RP-05: Sin fallas
    // =========================================================================
    await t.test('RP-05: Período sin intervenciones en las mismas máquinas -> fallas 0, mtbf/mttr null, disponibilidad 1', async () => {
      const desdeVacio = '2025-05-01T00:00:00Z';
      const hastaVacio = '2025-05-11T00:00:00Z';

      const resp = await app.request(
        `/api/reportes/indicadores?desde=${desdeVacio}&hasta=${hastaVacio}&planta_id=${planta1Id}`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();
      assert.strictEqual(json.maquinas, 2);
      assert.strictEqual(json.fallas, 0);
      assert.strictEqual(json.correctivas_finalizadas, 0);
      assert.strictEqual(json.preventivas_finalizadas, 0);
      assert.strictEqual(json.mtbf_horas, null);
      assert.strictEqual(json.mttr_minutos, null);
      assert.strictEqual(json.respuesta_promedio_minutos, null);
      assert.strictEqual(json.inactividad_minutos, 0);
      assert.strictEqual(json.disponibilidad, 1);
    });

    // =========================================================================
    // RP-06: Filtros en los otros reportes
    // =========================================================================
    await t.test('RP-06: Filtros en los otros reportes (/inactividad y /tiempos)', async () => {
      // 1. /inactividad?planta_id=P1: solo A y B
      const respInac = await app.request(
        `/api/reportes/inactividad?desde=${T0}&hasta=${T10}&planta_id=${planta1Id}`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(respInac.status, 200);
      const jsonInac = await respInac.json();
      assert.strictEqual(jsonInac.length, 2);
      const idsInac = jsonInac.map((m: any) => Number(m.maquina.id));
      assert.strictEqual(idsInac.includes(maquinaAId), true);
      assert.strictEqual(idsInac.includes(maquinaBId), true);
      assert.strictEqual(idsInac.includes(maquinaCId), false);

      // 2. /tiempos?agrupar=tipo&planta_id=P1: no cuenta la de C
      const respTiemposP1 = await app.request(
        `/api/reportes/tiempos?desde=${T0}&hasta=${T10}&agrupar=tipo&planta_id=${planta1Id}`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(respTiemposP1.status, 200);
      const jsonTiemposP1 = await respTiemposP1.json();
      const corrP1 = jsonTiemposP1.find((g: any) => g.grupo === 'CORRECTIVO');
      // Solo C1 (1 correctiva finalizada), no la de C
      assert.strictEqual(corrP1 ? corrP1.cantidad : 0, 1);

      // 3. /tiempos?agrupar=tipo&sector_id=S1: igual
      const respTiemposS1 = await app.request(
        `/api/reportes/tiempos?desde=${T0}&hasta=${T10}&agrupar=tipo&sector_id=${sector1Id}`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(respTiemposS1.status, 200);
      const jsonTiemposS1 = await respTiemposS1.json();
      const corrS1 = jsonTiemposS1.find((g: any) => g.grupo === 'CORRECTIVO');
      assert.strictEqual(corrS1 ? corrS1.cantidad : 0, 1);

      // 4. planta_id=abc y sector_id=abc -> 422
      const respInacInvalido = await app.request(
        `/api/reportes/inactividad?desde=${T0}&hasta=${T10}&planta_id=abc`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(respInacInvalido.status, 422);

      const respTiemposInvalido = await app.request(
        `/api/reportes/tiempos?desde=${T0}&hasta=${T10}&agrupar=tipo&sector_id=abc`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(respTiemposInvalido.status, 422);
    });

    // =========================================================================
    // RP-07: Período
    // =========================================================================
    await t.test('RP-07: Período inválido (desde posterior a hasta, más de 366 días)', async () => {
      // desde igual o posterior a hasta: 422
      const respInvertido = await app.request(
        `/api/reportes/indicadores?desde=2025-06-11T00:00:00Z&hasta=2025-06-01T00:00:00Z`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(respInvertido.status, 422);

      // Más de 366 días: 422
      const respLargo = await app.request(
        `/api/reportes/indicadores?desde=2024-01-01T00:00:00Z&hasta=2025-02-01T00:00:00Z`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(respLargo.status, 422);
    });

  } finally {
    client = await clienteSano(client);
    // Limpieza estricta de los datos creados
    if (createdIntervencionIds.length > 0) {
      await client.query('DELETE FROM intervencion_periodos_detencion WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
      await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
      await client.query('DELETE FROM intervencion_auditoria WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
      await client.query(
        'DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE intervencion_id = ANY($1))',
        [createdIntervencionIds]
      );
      await client.query('DELETE FROM notificaciones WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
      await client.query('DELETE FROM intervenciones WHERE id = ANY($1)', [createdIntervencionIds]);
    }

    if (createdMaquinaIds.length > 0) {
      await client.query('DELETE FROM intervencion_periodos_detencion WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
      await client.query('DELETE FROM historial_estados_maquina WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
      await client.query('DELETE FROM maquinas WHERE id = ANY($1)', [createdMaquinaIds]);
    }

    if (createdUsuarioIds.length > 0) {
      await client.query('DELETE FROM usuario_permiso WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
      await client.query('DELETE FROM usuario_sector WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
      await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [createdUsuarioIds]);
    }

    if (createdSectorIds.length > 0) {
      await client.query('DELETE FROM sectores WHERE id = ANY($1)', [createdSectorIds]);
    }

    if (createdPlantaIds.length > 0) {
      await client.query('DELETE FROM plantas WHERE id = ANY($1)', [createdPlantaIds]);
    }

    client.release();
  }
});

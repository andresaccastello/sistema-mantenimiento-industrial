import { test } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import app from '../functions/api.ts';
import { pool } from '../functions/db.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (TIEMPOS TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Etapa 8 — Tiempos de gestión e inactividad real de las máquinas', async (t) => {
  const client = await pool.connect();

  const createdIntervencionIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdUsuarioIds: number[] = [];

  const limpiarIntervencion = async (id: number) => {
    await client.query('DELETE FROM intervencion_periodos_detencion WHERE intervencion_id = $1', [id]);
    await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id = $1', [id]);
    await client.query('DELETE FROM intervencion_auditoria WHERE intervencion_id = $1', [id]);
    await client.query('DELETE FROM notificaciones WHERE intervencion_id = $1', [id]);
    await client.query('DELETE FROM intervenciones WHERE id = $1', [id]);
  };

  const limpiarMaquina = async (mId: number) => {
    await client.query('DELETE FROM intervencion_periodos_detencion WHERE maquina_id = $1', [mId]);
    await client.query('DELETE FROM historial_estados_maquina WHERE maquina_id = $1', [mId]);
    await client.query('DELETE FROM maquinas WHERE id = $1', [mId]);
  };

  let adminToken = '';
  let adminId = 0;

  let operarioToken = '';
  let operarioId = 0;

  let userSectoresToken = '';
  let userSectoresId = 0;

  let sector1Id = 0;
  let sector2Id = 0;
  let maquina1Id = 0;
  let maquina2Id = 0;

  let tipoCorrectivoId = 1;
  let tipoPreventivoId = 2;

  try {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('pass123', 10);
    const testSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    // Limpieza preventiva de corridas anteriores abortadas
    await client.query(`
      DELETE FROM intervencion_periodos_detencion WHERE intervencion_id IN (
        SELECT id FROM intervenciones WHERE maquina_id IN (
          SELECT id FROM maquinas WHERE sector_id IN (
            SELECT id FROM sectores WHERE nombre LIKE 'Sector Tiempos%'
          )
        )
      );
      DELETE FROM historial_estados_intervencion WHERE intervencion_id IN (
        SELECT id FROM intervenciones WHERE maquina_id IN (
          SELECT id FROM maquinas WHERE sector_id IN (
            SELECT id FROM sectores WHERE nombre LIKE 'Sector Tiempos%'
          )
        )
      );
      DELETE FROM intervencion_auditoria WHERE intervencion_id IN (
        SELECT id FROM intervenciones WHERE maquina_id IN (
          SELECT id FROM maquinas WHERE sector_id IN (
            SELECT id FROM sectores WHERE nombre LIKE 'Sector Tiempos%'
          )
        )
      );
      DELETE FROM notificaciones WHERE intervencion_id IN (
        SELECT id FROM intervenciones WHERE maquina_id IN (
          SELECT id FROM maquinas WHERE sector_id IN (
            SELECT id FROM sectores WHERE nombre LIKE 'Sector Tiempos%'
          )
        )
      );
      DELETE FROM intervenciones WHERE maquina_id IN (
        SELECT id FROM maquinas WHERE sector_id IN (
          SELECT id FROM sectores WHERE nombre LIKE 'Sector Tiempos%'
        )
      );
      DELETE FROM intervencion_periodos_detencion WHERE maquina_id IN (
        SELECT id FROM maquinas WHERE sector_id IN (
          SELECT id FROM sectores WHERE nombre LIKE 'Sector Tiempos%'
        )
      );
      DELETE FROM historial_estados_maquina WHERE maquina_id IN (
        SELECT id FROM maquinas WHERE sector_id IN (
          SELECT id FROM sectores WHERE nombre LIKE 'Sector Tiempos%'
        )
      );
      DELETE FROM maquinas WHERE sector_id IN (
        SELECT id FROM sectores WHERE nombre LIKE 'Sector Tiempos%'
      );
      DELETE FROM usuario_sector WHERE sector_id IN (
        SELECT id FROM sectores WHERE nombre LIKE 'Sector Tiempos%'
      );
      DELETE FROM sectores WHERE nombre LIKE 'Sector Tiempos%';
    `);

    // 1. Admin login
    const resAdmin = await client.query("SELECT id FROM usuarios WHERE legajo = 'ADMIN001' LIMIT 1");
    adminId = Number(resAdmin.rows[0].id);

    const loginAdmin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: 'ADMIN001', password: process.env.ADMIN_INITIAL_PASSWORD || 'admin' }),
    });
    const dAdmin = await loginAdmin.json();
    adminToken = dAdmin.token;

    // 2. Perfiles
    const resPerfiles = await client.query('SELECT id, nombre FROM perfiles');
    const perfilMap = Object.fromEntries(resPerfiles.rows.map((r) => [r.nombre, Number(r.id)]));

    // 3. Tipos de intervención
    const resTipos = await client.query('SELECT id, codigo FROM tipos_intervencion');
    for (const r of resTipos.rows) {
      if (r.codigo === 'CORRECTIVO') tipoCorrectivoId = Number(r.id);
      if (r.codigo === 'PREVENTIVO') tipoPreventivoId = Number(r.id);
    }

    // 4. Sectores
    const resSec1 = await client.query(
      'INSERT INTO sectores (nombre) VALUES ($1) RETURNING id',
      [`Sector Tiempos 1 ${testSuffix}`]
    );
    sector1Id = Number(resSec1.rows[0].id);
    createdSectorIds.push(sector1Id);

    const resSec2 = await client.query(
      'INSERT INTO sectores (nombre) VALUES ($1) RETURNING id',
      [`Sector Tiempos 2 ${testSuffix}`]
    );
    sector2Id = Number(resSec2.rows[0].id);
    createdSectorIds.push(sector2Id);

    // 5. Máquinas base
    const resM1 = await client.query(
      'INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ($1, $2, $3, \'OPERATIVA\', TRUE) RETURNING id',
      [`Torno Tiempos 1 ${testSuffix}`, `MAQ-T1-${testSuffix}`, sector1Id]
    );
    maquina1Id = Number(resM1.rows[0].id);
    createdMaquinaIds.push(maquina1Id);

    const resM2 = await client.query(
      'INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ($1, $2, $3, \'OPERATIVA\', TRUE) RETURNING id',
      [`Fresadora Tiempos 2 ${testSuffix}`, `MAQ-T2-${testSuffix}`, sector2Id]
    );
    maquina2Id = Number(resM2.rows[0].id);
    createdMaquinaIds.push(maquina2Id);

    // 6. Operario (sin REPORTES_CONSULTAR)
    const legajoOp = 'OP_T_' + Date.now();
    const resOp = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, debe_cambiar_password)
       VALUES ($1, 'Operario Tiempos', $2, $3, TRUE, FALSE) RETURNING id`,
      [legajoOp, hash, perfilMap['OPERARIO']]
    );
    operarioId = Number(resOp.rows[0].id);
    createdUsuarioIds.push(operarioId);

    const loginOp = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoOp, password: 'pass123' }),
    });
    operarioToken = (await loginOp.json()).token;

    // 7. Usuario con REPORTES_CONSULTAR alcance SECTORES asignado solo a sector1Id
    const legajoSec = 'USER_SEC_' + Date.now();
    const resUserSec = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, debe_cambiar_password)
       VALUES ($1, 'Usuario Sectores Tiempos', $2, $3, TRUE, FALSE) RETURNING id`,
      [legajoSec, hash, perfilMap['CONSULTA']]
    );
    userSectoresId = Number(resUserSec.rows[0].id);
    createdUsuarioIds.push(userSectoresId);

    // Asignar sector1Id
    await client.query(
      'INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)',
      [userSectoresId, sector1Id]
    );

    // Dar override REPORTES_CONSULTAR alcance SECTORES
    const resPermRep = await client.query("SELECT id FROM permisos WHERE codigo = 'REPORTES_CONSULTAR'");
    const permRepId = resPermRep.rows[0].id;
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, otorgado_por_usuario_id, motivo)
       VALUES ($1, $2, 'CONCEDER', 'SECTORES', $3, 'Override reportes sectores para test')`,
      [userSectoresId, permRepId, adminId]
    );

    const loginUserSec = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoSec, password: 'pass123' }),
    });
    userSectoresToken = (await loginUserSec.json()).token;

    // =========================================================================
    // 7.1 TIEMPOS DE UNA INTERVENCIÓN (T-01 a T-10)
    // =========================================================================

    // T-01: Creada 08:00, inicio 09:00, fin 12:00, sin espera de repuestos -> espera 60, bruta 180, neta 180, total 240
    let intT01Id = 0;
    await t.test('T-01: Creada 08:00, inicio 09:00, fin 12:00 -> espera 60, bruta 180, neta 180, total 240', async () => {
      const res = await client.query(
        `INSERT INTO intervenciones (
           maquina_id, tipo_intervencion_id, creado_por_usuario_id, responsable_usuario_id,
           descripcion, estado, ejecucion, trabajo_realizado, fecha_creacion, fecha_inicio, fecha_finalizacion
         ) VALUES ($1, $2, $3, $3, 'T-01 Test', 'FINALIZADA', 'INTERNA', 'Trabajo OK',
           '2026-01-01 08:00:00Z', '2026-01-01 09:00:00Z', '2026-01-01 12:00:00Z')
         RETURNING id`,
        [maquina1Id, tipoCorrectivoId, adminId]
      );
      intT01Id = Number(res.rows[0].id);
      createdIntervencionIds.push(intT01Id);

      await client.query(
        `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, cambiado_en)
         VALUES
           ($1, NULL, 'PENDIENTE', $2, '2026-01-01 08:00:00Z'),
           ($1, 'PENDIENTE', 'EN_PROCESO', $2, '2026-01-01 09:00:00Z'),
           ($1, 'EN_PROCESO', 'FINALIZADA', $2, '2026-01-01 12:00:00Z')`,
        [intT01Id, adminId]
      );

      const resp = await app.request(`/api/intervenciones/${intT01Id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();
      assert.ok(json.tiempos, 'Debe incluir bloque tiempos');
      assert.strictEqual(json.tiempos.espera_minutos, 60);
      assert.strictEqual(json.tiempos.espera_en_curso, false);
      assert.strictEqual(json.tiempos.duracion_bruta_minutos, 180);
      assert.strictEqual(json.tiempos.duracion_neta_minutos, 180);
      assert.strictEqual(json.tiempos.tiempo_total_minutos, 240);
      assert.strictEqual(json.tiempos.trabajo_en_curso, false);
    });

    // T-02: En proceso 09:00–10:00, en espera 10:00–11:30, en proceso 11:30–12:00, fin 12:00 -> bruta 180, neta 90
    let intT02Id = 0;
    await t.test('T-02: En proceso, espera repuestos y reanudación -> bruta 180, neta 90', async () => {
      const res = await client.query(
        `INSERT INTO intervenciones (
           maquina_id, tipo_intervencion_id, creado_por_usuario_id, responsable_usuario_id,
           descripcion, estado, ejecucion, trabajo_realizado, fecha_creacion, fecha_inicio, fecha_finalizacion
         ) VALUES ($1, $2, $3, $3, 'T-02 Test', 'FINALIZADA', 'INTERNA', 'Trabajo OK',
           '2026-01-01 08:00:00Z', '2026-01-01 09:00:00Z', '2026-01-01 12:00:00Z')
         RETURNING id`,
        [maquina1Id, tipoCorrectivoId, adminId]
      );
      intT02Id = Number(res.rows[0].id);
      createdIntervencionIds.push(intT02Id);

      await client.query(
        `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, cambiado_en, observacion)
         VALUES
           ($1, NULL, 'PENDIENTE', $2, '2026-01-01 08:00:00Z', NULL),
           ($1, 'PENDIENTE', 'EN_PROCESO', $2, '2026-01-01 09:00:00Z', NULL),
           ($1, 'EN_PROCESO', 'EN_ESPERA_REPUESTOS', $2, '2026-01-01 10:00:00Z', 'Esperando repuestos rodamiento'),
           ($1, 'EN_ESPERA_REPUESTOS', 'EN_PROCESO', $2, '2026-01-01 11:30:00Z', NULL),
           ($1, 'EN_PROCESO', 'FINALIZADA', $2, '2026-01-01 12:00:00Z', NULL)`,
        [intT02Id, adminId]
      );

      const resp = await app.request(`/api/intervenciones/${intT02Id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();
      assert.strictEqual(json.tiempos.duracion_bruta_minutos, 180);
      assert.strictEqual(json.tiempos.duracion_neta_minutos, 90);
    });

    // T-03: Finalizada 12:00, reabierta 15:00, finalizada 17:00 (inicio 09:00) -> bruta 480, neta 300
    let intT03Id = 0;
    await t.test('T-03: Reapertura -> bruta 480 (cubre el hueco), neta 300 (excluye el hueco)', async () => {
      const res = await client.query(
        `INSERT INTO intervenciones (
           maquina_id, tipo_intervencion_id, creado_por_usuario_id, responsable_usuario_id,
           descripcion, estado, ejecucion, trabajo_realizado, fecha_creacion, fecha_inicio, fecha_finalizacion
         ) VALUES ($1, $2, $3, $3, 'T-03 Test', 'FINALIZADA', 'INTERNA', 'Trabajo OK',
           '2026-01-01 08:00:00Z', '2026-01-01 09:00:00Z', '2026-01-01 17:00:00Z')
         RETURNING id`,
        [maquina1Id, tipoCorrectivoId, adminId]
      );
      intT03Id = Number(res.rows[0].id);
      createdIntervencionIds.push(intT03Id);

      await client.query(
        `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, cambiado_en)
         VALUES
           ($1, NULL, 'PENDIENTE', $2, '2026-01-01 08:00:00Z'),
           ($1, 'PENDIENTE', 'EN_PROCESO', $2, '2026-01-01 09:00:00Z'),
           ($1, 'EN_PROCESO', 'FINALIZADA', $2, '2026-01-01 12:00:00Z'),
           ($1, 'FINALIZADA', 'EN_PROCESO', $2, '2026-01-01 15:00:00Z'),
           ($1, 'EN_PROCESO', 'FINALIZADA', $2, '2026-01-01 17:00:00Z')`,
        [intT03Id, adminId]
      );

      const resp = await app.request(`/api/intervenciones/${intT03Id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();
      assert.strictEqual(json.tiempos.duracion_bruta_minutos, 480);
      assert.strictEqual(json.tiempos.duracion_neta_minutos, 300);
    });

    // T-04: Pendiente creada hace 2 h -> espera ≈ 120 con espera_en_curso = true; bruta, neta y total NULL
    await t.test('T-04: Pendiente creada hace 2 h -> espera ≈ 120, espera_en_curso = true, bruta/neta/total NULL', async () => {
      const res = await client.query(
        `INSERT INTO intervenciones (
           maquina_id, tipo_intervencion_id, creado_por_usuario_id,
           descripcion, estado, fecha_creacion
         ) VALUES ($1, $2, $3, 'T-04 Test', 'PENDIENTE', NOW() - INTERVAL '120 minutes')
         RETURNING id`,
        [maquina1Id, tipoCorrectivoId, adminId]
      );
      const intId = Number(res.rows[0].id);
      createdIntervencionIds.push(intId);

      await client.query(
        `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, cambiado_en)
         VALUES ($1, NULL, 'PENDIENTE', $2, NOW() - INTERVAL '120 minutes')`,
        [intId, adminId]
      );

      const resp = await app.request(`/api/intervenciones/${intId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();
      assert.strictEqual(json.tiempos.espera_en_curso, true);
      assert.ok(Math.abs(json.tiempos.espera_minutos - 120) <= 1, `Espera debe ser ≈ 120, fue ${json.tiempos.espera_minutos}`);
      assert.strictEqual(json.tiempos.duracion_bruta_minutos, null);
      assert.strictEqual(json.tiempos.duracion_neta_minutos, null);
      assert.strictEqual(json.tiempos.tiempo_total_minutos, null);
    });

    // T-05: "Resolver ahora" con inicio 10:00 y fin 10:20 -> bruta 20, neta 20
    await t.test('T-05: Resolver ahora con inicio 10:00 y fin 10:20 -> bruta 20, neta 20', async () => {
      const res = await client.query(
        `INSERT INTO intervenciones (
           maquina_id, tipo_intervencion_id, creado_por_usuario_id, responsable_usuario_id,
           descripcion, estado, ejecucion, trabajo_realizado, fecha_creacion, fecha_inicio, fecha_finalizacion
         ) VALUES ($1, $2, $3, $3, 'T-05 Test', 'FINALIZADA', 'INTERNA', 'Trabajo OK',
           '2026-01-01 09:50:00Z', '2026-01-01 10:00:00Z', '2026-01-01 10:20:00Z')
         RETURNING id`,
        [maquina1Id, tipoCorrectivoId, adminId]
      );
      const intId = Number(res.rows[0].id);
      createdIntervencionIds.push(intId);

      // Resolver ahora inserta exactamente dos filas en historial a la hora del registro
      await client.query(
        `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, cambiado_en)
         VALUES
           ($1, NULL, 'PENDIENTE', $2, '2026-01-01 09:50:00Z'),
           ($1, 'PENDIENTE', 'EN_PROCESO', $2, '2026-01-01 10:20:00Z'),
           ($1, 'EN_PROCESO', 'FINALIZADA', $2, '2026-01-01 10:20:00Z')`,
        [intId, adminId]
      );

      const resp = await app.request(`/api/intervenciones/${intId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();
      assert.strictEqual(json.tiempos.duracion_bruta_minutos, 20);
      assert.strictEqual(json.tiempos.duracion_neta_minutos, 20);
    });

    // T-06: Iniciada con fecha_inicio cargada 1 h antes del registro del cambio -> neta empieza en fecha_inicio
    await t.test('T-06: fecha_inicio cargada 1 h antes del cambio -> neta empieza en fecha_inicio, no en cambiado_en', async () => {
      const res = await client.query(
        `INSERT INTO intervenciones (
           maquina_id, tipo_intervencion_id, creado_por_usuario_id, responsable_usuario_id,
           descripcion, estado, ejecucion, trabajo_realizado, fecha_creacion, fecha_inicio, fecha_finalizacion
         ) VALUES ($1, $2, $3, $3, 'T-06 Test', 'FINALIZADA', 'INTERNA', 'Trabajo OK',
           '2026-01-01 08:00:00Z', '2026-01-01 09:00:00Z', '2026-01-01 12:00:00Z')
         RETURNING id`,
        [maquina1Id, tipoCorrectivoId, adminId]
      );
      const intId = Number(res.rows[0].id);
      createdIntervencionIds.push(intId);

      // El cambio a EN_PROCESO se registró a las 10:00 (1 hora después del inicio real 09:00)
      await client.query(
        `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, cambiado_en)
         VALUES
           ($1, NULL, 'PENDIENTE', $2, '2026-01-01 08:00:00Z'),
           ($1, 'PENDIENTE', 'EN_PROCESO', $2, '2026-01-01 10:00:00Z'),
           ($1, 'EN_PROCESO', 'FINALIZADA', $2, '2026-01-01 12:00:00Z')`,
        [intId, adminId]
      );

      const resp = await app.request(`/api/intervenciones/${intId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();
      assert.strictEqual(json.tiempos.duracion_bruta_minutos, 180);
      assert.strictEqual(json.tiempos.duracion_neta_minutos, 180);
    });

    // T-07: En proceso desde hace 30 min -> bruta y neta ≈ 30, trabajo_en_curso = true
    await t.test('T-07: En proceso desde hace 30 min -> bruta y neta ≈ 30, trabajo_en_curso = true', async () => {
      const res = await client.query(
        `INSERT INTO intervenciones (
           maquina_id, tipo_intervencion_id, creado_por_usuario_id, responsable_usuario_id,
           descripcion, estado, fecha_creacion, fecha_inicio
         ) VALUES ($1, $2, $3, $3, 'T-07 Test', 'EN_PROCESO',
           NOW() - INTERVAL '60 minutes', NOW() - INTERVAL '30 minutes')
         RETURNING id`,
        [maquina1Id, tipoCorrectivoId, adminId]
      );
      const intId = Number(res.rows[0].id);
      createdIntervencionIds.push(intId);

      await client.query(
        `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, cambiado_en)
         VALUES
           ($1, NULL, 'PENDIENTE', $2, NOW() - INTERVAL '60 minutes'),
           ($1, 'PENDIENTE', 'EN_PROCESO', $2, NOW() - INTERVAL '30 minutes')`,
        [intId, adminId]
      );

      const resp = await app.request(`/api/intervenciones/${intId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();
      assert.strictEqual(json.tiempos.trabajo_en_curso, true);
      assert.ok(Math.abs(json.tiempos.duracion_bruta_minutos - 30) <= 1, `Bruta ≈ 30, fue ${json.tiempos.duracion_bruta_minutos}`);
      assert.ok(Math.abs(json.tiempos.duracion_neta_minutos - 30) <= 1, `Neta ≈ 30, fue ${json.tiempos.duracion_neta_minutos}`);
    });

    // T-08: Cancelada sin empezar -> espera NULL, bruta NULL, neta 0
    await t.test('T-08: Cancelada sin empezar -> espera NULL, bruta NULL, neta 0', async () => {
      const res = await client.query(
        `INSERT INTO intervenciones (
           maquina_id, tipo_intervencion_id, creado_por_usuario_id,
           descripcion, estado, fecha_creacion
         ) VALUES ($1, $2, $3, 'T-08 Test', 'CANCELADA', '2026-01-01 08:00:00Z')
         RETURNING id`,
        [maquina1Id, tipoCorrectivoId, adminId]
      );
      const intId = Number(res.rows[0].id);
      createdIntervencionIds.push(intId);

      await client.query(
        `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, cambiado_en, observacion)
         VALUES
           ($1, NULL, 'PENDIENTE', $2, '2026-01-01 08:00:00Z', NULL),
           ($1, 'PENDIENTE', 'CANCELADA', $2, '2026-01-01 08:30:00Z', 'Cancelación justificada')`,
        [intId, adminId]
      );

      const resp = await app.request(`/api/intervenciones/${intId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();
      assert.strictEqual(json.tiempos.espera_minutos, null);
      assert.strictEqual(json.tiempos.duracion_bruta_minutos, null);
      assert.strictEqual(json.tiempos.duracion_neta_minutos, 0);
      assert.strictEqual(json.tiempos.tiempo_total_minutos, null);
    });

    // T-09: Un período cerrado de 2 h y uno abierto desde hace 1 h -> inactividad_minutos ≈ 180, en curso = true, columna guardada = 120
    await t.test('T-09: Período cerrado 2h y abierto 1h -> inactividad ≈ 180, inactividad_en_curso = true, columna guardada = 120', async () => {
      const res = await client.query(
        `INSERT INTO intervenciones (
           maquina_id, tipo_intervencion_id, creado_por_usuario_id,
           descripcion, estado, fecha_creacion, tiempo_inactividad_minutos
         ) VALUES ($1, $2, $3, 'T-09 Test', 'EN_PROCESO', NOW() - INTERVAL '4 hours', 120)
         RETURNING id`,
        [maquina1Id, tipoCorrectivoId, adminId]
      );
      const intId = Number(res.rows[0].id);
      createdIntervencionIds.push(intId);

      // Período cerrado de 2 horas (hace 3 horas a hace 1 hora)
      await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, hasta, abierto_por_usuario_id, confirmado_por_usuario_id)
         VALUES ($1, $2, NOW() - INTERVAL '3 hours', NOW() - INTERVAL '1 hour', $3, $3)`,
        [intId, maquina1Id, adminId]
      );

      // Período abierto de 1 hora (hace 1 hora hasta ahora)
      await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, hasta, abierto_por_usuario_id)
         VALUES ($1, $2, NOW() - INTERVAL '1 hour', NULL, $3)`,
        [intId, maquina1Id, adminId]
      );

      const resp = await app.request(`/api/intervenciones/${intId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();
      assert.strictEqual(json.tiempo_inactividad_minutos, 120, 'Columna guardada debe seguir en 120');
      assert.strictEqual(json.tiempos.inactividad_en_curso, true);
      assert.ok(Math.abs(json.tiempos.inactividad_minutos - 180) <= 1, `Inactividad debe ser ≈ 180, fue ${json.tiempos.inactividad_minutos}`);
    });

    // T-10: El listado trae el bloque tiempos en cada elemento, igual al del detalle
    await t.test('T-10: GET /api/intervenciones trae bloque tiempos idéntico al detalle', async () => {
      const resp = await app.request('/api/intervenciones', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resp.status, 200);
      const listado = await resp.json();
      assert.ok(Array.isArray(listado));

      const elemT01 = listado.find((i: any) => i.id === intT01Id);
      assert.ok(elemT01, 'T-01 debe estar en el listado');
      assert.deepStrictEqual(elemT01.tiempos, {
        espera_minutos: 60,
        espera_en_curso: false,
        duracion_bruta_minutos: 180,
        duracion_neta_minutos: 180,
        tiempo_total_minutos: 240,
        trabajo_en_curso: false,
        inactividad_minutos: 0,
        inactividad_en_curso: false,
      });

      const elemT02 = listado.find((i: any) => i.id === intT02Id);
      assert.ok(elemT02, 'T-02 debe estar en el listado');
      assert.strictEqual(elemT02.tiempos.duracion_neta_minutos, 90);
      assert.strictEqual(elemT02.tiempos.duracion_bruta_minutos, 180);
    });

    // =========================================================================
    // 7.2 INACTIVIDAD DE LA MÁQUINA (M-01 a M-09)
    // =========================================================================

    // M-01: Ejemplo 7.2 del análisis: A 08:00–12:00, B 10:00–14:00 -> 360 (no 480)
    let maqM01Id = 0;
    await t.test('M-01: Ejemplo 7.2 análisis: A 08:00–12:00, B 10:00–14:00 -> unión = 360 min', async () => {
      const resM = await client.query(
        "INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ('Maq M01', $2, $1, 'OPERATIVA', TRUE) RETURNING id",
        [sector1Id, 'MAQ-M01-' + testSuffix]
      );
      maqM01Id = Number(resM.rows[0].id);
      createdMaquinaIds.push(maqM01Id);

      const resIA = await client.query(
        "INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, ejecucion, trabajo_realizado, fecha_inicio, fecha_finalizacion) VALUES ($1, $2, $3, 'A', 'FINALIZADA', 'INTERNA', 'Trabajo A', '2026-05-01 08:00:00Z', '2026-05-01 12:00:00Z') RETURNING id",
        [maqM01Id, tipoCorrectivoId, adminId]
      );
      const resIB = await client.query(
        "INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, ejecucion, trabajo_realizado, fecha_inicio, fecha_finalizacion) VALUES ($1, $2, $3, 'B', 'FINALIZADA', 'INTERNA', 'Trabajo B', '2026-05-01 10:00:00Z', '2026-05-01 14:00:00Z') RETURNING id",
        [maqM01Id, tipoCorrectivoId, adminId]
      );
      createdIntervencionIds.push(Number(resIA.rows[0].id), Number(resIB.rows[0].id));

      await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, hasta, abierto_por_usuario_id, confirmado_por_usuario_id)
         VALUES
           ($1, $3, '2026-05-01 08:00:00Z', '2026-05-01 12:00:00Z', $4, $4),
           ($2, $3, '2026-05-01 10:00:00Z', '2026-05-01 14:00:00Z', $4, $4)`,
        [resIA.rows[0].id, resIB.rows[0].id, maqM01Id, adminId]
      );

      const resp = await app.request(
        `/api/maquinas/${maqM01Id}/inactividad?desde=2026-05-01T00:00:00Z&hasta=2026-05-01T23:59:59Z`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();
      assert.strictEqual(json.inactividad_minutos, 360, 'Inactividad total debe ser 360 min (6 h)');
      assert.strictEqual(json.periodos.length, 2);
    });

    // M-02: Igual que M-01, pidiendo intervalo 09:00–11:00 -> 120 (recortado)
    await t.test('M-02: Recorte al intervalo 09:00–11:00 -> 120 min', async () => {
      const resp = await app.request(
        `/api/maquinas/${maqM01Id}/inactividad?desde=2026-05-01T09:00:00Z&hasta=2026-05-01T11:00:00Z`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();
      assert.strictEqual(json.inactividad_minutos, 120, 'Debe ser recortado exactamente a 120 min (2 h)');
      assert.strictEqual(json.periodos.length, 2, 'Los dos períodos se superponen con el intervalo');
    });

    // M-03: Detención 08:00–14:00 con la máquina FUERA_DE_SERVICIO 10:00–12:00 -> 240, descontado 120
    await t.test('M-03: Detención 08:00–14:00 con FUERA_DE_SERVICIO 10:00–12:00 -> 240, descontado 120', async () => {
      const resM = await client.query(
        "INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ('Maq M03', $2, $1, 'OPERATIVA', TRUE) RETURNING id",
        [sector1Id, 'MAQ-M03-' + testSuffix]
      );
      const maqId = Number(resM.rows[0].id);
      createdMaquinaIds.push(maqId);

      const resI = await client.query(
        "INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, ejecucion, trabajo_realizado, fecha_inicio, fecha_finalizacion) VALUES ($1, $2, $3, 'M03', 'FINALIZADA', 'INTERNA', 'Trabajo M03', '2026-05-02 08:00:00Z', '2026-05-02 14:00:00Z') RETURNING id",
        [maqId, tipoCorrectivoId, adminId]
      );
      createdIntervencionIds.push(Number(resI.rows[0].id));

      await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, hasta, abierto_por_usuario_id, confirmado_por_usuario_id)
         VALUES ($1, $2, '2026-05-02 08:00:00Z', '2026-05-02 14:00:00Z', $3, $3)`,
        [resI.rows[0].id, maqId, adminId]
      );

      // Historial de la máquina con FUERA_DE_SERVICIO entre 10:00 y 12:00
      await client.query(
        `INSERT INTO historial_estados_maquina (maquina_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, cambiado_en)
         VALUES
           ($1, 'OPERATIVA', 'FUERA_DE_SERVICIO', $2, '2026-05-02 10:00:00Z'),
           ($1, 'FUERA_DE_SERVICIO', 'OPERATIVA', $2, '2026-05-02 12:00:00Z')`,
        [maqId, adminId]
      );

      const resp = await app.request(
        `/api/maquinas/${maqId}/inactividad?desde=2026-05-02T00:00:00Z&hasta=2026-05-02T23:59:59Z`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();
      assert.strictEqual(json.inactividad_minutos, 240, 'Inactividad neta descontada debe ser 240');
      assert.strictEqual(json.fuera_de_servicio_descontado_minutos, 120, 'FDS descontado debe ser 120');
    });

    // M-04: Un período de una intervención eliminada y otro de una cancelada -> eliminada no cuenta, cancelada sí
    await t.test('M-04: Eliminada no cuenta, cancelada sí cuenta', async () => {
      const resM = await client.query(
        "INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ('Maq M04', $2, $1, 'OPERATIVA', TRUE) RETURNING id",
        [sector1Id, 'MAQ-M04-' + testSuffix]
      );
      const maqId = Number(resM.rows[0].id);
      createdMaquinaIds.push(maqId);

      // Intervención eliminada lógicamente
      const resElim = await client.query(
        `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, eliminado_en, eliminado_por_usuario_id, motivo_eliminacion)
         VALUES ($1, $2, $3, 'Eliminada', 'CANCELADA', '2026-05-03 10:00:00Z', $3, 'Error') RETURNING id`,
        [maqId, tipoCorrectivoId, adminId]
      );
      createdIntervencionIds.push(Number(resElim.rows[0].id));

      await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, hasta, abierto_por_usuario_id, confirmado_por_usuario_id)
         VALUES ($1, $2, '2026-05-03 08:00:00Z', '2026-05-03 10:00:00Z', $3, $3)`,
        [resElim.rows[0].id, maqId, adminId]
      );

      // Intervención cancelada (válida, no eliminada)
      const resCanc = await client.query(
        `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado)
         VALUES ($1, $2, $3, 'Cancelada', 'CANCELADA') RETURNING id`,
        [maqId, tipoCorrectivoId, adminId]
      );
      createdIntervencionIds.push(Number(resCanc.rows[0].id));

      await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, hasta, abierto_por_usuario_id, confirmado_por_usuario_id)
         VALUES ($1, $2, '2026-05-03 10:00:00Z', '2026-05-03 11:30:00Z', $3, $3)`,
        [resCanc.rows[0].id, maqId, adminId]
      );

      const resp = await app.request(
        `/api/maquinas/${maqId}/inactividad?desde=2026-05-03T00:00:00Z&hasta=2026-05-03T23:59:59Z`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();
      assert.strictEqual(json.inactividad_minutos, 90, 'Solo debe contar el período de la intervención cancelada (90 min)');
      assert.strictEqual(json.periodos.length, 1, 'Solo debe aparecer el período de la no eliminada');
    });

    // M-05: Un período abierto desde hace 2 h; con hasta = hace 1 h -> ≈ 120; 60 (corta en hasta)
    await t.test('M-05: Período abierto desde hace 2 h; con hasta = hace 1 h corta en 60', async () => {
      const resM = await client.query(
        "INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ('Maq M05', $2, $1, 'OPERATIVA', TRUE) RETURNING id",
        [sector1Id, 'MAQ-M05-' + testSuffix]
      );
      const maqId = Number(resM.rows[0].id);
      createdMaquinaIds.push(maqId);

      const resI = await client.query(
        "INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado) VALUES ($1, $2, $3, 'M05', 'EN_PROCESO') RETURNING id",
        [maqId, tipoCorrectivoId, adminId]
      );
      createdIntervencionIds.push(Number(resI.rows[0].id));

      await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, hasta, abierto_por_usuario_id)
         VALUES ($1, $2, NOW() - INTERVAL '2 hours', NULL, $3)`,
        [resI.rows[0].id, maqId, adminId]
      );

      // Consulta 1: Por defecto (hasta NOW())
      const resp1 = await app.request(`/api/maquinas/${maqId}/inactividad`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resp1.status, 200);
      const json1 = await resp1.json();
      assert.ok(Math.abs(json1.inactividad_minutos - 120) <= 1, `Debe ser ≈ 120, fue ${json1.inactividad_minutos}`);

      // Consulta 2: Cortando hasta hace 1 hora
      const resNowMinus1 = await client.query("SELECT (NOW() - INTERVAL '1 hour')::text AS h, (NOW() - INTERVAL '3 hours')::text AS d");
      const hastaCorte = new Date(resNowMinus1.rows[0].h).toISOString();
      const desdeCorte = new Date(resNowMinus1.rows[0].d).toISOString();

      const resp2 = await app.request(
        `/api/maquinas/${maqId}/inactividad?desde=${encodeURIComponent(desdeCorte)}&hasta=${encodeURIComponent(hastaCorte)}`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resp2.status, 200);
      const json2 = await resp2.json();
      assert.ok(Math.abs(json2.inactividad_minutos - 60) <= 1, `Debe cortar en hasta a ≈ 60 min, fue ${json2.inactividad_minutos}`);
    });

    // M-06: Correctiva 08:00–12:00 y preventiva 10:00–13:00 -> total 300, CORRECTIVO 240, PREVENTIVO 180
    await t.test('M-06: Desglose por tipo: Correctiva 08:00–12:00 y Preventiva 10:00–13:00 -> total 300, CORR 240, PREV 180', async () => {
      const resM = await client.query(
        "INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ('Maq M06', $2, $1, 'OPERATIVA', TRUE) RETURNING id",
        [sector1Id, 'MAQ-M06-' + testSuffix]
      );
      const maqId = Number(resM.rows[0].id);
      createdMaquinaIds.push(maqId);

      const resCorr = await client.query(
        `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, ejecucion, trabajo_realizado, fecha_inicio, fecha_finalizacion)
         VALUES ($1, $2, $3, 'Corr', 'FINALIZADA', 'INTERNA', 'Trabajo Corr', '2026-05-04 08:00:00Z', '2026-05-04 12:00:00Z') RETURNING id`,
        [maqId, tipoCorrectivoId, adminId]
      );
      const resPrev = await client.query(
        `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, ejecucion, trabajo_realizado, fecha_inicio, fecha_finalizacion)
         VALUES ($1, $2, $3, 'Prev', 'FINALIZADA', 'INTERNA', 'Trabajo Prev', '2026-05-04 10:00:00Z', '2026-05-04 13:00:00Z') RETURNING id`,
        [maqId, tipoPreventivoId, adminId]
      );
      createdIntervencionIds.push(Number(resCorr.rows[0].id), Number(resPrev.rows[0].id));

      await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, hasta, abierto_por_usuario_id, confirmado_por_usuario_id)
         VALUES
           ($1, $3, '2026-05-04 08:00:00Z', '2026-05-04 12:00:00Z', $4, $4),
           ($2, $3, '2026-05-04 10:00:00Z', '2026-05-04 13:00:00Z', $4, $4)`,
        [resCorr.rows[0].id, resPrev.rows[0].id, maqId, adminId]
      );

      const resp = await app.request(
        `/api/maquinas/${maqId}/inactividad?desde=2026-05-04T00:00:00Z&hasta=2026-05-04T23:59:59Z`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();
      assert.strictEqual(json.inactividad_minutos, 300, 'Unión total debe ser 300 min');
      assert.strictEqual(json.por_tipo.CORRECTIVO, 240, 'Correctivo debe ser 240 min');
      assert.strictEqual(json.por_tipo.PREVENTIVO, 180, 'Preventivo debe ser 180 min');
    });

    // M-07: Máquina sin detenciones -> 0 y periodos vacío
    await t.test('M-07: Máquina sin detenciones -> inactividad 0 y periodos vacío', async () => {
      const resM = await client.query(
        "INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ('Maq M07', $2, $1, 'OPERATIVA', TRUE) RETURNING id",
        [sector1Id, 'MAQ-M07-' + testSuffix]
      );
      const maqId = Number(resM.rows[0].id);
      createdMaquinaIds.push(maqId);

      const resp = await app.request(`/api/maquinas/${maqId}/inactividad`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();
      assert.strictEqual(json.inactividad_minutos, 0);
      assert.strictEqual(json.por_tipo.CORRECTIVO, 0);
      assert.strictEqual(json.por_tipo.PREVENTIVO, 0);
      assert.strictEqual(json.fuera_de_servicio_descontado_minutos, 0);
      assert.deepStrictEqual(json.periodos, []);
    });

    // M-08: Sin REPORTES_CONSULTAR -> 403; con alcance SECTORES sobre máquina de otro sector -> 404
    await t.test('M-08: Autorización: sin permiso -> 403; alcance SECTORES máquina ajena -> 404', async () => {
      // 1. Sin REPORTES_CONSULTAR (operario)
      const resp403 = await app.request(`/api/maquinas/${maquina1Id}/inactividad`, {
        headers: { Authorization: `Bearer ${operarioToken}` },
      });
      assert.strictEqual(resp403.status, 403);

      // 2. Con alcance SECTORES sobre máquina de su sector (maquina1Id está en sector1Id) -> 200
      const resp200 = await app.request(`/api/maquinas/${maquina1Id}/inactividad`, {
        headers: { Authorization: `Bearer ${userSectoresToken}` },
      });
      assert.strictEqual(resp200.status, 200);

      // 3. Con alcance SECTORES sobre máquina de otro sector (maquina2Id está en sector2Id) -> 404
      const resp404 = await app.request(`/api/maquinas/${maquina2Id}/inactividad`, {
        headers: { Authorization: `Bearer ${userSectoresToken}` },
      });
      assert.strictEqual(resp404.status, 404);
    });

    // M-09: La función SQL contra cálculo hecho a mano en test (fusión en TypeScript) para 6 períodos
    await t.test('M-09: Validación cruzada: función SQL vs fusión de intervalos en TypeScript para 6 períodos', async () => {
      const resM = await client.query(
        "INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ('Maq M09', $2, $1, 'OPERATIVA', TRUE) RETURNING id",
        [sector1Id, 'MAQ-M09-' + testSuffix]
      );
      const maqId = Number(resM.rows[0].id);
      createdMaquinaIds.push(maqId);

      const resI = await client.query(
        "INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, ejecucion, trabajo_realizado, fecha_inicio, fecha_finalizacion) VALUES ($1, $2, $3, 'M09', 'FINALIZADA', 'INTERNA', 'Trabajo M09', '2026-06-01 01:00:00Z', '2026-06-01 14:00:00Z') RETURNING id",
        [maqId, tipoCorrectivoId, adminId]
      );
      createdIntervencionIds.push(Number(resI.rows[0].id));

      // 6 períodos con solapamientos variados y huecos
      const periodosRaw = [
        { d: '2026-06-01 01:00:00Z', h: '2026-06-01 03:00:00Z' },
        { d: '2026-06-01 02:00:00Z', h: '2026-06-01 05:00:00Z' }, // solapa con 1 -> [01:00, 05:00)
        { d: '2026-06-01 06:00:00Z', h: '2026-06-01 07:30:00Z' }, // hueco
        { d: '2026-06-01 07:00:00Z', h: '2026-06-01 09:00:00Z' }, // solapa con 3 -> [06:00, 09:00)
        { d: '2026-06-01 08:30:00Z', h: '2026-06-01 10:00:00Z' }, // solapa con 4 -> [06:00, 10:00)
        { d: '2026-06-01 12:00:00Z', h: '2026-06-01 14:00:00Z' }, // hueco -> [12:00, 14:00)
      ];

      for (const p of periodosRaw) {
        await client.query(
          `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, hasta, abierto_por_usuario_id, confirmado_por_usuario_id)
           VALUES ($1, $2, $3, $4, $5, $5)`,
          [resI.rows[0].id, maqId, p.d, p.h, adminId]
        );
      }

      // Algoritmo en TypeScript de unión de intervalos ordenados
      const sorted = periodosRaw
        .map((p) => ({ start: new Date(p.d).getTime(), end: new Date(p.h).getTime() }))
        .sort((a, b) => a.start - b.start);

      const merged: Array<{ start: number; end: number }> = [];
      for (const cur of sorted) {
        if (merged.length === 0) {
          merged.push({ ...cur });
        } else {
          const last = merged[merged.length - 1];
          if (cur.start <= last.end) {
            last.end = Math.max(last.end, cur.end);
          } else {
            merged.push({ ...cur });
          }
        }
      }

      const totalMs = merged.reduce((acc, cur) => acc + (cur.end - cur.start), 0);
      const expectedMinutos = Math.round(totalMs / 60000);

      // Consulta a la función SQL
      const resSql = await client.query(
        "SELECT total_minutos FROM fn_inactividad_maquina($1, '2026-06-01 00:00:00Z', '2026-06-01 23:59:59Z')",
        [maqId]
      );
      assert.strictEqual(resSql.rows[0].total_minutos, expectedMinutos, `Función SQL (${resSql.rows[0].total_minutos}) debe coincidir con cálculo TypeScript (${expectedMinutos})`);
    });

    // =========================================================================
    // 7.3 REPORTES, VALIDACIONES Y REGRESIÓN (R-01 a R-03)
    // =========================================================================

    // R-01: /reportes/inactividad con tres máquinas (360, 0 y 90 minutos) y filtro de sector
    await t.test('R-01: /reportes/inactividad: orden DESC por inactividad, filtro de sector y alcance SECTORES', async () => {
      // 3 máquinas en fecha 2026-07-01
      // M_R1: en sector 1, 360 min
      const resR1 = await client.query(
        "INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ('Maq R1 (360m)', $2, $1, 'OPERATIVA', TRUE) RETURNING id",
        [sector1Id, 'MAQ-R1-' + testSuffix]
      );
      const mR1 = Number(resR1.rows[0].id);

      // M_R2: en sector 1, 0 min
      const resR2 = await client.query(
        "INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ('Maq R2 (0m)', $2, $1, 'OPERATIVA', TRUE) RETURNING id",
        [sector1Id, 'MAQ-R2-' + testSuffix]
      );
      const mR2 = Number(resR2.rows[0].id);

      // M_R3: en sector 2, 90 min
      const resR3 = await client.query(
        "INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ('Maq R3 (90m)', $2, $1, 'OPERATIVA', TRUE) RETURNING id",
        [sector2Id, 'MAQ-R3-' + testSuffix]
      );
      const mR3 = Number(resR3.rows[0].id);

      createdMaquinaIds.push(mR1, mR2, mR3);

      const resI1 = await client.query(
        "INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, ejecucion, trabajo_realizado, fecha_inicio, fecha_finalizacion) VALUES ($1, $2, $3, 'R1', 'FINALIZADA', 'INTERNA', 'Trabajo R1', '2026-07-01 08:00:00Z', '2026-07-01 14:00:00Z') RETURNING id",
        [mR1, tipoCorrectivoId, adminId]
      );
      const resI3 = await client.query(
        "INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, ejecucion, trabajo_realizado, fecha_inicio, fecha_finalizacion) VALUES ($1, $2, $3, 'R3', 'FINALIZADA', 'INTERNA', 'Trabajo R3', '2026-07-01 10:00:00Z', '2026-07-01 11:30:00Z') RETURNING id",
        [mR3, tipoCorrectivoId, adminId]
      );
      createdIntervencionIds.push(Number(resI1.rows[0].id), Number(resI3.rows[0].id));

      await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, hasta, abierto_por_usuario_id, confirmado_por_usuario_id)
         VALUES
           ($1, $2, '2026-07-01 08:00:00Z', '2026-07-01 14:00:00Z', $4, $4),
           ($3, $5, '2026-07-01 10:00:00Z', '2026-07-01 11:30:00Z', $4, $4)`,
        [resI1.rows[0].id, mR1, resI3.rows[0].id, adminId, mR3]
      );

      // 1. Admin consulta todas
      const respAll = await app.request(
        '/api/reportes/inactividad?desde=2026-07-01T00:00:00Z&hasta=2026-07-01T23:59:59Z',
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(respAll.status, 200);
      const jsonAll = await respAll.json();
      assert.ok(Array.isArray(jsonAll));

      const r1 = jsonAll.find((x: any) => x.maquina.id === mR1);
      const r2 = jsonAll.find((x: any) => x.maquina.id === mR2);
      const r3 = jsonAll.find((x: any) => x.maquina.id === mR3);

      assert.strictEqual(r1.inactividad_minutos, 360);
      assert.strictEqual(r3.inactividad_minutos, 90);
      assert.strictEqual(r2.inactividad_minutos, 0);

      // Orden relativo: 360 antes de 90 antes de 0
      const idxR1 = jsonAll.findIndex((x: any) => x.maquina.id === mR1);
      const idxR3 = jsonAll.findIndex((x: any) => x.maquina.id === mR3);
      const idxR2 = jsonAll.findIndex((x: any) => x.maquina.id === mR2);
      assert.ok(idxR1 < idxR3, '360 min debe ir antes de 90 min');
      assert.ok(idxR3 < idxR2, '90 min debe ir antes de 0 min');

      // 2. Filtro de sector_id = sector1Id
      const respSec1 = await app.request(
        `/api/reportes/inactividad?desde=2026-07-01T00:00:00Z&hasta=2026-07-01T23:59:59Z&sector_id=${sector1Id}`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(respSec1.status, 200);
      const jsonSec1 = await respSec1.json();
      assert.ok(jsonSec1.some((x: any) => x.maquina.id === mR1));
      assert.ok(jsonSec1.some((x: any) => x.maquina.id === mR2));
      assert.ok(!jsonSec1.some((x: any) => x.maquina.id === mR3), 'mR3 está en sector 2, no debe aparecer');

      // 3. Usuario con alcance SECTORES (solo sector 1) no ve sector 2
      const respUserSec = await app.request(
        '/api/reportes/inactividad?desde=2026-07-01T00:00:00Z&hasta=2026-07-01T23:59:59Z',
        { headers: { Authorization: `Bearer ${userSectoresToken}` } }
      );
      assert.strictEqual(respUserSec.status, 200);
      const jsonUserSec = await respUserSec.json();
      assert.ok(jsonUserSec.some((x: any) => x.maquina.id === mR1));
      assert.ok(!jsonUserSec.some((x: any) => x.maquina.id === mR3), 'Con alcance SECTORES (sector 1), no debe ver sector 2');
    });

    // R-02: /reportes/tiempos?agrupar=ejecucion con 2 internas (bruta 60 y 120) y 1 externa (bruta 300)
    await t.test('R-02: /reportes/tiempos?agrupar=ejecucion -> INTERNA: cant 2, prom 90, tot 180; EXTERNA: cant 1, prom 300, tot 300', async () => {
      // Intervención Interna 1: inicio 08:00, fin 09:00 (bruta 60)
      const resI1 = await client.query(
        `INSERT INTO intervenciones (
           maquina_id, tipo_intervencion_id, creado_por_usuario_id, responsable_usuario_id,
           descripcion, estado, ejecucion, trabajo_realizado, fecha_creacion, fecha_inicio, fecha_finalizacion
         ) VALUES ($1, $2, $3, $3, 'Int 1', 'FINALIZADA', 'INTERNA', 'Trabajo Int 1',
           '2026-08-01 07:00:00Z', '2026-08-01 08:00:00Z', '2026-08-01 09:00:00Z')
         RETURNING id`,
        [maquina1Id, tipoCorrectivoId, adminId]
      );

      // Intervención Interna 2: inicio 10:00, fin 12:00 (bruta 120)
      const resI2 = await client.query(
        `INSERT INTO intervenciones (
           maquina_id, tipo_intervencion_id, creado_por_usuario_id, responsable_usuario_id,
           descripcion, estado, ejecucion, trabajo_realizado, fecha_creacion, fecha_inicio, fecha_finalizacion
         ) VALUES ($1, $2, $3, $3, 'Int 2', 'FINALIZADA', 'INTERNA', 'Trabajo Int 2',
           '2026-08-01 09:00:00Z', '2026-08-01 10:00:00Z', '2026-08-01 12:00:00Z')
         RETURNING id`,
        [maquina1Id, tipoCorrectivoId, adminId]
      );

      // Intervención Externa 1: inicio 13:00, fin 18:00 (bruta 300)
      const resI3 = await client.query(
        `INSERT INTO intervenciones (
           maquina_id, tipo_intervencion_id, creado_por_usuario_id, responsable_usuario_id,
           descripcion, estado, ejecucion, trabajo_realizado, fecha_creacion, fecha_inicio, fecha_finalizacion
         ) VALUES ($1, $2, $3, $3, 'Ext 1', 'FINALIZADA', 'EXTERNA', 'Trabajo Ext 1',
           '2026-08-01 12:00:00Z', '2026-08-01 13:00:00Z', '2026-08-01 18:00:00Z')
         RETURNING id`,
        [maquina1Id, tipoCorrectivoId, adminId]
      );

      createdIntervencionIds.push(Number(resI1.rows[0].id), Number(resI2.rows[0].id), Number(resI3.rows[0].id));

      const resp = await app.request(
        '/api/reportes/tiempos?desde=2026-08-01T00:00:00Z&hasta=2026-08-01T23:59:59Z&agrupar=ejecucion',
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resp.status, 200);
      const json = await resp.json();
      assert.ok(Array.isArray(json));

      const interna = json.find((x: any) => x.grupo === 'INTERNA');
      assert.ok(interna, 'Debe existir grupo INTERNA');
      assert.strictEqual(interna.cantidad, 2);
      assert.strictEqual(interna.duracion_bruta_promedio_minutos, 90);
      assert.strictEqual(interna.duracion_bruta_total_minutos, 180);

      const externa = json.find((x: any) => x.grupo === 'EXTERNA');
      assert.ok(externa, 'Debe existir grupo EXTERNA');
      assert.strictEqual(externa.cantidad, 1);
      assert.strictEqual(externa.duracion_bruta_promedio_minutos, 300);
      assert.strictEqual(externa.duracion_bruta_total_minutos, 300);
    });

    // R-03: Fechas inválidas o sin zona; desde >= hasta; intervalo de 400 días; agrupar inválido -> 422 DATOS_INVALIDOS
    await t.test('R-03: Validaciones de fechas e intervalo -> 422 DATOS_INVALIDOS', async () => {
      // 1. Fecha sin zona horaria
      const rSinZona = await app.request(
        '/api/reportes/inactividad?desde=2026-01-01T00:00:00&hasta=2026-01-02T00:00:00Z',
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(rSinZona.status, 422);
      const jSinZona = await rSinZona.json();
      assert.strictEqual(jSinZona.codigo, 'DATOS_INVALIDOS');

      // 2. Fecha inválida de calendario
      const rInvalida = await app.request(
        '/api/reportes/inactividad?desde=2026-02-31T00:00:00Z&hasta=2026-03-01T00:00:00Z',
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(rInvalida.status, 422);
      assert.strictEqual((await rInvalida.json()).codigo, 'DATOS_INVALIDOS');

      // 3. desde >= hasta
      const rDesdeMayor = await app.request(
        '/api/reportes/inactividad?desde=2026-05-02T00:00:00Z&hasta=2026-05-01T00:00:00Z',
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(rDesdeMayor.status, 422);
      assert.strictEqual((await rDesdeMayor.json()).codigo, 'DATOS_INVALIDOS');

      // 4. Intervalo de 400 días (> 366 días)
      const r400d = await app.request(
        '/api/reportes/inactividad?desde=2025-01-01T00:00:00Z&hasta=2026-03-01T00:00:00Z',
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(r400d.status, 422);
      assert.strictEqual((await r400d.json()).codigo, 'DATOS_INVALIDOS');

      // 5. Parámetro agrupar inválido en /reportes/tiempos
      const rAgruparInv = await app.request(
        '/api/reportes/tiempos?desde=2026-01-01T00:00:00Z&hasta=2026-01-02T00:00:00Z&agrupar=invalido',
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(rAgruparInv.status, 422);
      assert.strictEqual((await rAgruparInv.json()).codigo, 'DATOS_INVALIDOS');

      // 6. Parámetro agrupar ausente en /reportes/tiempos
      const rAgruparFalta = await app.request(
        '/api/reportes/tiempos?desde=2026-01-01T00:00:00Z&hasta=2026-01-02T00:00:00Z',
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(rAgruparFalta.status, 422);
      assert.strictEqual((await rAgruparFalta.json()).codigo, 'DATOS_INVALIDOS');
    });
  } finally {
    try {
      if (createdIntervencionIds.length > 0) {
        await client.query('DELETE FROM intervencion_periodos_detencion WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervencion_auditoria WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM notificaciones WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM historial_estados_maquina WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervenciones WHERE id = ANY($1)', [createdIntervencionIds]);
      }
      if (createdMaquinaIds.length > 0) {
        await client.query('DELETE FROM intervencion_periodos_detencion WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
        await client.query('DELETE FROM historial_estados_maquina WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
        await client.query('DELETE FROM intervenciones WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
        await client.query('DELETE FROM maquinas WHERE id = ANY($1)', [createdMaquinaIds]);
      }
      if (userSectoresId) {
        await client.query('DELETE FROM usuario_permiso WHERE usuario_id = $1', [userSectoresId]);
        await client.query('DELETE FROM usuario_sector WHERE usuario_id = $1', [userSectoresId]);
      }
      if (createdUsuarioIds.length > 0) {
        await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [createdUsuarioIds]);
      }
      if (createdSectorIds.length > 0) {
        await client.query('DELETE FROM sectores WHERE id = ANY($1)', [createdSectorIds]);
      }
    } catch (err) {
      console.error('Error en teardown:', err);
    } finally {
      client.release();
    }
  }
});

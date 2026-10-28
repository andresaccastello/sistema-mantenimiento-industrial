import { test } from 'node:test';
import assert from 'node:assert';
import { pool } from '../functions/db.ts';
import app from '../functions/api.ts';
import { usuariosConPermiso } from '../functions/intervenciones/notificaciones.ts';
import { resolverPermisosEfectivos } from '../functions/intervenciones/permisos.ts';

// Configurar timeout de bloqueo
process.env.LOCK_TIMEOUT = '3s';

// Identificación estricta de la rama aislada de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (NOTIFICACIONES TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Etapa 7 — Notificaciones internas, reglas de destinatarios, bandeja y canales', async (t) => {
  const client = await pool.connect();
  const createdIntervencionIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdUsuarioIds: number[] = [];
  const createdSectorIds: number[] = [];

  const limpiarIntervenciones = async (ids: number[]) => {
    if (!ids || ids.length === 0) return;
    await client.query(
      'DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE intervencion_id = ANY($1))',
      [ids]
    );
    await client.query('DELETE FROM notificaciones WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM intervencion_auditoria WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM intervencion_costos WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM documentos WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM intervencion_repuestos WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM movimientos_stock WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM intervencion_periodos_detencion WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM historial_estados_maquina WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM intervenciones WHERE id = ANY($1)', [ids]);
  };

  const limpiarMaquina = async (mId: number) => {
    await client.query('DELETE FROM intervencion_periodos_detencion WHERE maquina_id = $1', [mId]);
    await client.query('DELETE FROM historial_estados_maquina WHERE maquina_id = $1', [mId]);
    await client.query('DELETE FROM maquinas WHERE id = $1', [mId]);
  };

  let adminToken = '';
  let adminId = 0;

  let resp1Token = '';
  let resp1Id = 0;

  let resp2Token = '';
  let resp2Id = 0;

  let resp3Token = '';
  let resp3Id = 0;

  let operarioToken = '';
  let operarioId = 0;

  let consultaToken = '';
  let consultaId = 0;

  let sector1Id = 0;
  let sector2Id = 0;
  let maquina1Id = 0;
  let maquina2Id = 0;

  try {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('pass123', 10);

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

    // Permisos IDs
    const resPerms = await client.query('SELECT id, codigo FROM permisos');
    const permMap = Object.fromEntries(resPerms.rows.map((r) => [r.codigo, Number(r.id)]));

    // 3. Crear Sectores de prueba
    const ts = Date.now();
    const resS1 = await client.query(
      `INSERT INTO sectores (nombre, descripcion) VALUES ($1, 'Sector 1 Pruebas Notif') RETURNING id`,
      [`S1_NOTIF_${ts}`]
    );
    sector1Id = Number(resS1.rows[0].id);
    createdSectorIds.push(sector1Id);

    const resS2 = await client.query(
      `INSERT INTO sectores (nombre, descripcion) VALUES ($1, 'Sector 2 Pruebas Notif') RETURNING id`,
      [`S2_NOTIF_${ts}`]
    );
    sector2Id = Number(resS2.rows[0].id);
    createdSectorIds.push(sector2Id);

    // 4. Crear Máquinas
    const resM1 = await client.query(
      `INSERT INTO maquinas (codigo, nombre, sector_id, estado) VALUES ($1, $2, $3, 'OPERATIVA') RETURNING id`,
      [`MQ1_N_${ts}`, `Máquina 1 Sector 1`, sector1Id]
    );
    maquina1Id = Number(resM1.rows[0].id);
    createdMaquinaIds.push(maquina1Id);

    const resM2 = await client.query(
      `INSERT INTO maquinas (codigo, nombre, sector_id, estado) VALUES ($1, $2, $3, 'OPERATIVA') RETURNING id`,
      [`MQ2_N_${ts}`, `Máquina 2 Sector 2`, sector2Id]
    );
    maquina2Id = Number(resM2.rows[0].id);
    createdMaquinaIds.push(maquina2Id);

    // 5. Crear Usuarios de prueba: O, R1, R2, C, R3
    // O: Operario (crea fallas)
    const legajoO = `OP_N_${ts}`;
    const resO = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id) VALUES ($1, 'Operario Notif', $2, $3) RETURNING id`,
      [legajoO, hash, perfilMap['OPERARIO']]
    );
    operarioId = Number(resO.rows[0].id);
    createdUsuarioIds.push(operarioId);
    const loginO = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoO, password: 'pass123' }),
    });
    operarioToken = (await loginO.json()).token;

    // R1: Responsable Mantenimiento 1
    const legajoR1 = `R1_N_${ts}`;
    const resR1 = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id) VALUES ($1, 'Resp 1 Notif', $2, $3) RETURNING id`,
      [legajoR1, hash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
    );
    resp1Id = Number(resR1.rows[0].id);
    createdUsuarioIds.push(resp1Id);
    const loginR1 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoR1, password: 'pass123' }),
    });
    resp1Token = (await loginR1.json()).token;

    // R2: Responsable Mantenimiento 2
    const legajoR2 = `R2_N_${ts}`;
    const resR2 = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id) VALUES ($1, 'Resp 2 Notif', $2, $3) RETURNING id`,
      [legajoR2, hash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
    );
    resp2Id = Number(resR2.rows[0].id);
    createdUsuarioIds.push(resp2Id);
    const loginR2 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoR2, password: 'pass123' }),
    });
    resp2Token = (await loginR2.json()).token;

    // C: Usuario de Consulta
    const legajoC = `C_N_${ts}`;
    const resC = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id) VALUES ($1, 'Consulta Notif', $2, $3) RETURNING id`,
      [legajoC, hash, perfilMap['CONSULTA']]
    );
    consultaId = Number(resC.rows[0].id);
    createdUsuarioIds.push(consultaId);
    const loginC = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoC, password: 'pass123' }),
    });
    consultaToken = (await loginC.json()).token;

    // R3: Responsable con INTERVENCIONES_VER y NOTIFICACIONES_FALLAS_RECIBIR alcance SECTORES (solo sector 1)
    const legajoR3 = `R3_N_${ts}`;
    const resR3 = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id) VALUES ($1, 'Resp 3 Sectores Notif', $2, $3) RETURNING id`,
      [legajoR3, hash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
    );
    resp3Id = Number(resR3.rows[0].id);
    createdUsuarioIds.push(resp3Id);

    // Asignar sector 1 a R3
    await client.query(
      `INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)`,
      [resp3Id, sector1Id]
    );

    // Excepciones individuales para R3: INTERVENCIONES_VER alcance SECTORES y NOTIFICACIONES_FALLAS_RECIBIR alcance SECTORES
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Prueba R3 solo sector 1', $3)`,
      [resp3Id, permMap['INTERVENCIONES_VER'], adminId]
    );
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Prueba R3 notif sector 1', $3)`,
      [resp3Id, permMap['NOTIFICACIONES_FALLAS_RECIBIR'], adminId]
    );

    const loginR3 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoR3, password: 'pass123' }),
    });
    resp3Token = (await loginR3.json()).token;

    // Asegurar canales inactivos inicialmente
    await client.query('UPDATE notificacion_canales SET activo = FALSE');

    // =========================================================================
    // N-01: O registra una falla CON detención en el sector 1
    // =========================================================================
    await t.test('N-01: O registra falla CON detención en sector 1 -> R1, R2, A y R3 reciben ALTA', async () => {
      const res = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
        body: JSON.stringify({
          maquina_id: maquina1Id,
          descripcion: 'Falla severa de rodamiento con detención',
          detiene_maquina: true,
        }),
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      const intId = Number(data.id);
      createdIntervencionIds.push(intId);

      // Verificar en DB las notificaciones creadas para esta intervención
      const resNotifs = await client.query(
        `SELECT usuario_id, tipo_evento, prioridad, titulo, mensaje
         FROM notificaciones
         WHERE intervencion_id = $1
         ORDER BY usuario_id ASC`,
        [intId]
      );

      const rows = resNotifs.rows;
      const destinatarios = rows.map((r: any) => Number(r.usuario_id));

      // Esperado: R1, R2, A, R3 reciben; O y C NO
      assert.strictEqual(destinatarios.includes(resp1Id), true, 'R1 debe recibir');
      assert.strictEqual(destinatarios.includes(resp2Id), true, 'R2 debe recibir');
      assert.strictEqual(destinatarios.includes(adminId), true, 'A debe recibir');
      assert.strictEqual(destinatarios.includes(resp3Id), true, 'R3 debe recibir');
      assert.strictEqual(destinatarios.includes(operarioId), false, 'O no debe recibir (es el actor)');
      assert.strictEqual(destinatarios.includes(consultaId), false, 'C no debe recibir (sin permiso)');

      for (const r of rows) {
        assert.strictEqual(r.tipo_evento, 'FALLA_REGISTRADA');
        assert.strictEqual(r.prioridad, 'ALTA');
        assert.strictEqual(r.titulo.includes('máquina detenida'), true);
      }
    });

    // =========================================================================
    // N-02: O registra una falla SIN detención
    // =========================================================================
    await t.test('N-02: O registra falla SIN detención -> mismos destinatarios, prioridad NORMAL', async () => {
      const res = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
        body: JSON.stringify({
          maquina_id: maquina1Id,
          descripcion: 'Ruido anormal leve sin detención',
          detiene_maquina: false,
        }),
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      const intId = Number(data.id);
      createdIntervencionIds.push(intId);

      const resNotifs = await client.query(
        `SELECT usuario_id, tipo_evento, prioridad, titulo
         FROM notificaciones
         WHERE intervencion_id = $1
         ORDER BY usuario_id ASC`,
        [intId]
      );

      const rows = resNotifs.rows;
      const destinatarios = rows.map((r: any) => Number(r.usuario_id));

      assert.strictEqual(destinatarios.includes(resp1Id), true);
      assert.strictEqual(destinatarios.includes(resp2Id), true);
      assert.strictEqual(destinatarios.includes(adminId), true);
      assert.strictEqual(destinatarios.includes(resp3Id), true);
      assert.strictEqual(destinatarios.includes(operarioId), false);
      assert.strictEqual(destinatarios.includes(consultaId), false);

      for (const r of rows) {
        assert.strictEqual(r.tipo_evento, 'FALLA_REGISTRADA');
        assert.strictEqual(r.prioridad, 'NORMAL');
        assert.strictEqual(r.titulo.includes('máquina detenida'), false);
      }
    });

    // =========================================================================
    // N-03: Falla en máquina del sector 2 -> R3 no recibe nada
    // =========================================================================
    await t.test('N-03: Falla en máquina del sector 2 -> R3 no recibe nada; R1, R2 y A sí', async () => {
      const res = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
        body: JSON.stringify({
          maquina_id: maquina2Id,
          descripcion: 'Falla en máquina de sector 2',
          detiene_maquina: true,
        }),
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      const intId = Number(data.id);
      createdIntervencionIds.push(intId);

      const resNotifs = await client.query(
        `SELECT usuario_id, tipo_evento, prioridad
         FROM notificaciones
         WHERE intervencion_id = $1`,
        [intId]
      );

      const destinatarios = resNotifs.rows.map((r: any) => Number(r.usuario_id));

      assert.strictEqual(destinatarios.includes(resp3Id), false, 'R3 NO debe recibir fallas de sector 2');
      assert.strictEqual(destinatarios.includes(resp1Id), true, 'R1 sí recibe');
      assert.strictEqual(destinatarios.includes(resp2Id), true, 'R2 sí recibe');
      assert.strictEqual(destinatarios.includes(adminId), true, 'A sí recibe');
    });

    // =========================================================================
    // =========================================================================
    // N-04: Excepciones y desactivación (con regla de visibilidad D-38 c)
    // =========================================================================
    await t.test('N-04: R1 con DENEGAR; O con CONCEDER (sector 1); R2 desactivado; O con VER PROPIAS vs SECTORES', async () => {
      // 1. R1: Excepción DENEGAR en NOTIFICACIONES_FALLAS_RECIBIR
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
         VALUES ($1, $2, 'DENEGAR', 'TODAS', 'Denegar notificaciones R1', $3)`,
        [resp1Id, permMap['NOTIFICACIONES_FALLAS_RECIBIR'], adminId]
      );

      // 2. O: Excepción CONCEDER en NOTIFICACIONES_FALLAS_RECIBIR con alcance SECTORES (sector 1)
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
         VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Conceder notificaciones O', $3)`,
        [operarioId, permMap['NOTIFICACIONES_FALLAS_RECIBIR'], adminId]
      );
      await client.query(
        `INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [operarioId, sector1Id]
      );

      // 3. R2: desactivado
      await client.query('UPDATE usuarios SET activo = FALSE WHERE id = $1', [resp2Id]);

      try {
        // Caso A1: O tiene NOTIFICACIONES_FALLAS_RECIBIR pero su INTERVENCIONES_VER es solo PROPIAS (perfil OPERARIO).
        // Admin registra falla en sector 1 (máquina 1). O NO debe recibirla porque no puede ver la intervención ajena.
        const resA1 = await app.request('/api/intervenciones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({
            maquina_id: maquina1Id,
            descripcion: 'Falla registrada por Admin en sector 1 (O solo tiene VER PROPIAS)',
            detiene_maquina: false,
          }),
        });

        assert.strictEqual(resA1.status, 201);
        const intIdA1 = Number((await resA1.json()).id);
        createdIntervencionIds.push(intIdA1);

        const resNotifsA1 = await client.query(
          `SELECT usuario_id FROM notificaciones WHERE intervencion_id = $1`,
          [intIdA1]
        );
        const destsA1 = resNotifsA1.rows.map((r: any) => Number(r.usuario_id));

        assert.strictEqual(destsA1.includes(resp1Id), false, 'R1 no debe recibir por DENEGAR');
        assert.strictEqual(destsA1.includes(resp2Id), false, 'R2 no debe recibir por inactivo');
        assert.strictEqual(
          destsA1.includes(operarioId),
          false,
          'O con NOTIFICACIONES_FALLAS_RECIBIR pero INTERVENCIONES_VER PROPIAS no recibe avisos de fallas ajenas'
        );
        assert.strictEqual(destsA1.includes(resp3Id), true, 'R3 sí recibe');
        assert.strictEqual(destsA1.includes(adminId), false, 'A no recibe (es actor)');

        // Caso A2: Se concede a O también INTERVENCIONES_VER con alcance SECTORES (sector 1)
        await client.query(
          `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
           VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Conceder ver sector 1 a O', $3)`,
          [operarioId, permMap['INTERVENCIONES_VER'], adminId]
        );

        const resA2 = await app.request('/api/intervenciones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({
            maquina_id: maquina1Id,
            descripcion: 'Falla registrada por Admin en sector 1 (O tiene VER SECTORES)',
            detiene_maquina: false,
          }),
        });

        assert.strictEqual(resA2.status, 201);
        const intIdA2 = Number((await resA2.json()).id);
        createdIntervencionIds.push(intIdA2);

        const resNotifsA2 = await client.query(
          `SELECT usuario_id FROM notificaciones WHERE intervencion_id = $1`,
          [intIdA2]
        );
        const destsA2 = resNotifsA2.rows.map((r: any) => Number(r.usuario_id));

        assert.strictEqual(
          destsA2.includes(operarioId),
          true,
          'O sí recibe aviso de falla de sector 1 al tener además INTERVENCIONES_VER con alcance SECTORES'
        );
        assert.strictEqual(destsA2.includes(resp1Id), false, 'R1 no debe recibir por DENEGAR');
        assert.strictEqual(destsA2.includes(resp2Id), false, 'R2 no debe recibir por inactivo');
        assert.strictEqual(destsA2.includes(resp3Id), true, 'R3 sí recibe');
        assert.strictEqual(destsA2.includes(adminId), false, 'A no recibe (es actor)');

        // Caso B: O registra falla en sector 1
        const resO = await app.request('/api/intervenciones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
          body: JSON.stringify({
            maquina_id: maquina1Id,
            descripcion: 'Falla registrada por O en sector 1',
            detiene_maquina: false,
          }),
        });

        assert.strictEqual(resO.status, 201);
        const dataO = await resO.json();
        const intIdO = Number(dataO.id);
        createdIntervencionIds.push(intIdO);

        const resNotifsO = await client.query(
          `SELECT usuario_id FROM notificaciones WHERE intervencion_id = $1`,
          [intIdO]
        );
        const destsO = resNotifsO.rows.map((r: any) => Number(r.usuario_id));

        assert.strictEqual(destsO.includes(operarioId), false, 'O no recibe falla creada por él mismo');
      } finally {
        // Restaurar estado
        await client.query('DELETE FROM usuario_permiso WHERE usuario_id = $1 AND permiso_id = ANY($2)', [
          operarioId,
          [permMap['NOTIFICACIONES_FALLAS_RECIBIR'], permMap['INTERVENCIONES_VER']],
        ]);
        await client.query('DELETE FROM usuario_permiso WHERE usuario_id = $1 AND permiso_id = $2', [
          resp1Id,
          permMap['NOTIFICACIONES_FALLAS_RECIBIR'],
        ]);
        await client.query('DELETE FROM usuario_sector WHERE usuario_id = $1 AND sector_id = $2', [
          operarioId,
          sector1Id,
        ]);
        await client.query('UPDATE usuarios SET activo = TRUE WHERE id = $1', [resp2Id]);
      }
    });

    // =========================================================================
    // N-05: A asigna a R1 -> R1 recibe; autoasignación -> nadie recibe
    // =========================================================================
    await t.test('N-05: A asigna a R1; autoasignación de R1 -> nadie recibe', async () => {
      // Crear intervención sin responsable
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
        body: JSON.stringify({
          maquina_id: maquina1Id,
          descripcion: 'Intervención para probar asignación',
          detiene_maquina: false,
        }),
      });
      const intId = Number((await resCrear.json()).id);
      createdIntervencionIds.push(intId);

      // A asigna a R1
      const resAsig = await app.request(`/api/intervenciones/${intId}/responsable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          usuario_id: resp1Id,
          estado_esperado: 'PENDIENTE',
        }),
      });
      assert.strictEqual(resAsig.status, 200);

      const notifsAsig = await client.query(
        `SELECT usuario_id, tipo_evento, prioridad, titulo
         FROM notificaciones
         WHERE intervencion_id = $1 AND tipo_evento = 'INTERVENCION_ASIGNADA'`,
        [intId]
      );
      assert.strictEqual(notifsAsig.rows.length, 1);
      assert.strictEqual(Number(notifsAsig.rows[0].usuario_id), resp1Id);
      assert.strictEqual(notifsAsig.rows[0].prioridad, 'NORMAL');
      assert.strictEqual(notifsAsig.rows[0].titulo.includes('Te asignaron'), true);

      // Autoasignación: Crear otra intervención y R1 se autoasigna con tomar
      const resCrear2 = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
        body: JSON.stringify({
          maquina_id: maquina1Id,
          descripcion: 'Intervención para probar autoasignación',
          detiene_maquina: false,
        }),
      });
      const intId2 = Number((await resCrear2.json()).id);
      createdIntervencionIds.push(intId2);

      const resTomar = await app.request(`/api/intervenciones/${intId2}/tomar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' }),
      });
      assert.strictEqual(resTomar.status, 200);

      const notifsTomar = await client.query(
        `SELECT usuario_id, tipo_evento
         FROM notificaciones
         WHERE intervencion_id = $1 AND tipo_evento = 'INTERVENCION_ASIGNADA'`,
        [intId2]
      );
      assert.strictEqual(notifsTomar.rows.length, 0, 'Autoasignación no debe generar notificaciones');
    });

    // =========================================================================
    // N-06: A reasigna de R1 a R2, con motivo
    // =========================================================================
    await t.test('N-06: A reasigna de R1 a R2, con motivo -> R2 recibe asignación y R1 te quitaron', async () => {
      // Crear intervención y asignar a R1
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
        body: JSON.stringify({
          maquina_id: maquina1Id,
          descripcion: 'Falla para reasignación',
          detiene_maquina: false,
        }),
      });
      const intId = Number((await resCrear.json()).id);
      createdIntervencionIds.push(intId);

      await app.request(`/api/intervenciones/${intId}/responsable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ usuario_id: resp1Id, estado_esperado: 'PENDIENTE' }),
      });

      // A reasigna a R2 con motivo
      const motivoReasig = 'Reasignación por rotación de turno y conocimientos de mecánica';
      const resReasig = await app.request(`/api/intervenciones/${intId}/responsable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          usuario_id: resp2Id,
          motivo: motivoReasig,
          estado_esperado: 'PENDIENTE',
        }),
      });
      assert.strictEqual(resReasig.status, 200);

      const resNotifs = await client.query(
        `SELECT usuario_id, tipo_evento, prioridad, titulo, mensaje
         FROM notificaciones
         WHERE intervencion_id = $1 AND tipo_evento IN ('INTERVENCION_ASIGNADA', 'INTERVENCION_REASIGNADA')
         ORDER BY id ASC`,
        [intId]
      );

      // Esperado: dos notificaciones de reasignación/asignación
      const notifR2 = resNotifs.rows.find((r: any) => Number(r.usuario_id) === resp2Id);
      const notifR1 = resNotifs.rows.find((r: any) => Number(r.usuario_id) === resp1Id && r.titulo.includes('quitaron'));

      assert.ok(notifR2, 'R2 debe recibir notificación de asignación');
      assert.ok(notifR1, 'R1 debe recibir notificación de te quitaron');

      assert.strictEqual(notifR2.titulo.includes('Te asignaron'), true);
      assert.strictEqual(notifR2.mensaje.includes(motivoReasig), true);

      assert.strictEqual(notifR1.titulo.includes('Te quitaron'), true);
      assert.strictEqual(notifR1.mensaje.includes(motivoReasig), true);
    });

    // =========================================================================
    // N-07: A quita el responsable R1 (en PENDIENTE)
    // =========================================================================
    await t.test('N-07: A quita el responsable R1 (en PENDIENTE) -> R1 recibe "te quitaron"', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
        body: JSON.stringify({
          maquina_id: maquina1Id,
          descripcion: 'Falla para desasignación',
          detiene_maquina: false,
        }),
      });
      const intId = Number((await resCrear.json()).id);
      createdIntervencionIds.push(intId);

      await app.request(`/api/intervenciones/${intId}/responsable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ usuario_id: resp1Id, estado_esperado: 'PENDIENTE' }),
      });

      const motivoDesasig = 'Se cancela la guardia de R1';
      const resDesasig = await app.request(`/api/intervenciones/${intId}/responsable`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          motivo: motivoDesasig,
          estado_esperado: 'PENDIENTE',
        }),
      });
      assert.strictEqual(resDesasig.status, 200);

      const resNotifs = await client.query(
        `SELECT usuario_id, tipo_evento, titulo, mensaje
         FROM notificaciones
         WHERE intervencion_id = $1 AND tipo_evento = 'INTERVENCION_DESASIGNADA'`,
        [intId]
      );
      assert.strictEqual(resNotifs.rows.length, 1);
      assert.strictEqual(Number(resNotifs.rows[0].usuario_id), resp1Id);
      assert.strictEqual(resNotifs.rows[0].titulo.includes('Te quitaron'), true);
      assert.strictEqual(resNotifs.rows[0].mensaje.includes(motivoDesasig), true);
    });

    // =========================================================================
    // N-08: R1 finaliza su intervención con recuperación
    // =========================================================================
    await t.test('N-08: R1 finaliza con recuperación -> O recibe FINALIZADA; R1 no; ninguna DETENCION', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
        body: JSON.stringify({
          maquina_id: maquina1Id,
          descripcion: 'Falla para finalizar con recuperación',
          detiene_maquina: true,
        }),
      });
      const intId = Number((await resCrear.json()).id);
      createdIntervencionIds.push(intId);

      // R1 toma y empieza
      await app.request(`/api/intervenciones/${intId}/tomar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' }),
      });
      await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' }),
      });

      // R1 finaliza con maquina_recuperada = true
      const resFin = await app.request(`/api/intervenciones/${intId}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Se cambió rodamiento y calibró',
          ejecucion: 'INTERNA',
          maquina_recuperada: true,
        }),
      });
      assert.strictEqual(resFin.status, 200);

      const resNotifs = await client.query(
        `SELECT usuario_id, tipo_evento, prioridad, titulo
         FROM notificaciones
         WHERE intervencion_id = $1 AND tipo_evento = 'INTERVENCION_FINALIZADA'`,
        [intId]
      );

      // Creador O recibe; R1 (actor) no
      assert.strictEqual(resNotifs.rows.length, 1);
      assert.strictEqual(Number(resNotifs.rows[0].usuario_id), operarioId);
      assert.strictEqual(resNotifs.rows[0].prioridad, 'NORMAL');

      // Ninguna DETENCION_PENDIENTE_CONFIRMACION
      const resDet = await client.query(
        `SELECT id FROM notificaciones WHERE intervencion_id = $1 AND tipo_evento = 'DETENCION_PENDIENTE_CONFIRMACION'`,
        [intId]
      );
      assert.strictEqual(resDet.rows.length, 0);
    });

    // =========================================================================
    // N-09: R1 finaliza SIN recuperación (período abierto)
    // =========================================================================
    await t.test('N-09: R1 finaliza SIN recuperación -> O recibe FINALIZADA; R2 y A reciben DETENCION; R_NoVer no', async () => {
      // Crear usuario con CONFIRMAR_RECUPERACION pero INTERVENCIONES_VER solo en Sector 2
      const legajoNoVer = `NO_VER_${Date.now()}`;
      const resNoVer = await client.query(
        `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id) VALUES ($1, 'Usuario No Ver', $2, $3) RETURNING id`,
        [legajoNoVer, hash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
      );
      const noVerId = Number(resNoVer.rows[0].id);
      createdUsuarioIds.push(noVerId);

      // Solo sector 2
      await client.query(`INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)`, [noVerId, sector2Id]);
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
         VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Solo sector 2', $3)`,
        [noVerId, permMap['INTERVENCIONES_VER'], adminId]
      );

      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
        body: JSON.stringify({
          maquina_id: maquina1Id, // sector 1
          descripcion: 'Falla finalizada sin recuperacion',
          detiene_maquina: true,
        }),
      });
      const intId = Number((await resCrear.json()).id);
      createdIntervencionIds.push(intId);

      await app.request(`/api/intervenciones/${intId}/tomar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' }),
      });
      await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' }),
      });

      // R1 finaliza con maquina_recuperada = false
      const resFin = await app.request(`/api/intervenciones/${intId}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Se colocó parche provisorio pero la máquina no puede arrancar',
          ejecucion: 'INTERNA',
          maquina_recuperada: false,
        }),
      });
      assert.strictEqual(resFin.status, 200);

      // Notificación de finalización: solo a O (creador), no a R1 (actor)
      const resNotifFin = await client.query(
        `SELECT usuario_id, prioridad FROM notificaciones WHERE intervencion_id = $1 AND tipo_evento = 'INTERVENCION_FINALIZADA'`,
        [intId]
      );
      assert.strictEqual(resNotifFin.rows.length, 1);
      assert.strictEqual(Number(resNotifFin.rows[0].usuario_id), operarioId);
      assert.strictEqual(resNotifFin.rows[0].prioridad, 'NORMAL');

      // Notificaciones de DETENCION_PENDIENTE_CONFIRMACION (ALTA)
      const resDet = await client.query(
        `SELECT usuario_id, prioridad, titulo FROM notificaciones WHERE intervencion_id = $1 AND tipo_evento = 'DETENCION_PENDIENTE_CONFIRMACION'`,
        [intId]
      );
      const destsDet = resDet.rows.map((r: any) => Number(r.usuario_id));

      assert.strictEqual(destsDet.includes(resp2Id), true, 'R2 debe recibir DETENCION');
      assert.strictEqual(destsDet.includes(adminId), true, 'A debe recibir DETENCION');
      assert.strictEqual(destsDet.includes(resp1Id), false, 'R1 es el actor, no debe recibir');
      assert.strictEqual(destsDet.includes(noVerId), false, 'noVer no alcanza esta máquina por INTERVENCIONES_VER (D-38 c)');

      for (const r of resDet.rows) {
        assert.strictEqual(r.prioridad, 'ALTA');
        assert.strictEqual(r.titulo.includes('sigue detenida'), true);
      }
    });

    // =========================================================================
    // N-10: Cancelar y reabrir -> creador y responsable reciben con motivo
    // =========================================================================
    await t.test('N-10: Cancelar y reabrir -> creador y responsable reciben con motivo', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
        body: JSON.stringify({
          maquina_id: maquina1Id,
          descripcion: 'Falla para ciclo cancelar y reabrir',
          detiene_maquina: false,
        }),
      });
      const intId = Number((await resCrear.json()).id);
      createdIntervencionIds.push(intId);

      await app.request(`/api/intervenciones/${intId}/responsable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ usuario_id: resp1Id, estado_esperado: 'PENDIENTE' }),
      });

      // 1. Cancelar
      const motivoCanc = 'Se cancela por pedido de producción';
      const resCanc = await app.request(`/api/intervenciones/${intId}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          motivo: motivoCanc,
          estado_esperado: 'PENDIENTE',
          maquina_recuperada: true,
        }),
      });
      assert.strictEqual(resCanc.status, 200);

      const notifsCanc = await client.query(
        `SELECT usuario_id, tipo_evento, titulo, mensaje
         FROM notificaciones
         WHERE intervencion_id = $1 AND tipo_evento = 'INTERVENCION_CANCELADA'`,
        [intId]
      );
      const destsCanc = notifsCanc.rows.map((r: any) => Number(r.usuario_id));
      assert.strictEqual(destsCanc.includes(operarioId), true, 'Creador recibe cancelación');
      assert.strictEqual(destsCanc.includes(resp1Id), true, 'Responsable recibe cancelación');
      assert.strictEqual(destsCanc.includes(adminId), false, 'Actor A no recibe');

      for (const r of notifsCanc.rows) {
        assert.strictEqual(r.titulo.includes('Se canceló'), true);
        assert.strictEqual(r.mensaje.includes(motivoCanc), true);
      }

      // 2. Reabrir: Crear intervención, finalizarla y reabrirla
      const resCrearReab = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
        body: JSON.stringify({
          maquina_id: maquina1Id,
          descripcion: 'Falla para ciclo de reapertura',
          detiene_maquina: false,
        }),
      });
      const intIdReab = Number((await resCrearReab.json()).id);
      createdIntervencionIds.push(intIdReab);

      await app.request(`/api/intervenciones/${intIdReab}/responsable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ usuario_id: resp1Id, estado_esperado: 'PENDIENTE' }),
      });

      await app.request(`/api/intervenciones/${intIdReab}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' }),
      });

      await app.request(`/api/intervenciones/${intIdReab}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Trabajo preliminar finalizado',
          ejecucion: 'INTERNA',
          maquina_recuperada: true,
        }),
      });

      const motivoReab = 'Se reabre porque la falla volvió a manifestarse';
      const resReab = await app.request(`/api/intervenciones/${intIdReab}/reabrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          motivo: motivoReab,
          estado_esperado: 'FINALIZADA',
          maquina_detenida: false,
        }),
      });
      assert.strictEqual(resReab.status, 200);

      const notifsReab = await client.query(
        `SELECT usuario_id, tipo_evento, titulo, mensaje
         FROM notificaciones
         WHERE intervencion_id = $1 AND tipo_evento = 'INTERVENCION_REABIERTA'`,
        [intIdReab]
      );
      const destsReab = notifsReab.rows.map((r: any) => Number(r.usuario_id));
      assert.strictEqual(destsReab.includes(operarioId), true, 'Creador recibe reapertura');
      assert.strictEqual(destsReab.includes(resp1Id), true, 'Responsable recibe reapertura');
      assert.strictEqual(destsReab.includes(adminId), false, 'Actor A no recibe');

      for (const r of notifsReab.rows) {
        assert.strictEqual(r.titulo.includes('Se reabrió'), true);
        assert.strictEqual(r.mensaje.includes(motivoReab), true);
      }
    });

    // =========================================================================
    // N-11: Creador = responsable -> una sola notificación (D-38 d)
    // =========================================================================
    await t.test('N-11: Creador = responsable -> R1 recibe UNA notificación, no dos', async () => {
      // R1 crea la falla
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          maquina_id: maquina1Id,
          descripcion: 'Falla creada por R1 para prueba N-11',
          detiene_maquina: false,
        }),
      });
      const intId = Number((await resCrear.json()).id);
      createdIntervencionIds.push(intId);

      // R1 la toma (creador = responsable)
      const resTomar11 = await app.request(`/api/intervenciones/${intId}/tomar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' }),
      });
      assert.strictEqual(resTomar11.status, 200);

      // A la cancela
      const resCanc = await app.request(`/api/intervenciones/${intId}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          motivo: 'Cancelada por supervisor A',
          estado_esperado: 'PENDIENTE',
          maquina_recuperada: true,
        }),
      });
      assert.strictEqual(resCanc.status, 200);

      const resNotifs = await client.query(
        `SELECT id, usuario_id FROM notificaciones WHERE intervencion_id = $1 AND tipo_evento = 'INTERVENCION_CANCELADA'`,
        [intId]
      );

      // Debe haber exactamente 1 notificación y ser para R1
      assert.strictEqual(resNotifs.rows.length, 1);
      assert.strictEqual(Number(resNotifs.rows[0].usuario_id), resp1Id);
    });

    // =========================================================================
    // N-12: Eventos excluidos no generan notificaciones (D-39)
    // =========================================================================
    await t.test('N-12: Iniciar, esperar repuestos, reanudar, confirmar recup, registrar detención, eliminar -> cero notificaciones', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
        body: JSON.stringify({
          maquina_id: maquina1Id,
          descripcion: 'Falla para probar operaciones sin notificación',
          detiene_maquina: true,
        }),
      });
      const intId = Number((await resCrear.json()).id);
      createdIntervencionIds.push(intId);

      await app.request(`/api/intervenciones/${intId}/responsable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ usuario_id: resp1Id, estado_esperado: 'PENDIENTE' }),
      });

      const getCount = async () => {
        const res = await client.query('SELECT COUNT(*)::integer AS c FROM notificaciones');
        return Number(res.rows[0].c);
      };

      const c0 = await getCount();

      // 1. Iniciar
      await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' }),
      });
      assert.strictEqual(await getCount(), c0, 'Iniciar no debe generar notificaciones');

      // 2. Pasar a espera
      await app.request(`/api/intervenciones/${intId}/esperar-repuestos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          observacion: 'Falta rodamiento 6204',
          estado_esperado: 'EN_PROCESO',
        }),
      });
      assert.strictEqual(await getCount(), c0, 'Esperar repuestos no debe generar notificaciones');

      // 3. Reanudar
      await app.request(`/api/intervenciones/${intId}/reanudar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_ESPERA_REPUESTOS' }),
      });
      assert.strictEqual(await getCount(), c0, 'Reanudar no debe generar notificaciones');

      // 4. Confirmar recuperación
      await app.request(`/api/maquinas/${maquina1Id}/confirmar-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ observacion: 'Recuperada manualmente' }),
      });
      assert.strictEqual(await getCount(), c0, 'Confirmar recuperación no debe generar notificaciones');

      // 5. Registrar detención adicional
      await app.request(`/api/intervenciones/${intId}/registrar-detencion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          observacion: 'Nueva detención detectada en prueba',
        }),
      });
      assert.strictEqual(await getCount(), c0, 'Registrar detención no debe generar notificaciones');

      // 6. Eliminar
      await app.request(`/api/intervenciones/${intId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          motivo: 'Eliminación de prueba N-12',
          estado_esperado: 'EN_PROCESO',
          maquina_recuperada: true,
        }),
      });
      assert.strictEqual(await getCount(), c0, 'Eliminar no debe generar notificaciones');
    });

    // =========================================================================
    // N-13: Atomicidad
    // =========================================================================
    await t.test('N-13: Atomicidad: trigger que falla en notificaciones revierte toda la operación', async () => {
      // Crear trigger temporal que aborta la inserción en notificaciones
      await client.query(`
        CREATE OR REPLACE FUNCTION trg_fn_test_fallo_notif() RETURNS TRIGGER AS $$
        BEGIN
          RAISE EXCEPTION 'Simulación de fallo en notificaciones';
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_test_fallo_notif ON notificaciones;
        CREATE TRIGGER trg_test_fallo_notif
        BEFORE INSERT ON notificaciones
        FOR EACH ROW EXECUTE FUNCTION trg_fn_test_fallo_notif();
      `);

      try {
        const res = await app.request('/api/intervenciones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
          body: JSON.stringify({
            maquina_id: maquina1Id,
            descripcion: 'Falla que debe fallar por trigger en notificaciones',
            detiene_maquina: true,
          }),
        });

        assert.strictEqual(res.status, 500, 'Debe devolver 500');

        // Verificar que no se insertó nada en intervenciones
        const resI = await client.query(
          "SELECT id FROM intervenciones WHERE descripcion = 'Falla que debe fallar por trigger en notificaciones'"
        );
        assert.strictEqual(resI.rows.length, 0, 'La intervención no debe haberse guardado');

        // Verificar que no hay períodos
        const resP = await client.query(
          "SELECT id FROM intervencion_periodos_detencion WHERE observacion LIKE '%Falla que debe fallar%'"
        );
        assert.strictEqual(resP.rows.length, 0, 'El período no debe haberse guardado');
      } finally {
        await client.query(`
          DROP TRIGGER IF EXISTS trg_test_fallo_notif ON notificaciones;
          DROP FUNCTION IF EXISTS trg_fn_test_fallo_notif();
        `);
      }

      // Validación rechazada no deja notificaciones
      const resValRechazada = await app.request('/api/intervenciones/999999/finalizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'algo',
          ejecucion: 'INTERNA',
        }),
      });
      assert.strictEqual(resValRechazada.status, 404);
    });

    // =========================================================================
    // N-14: usuariosConPermiso contra resolverPermisosEfectivos
    // =========================================================================
    await t.test('N-14: usuariosConPermiso contra resolverPermisosEfectivos', async () => {
      const codigoPerm = 'NOTIFICACIONES_FALLAS_RECIBIR';

      const resRapida = await usuariosConPermiso(client, codigoPerm);
      const mapaRapido = new Map(resRapida.map((u) => [u.usuario_id, u]));

      // Consultar todos los usuarios
      const resTodos = await client.query('SELECT id, activo FROM usuarios');
      for (const row of resTodos.rows) {
        const uId = Number(row.id);
        const info = await resolverPermisosEfectivos(client, uId);

        const tienePermisoEfectivo = info.activo && codigoPerm in info.permisos;
        const enRapida = mapaRapido.has(uId);

        assert.strictEqual(
          enRapida,
          tienePermisoEfectivo,
          `Usuario ${uId}: coincidencia en presencia de permiso efectivo`
        );

        if (tienePermisoEfectivo) {
          const itemRapido = mapaRapido.get(uId)!;
          assert.strictEqual(
            itemRapido.alcance,
            info.permisos[codigoPerm],
            `Usuario ${uId}: coincidencia en alcance`
          );
          assert.deepStrictEqual(
            itemRapido.sectores.sort(),
            info.sectores.sort(),
            `Usuario ${uId}: coincidencia en sectores`
          );
        }
      }
    });

    // =========================================================================
    // N-15: Bandeja: listar, contador, leer, leer-todas, paginado con antes_de
    // =========================================================================
    await t.test('N-15: Bandeja: listar, contador, leer, leer-todas, paginado con antes_de', async () => {
      // Limpiar notificaciones de R1 y R2
      await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE usuario_id IN ($1, $2))', [resp1Id, resp2Id]);
      await client.query('DELETE FROM notificaciones WHERE usuario_id IN ($1, $2)', [resp1Id, resp2Id]);

      // Insertar 5 notificaciones para R1 (3 NORMAL, 2 ALTA) y 2 para R2
      const idsR1: number[] = [];
      for (let i = 1; i <= 5; i++) {
        const prioridad = i <= 2 ? 'ALTA' : 'NORMAL';
        const resIns = await client.query(
          `INSERT INTO notificaciones (
             usuario_id, tipo_evento, prioridad, titulo, mensaje, generada_por_usuario_id, creada_en
           )
           VALUES ($1, 'PRUEBA_BANDEJA', $2, $3, $4, $5, NOW() - ($6 || ' minutes')::interval)
           RETURNING id`,
          [resp1Id, prioridad, `Notif R1 número ${i}`, `Mensaje ${i}`, adminId, (6 - i) * 5]
        );
        idsR1.push(Number(resIns.rows[0].id));
      }

      // Notificaciones para R2
      const resInsR2 = await client.query(
        `INSERT INTO notificaciones (
           usuario_id, tipo_evento, prioridad, titulo, mensaje, generada_por_usuario_id, creada_en
         )
         VALUES ($1, 'PRUEBA_BANDEJA', 'NORMAL', 'Notif R2', 'Mensaje R2', $2, NOW())
         RETURNING id`,
        [resp2Id, adminId]
      );
      const idR2 = Number(resInsR2.rows[0].id);

      // 1. Listar propias de R1
      const resListR1 = await app.request('/api/notificaciones', {
        headers: { Authorization: `Bearer ${resp1Token}` },
      });
      assert.strictEqual(resListR1.status, 200);
      const listaR1 = await resListR1.json();
      assert.strictEqual(listaR1.length, 5);
      // R2 no aparece en la lista de R1
      assert.strictEqual(listaR1.some((n: any) => n.id === idR2), false);

      // 2. Contador de R1
      const resContR1 = await app.request('/api/notificaciones/contador', {
        headers: { Authorization: `Bearer ${resp1Token}` },
      });
      assert.strictEqual(resContR1.status, 200);
      const dContR1 = await resContR1.json();
      assert.strictEqual(dContR1.no_leidas, 5);
      assert.strictEqual(dContR1.no_leidas_alta, 2);

      // 3. POST /:id/leer
      // a) Leer ajena -> 404
      const resLeerAjena = await app.request(`/api/notificaciones/${idR2}/leer`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${resp1Token}` },
      });
      assert.strictEqual(resLeerAjena.status, 404);

      // b) Leer propia
      const idALeer = idsR1[0];
      const resLeerPropia = await app.request(`/api/notificaciones/${idALeer}/leer`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${resp1Token}` },
      });
      assert.strictEqual(resLeerPropia.status, 200);
      const dLeerPropia = await resLeerPropia.json();
      assert.strictEqual(dLeerPropia.ok, true);
      assert.ok(dLeerPropia.leida_en);

      // c) Leer ya leída -> 200 sin cambios
      const resLeerOtraVez = await app.request(`/api/notificaciones/${idALeer}/leer`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${resp1Token}` },
      });
      assert.strictEqual(resLeerOtraVez.status, 200);

      // Contador baja a 4
      const resContR1B = await app.request('/api/notificaciones/contador', {
        headers: { Authorization: `Bearer ${resp1Token}` },
      });
      const dContR1B = await resContR1B.json();
      assert.strictEqual(dContR1B.no_leidas, 4);

      // 4. leer-todas
      const resLeerTodas = await app.request('/api/notificaciones/leer-todas', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resp1Token}` },
      });
      assert.strictEqual(resLeerTodas.status, 200);
      const dLeerTodas = await resLeerTodas.json();
      assert.strictEqual(dLeerTodas.marcadas, 4);

      // Contador ahora es 0
      const resContR1C = await app.request('/api/notificaciones/contador', {
        headers: { Authorization: `Bearer ${resp1Token}` },
      });
      const dContR1C = await resContR1C.json();
      assert.strictEqual(dContR1C.no_leidas, 0);
      assert.strictEqual(dContR1C.no_leidas_alta, 0);

      // 5. Paginado con antes_de
      // Limpiar y crear 5 con IDs correlativos
      await client.query('DELETE FROM notificaciones WHERE usuario_id = $1', [resp1Id]);
      const pIds: number[] = [];
      for (let i = 1; i <= 5; i++) {
        const r = await client.query(
          `INSERT INTO notificaciones (usuario_id, tipo_evento, prioridad, titulo, mensaje, generada_por_usuario_id, creada_en)
           VALUES ($1, 'TEST_PAG', 'NORMAL', $2, 'msg', $3, NOW() + ($4 || ' seconds')::interval) RETURNING id`,
          [resp1Id, `Pag ${i}`, adminId, i * 2]
        );
        pIds.push(Number(r.rows[0].id));
      }

      // Página 1: límite 2
      const resP1 = await app.request('/api/notificaciones?limite=2', {
        headers: { Authorization: `Bearer ${resp1Token}` },
      });
      const listP1 = await resP1.json();
      assert.strictEqual(listP1.length, 2);
      const idUltimoP1 = listP1[1].id;

      // Página 2: límite 2 & antes_de = idUltimoP1
      const resP2 = await app.request(`/api/notificaciones?limite=2&antes_de=${idUltimoP1}`, {
        headers: { Authorization: `Bearer ${resp1Token}` },
      });
      const listP2 = await resP2.json();
      assert.strictEqual(listP2.length, 2);
      const idUltimoP2 = listP2[1].id;

      // Página 3: límite 2 & antes_de = idUltimoP2
      const resP3 = await app.request(`/api/notificaciones?limite=2&antes_de=${idUltimoP2}`, {
        headers: { Authorization: `Bearer ${resp1Token}` },
      });
      const listP3 = await resP3.json();
      assert.strictEqual(listP3.length, 1);

      // Verificar que los IDs recolectados son únicos y cubren los 5
      const allPagIds = [...listP1.map((x: any) => x.id), ...listP2.map((x: any) => x.id), ...listP3.map((x: any) => x.id)];
      assert.strictEqual(new Set(allPagIds).size, 5);
      assert.deepStrictEqual(allPagIds.sort(), pIds.sort());
    });

    // =========================================================================
    // N-16: Canales y bandeja de salida
    // =========================================================================
    await t.test('N-16: Activar EMAIL por SQL -> Un envío PENDIENTE por notificación; inactivos -> cero envíos', async () => {
      // 1. Activar EMAIL
      await client.query("UPDATE notificacion_canales SET activo = TRUE WHERE canal = 'EMAIL'");

      const res1 = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
        body: JSON.stringify({
          maquina_id: maquina1Id,
          descripcion: 'Falla para probar outbox con EMAIL activo',
          detiene_maquina: false,
        }),
      });
      assert.strictEqual(res1.status, 201);
      const intId1 = Number((await res1.json()).id);
      createdIntervencionIds.push(intId1);

      const notifs1 = await client.query('SELECT id FROM notificaciones WHERE intervencion_id = $1', [intId1]);
      assert.ok(notifs1.rows.length > 0);

      const envios1 = await client.query(
        `SELECT notificacion_id, canal, estado, intentos
         FROM notificacion_envios
         WHERE notificacion_id = ANY($1)`,
        [notifs1.rows.map((r: any) => Number(r.id))]
      );

      assert.strictEqual(
        envios1.rows.length,
        notifs1.rows.length,
        'Debe haber exactamente un envío por cada notificación'
      );
      for (const e of envios1.rows) {
        assert.strictEqual(e.canal, 'EMAIL');
        assert.strictEqual(e.estado, 'PENDIENTE');
        assert.strictEqual(e.intentos, 0);
      }

      // 2. Desactivar todos los canales
      await client.query('UPDATE notificacion_canales SET activo = FALSE');

      const res2 = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
        body: JSON.stringify({
          maquina_id: maquina1Id,
          descripcion: 'Falla con todos los canales inactivos',
          detiene_maquina: false,
        }),
      });
      assert.strictEqual(res2.status, 201);
      const intId2 = Number((await res2.json()).id);
      createdIntervencionIds.push(intId2);

      const notifs2 = await client.query('SELECT id FROM notificaciones WHERE intervencion_id = $1', [intId2]);
      assert.ok(notifs2.rows.length > 0);

      const envios2 = await client.query(
        `SELECT id FROM notificacion_envios WHERE notificacion_id = ANY($1)`,
        [notifs2.rows.map((r: any) => Number(r.id))]
      );
      assert.strictEqual(envios2.rows.length, 0, 'No debe haber envíos con canales inactivos');
    });

    // =========================================================================
    // N-17: Inserción en lote con al menos 20 destinatarios (Etapa 7.1)
    // =========================================================================
    await t.test('N-17: Inserción en lote: falla con al menos 20 destinatarios y todos reciben exactamente una notificación', async () => {
      const loteTs = Date.now();
      // Crear 20 usuarios con perfil RESPONSABLE_MANTENIMIENTO (tienen NOTIFICACIONES_FALLAS_RECIBIR TODAS e INTERVENCIONES_VER TODAS)
      const res20 = await client.query(
        `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo)
         SELECT 
           'L20_' || $1 || '_' || i,
           'Resp Lote ' || i,
           $2,
           $3,
           TRUE
         FROM generate_series(1, 20) AS s(i)
         RETURNING id`,
        [loteTs, hash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
      );
      const user20Ids = res20.rows.map((r: any) => Number(r.id));
      createdUsuarioIds.push(...user20Ids);

      // Operario registra falla con detención en máquina 1
      const resFalla = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
        body: JSON.stringify({
          maquina_id: maquina1Id,
          descripcion: 'Falla para probar inserción en lote con más de 20 destinatarios',
          detiene_maquina: true,
        }),
      });

      assert.strictEqual(resFalla.status, 201);
      const intIdLote = Number((await resFalla.json()).id);
      createdIntervencionIds.push(intIdLote);

      // Consultar notificaciones creadas para esta intervención
      const resNotifs = await client.query(
        `SELECT id, usuario_id, tipo_evento, prioridad, titulo FROM notificaciones WHERE intervencion_id = $1`,
        [intIdLote]
      );

      // Verificar que cada uno de los 20 usuarios del lote recibió exactamente 1 notificación
      const notifsPorUsuario = new Map<number, number>();
      for (const row of resNotifs.rows) {
        const uId = Number(row.usuario_id);
        notifsPorUsuario.set(uId, (notifsPorUsuario.get(uId) || 0) + 1);
      }

      for (const uId of user20Ids) {
        const count = notifsPorUsuario.get(uId);
        assert.strictEqual(count, 1, `Usuario ${uId} debe recibir exactamente 1 notificación`);
      }

      // Total de notificaciones generadas debe ser al menos 20 (los 20 del lote + R1, R3, Admin existentes)
      assert.ok(
        resNotifs.rows.length >= 20,
        `Debe haber al menos 20 notificaciones generadas (hubo ${resNotifs.rows.length})`
      );
    });

  } finally {
    // Limpieza final
    await limpiarIntervenciones(createdIntervencionIds);
    for (const mId of createdMaquinaIds) {
      await limpiarMaquina(mId);
    }
    if (createdUsuarioIds.length > 0) {
      await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE usuario_id = ANY($1) OR generada_por_usuario_id = ANY($1))', [createdUsuarioIds]);
      await client.query('DELETE FROM notificaciones WHERE usuario_id = ANY($1) OR generada_por_usuario_id = ANY($1)', [createdUsuarioIds]);
      await client.query('DELETE FROM usuario_permiso WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
      await client.query('DELETE FROM usuario_sector WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
      await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [createdUsuarioIds]);
    }
    if (createdSectorIds.length > 0) {
      await client.query('DELETE FROM usuario_sector WHERE sector_id = ANY($1)', [createdSectorIds]);
      await client.query('DELETE FROM sectores WHERE id = ANY($1)', [createdSectorIds]);
    }
    // Dejar canales inactivos
    await client.query('UPDATE notificacion_canales SET activo = FALSE');
    client.release();
  }
});

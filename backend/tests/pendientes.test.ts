import { test } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import app from '../functions/api.ts';
import { pool } from '../functions/db.ts';
import { validarResponsableHabilitado } from '../functions/intervenciones/motor.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (PENDIENTES TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Etapa P — Pendientes técnicos del backend', async (t) => {
  const client = await pool.connect();

  const createdIntervencionIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdUsuarioIds: number[] = [];

  let adminToken = '';
  let adminId = 0;
  let operarioToken = '';
  let operarioId = 0;

  const testSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  try {
    // 1. Login ADMIN001
    const resAdmin = await client.query("SELECT id FROM usuarios WHERE legajo = 'ADMIN001' LIMIT 1");
    assert.ok(resAdmin.rows.length > 0, 'Debe existir usuario ADMIN001');
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

    // 3. Crear operario base para pruebas de permisos
    const passHash = await bcrypt.hash('pass123', 10);
    const resOp = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id`,
      [`OP_BASE_${testSuffix}`, `Operario Base ${testSuffix}`, passHash, perfilMap['OPERARIO']]
    );
    operarioId = Number(resOp.rows[0].id);
    createdUsuarioIds.push(operarioId);

    const loginOp = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: `OP_BASE_${testSuffix}`, password: 'pass123' }),
    });
    operarioToken = (await loginOp.json()).token;

    // 4. Sector y máquina para P-01 y P-02
    const resSec1 = await client.query(
      'INSERT INTO sectores (nombre) VALUES ($1) RETURNING id',
      [`Sector Pendientes 1 ${testSuffix}`]
    );
    const sector1Id = Number(resSec1.rows[0].id);
    createdSectorIds.push(sector1Id);

    const resMaq1 = await client.query(
      `INSERT INTO maquinas (nombre, sector_id, codigo) VALUES ($1, $2, $3) RETURNING id`,
      [`Máquina Pendientes 1 ${testSuffix}`, sector1Id, `MAQ-P1-${testSuffix}`]
    );
    const maquina1Id = Number(resMaq1.rows[0].id);
    createdMaquinaIds.push(maquina1Id);

    // P-01: Iniciar sin fecha_inicio -> son iguales al milisegundo fecha_inicio, cambiado_en y fecha_efectiva
    await t.test('P-01: Iniciar sin fecha_inicio', async () => {
      const resI = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion P-01 sin fecha_inicio' }),
      });
      assert.strictEqual(resI.status, 201);
      const idI = (await resI.json()).id;
      createdIntervencionIds.push(idI);

      const resIni = await app.request(`/api/intervenciones/${idI}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' }),
      });
      assert.strictEqual(resIni.status, 200);

      const resDbI = await client.query('SELECT fecha_inicio FROM intervenciones WHERE id = $1', [idI]);
      const resDbH = await client.query(
        "SELECT cambiado_en, fecha_efectiva FROM historial_estados_intervencion WHERE intervencion_id = $1 AND estado_nuevo = 'EN_PROCESO'",
        [idI]
      );

      assert.strictEqual(resDbI.rows.length, 1);
      assert.strictEqual(resDbH.rows.length, 1);

      const fechaInicioMs = new Date(resDbI.rows[0].fecha_inicio).getTime();
      const cambiadoEnMs = new Date(resDbH.rows[0].cambiado_en).getTime();
      const fechaEfectivaMs = new Date(resDbH.rows[0].fecha_efectiva).getTime();

      assert.strictEqual(fechaInicioMs, cambiadoEnMs, 'fecha_inicio debe ser igual a cambiado_en');
      assert.strictEqual(fechaInicioMs, fechaEfectivaMs, 'fecha_inicio debe ser igual a fecha_efectiva');
    });

    // P-02: Eliminar una intervención pendiente -> valor_nuevo auditoría igual al milisegundo a eliminado_en
    await t.test('P-02: Eliminar una intervención pendiente', async () => {
      const resI = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion P-02 eliminar pendiente' }),
      });
      assert.strictEqual(resI.status, 201);
      const idI = (await resI.json()).id;
      createdIntervencionIds.push(idI);

      const resElim = await app.request(`/api/intervenciones/${idI}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ motivo: 'Eliminación lógica prueba P-02' }),
      });
      assert.strictEqual(resElim.status, 200);

      const resDbI = await client.query('SELECT eliminado_en FROM intervenciones WHERE id = $1', [idI]);
      const resDbA = await client.query(
        "SELECT valor_nuevo FROM intervencion_auditoria WHERE intervencion_id = $1 AND tipo_evento = 'ELIMINACION_LOGICA'",
        [idI]
      );

      assert.strictEqual(resDbI.rows.length, 1);
      assert.strictEqual(resDbA.rows.length, 1);

      const eliminadoEnMs = new Date(resDbI.rows[0].eliminado_en).getTime();
      const valorNuevoMs = new Date(resDbA.rows[0].valor_nuevo).getTime();

      assert.strictEqual(valorNuevoMs, eliminadoEnMs, 'valor_nuevo en auditoría debe ser igual a eliminado_en');
    });

    // P-03: Responsables habilitados
    await t.test('P-03: Responsables habilitados', async () => {
      // Sectores: sectorMaquina y sectorOtro
      const resSecM = await client.query(
        'INSERT INTO sectores (nombre) VALUES ($1) RETURNING id',
        [`Sector Maquina P03 ${testSuffix}`]
      );
      const sectorMaquinaId = Number(resSecM.rows[0].id);
      createdSectorIds.push(sectorMaquinaId);

      const resSecO = await client.query(
        'INSERT INTO sectores (nombre) VALUES ($1) RETURNING id',
        [`Sector Otro P03 ${testSuffix}`]
      );
      const sectorOtroId = Number(resSecO.rows[0].id);
      createdSectorIds.push(sectorOtroId);

      const resMaq = await client.query(
        `INSERT INTO maquinas (nombre, sector_id, codigo) VALUES ($1, $2, $3) RETURNING id`,
        [`Máquina P03 ${testSuffix}`, sectorMaquinaId, `MAQ-P03-${testSuffix}`]
      );
      const maquinaP3Id = Number(resMaq.rows[0].id);
      createdMaquinaIds.push(maquinaP3Id);

      const resInt = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaP3Id, descripcion: 'Intervencion P-03 prueba habilitados' }),
      });
      assert.strictEqual(resInt.status, 201);
      const intervencionP3Id = (await resInt.json()).id;
      createdIntervencionIds.push(intervencionP3Id);

      // Permisos
      const resPerms = await client.query(
        "SELECT id, codigo FROM permisos WHERE codigo IN ('INTERVENCIONES_RECIBIR_ASIGNACION', 'INTERVENCIONES_VER')"
      );
      const permMap = Object.fromEntries(resPerms.rows.map((r) => [r.codigo, Number(r.id)]));

      // (a) Responsable de mantenimiento activo
      const resUA = await client.query(
        `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo)
         VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
        [`UA_RESP_${testSuffix}`, `Usuario A Responsable ${testSuffix}`, passHash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
      );
      const userAId = Number(resUA.rows[0].id);
      createdUsuarioIds.push(userAId);

      // (b) Operario sin excepciones
      const resUB = await client.query(
        `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo)
         VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
        [`UB_OPER_${testSuffix}`, `Usuario B Operario ${testSuffix}`, passHash, perfilMap['OPERARIO']]
      );
      const userBId = Number(resUB.rows[0].id);
      createdUsuarioIds.push(userBId);

      // (c) Operario con excepciones CONCEDER RECIBIR_ASIGNACION y VER (SECTORES), asignado a OTRO sector
      const resUC = await client.query(
        `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo)
         VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
        [`UC_OTRO_${testSuffix}`, `Usuario C Operario Otro ${testSuffix}`, passHash, perfilMap['OPERARIO']]
      );
      const userCId = Number(resUC.rows[0].id);
      createdUsuarioIds.push(userCId);
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, otorgado_por_usuario_id) VALUES
         ($1, $2, 'CONCEDER', 'TODAS', $4),
         ($1, $3, 'CONCEDER', 'SECTORES', $4)`,
        [userCId, permMap['INTERVENCIONES_RECIBIR_ASIGNACION'], permMap['INTERVENCIONES_VER'], adminId]
      );
      await client.query(
        'INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)',
        [userCId, sectorOtroId]
      );

      // (d) Operario con excepciones CONCEDER RECIBIR_ASIGNACION y VER (SECTORES), asignado al sector de la máquina
      const resUD = await client.query(
        `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo)
         VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
        [`UD_MAQ_${testSuffix}`, `Usuario D Operario Maquina ${testSuffix}`, passHash, perfilMap['OPERARIO']]
      );
      const userDId = Number(resUD.rows[0].id);
      createdUsuarioIds.push(userDId);
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, otorgado_por_usuario_id) VALUES
         ($1, $2, 'CONCEDER', 'TODAS', $4),
         ($1, $3, 'CONCEDER', 'SECTORES', $4)`,
        [userDId, permMap['INTERVENCIONES_RECIBIR_ASIGNACION'], permMap['INTERVENCIONES_VER'], adminId]
      );
      await client.query(
        'INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)',
        [userDId, sectorMaquinaId]
      );

      // (e) Responsable con DENEGAR de RECIBIR_ASIGNACION
      const resUE = await client.query(
        `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo)
         VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
        [`UE_DEN_${testSuffix}`, `Usuario E Denegado ${testSuffix}`, passHash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
      );
      const userEId = Number(resUE.rows[0].id);
      createdUsuarioIds.push(userEId);
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, otorgado_por_usuario_id) VALUES
         ($1, $2, 'DENEGAR', 'TODAS', $3)`,
        [userEId, permMap['INTERVENCIONES_RECIBIR_ASIGNACION'], adminId]
      );

      // (f) Responsable inactivo
      const resUF = await client.query(
        `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo)
         VALUES ($1, $2, $3, $4, FALSE) RETURNING id`,
        [`UF_INAC_${testSuffix}`, `Usuario F Inactivo ${testSuffix}`, passHash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
      );
      const userFId = Number(resUF.rows[0].id);
      createdUsuarioIds.push(userFId);

      // Consultar endpoint
      const resHab = await app.request(`/api/intervenciones/${intervencionP3Id}/responsables-habilitados`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resHab.status, 200);
      const listaHabilitados = await resHab.json();
      const idsHabilitados = new Set(listaHabilitados.map((u: any) => Number(u.id)));

      // Verificación de inclusiones y exclusiones esperadas
      assert.ok(idsHabilitados.has(userAId), 'Debe incluir a (a) responsable de mantenimiento');
      assert.ok(idsHabilitados.has(userDId), 'Debe incluir a (d) operario habilitado en el sector de la máquina');
      assert.ok(!idsHabilitados.has(userBId), 'No debe incluir a (b) operario');
      assert.ok(!idsHabilitados.has(userCId), 'No debe incluir a (c) operario asignado a otro sector');
      assert.ok(!idsHabilitados.has(userEId), 'No debe incluir a (e) responsable con DENEGAR');
      assert.ok(!idsHabilitados.has(userFId), 'No debe incluir a (f) responsable inactivo');

      // Verificación de coincidencia exacta con validarResponsableHabilitado para todos los usuarios activos
      const resTodosActivos = await client.query('SELECT id FROM usuarios WHERE activo = TRUE');
      for (const row of resTodosActivos.rows) {
        const uid = Number(row.id);
        const enLista = idsHabilitados.has(uid);
        let valOk = false;
        try {
          await validarResponsableHabilitado(client, uid, sectorMaquinaId);
          valOk = true;
        } catch {
          valOk = false;
        }
        assert.strictEqual(enLista, valOk, `Coincidencia entre lista y validador para usuario ${uid}`);
      }
    });

    // P-04: Formato de errores
    await t.test('P-04: Formato de errores con codigo', async () => {
      // 1. Sin token -> 401 NO_AUTENTICADO
      const resSinToken = await app.request('/api/maquinas');
      assert.strictEqual(resSinToken.status, 401);
      const dSinToken = await resSinToken.json();
      assert.strictEqual(dSinToken.codigo, 'NO_AUTENTICADO');

      // 2. Sin permiso -> 403 PERMISO_INSUFICIENTE (operario intentando gestionar máquinas)
      const resSinPerm = await app.request('/api/maquinas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
        body: JSON.stringify({ nombre: 'Máquina Sin Permiso', sector_id: 1 }),
      });
      assert.strictEqual(resSinPerm.status, 403);
      const dSinPerm = await resSinPerm.json();
      assert.strictEqual(dSinPerm.codigo, 'PERMISO_INSUFICIENTE');

      // 3. Máquina inexistente -> 404 MAQUINA_NO_ENCONTRADA
      const resMaqNo = await app.request('/api/maquinas/999999999', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resMaqNo.status, 404);
      const dMaqNo = await resMaqNo.json();
      assert.strictEqual(dMaqNo.codigo, 'MAQUINA_NO_ENCONTRADA');

      // 4. Sector inexistente -> 404 SECTOR_NO_ENCONTRADO
      const resSecNo = await app.request('/api/sectores/999999999', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resSecNo.status, 404);
      const dSecNo = await resSecNo.json();
      assert.strictEqual(dSecNo.codigo, 'SECTOR_NO_ENCONTRADO');

      // 5. ID inválido (/api/maquinas/abc) -> 400 DATOS_INVALIDOS
      const resIdInv = await app.request('/api/maquinas/abc', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resIdInv.status, 400);
      const dIdInv = await resIdInv.json();
      assert.strictEqual(dIdInv.codigo, 'DATOS_INVALIDOS');
    });

  } finally {
    // Limpieza de datos creados
    try {
      if (createdIntervencionIds.length > 0) {
        await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervencion_auditoria WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM notificaciones WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervenciones WHERE id = ANY($1)', [createdIntervencionIds]);
      }
      if (createdMaquinaIds.length > 0) {
        await client.query('DELETE FROM historial_estados_maquina WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
        await client.query('DELETE FROM maquinas WHERE id = ANY($1)', [createdMaquinaIds]);
      }
      if (createdUsuarioIds.length > 0) {
        await client.query('DELETE FROM usuario_sector WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM usuario_permiso WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM auditoria_permisos WHERE realizado_por_usuario_id = ANY($1) OR sobre_usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM notificaciones WHERE usuario_id = ANY($1) OR generada_por_usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [createdUsuarioIds]);
      }
      if (createdSectorIds.length > 0) {
        await client.query('DELETE FROM sectores WHERE id = ANY($1)', [createdSectorIds]);
      }
    } catch (cleanupErr) {
      console.error('Error durante limpieza de prueba pendientes:', cleanupErr);
    } finally {
      client.release();
    }
  }
});

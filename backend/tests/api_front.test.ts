import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import app from '../functions/api.ts';
import { pool } from '../functions/db.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (API FRONT TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Etapa API — API para el frontend', async (t) => {
  const client = await pool.connect();

  const createdIntervencionIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdUsuarioIds: number[] = [];

  const limpiarIntervencion = async (intId: number) => {
    await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE intervencion_id = $1)', [intId]);
    await client.query('DELETE FROM notificaciones WHERE intervencion_id = $1', [intId]);
    await client.query('DELETE FROM intervencion_auditoria WHERE intervencion_id = $1', [intId]);
    await client.query('DELETE FROM intervencion_costos WHERE intervencion_id = $1', [intId]);
    await client.query('DELETE FROM documentos WHERE intervencion_id = $1', [intId]);
    await client.query('DELETE FROM intervencion_repuestos WHERE intervencion_id = $1', [intId]);
    await client.query('DELETE FROM movimientos_stock WHERE intervencion_id = $1', [intId]);
    await client.query('DELETE FROM intervencion_periodos_detencion WHERE intervencion_id = $1', [intId]);
    await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id = $1', [intId]);
    await client.query('DELETE FROM historial_estados_maquina WHERE intervencion_id = $1', [intId]);
    await client.query('DELETE FROM intervenciones WHERE id = $1', [intId]);
  };

  const testSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  let adminToken = '';
  let adminId = 0;

  let r1Token = '';
  let r1Id = 0;

  let r2Token = '';
  let r2Id = 0;

  let opToken = '';
  let opId = 0;

  let conToken = '';
  let conId = 0;

  let sector1Id = 0;
  let sector2Id = 0;
  let maquina1Id = 0;
  let maquina2Id = 0;

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

    // 2. Obtener perfiles
    const resPerfiles = await client.query('SELECT id, nombre FROM perfiles');
    const perfilMap = Object.fromEntries(resPerfiles.rows.map((r) => [r.nombre, Number(r.id)]));

    // 3. Crear sectores y máquinas
    const resSec1 = await client.query(
      `INSERT INTO sectores (nombre) VALUES ($1) RETURNING id`,
      [`Sector_AF1_${testSuffix}`]
    );
    sector1Id = Number(resSec1.rows[0].id);
    createdSectorIds.push(sector1Id);

    const resSec2 = await client.query(
      `INSERT INTO sectores (nombre) VALUES ($1) RETURNING id`,
      [`Sector_AF2_${testSuffix}`]
    );
    sector2Id = Number(resSec2.rows[0].id);
    createdSectorIds.push(sector2Id);

    const resM1 = await client.query(
      `INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ($1, $2, $3, 'OPERATIVA', TRUE) RETURNING id`,
      [`Maquina_AF1_${testSuffix}`, `M1_${testSuffix.slice(0, 6)}`, sector1Id]
    );
    maquina1Id = Number(resM1.rows[0].id);
    createdMaquinaIds.push(maquina1Id);

    const resM2 = await client.query(
      `INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ($1, $2, $3, 'OPERATIVA', TRUE) RETURNING id`,
      [`Maquina_AF2_${testSuffix}`, `M2_${testSuffix.slice(0, 6)}`, sector2Id]
    );
    maquina2Id = Number(resM2.rows[0].id);
    createdMaquinaIds.push(maquina2Id);

    // 4. Crear usuarios: R1, R2, OP, CON
    const passHash = await bcrypt.hash('pass123', 10);

    const crearUsuario = async (legajo: string, nombre: string, perfilId: number, sectorId?: number) => {
      const resU = await client.query(
        `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, sesion_version, debe_cambiar_password)
         VALUES ($1, $2, $3, $4, TRUE, 1, FALSE) RETURNING id`,
        [legajo, nombre, passHash, perfilId]
      );
      const uId = Number(resU.rows[0].id);
      createdUsuarioIds.push(uId);
      if (sectorId) {
        await client.query(`INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [uId, sectorId]);
      }
      const resLog = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legajo, password: 'pass123' }),
      });
      const dataLog = await resLog.json();
      return { id: uId, token: dataLog.token };
    };

    const r1 = await crearUsuario(`R1_${testSuffix}`, 'Resp 1 AF', perfilMap['RESPONSABLE_MANTENIMIENTO'], sector1Id);
    r1Id = r1.id;
    r1Token = r1.token;

    const r2 = await crearUsuario(`R2_${testSuffix}`, 'Resp 2 AF', perfilMap['RESPONSABLE_MANTENIMIENTO'], sector1Id);
    r2Id = r2.id;
    r2Token = r2.token;

    const op = await crearUsuario(`OP_${testSuffix}`, 'Operario AF', perfilMap['OPERARIO'], sector1Id);
    opId = op.id;
    opToken = op.token;

    const con = await crearUsuario(`CON_${testSuffix}`, 'Consulta AF', perfilMap['CONSULTA'], sector1Id);
    conId = con.id;
    conToken = con.token;

    // =========================================================================
    // AF-01: Tabla de la sección 2.4: las 7 situaciones x 4 usuarios
    // =========================================================================
    await t.test('AF-01: Tabla de acciones disponibles en las 7 situaciones x 4 usuarios', async () => {
      // Situación 1: Pendiente, sin responsable (creada por OP)
      const resS1 = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Falla S1 AF-01', detiene_maquina: false }),
      });
      assert.strictEqual(resS1.status, 201);
      const intS1 = await resS1.json();
      const intId = intS1.id;
      createdIntervencionIds.push(intId);

      const consultarAcciones = async (token: string) => {
        const res = await app.request(`/api/intervenciones/${intId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        return data.acciones_disponibles;
      };

      const S1_EXP_R = ['TOMAR', 'ASIGNAR', 'INICIAR', 'RESOLVER_AHORA', 'CANCELAR', 'REGISTRAR_DETENCION', 'EDITAR', 'ELIMINAR'];
      assert.deepStrictEqual(await consultarAcciones(r1Token), S1_EXP_R, 'S1 - R1');
      assert.deepStrictEqual(await consultarAcciones(r2Token), S1_EXP_R, 'S1 - R2');
      assert.deepStrictEqual(await consultarAcciones(opToken), ['EDITAR'], 'S1 - OP');
      assert.deepStrictEqual(await consultarAcciones(conToken), [], 'S1 - CON');

      // Situación 2: Pendiente, responsable R1 (R1 la tomó)
      const resTomar = await app.request(`/api/intervenciones/${intId}/tomar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' }),
      });
      assert.strictEqual(resTomar.status, 200);

      const S2_EXP_R = ['ASIGNAR', 'DESASIGNAR', 'INICIAR', 'RESOLVER_AHORA', 'CANCELAR', 'REGISTRAR_DETENCION', 'EDITAR', 'ELIMINAR'];
      assert.deepStrictEqual(await consultarAcciones(r1Token), S2_EXP_R, 'S2 - R1');
      assert.deepStrictEqual(await consultarAcciones(r2Token), S2_EXP_R, 'S2 - R2');
      assert.deepStrictEqual(await consultarAcciones(opToken), [], 'S2 - OP');
      assert.deepStrictEqual(await consultarAcciones(conToken), [], 'S2 - CON');

      // Situación 3: En proceso, responsable R1
      const resIniciar = await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' }),
      });
      assert.strictEqual(resIniciar.status, 200);

      const S3_EXP_R = ['ASIGNAR', 'ESPERAR_REPUESTOS', 'FINALIZAR', 'CANCELAR', 'REGISTRAR_DETENCION', 'EDITAR'];
      assert.deepStrictEqual(await consultarAcciones(r1Token), S3_EXP_R, 'S3 - R1');
      assert.deepStrictEqual(await consultarAcciones(r2Token), S3_EXP_R, 'S3 - R2');
      assert.deepStrictEqual(await consultarAcciones(opToken), [], 'S3 - OP');
      assert.deepStrictEqual(await consultarAcciones(conToken), [], 'S3 - CON');

      // Situación 4: Esperando repuestos, responsable R1
      const resEspera = await app.request(`/api/intervenciones/${intId}/espera-repuestos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', observacion: 'Falta repuesto ruleman' }),
      });
      assert.strictEqual(resEspera.status, 200);

      const S4_EXP_R = ['ASIGNAR', 'REANUDAR', 'CANCELAR', 'REGISTRAR_DETENCION', 'EDITAR'];
      assert.deepStrictEqual(await consultarAcciones(r1Token), S4_EXP_R, 'S4 - R1');
      assert.deepStrictEqual(await consultarAcciones(r2Token), S4_EXP_R, 'S4 - R2');
      assert.deepStrictEqual(await consultarAcciones(opToken), [], 'S4 - OP');
      assert.deepStrictEqual(await consultarAcciones(conToken), [], 'S4 - CON');

      // Situación 5: Finalizada (Reanudar -> Finalizar)
      await app.request(`/api/intervenciones/${intId}/reanudar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_ESPERA_REPUESTOS' }),
      });
      const resFin = await app.request(`/api/intervenciones/${intId}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Reparacion exitosa',
          ejecucion: 'INTERNA',
        }),
      });
      assert.strictEqual(resFin.status, 200);

      const S5_EXP_R = ['REABRIR'];
      assert.deepStrictEqual(await consultarAcciones(r1Token), S5_EXP_R, 'S5 - R1');
      assert.deepStrictEqual(await consultarAcciones(r2Token), S5_EXP_R, 'S5 - R2');
      assert.deepStrictEqual(await consultarAcciones(opToken), [], 'S5 - OP');
      assert.deepStrictEqual(await consultarAcciones(conToken), [], 'S5 - CON');

      // Situación 6: Cancelada
      const resS6 = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Falla S6 AF-01', detiene_maquina: false }),
      });
      const intS6Id = (await resS6.json()).id;
      createdIntervencionIds.push(intS6Id);

      await app.request(`/api/intervenciones/${intS6Id}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', motivo: 'Cancelacion prueba' }),
      });

      const consultarS6 = async (token: string) => {
        const res = await app.request(`/api/intervenciones/${intS6Id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assert.strictEqual(res.status, 200);
        return (await res.json()).acciones_disponibles;
      };
      assert.deepStrictEqual(await consultarS6(r1Token), [], 'S6 - R1');
      assert.deepStrictEqual(await consultarS6(r2Token), [], 'S6 - R2');
      assert.deepStrictEqual(await consultarS6(opToken), [], 'S6 - OP');
      assert.deepStrictEqual(await consultarS6(conToken), [], 'S6 - CON');

      // Situación 7: Igual que S1, pero con un período de detención abierto
      const resS7 = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Falla S7 AF-01', detiene_maquina: true }),
      });
      const intS7Id = (await resS7.json()).id;
      createdIntervencionIds.push(intS7Id);

      const consultarS7 = async (token: string) => {
        const res = await app.request(`/api/intervenciones/${intS7Id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assert.strictEqual(res.status, 200);
        return (await res.json()).acciones_disponibles;
      };

      const r1_s7 = await consultarS7(r1Token);
      const r2_s7 = await consultarS7(r2Token);
      assert.ok(!r1_s7.includes('REGISTRAR_DETENCION'), 'S7 - R1 no debe incluir REGISTRAR_DETENCION');
      assert.ok(!r2_s7.includes('REGISTRAR_DETENCION'), 'S7 - R2 no debe incluir REGISTRAR_DETENCION');
      assert.deepStrictEqual(await consultarS7(opToken), ['EDITAR'], 'S7 - OP');
      assert.deepStrictEqual(await consultarS7(conToken), [], 'S7 - CON');
    });

    // =========================================================================
    // AF-02: Para R2 en S1, S3 y S5 ejecutar cada acción
    // =========================================================================
    await t.test('AF-02: R2 ejecuta cada acción en S1, S3 y S5 sobre intervención nueva y 409 en inválidas', async () => {
      // Helper para crear intervencion en S1
      const crearS1 = async () => {
        const res = await app.request('/api/intervenciones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opToken}` },
          body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion AF-02 S1' }),
        });
        const id = (await res.json()).id;
        createdIntervencionIds.push(id);
        return id;
      };

      // S1 acciones: TOMAR, ASIGNAR, INICIAR, RESOLVER_AHORA, CANCELAR, REGISTRAR_DETENCION, EDITAR, ELIMINAR
      // 1. TOMAR
      const idTomar = await crearS1();
      const rTomar = await app.request(`/api/intervenciones/${idTomar}/tomar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' }),
      });
      assert.strictEqual(rTomar.status, 200);

      // 2. ASIGNAR (destino R1 distinto de null)
      const idAsig = await crearS1();
      const rAsig = await app.request(`/api/intervenciones/${idAsig}/responsable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2Token}` },
        body: JSON.stringify({ usuario_id: r1Id, estado_esperado: 'PENDIENTE' }),
      });
      assert.strictEqual(rAsig.status, 200);

      // 3. INICIAR
      const idIni = await crearS1();
      const rIni = await app.request(`/api/intervenciones/${idIni}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' }),
      });
      assert.strictEqual(rIni.status, 200);

      // 4. RESOLVER_AHORA
      const idRes = await crearS1();
      const rRes = await app.request(`/api/intervenciones/${idRes}/resolver-ahora`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2Token}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
          fecha_inicio: new Date().toISOString(),
          trabajo_realizado: 'Solucion inmediata',
          ejecucion: 'INTERNA',
        }),
      });
      assert.strictEqual(rRes.status, 200);

      // 5. CANCELAR
      const idCanc = await crearS1();
      const rCanc = await app.request(`/api/intervenciones/${idCanc}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', motivo: 'Cancelacion prueba' }),
      });
      assert.strictEqual(rCanc.status, 200);

      // 6. REGISTRAR_DETENCION
      const idDet = await crearS1();
      const rDet = await app.request(`/api/intervenciones/${idDet}/registrar-detencion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', observacion: 'Detencion maquina' }),
      });
      assert.strictEqual(rDet.status, 200);

      // 7. EDITAR
      const idEdit = await crearS1();
      const rEdit = await app.request(`/api/intervenciones/${idEdit}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', descripcion: 'Falla editada por R2' }),
      });
      assert.strictEqual(rEdit.status, 200);

      // 8. ELIMINAR
      const idElim = await crearS1();
      const rElim = await app.request(`/api/intervenciones/${idElim}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2Token}` },
        body: JSON.stringify({ motivo: 'Eliminacion por R2' }),
      });
      assert.strictEqual(rElim.status, 200);

      // Helper para crear intervencion en S3 (EN_PROCESO, responsable R1)
      const crearS3 = async () => {
        const id = await crearS1();
        await app.request(`/api/intervenciones/${id}/tomar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r1Token}` },
          body: JSON.stringify({ estado_esperado: 'PENDIENTE' }),
        });
        await app.request(`/api/intervenciones/${id}/iniciar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r1Token}` },
          body: JSON.stringify({ estado_esperado: 'PENDIENTE' }),
        });
        return id;
      };

      // S3 acciones: ASIGNAR, ESPERAR_REPUESTOS, FINALIZAR, CANCELAR, REGISTRAR_DETENCION, EDITAR
      // 1. ASIGNAR (destino R2 distinto del actual R1)
      const idS3Asig = await crearS3();
      const rS3Asig = await app.request(`/api/intervenciones/${idS3Asig}/responsable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2Token}` },
        body: JSON.stringify({ usuario_id: r2Id, motivo: 'Reasignar a R2', estado_esperado: 'EN_PROCESO' }),
      });
      assert.strictEqual(rS3Asig.status, 200);

      // 2. ESPERAR_REPUESTOS
      const idS3Esp = await crearS3();
      const rS3Esp = await app.request(`/api/intervenciones/${idS3Esp}/espera-repuestos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', observacion: 'Falta repuesto x' }),
      });
      assert.strictEqual(rS3Esp.status, 200);

      // 3. FINALIZAR
      const idS3Fin = await crearS3();
      const rS3Fin = await app.request(`/api/intervenciones/${idS3Fin}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Trabajo finalizado',
          ejecucion: 'INTERNA',
        }),
      });
      assert.strictEqual(rS3Fin.status, 200);

      // 4. CANCELAR
      const idS3Canc = await crearS3();
      const rS3Canc = await app.request(`/api/intervenciones/${idS3Canc}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', motivo: 'Cancelacion prueba S3' }),
      });
      assert.strictEqual(rS3Canc.status, 200);

      // 5. REGISTRAR_DETENCION
      const idS3Det = await crearS3();
      const rS3Det = await app.request(`/api/intervenciones/${idS3Det}/registrar-detencion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', observacion: 'Detencion maquina S3' }),
      });
      assert.strictEqual(rS3Det.status, 200);

      // 6. EDITAR
      const idS3Edit = await crearS3();
      const rS3Edit = await app.request(`/api/intervenciones/${idS3Edit}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', descripcion: 'Falla editada en S3' }),
      });
      assert.strictEqual(rS3Edit.status, 200);

      // Dos acciones no permitidas en S3: INICIAR y REABRIR con estado_esperado 'EN_PROCESO'
      const idS3Inval = await crearS3();
      const rInvIni = await app.request(`/api/intervenciones/${idS3Inval}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO' }),
      });
      assert.strictEqual(rInvIni.status, 409);
      assert.strictEqual((await rInvIni.json()).codigo, 'TRANSICION_NO_PERMITIDA');

      const rInvReab = await app.request(`/api/intervenciones/${idS3Inval}/reabrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', motivo: 'Reapertura invalida' }),
      });
      assert.strictEqual(rInvReab.status, 409);
      assert.strictEqual((await rInvReab.json()).codigo, 'TRANSICION_NO_PERMITIDA');

      // S5 (FINALIZADA): REABRIR
      const idS5 = await crearS3();
      const rFinS5 = await app.request(`/api/intervenciones/${idS5}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Trabajo finalizado',
          ejecucion: 'INTERNA',
        }),
      });
      assert.strictEqual(rFinS5.status, 200);
      const rS5Reab = await app.request(`/api/intervenciones/${idS5}/reabrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2Token}` },
        body: JSON.stringify({ estado_esperado: 'FINALIZADA', motivo: 'Reapertura valida por R2', maquina_detenida: false }),
      });
      assert.strictEqual(rS5Reab.status, 200);
    });

    // =========================================================================
    // AF-03: Intervención eliminada -> acciones_disponibles = []
    // =========================================================================
    await t.test('AF-03: Intervención eliminada devuelve acciones_disponibles = []', async () => {
      const res = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion para eliminar AF-03' }),
      });
      const intId = (await res.json()).id;
      createdIntervencionIds.push(intId);

      await app.request(`/api/intervenciones/${intId}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r1Token}` },
        body: JSON.stringify({ motivo: 'Eliminacion AF-03' }),
      });

      // Sin parámetro -> 404 INTERVENCION_NO_ENCONTRADA (compatibilidad)
      const resSinParam = await app.request(`/api/intervenciones/${intId}`, {
        headers: { Authorization: `Bearer ${r1Token}` },
      });
      assert.strictEqual(resSinParam.status, 404);

      // Con ?incluir_eliminada=true -> 200 con acciones_disponibles = []
      const resDetalle = await app.request(`/api/intervenciones/${intId}?incluir_eliminada=true`, {
        headers: { Authorization: `Bearer ${r1Token}` },
      });
      assert.strictEqual(resDetalle.status, 200);
      const data = await resDetalle.json();
      assert.deepStrictEqual(data.acciones_disponibles, []);
    });

    // =========================================================================
    // AF-04: Filtros en GET /api/intervenciones
    // =========================================================================
    await t.test('AF-04: Filtros por estado, maquina_id, sector_id, tipo, responsable_id, mias, fechas y q', async () => {
      // Crear conjunto controlado:
      // i1: PENDIENTE, maquina1 (sector1), CORRECTIVO, resp R1, q="Fuga hidraulica en bomba", date 2026-05-01
      // i2: EN_PROCESO, maquina1 (sector1), CORRECTIVO, resp R2, q="Vibracion en reductor", date 2026-05-10
      // i3: EN_ESPERA_REPUESTOS, maquina2 (sector2), PREVENTIVO, resp R1, q="Cambio de ruleman", date 2026-05-20
      // i4: FINALIZADA, maquina2 (sector2), CORRECTIVO, resp R2, q="Ajuste de correa", date 2026-05-25

      const resTipoPrev = await client.query("SELECT id FROM tipos_intervencion WHERE codigo = 'PREVENTIVO'");
      const tipoPrevId = resTipoPrev.rows[0].id;
      const resTipoCorr = await client.query("SELECT id FROM tipos_intervencion WHERE codigo = 'CORRECTIVO'");
      const tipoCorrId = resTipoCorr.rows[0].id;

      const crearDirecto = async (opts: any) => {
        const esFin = opts.estado === 'FINALIZADA';
        const res = await client.query(
          `INSERT INTO intervenciones (
             maquina_id, tipo_intervencion_id, creado_por_usuario_id, responsable_usuario_id,
             descripcion, estado, trabajo_realizado, ejecucion, fecha_inicio, fecha_finalizacion, fecha_creacion, actualizado_en
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, NOW()) RETURNING id`,
          [
            opts.maquinaId,
            opts.tipoId,
            opId,
            opts.respId,
            opts.desc,
            opts.estado,
            esFin ? 'Trabajo completado' : null,
            esFin ? 'INTERNA' : null,
            esFin ? opts.fecha : null,
            esFin ? opts.fecha : null,
            opts.fecha,
          ]
        );
        const id = Number(res.rows[0].id);
        createdIntervencionIds.push(id);
        await client.query(
          `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, cambiado_en, observacion)
           VALUES ($1, NULL, $2, $3, NOW(), $4)`,
          [id, opts.estado, opId, opts.estado === 'EN_ESPERA_REPUESTOS' ? 'Falta repuesto' : null]
        );
        return id;
      };

      const id1 = await crearDirecto({ maquinaId: maquina1Id, tipoId: tipoCorrId, respId: r1Id, desc: `Fuga hidraulica bomba ${testSuffix}`, estado: 'PENDIENTE', fecha: '2026-05-01T10:00:00Z' });
      const id2 = await crearDirecto({ maquinaId: maquina1Id, tipoId: tipoCorrId, respId: r2Id, desc: `Vibracion en reductor ${testSuffix}`, estado: 'EN_PROCESO', fecha: '2026-05-10T10:00:00Z' });
      const id3 = await crearDirecto({ maquinaId: maquina2Id, tipoId: tipoPrevId, respId: r1Id, desc: `Cambio de ruleman ${testSuffix}`, estado: 'EN_ESPERA_REPUESTOS', fecha: '2026-05-20T10:00:00Z' });
      const id4 = await crearDirecto({ maquinaId: maquina2Id, tipoId: tipoCorrId, respId: r2Id, desc: `Ajuste de correa ${testSuffix}`, estado: 'FINALIZADA', fecha: '2026-05-25T10:00:00Z' });

      const filtrarIds = async (queryStr: string, token: string = r1Token) => {
        const res = await app.request(`/api/intervenciones?${queryStr}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assert.strictEqual(res.status, 200);
        const list = await res.json();
        return list.map((x: any) => x.id).filter((id: number) => [id1, id2, id3, id4].includes(id));
      };

      // 1. estado=PENDIENTE,EN_PROCESO
      const f1 = await filtrarIds('estado=PENDIENTE,EN_PROCESO');
      assert.deepStrictEqual(f1.sort(), [id1, id2].sort(), 'Filtro por estados');

      // 2. maquina_id
      const f2 = await filtrarIds(`maquina_id=${maquina1Id}`);
      assert.deepStrictEqual(f2.sort(), [id1, id2].sort(), 'Filtro por maquina_id');

      // 3. sector_id
      const f3 = await filtrarIds(`sector_id=${sector2Id}`);
      assert.deepStrictEqual(f3.sort(), [id3, id4].sort(), 'Filtro por sector_id');

      // 4. tipo=PREVENTIVO
      const f4 = await filtrarIds('tipo=PREVENTIVO');
      assert.deepStrictEqual(f4.sort(), [id3].sort(), 'Filtro por tipo');

      // 5. responsable_id
      const f5 = await filtrarIds(`responsable_id=${r1Id}`);
      assert.deepStrictEqual(f5.sort(), [id1, id3].sort(), 'Filtro por responsable_id');

      // 6. mias=true (como R1)
      const f6 = await filtrarIds('mias=true', r1Token);
      assert.deepStrictEqual(f6.sort(), [id1, id3].sort(), 'Filtro por mias=true');

      // 7. desde / hasta
      const f7 = await filtrarIds('desde=2026-05-05T00:00:00Z&hasta=2026-05-22T00:00:00Z');
      assert.deepStrictEqual(f7.sort(), [id2, id3].sort(), 'Filtro por rango de fechas');

      // 8. q
      const f8 = await filtrarIds('q=bomba');
      assert.deepStrictEqual(f8.sort(), [id1].sort(), 'Filtro por texto q');

      // 9. Combinado
      const f9 = await filtrarIds(`maquina_id=${maquina1Id}&estado=PENDIENTE`);
      assert.deepStrictEqual(f9.sort(), [id1].sort(), 'Filtro combinado');
    });

    // =========================================================================
    // AF-05: Paginación sobre 7 resultados con limit=3
    // =========================================================================
    await t.test('AF-05: Paginación con limit=3, offset 0, 3, 6 y header X-Total-Count', async () => {
      // Máquina específica para esta prueba
      const resM = await client.query(
        `INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ($1, $2, $3, 'OPERATIVA', TRUE) RETURNING id`,
        [`Maquina_Pag_${testSuffix}`, `MP_${testSuffix.slice(0, 6)}`, sector1Id]
      );
      const maqPagId = Number(resM.rows[0].id);
      createdMaquinaIds.push(maqPagId);

      const resTipoCorr = await client.query("SELECT id FROM tipos_intervencion WHERE codigo = 'CORRECTIVO'");
      const tipoCorrId = resTipoCorr.rows[0].id;

      const idsPag: number[] = [];
      for (let i = 1; i <= 7; i++) {
        const res = await client.query(
          `INSERT INTO intervenciones (
             maquina_id, tipo_intervencion_id, creado_por_usuario_id,
             descripcion, estado, fecha_creacion, actualizado_en
           ) VALUES ($1, $2, $3, $4, 'PENDIENTE', NOW() - ($5 || ' minutes')::interval, NOW()) RETURNING id`,
          [maqPagId, tipoCorrId, opId, `Intervencion paginada ${i} ${testSuffix}`, 10 - i]
        );
        const id = Number(res.rows[0].id);
        idsPag.push(id);
        createdIntervencionIds.push(id);
      }

      // Consulta offset=0
      const res0 = await app.request(`/api/intervenciones?maquina_id=${maqPagId}&limit=3&offset=0`, {
        headers: { Authorization: `Bearer ${r1Token}` },
      });
      assert.strictEqual(res0.status, 200);
      assert.strictEqual(res0.headers.get('X-Total-Count'), '7');
      const list0 = await res0.json();
      assert.strictEqual(list0.length, 3);

      // Consulta offset=3
      const res3 = await app.request(`/api/intervenciones?maquina_id=${maqPagId}&limit=3&offset=3`, {
        headers: { Authorization: `Bearer ${r1Token}` },
      });
      assert.strictEqual(res3.status, 200);
      assert.strictEqual(res3.headers.get('X-Total-Count'), '7');
      const list3 = await res3.json();
      assert.strictEqual(list3.length, 3);

      // Consulta offset=6
      const res6 = await app.request(`/api/intervenciones?maquina_id=${maqPagId}&limit=3&offset=6`, {
        headers: { Authorization: `Bearer ${r1Token}` },
      });
      assert.strictEqual(res6.status, 200);
      assert.strictEqual(res6.headers.get('X-Total-Count'), '7');
      const list6 = await res6.json();
      assert.strictEqual(list6.length, 1);

      // Verificar que los 7 IDs combinados no tengan repetidos y sean exactamente los 7
      const combinados = [...list0.map((x: any) => x.id), ...list3.map((x: any) => x.id), ...list6.map((x: any) => x.id)];
      assert.strictEqual(new Set(combinados).size, 7);
      assert.deepStrictEqual(combinados.sort(), idsPag.sort());

      // Consulta sin limit: devuelve los 7
      const resAll = await app.request(`/api/intervenciones?maquina_id=${maqPagId}`, {
        headers: { Authorization: `Bearer ${r1Token}` },
      });
      assert.strictEqual(resAll.status, 200);
      assert.strictEqual(resAll.headers.get('X-Total-Count'), '7');
      const listAll = await resAll.json();
      assert.strictEqual(listAll.length, 7);
    });

    // =========================================================================
    // AF-06: Operario (alcance PROPIAS) con filtros
    // =========================================================================
    await t.test('AF-06: Operario con alcance PROPIAS no ve intervenciones ajenas aunque coincidan con el filtro', async () => {
      // Intervencion ajena creada por R1
      const resAjena = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: `Falla ajena R1 AF-06 ${testSuffix}` }),
      });
      const idAjena = (await resAjena.json()).id;
      createdIntervencionIds.push(idAjena);

      // Intervencion propia creada por OP
      const resPropia = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: `Falla propia OP AF-06 ${testSuffix}` }),
      });
      const idPropia = (await resPropia.json()).id;
      createdIntervencionIds.push(idPropia);

      // OP consulta filtrando por estado=PENDIENTE
      const resOp = await app.request('/api/intervenciones?estado=PENDIENTE', {
        headers: { Authorization: `Bearer ${opToken}` },
      });
      assert.strictEqual(resOp.status, 200);
      const list = await resOp.json();
      const ids = list.map((x: any) => x.id);

      assert.ok(ids.includes(idPropia), 'Debe incluir su propia intervención');
      assert.ok(!ids.includes(idAjena), 'NO debe incluir la intervención ajena');
    });

    // =========================================================================
    // AF-07: Parámetros inválidos devuelven 422 DATOS_INVALIDOS
    // =========================================================================
    await t.test('AF-07: Parámetros inválidos responden con 422 DATOS_INVALIDOS', async () => {
      const casos = [
        'estado=XX',
        'limit=0',
        'limit=500',
        'maquina_id=abc',
        'desde=2026-10-30T10:00:00', // sin zona horaria
        'q=a',                      // 1 solo caracter
      ];

      for (const caso of casos) {
        const res = await app.request(`/api/intervenciones?${caso}`, {
          headers: { Authorization: `Bearer ${r1Token}` },
        });
        assert.strictEqual(res.status, 422, `Caso ${caso} debe dar 422`);
        const body = await res.json();
        assert.strictEqual(body.codigo, 'DATOS_INVALIDOS', `Caso ${caso} debe tener código DATOS_INVALIDOS`);
      }
    });

    // =========================================================================
    // AF-08: Tablero con datos armados
    // =========================================================================
    await t.test('AF-08: Tablero consolida contadores y detenidas_ahora con tiempos en minutos', async () => {
      // Máquina 1: detenida desde hace 120 minutos
      const resM1 = await client.query(
        `INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ($1, $2, $3, 'DETENIDA', TRUE) RETURNING id`,
        [`Maq_Tablero_120_${testSuffix}`, `MT1_${testSuffix.slice(0, 6)}`, sector1Id]
      );
      const m1Id = Number(resM1.rows[0].id);
      createdMaquinaIds.push(m1Id);

      // Máquina 2: detenida desde hace 30 minutos
      const resM2 = await client.query(
        `INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ($1, $2, $3, 'DETENIDA', TRUE) RETURNING id`,
        [`Maq_Tablero_30_${testSuffix}`, `MT2_${testSuffix.slice(0, 6)}`, sector1Id]
      );
      const m2Id = Number(resM2.rows[0].id);
      createdMaquinaIds.push(m2Id);

      const resTipoCorr = await client.query("SELECT id FROM tipos_intervencion WHERE codigo = 'CORRECTIVO'");
      const tipoCorrId = resTipoCorr.rows[0].id;

      // Intervención sobre m1 con período abierto desde hace 120 min
      const resInt1 = await client.query(
        `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, fecha_creacion, actualizado_en)
         VALUES ($1, $2, $3, $4, 'EN_PROCESO', NOW() - INTERVAL '130 minutes', NOW()) RETURNING id`,
        [m1Id, tipoCorrId, opId, `Int Tablero 120m ${testSuffix}`]
      );
      const int1Id = Number(resInt1.rows[0].id);
      createdIntervencionIds.push(int1Id);
      await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, abierto_por_usuario_id, observacion)
         VALUES ($1, $2, NOW() - INTERVAL '120 minutes', $3, 'Detencion 120m')`,
        [int1Id, m1Id, opId]
      );

      // Intervención sobre m2 con período abierto desde hace 30 min
      const resInt2 = await client.query(
        `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, fecha_creacion, actualizado_en)
         VALUES ($1, $2, $3, $4, 'PENDIENTE', NOW() - INTERVAL '35 minutes', NOW()) RETURNING id`,
        [m2Id, tipoCorrId, opId, `Int Tablero 30m ${testSuffix}`]
      );
      const int2Id = Number(resInt2.rows[0].id);
      createdIntervencionIds.push(int2Id);
      await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, abierto_por_usuario_id, observacion)
         VALUES ($1, $2, NOW() - INTERVAL '30 minutes', $3, 'Detencion 30m')`,
        [int2Id, m2Id, opId]
      );

      const resTablero = await app.request('/api/tablero', {
        headers: { Authorization: `Bearer ${r1Token}` },
      });
      assert.strictEqual(resTablero.status, 200);
      const data = await resTablero.json();

      assert.ok(typeof data.maquinas === 'object');
      assert.ok(typeof data.intervenciones === 'object');
      assert.ok(Array.isArray(data.detenidas_ahora));

      // Filtrar las 2 máquinas armadas para esta prueba
      const detenidas = data.detenidas_ahora.filter((d: any) => [m1Id, m2Id].includes(d.maquina.id));
      assert.strictEqual(detenidas.length, 2, 'Debe incluir las 2 máquinas detenidas');

      // Ordenadas de mayor a menor tiempo: m1 primero (~120 min), m2 segundo (~30 min)
      assert.strictEqual(detenidas[0].maquina.id, m1Id);
      assert.strictEqual(detenidas[1].maquina.id, m2Id);

      assert.ok(
        Math.abs(detenidas[0].inactividad_en_curso_minutos - 120) <= 1,
        `Tolerancia de 1 minuto para ~120m (actual: ${detenidas[0].inactividad_en_curso_minutos})`
      );
      assert.ok(
        Math.abs(detenidas[1].inactividad_en_curso_minutos - 30) <= 1,
        `Tolerancia de 1 minuto para ~30m (actual: ${detenidas[1].inactividad_en_curso_minutos})`
      );
    });

    // =========================================================================
    // AF-09: Tablero con alcance SECTORES
    // =========================================================================
    await t.test('AF-09: Tablero con alcance SECTORES solo cuenta máquinas e intervenciones de sus sectores', async () => {
      // Crear usuario con alcance SECTORES únicamente sobre sector2Id
      const uSect = await crearUsuario(`USect_${testSuffix}`, 'User Sectores AF', perfilMap['RESPONSABLE_MANTENIMIENTO']);
      await client.query("DELETE FROM usuario_sector WHERE usuario_id = $1", [uSect.id]);
      await client.query("INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)", [uSect.id, sector2Id]);

      const permVer = await client.query("SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_VER'");
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, otorgado_por_usuario_id)
         VALUES ($1, $2, 'CONCEDER', 'SECTORES', $3)`,
        [uSect.id, permVer.rows[0].id, adminId]
      );

      const resTab = await app.request('/api/tablero', {
        headers: { Authorization: `Bearer ${uSect.token}` },
      });
      assert.strictEqual(resTab.status, 200);
      const data = await resTab.json();

      // En sector2Id tenemos maquina2Id
      const maquinasSector2 = await client.query('SELECT COUNT(*) AS total FROM maquinas WHERE sector_id = $1 AND activo = TRUE', [sector2Id]);
      const totalMaqS2 = Number(maquinasSector2.rows[0].total);
      const sumMaq = Object.values(data.maquinas as Record<string, number>).reduce((a, b) => a + b, 0);
      assert.strictEqual(sumMaq, totalMaqS2, 'La suma de máquinas debe coincidir con las de su sector');
    });

    // =========================================================================
    // AF-10: GET /api/tipos-intervencion
    // =========================================================================
    await t.test('AF-10: GET /api/tipos-intervencion incluye CORRECTIVO y PREVENTIVO; sin sesión responde 401', async () => {
      const resSinAuth = await app.request('/api/tipos-intervencion');
      assert.strictEqual(resSinAuth.status, 401);
      const bodySinAuth = await resSinAuth.json();
      assert.strictEqual(bodySinAuth.codigo, 'NO_AUTENTICADO');

      const resConAuth = await app.request('/api/tipos-intervencion', {
        headers: { Authorization: `Bearer ${r1Token}` },
      });
      assert.strictEqual(resConAuth.status, 200);
      const tipos = await resConAuth.json();
      assert.ok(Array.isArray(tipos));
      const codigos = tipos.map((t: any) => t.codigo);
      assert.ok(codigos.includes('CORRECTIVO'));
      assert.ok(codigos.includes('PREVENTIVO'));
    });

    // =========================================================================
    // AF-11: intervenciones_abiertas en GET /api/maquinas
    // =========================================================================
    await t.test('AF-11: intervenciones_abiertas en GET /api/maquinas cuenta 1 pendiente, 1 en proceso, 1 finalizada y 1 eliminada -> 2', async () => {
      // Máquina aislada
      const resM = await client.query(
        `INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ($1, $2, $3, 'OPERATIVA', TRUE) RETURNING id`,
        [`Maq_Abiertas_${testSuffix}`, `MO_${testSuffix.slice(0, 6)}`, sector1Id]
      );
      const mId = Number(resM.rows[0].id);
      createdMaquinaIds.push(mId);

      const resTipoCorr = await client.query("SELECT id FROM tipos_intervencion WHERE codigo = 'CORRECTIVO'");
      const tipoCorrId = resTipoCorr.rows[0].id;

      const crearInt = async (estado: string, eliminada: boolean = false) => {
        const esFin = estado === 'FINALIZADA';
        const res = await client.query(
          `INSERT INTO intervenciones (
             maquina_id, tipo_intervencion_id, creado_por_usuario_id,
             descripcion, estado, trabajo_realizado, ejecucion, fecha_inicio, fecha_finalizacion,
             eliminado_en, eliminado_por_usuario_id, motivo_eliminacion, fecha_creacion, actualizado_en
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()) RETURNING id`,
          [
            mId,
            tipoCorrId,
            opId,
            `Int ${estado} ${testSuffix}`,
            estado,
            esFin ? 'Trabajo OK' : null,
            esFin ? 'INTERNA' : null,
            esFin ? new Date() : null,
            esFin ? new Date() : null,
            eliminada ? new Date() : null,
            eliminada ? opId : null,
            eliminada ? 'Motivo eliminacion' : null,
          ]
        );
        const id = Number(res.rows[0].id);
        createdIntervencionIds.push(id);
        return id;
      };

      await crearInt('PENDIENTE');           // Abierta 1
      await crearInt('EN_PROCESO');          // Abierta 2
      await crearInt('FINALIZADA');          // Cerrada
      await crearInt('PENDIENTE', true);     // Eliminada

      const resMaq = await app.request('/api/maquinas', {
        headers: { Authorization: `Bearer ${r1Token}` },
      });
      assert.strictEqual(resMaq.status, 200);
      const maquinas = await resMaq.json();
      const maquina = maquinas.find((m: any) => Number(m.id) === mId);
      assert.ok(maquina, 'Debe encontrar la máquina');
      assert.strictEqual(maquina.intervenciones_abiertas, 2, 'Debe contabilizar exactamente 2 intervenciones abiertas');
    });

    // =========================================================================
    // AF-12: Configuración pública sin sesión
    // =========================================================================
    await t.test('AF-12: GET /api/configuracion/publica sin sesión y logo -> 404 LOGO_NO_CONFIGURADO', async () => {
      const resPub = await app.request('/api/configuracion/publica');
      assert.strictEqual(resPub.status, 200);
      const data = await resPub.json();
      assert.strictEqual(data.nombre_sistema, 'Sistema de Mantenimiento Industrial');
      assert.strictEqual(data.tiene_logo, false);

      const resLogo = await app.request('/api/configuracion/logo');
      assert.strictEqual(resLogo.status, 404);
      const dataLogo = await resLogo.json();
      assert.strictEqual(dataLogo.codigo, 'LOGO_NO_CONFIGURADO');
    });

    // =========================================================================
    // AF-13: Cargar un PNG chico por SQL en la prueba
    // =========================================================================
    await t.test('AF-13: Cargar un PNG chico por SQL devuelve tiene_logo=true y logo responde 200 con headers correctos', async () => {
      // Cabecera PNG válida
      const pngChico = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);

      await client.query(
        "UPDATE configuracion_sistema SET logo = $1, logo_tipo = 'image/png', actualizado_en = NOW() WHERE id = 1",
        [pngChico]
      );

      try {
        const resPub = await app.request('/api/configuracion/publica');
        assert.strictEqual(resPub.status, 200);
        const dataPub = await resPub.json();
        assert.strictEqual(dataPub.tiene_logo, true);

        const resLogo = await app.request('/api/configuracion/logo');
        assert.strictEqual(resLogo.status, 200);
        assert.strictEqual(resLogo.headers.get('Content-Type'), 'image/png');
        assert.strictEqual(resLogo.headers.get('X-Content-Type-Options'), 'nosniff');
        assert.ok(resLogo.headers.get('Cache-Control')?.includes('max-age=3600'));

        const bytesLogo = Buffer.from(await resLogo.arrayBuffer());
        assert.deepStrictEqual(bytesLogo, pngChico);
      } finally {
        await client.query(
          "UPDATE configuracion_sistema SET logo = NULL, logo_tipo = NULL, actualizado_en = NOW() WHERE id = 1"
        );
      }
    });

    // =========================================================================
    // AF-14: Responsable con CONCEDER INTERVENCIONES_ELIMINAR alcance PROPIAS
    // sobre falla creada por otro usuario -> acciones_disponibles incluye ELIMINAR y endpoint responde 200
    // =========================================================================
    await t.test('AF-14: Responsable con CONCEDER INTERVENCIONES_ELIMINAR alcance PROPIAS sobre falla de otro usuario', async () => {
      // 1. OP crea una falla
      const resPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion para AF-14' }),
      });
      assert.strictEqual(resPost.status, 201);
      const intId = (await resPost.json()).id;
      createdIntervencionIds.push(intId);

      // 2. Otorgar a R2 la excepción CONCEDER INTERVENCIONES_ELIMINAR alcance PROPIAS
      const resPerm = await client.query('SELECT id FROM permisos WHERE codigo = $1', ['INTERVENCIONES_ELIMINAR']);
      const permEliminarId = resPerm.rows[0].id;

      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, otorgado_por_usuario_id)
         VALUES ($1, $2, 'CONCEDER', 'PROPIAS', $3)
         ON CONFLICT (usuario_id, permiso_id) DO UPDATE SET efecto = 'CONCEDER', alcance = 'PROPIAS'`,
        [r2Id, permEliminarId, adminId]
      );

      try {
        // 3. Consultar detalle con R2 -> acciones_disponibles DEBE incluir ELIMINAR
        const resDetalle = await app.request(`/api/intervenciones/${intId}`, {
          headers: { Authorization: `Bearer ${r2Token}` },
        });
        assert.strictEqual(resDetalle.status, 200);
        const dataDetalle = await resDetalle.json();
        assert.ok(
          dataDetalle.acciones_disponibles.includes('ELIMINAR'),
          'acciones_disponibles debe incluir ELIMINAR para el caso de la seccion 1'
        );

        // 4. Ejecutar POST /:id/eliminar con R2 -> Debe responder 200
        const resEliminar = await app.request(`/api/intervenciones/${intId}/eliminar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2Token}` },
          body: JSON.stringify({ motivo: 'Eliminacion AF-14 valida' }),
        });
        assert.strictEqual(resEliminar.status, 200);
      } finally {
        await client.query('DELETE FROM usuario_permiso WHERE usuario_id = $1 AND permiso_id = $2', [
          r2Id,
          permEliminarId,
        ]);
      }
    });

    // =========================================================================
    // AF-15: En S1 y S3, para OP, CON y R2: ejecutar cada una de las 13 acciones
    // que NO esta en acciones_disponibles -> Ninguna responde 2xx y estado no cambia
    // =========================================================================
    await t.test('AF-15: En S1 y S3, para OP, CON y R2 ejecutar acciones no disponibles no responde 2xx ni cambia estado', async () => {
      const TODAS_ACCIONES = [
        'TOMAR',
        'ASIGNAR',
        'DESASIGNAR',
        'INICIAR',
        'ESPERAR_REPUESTOS',
        'REANUDAR',
        'FINALIZAR',
        'RESOLVER_AHORA',
        'CANCELAR',
        'REABRIR',
        'REGISTRAR_DETENCION',
        'EDITAR',
        'ELIMINAR',
      ];

      const ejecutarAccion = async (accion: string, id: number, estadoActual: string, token: string) => {
        let endpoint = '';
        let method = 'POST';
        let body: any = {};

        switch (accion) {
          case 'TOMAR':
            endpoint = `/api/intervenciones/${id}/tomar`;
            body = { estado_esperado: estadoActual };
            break;
          case 'ASIGNAR':
            endpoint = `/api/intervenciones/${id}/responsable`;
            method = 'PUT';
            body = {
              destinatario_id: estadoActual === 'EN_PROCESO' ? r2Id : r1Id,
              motivo: 'Reasignacion AF-15 valida',
              estado_esperado: estadoActual,
            };
            break;
          case 'DESASIGNAR':
            endpoint = `/api/intervenciones/${id}/responsable`;
            method = 'DELETE';
            body = { motivo: 'Desasignacion AF-15 valida', estado_esperado: estadoActual };
            break;
          case 'INICIAR':
            endpoint = `/api/intervenciones/${id}/iniciar`;
            body = { estado_esperado: estadoActual };
            break;
          case 'ESPERAR_REPUESTOS':
            endpoint = `/api/intervenciones/${id}/espera-repuestos`;
            body = { estado_esperado: estadoActual, observacion: 'Falta repuesto ruleman AF-15' };
            break;
          case 'REANUDAR':
            endpoint = `/api/intervenciones/${id}/reanudar`;
            body = { estado_esperado: estadoActual };
            break;
          case 'FINALIZAR':
            endpoint = `/api/intervenciones/${id}/finalizar`;
            body = { estado_esperado: estadoActual, trabajo_realizado: 'Trabajo AF-15 finalizado', ejecucion: 'INTERNA' };
            break;
          case 'RESOLVER_AHORA':
            endpoint = `/api/intervenciones/${id}/resolver-ahora`;
            body = {
              estado_esperado: estadoActual,
              fecha_inicio: new Date().toISOString(),
              trabajo_realizado: 'Resolucion inmediata AF-15',
              ejecucion: 'INTERNA',
            };
            break;
          case 'CANCELAR':
            endpoint = `/api/intervenciones/${id}/cancelar`;
            body = { estado_esperado: estadoActual, motivo: 'Cancelacion AF-15 valida' };
            break;
          case 'REABRIR':
            endpoint = `/api/intervenciones/${id}/reabrir`;
            body = { estado_esperado: estadoActual, motivo: 'Reapertura AF-15 valida' };
            break;
          case 'REGISTRAR_DETENCION':
            endpoint = `/api/intervenciones/${id}/registrar-detencion`;
            body = { estado_esperado: estadoActual, observacion: 'Detencion AF-15 valida' };
            break;
          case 'EDITAR':
            endpoint = `/api/intervenciones/${id}`;
            method = 'PATCH';
            body = { estado_esperado: estadoActual, descripcion: 'Descripcion editada AF-15' };
            break;
          case 'ELIMINAR':
            endpoint = `/api/intervenciones/${id}/eliminar`;
            body = { motivo: 'Eliminacion AF-15 valida' };
            break;
          default:
            throw new Error(`Accion desconocida: ${accion}`);
        }

        const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
        if (method !== 'GET') {
          headers['Content-Type'] = 'application/json';
        }

        return await app.request(endpoint, {
          method,
          headers,
          body: JSON.stringify(body),
        });
      };

      const crearS1 = async () => {
        const res = await app.request('/api/intervenciones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opToken}` },
          body: JSON.stringify({ maquina_id: maquina1Id, descripcion: `Falla S1 AF15 ${Date.now()}` }),
        });
        assert.strictEqual(res.status, 201);
        const id = (await res.json()).id;
        createdIntervencionIds.push(id);
        return id;
      };

      const crearS3 = async () => {
        const id = await crearS1();
        const resIni = await app.request(`/api/intervenciones/${id}/iniciar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r1Token}` },
          body: JSON.stringify({ estado_esperado: 'PENDIENTE' }),
        });
        assert.strictEqual(resIni.status, 200);
        return id;
      };

      const situaciones = [
        { sit: 'S1', estado: 'PENDIENTE', crear: crearS1 },
        { sit: 'S3', estado: 'EN_PROCESO', crear: crearS3 },
      ];

      const usuarios = [
        { nombre: 'OP', token: opToken },
        { nombre: 'CON', token: conToken },
        { nombre: 'R2', token: r2Token },
      ];

      for (const situacion of situaciones) {
        for (const usuario of usuarios) {
          // Obtener acciones disponibles para este usuario en esta situación
          const refId = await situacion.crear();
          const resDet = await app.request(`/api/intervenciones/${refId}`, {
            headers: { Authorization: `Bearer ${usuario.token}` },
          });
          assert.strictEqual(resDet.status, 200);
          const dataDet = await resDet.json();
          const disponibles: string[] = dataDet.acciones_disponibles;

          const noDisponibles = TODAS_ACCIONES.filter((a) => !disponibles.includes(a));
          assert.ok(noDisponibles.length > 0, `Debe haber acciones no disponibles para ${usuario.nombre} en ${situacion.sit}`);

          for (const accion of noDisponibles) {
            const testId = await situacion.crear();
            const resAccion = await ejecutarAccion(accion, testId, situacion.estado, usuario.token);

            assert.ok(
              resAccion.status < 200 || resAccion.status >= 300,
              `AF-15: ${usuario.nombre} en ${situacion.sit} ejecutando ${accion} debio responder no-2xx (respondio ${resAccion.status})`
            );

            const resCheck = await client.query('SELECT estado FROM intervenciones WHERE id = $1', [testId]);
            assert.strictEqual(
              resCheck.rows[0].estado,
              situacion.estado,
              `AF-15: El estado de la intervencion ${testId} debio permanecer en ${situacion.estado}`
            );
          }
        }
      }
    });

    // =========================================================================
    // AF-16: Detalle de una intervención eliminada con ?incluir_eliminada=true
    // =========================================================================
    await t.test('AF-16: Detalle de una intervención eliminada con y sin ?incluir_eliminada=true', async () => {
      // 1. Crear intervención con OP y luego eliminarla con admin
      const resPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion para AF-16' }),
      });
      assert.strictEqual(resPost.status, 201);
      const intId = (await resPost.json()).id;
      createdIntervencionIds.push(intId);

      const resElim = await app.request(`/api/intervenciones/${intId}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ motivo: 'Eliminacion AF-16' }),
      });
      assert.strictEqual(resElim.status, 200);

      // Con ?incluir_eliminada=true:
      // - Usuario de consulta (CON) -> 403 PERMISO_INSUFICIENTE
      const resConInc = await app.request(`/api/intervenciones/${intId}?incluir_eliminada=true`, {
        headers: { Authorization: `Bearer ${conToken}` },
      });
      assert.strictEqual(resConInc.status, 403);
      assert.strictEqual((await resConInc.json()).codigo, 'PERMISO_INSUFICIENTE');

      // - Operario creador (OP) -> 403 PERMISO_INSUFICIENTE
      const resOpInc = await app.request(`/api/intervenciones/${intId}?incluir_eliminada=true`, {
        headers: { Authorization: `Bearer ${opToken}` },
      });
      assert.strictEqual(resOpInc.status, 403);
      assert.strictEqual((await resOpInc.json()).codigo, 'PERMISO_INSUFICIENTE');

      // - Administrador (ADMIN) -> 200 con acciones_disponibles = []
      const resAdminInc = await app.request(`/api/intervenciones/${intId}?incluir_eliminada=true`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resAdminInc.status, 200);
      const dataAdmin = await resAdminInc.json();
      assert.deepStrictEqual(dataAdmin.acciones_disponibles, []);

      // Sin el parámetro -> 404 para todos
      const resConSin = await app.request(`/api/intervenciones/${intId}`, {
        headers: { Authorization: `Bearer ${conToken}` },
      });
      assert.strictEqual(resConSin.status, 404);

      const resOpSin = await app.request(`/api/intervenciones/${intId}`, {
        headers: { Authorization: `Bearer ${opToken}` },
      });
      assert.strictEqual(resOpSin.status, 404);

      const resAdminSin = await app.request(`/api/intervenciones/${intId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resAdminSin.status, 404);
    });

    // =========================================================================
    // AF-17: cargar-marca.mjs ejecutado como proceso aparte contra la base de pruebas
    // =========================================================================
    await t.test('AF-17: cargar-marca.mjs ejecutado como proceso aparte contra la base de pruebas', async () => {
      // Guardar estado original
      const resOrig = await client.query('SELECT nombre_empresa, logo, logo_tipo FROM configuracion_sistema WHERE id = 1');
      const origRow = resOrig.rows[0];

      const rootDir = path.resolve(__dirname, '../..');
      const scriptPath = path.join(rootDir, 'scripts', 'cargar-marca.mjs');

      const tmpDir = os.tmpdir();
      const pngChicoPath = path.join(tmpDir, `logo_test_af17_${Date.now()}.png`);
      const svgFakePath = path.join(tmpDir, `logo_fake_af17_${Date.now()}.svg`);
      const bigFilePath = path.join(tmpDir, `logo_big_af17_${Date.now()}.png`);

      // 1x1 PNG válido
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
        0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
        0x42, 0x60, 0x82,
      ]);
      fs.writeFileSync(pngChicoPath, pngBuffer);

      // Archivo de texto que empieza con <svg
      fs.writeFileSync(svgFakePath, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');

      // Archivo de más de 300 KB (301 KB = 308224 bytes)
      const bigBuffer = Buffer.alloc(308224, 0);
      pngBuffer.copy(bigBuffer, 0, 0, 8);
      fs.writeFileSync(bigFilePath, bigBuffer);

      try {
        // 1. Con un PNG chico y --empresa "Empresa de prueba": termina con código 0
        const procSuccess = spawnSync(
          process.execPath,
          [scriptPath, '--empresa', 'Empresa de prueba', '--logo', pngChicoPath],
          {
            cwd: rootDir,
            env: { ...process.env, DATABASE_URL: dbUrl },
            encoding: 'utf-8',
          }
        );
        assert.strictEqual(procSuccess.status, 0, `cargar-marca exit code should be 0: ${procSuccess.stderr}`);

        const resPub = await app.request('/api/configuracion/publica');
        assert.strictEqual(resPub.status, 200);
        const dataPub = await resPub.json();
        assert.strictEqual(dataPub.tiene_logo, true);
        assert.strictEqual(dataPub.nombre_empresa, 'Empresa de prueba');

        // 2. Con un archivo de texto que empieza con <svg: código distinto de 0 y la fila no cambia
        const procSvg = spawnSync(
          process.execPath,
          [scriptPath, '--logo', svgFakePath],
          {
            cwd: rootDir,
            env: { ...process.env, DATABASE_URL: dbUrl },
            encoding: 'utf-8',
          }
        );
        assert.notStrictEqual(procSvg.status, 0);

        const resPubSvg = await app.request('/api/configuracion/publica');
        const dataPubSvg = await resPubSvg.json();
        assert.strictEqual(dataPubSvg.tiene_logo, true);
        assert.strictEqual(dataPubSvg.nombre_empresa, 'Empresa de prueba');

        // 3. Con un archivo de 301 KB: código distinto de 0 y la fila no cambia
        const procBig = spawnSync(
          process.execPath,
          [scriptPath, '--logo', bigFilePath],
          {
            cwd: rootDir,
            env: { ...process.env, DATABASE_URL: dbUrl },
            encoding: 'utf-8',
          }
        );
        assert.notStrictEqual(procBig.status, 0);

        const resPubBig = await app.request('/api/configuracion/publica');
        const dataPubBig = await resPubBig.json();
        assert.strictEqual(dataPubBig.tiene_logo, true);
        assert.strictEqual(dataPubBig.nombre_empresa, 'Empresa de prueba');
      } finally {
        // Limpiar archivos temporales
        try { fs.unlinkSync(pngChicoPath); } catch {}
        try { fs.unlinkSync(svgFakePath); } catch {}
        try { fs.unlinkSync(bigFilePath); } catch {}

        // Restaurar fila 1 a como estaba por SQL
        await client.query(
          'UPDATE configuracion_sistema SET nombre_empresa = $1, logo = $2, logo_tipo = $3, actualizado_en = NOW() WHERE id = 1',
          [origRow?.nombre_empresa || null, origRow?.logo || null, origRow?.logo_tipo || null]
        );
      }
    });
  } finally {
    // Limpieza de datos creados en orden inverso de dependencias
    if (createdIntervencionIds.length > 0) {
      try {
        await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE intervencion_id = ANY($1))', [createdIntervencionIds]);
        await client.query('DELETE FROM notificaciones WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervencion_auditoria WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervencion_costos WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM documentos WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervencion_repuestos WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM movimientos_stock WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervencion_periodos_detencion WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervenciones WHERE id = ANY($1)', [createdIntervencionIds]);
      } catch {}
    }
    for (const mId of createdMaquinaIds) {
      try {
        await client.query('DELETE FROM intervencion_periodos_detencion WHERE maquina_id = $1', [mId]);
        await client.query('DELETE FROM historial_estados_maquina WHERE maquina_id = $1', [mId]);
        await client.query('DELETE FROM maquinas WHERE id = $1', [mId]);
      } catch {}
    }
    for (const uId of createdUsuarioIds) {
      try {
        await client.query('DELETE FROM usuario_permiso WHERE usuario_id = $1', [uId]);
        await client.query('DELETE FROM usuario_sector WHERE usuario_id = $1', [uId]);
        await client.query('DELETE FROM notificaciones WHERE usuario_id = $1', [uId]);
        await client.query('DELETE FROM usuarios WHERE id = $1', [uId]);
      } catch {}
    }
    for (const sId of createdSectorIds) {
      try {
        await client.query('DELETE FROM sectores WHERE id = $1', [sId]);
      } catch {}
    }
    client.release();
  }
});

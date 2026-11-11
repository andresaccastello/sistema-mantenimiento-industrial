import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';
import app from '../functions/api.ts';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (MAQUINAS TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Etapa F3a — Datos de la máquina y API para el tablero y las máquinas', async (t) => {
  let client = await pool.connect();

  const createdIntervencionIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdPlantaIds: number[] = [];
  const createdCriticidadIds: number[] = [];
  const createdTipoEquipoIds: number[] = [];
  const createdUsuarioIds: number[] = [];

  const limpiarIntervenciones = async (ids: number[]) => {
    if (ids.length === 0) return;
    await client.query(
      'DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE intervencion_id = ANY($1))',
      [ids]
    );
    await client.query('DELETE FROM notificaciones WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM intervencion_auditoria WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM intervencion_costos WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM documentos WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM intervencion_repuestos WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM intervencion_periodos_detencion WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM historial_estados_maquina WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM intervenciones WHERE id = ANY($1)', [ids]);
  };

  try {
    const suf = Date.now();
    const passHash = await bcrypt.hash('pass123', 10);

    // Perfiles
    const resPerfiles = await client.query('SELECT id, nombre FROM perfiles');
    const perfilMap: Record<string, number> = {};
    for (const r of resPerfiles.rows) {
      perfilMap[r.nombre] = Number(r.id);
    }

    // Crear usuarios propios de la prueba: Admin, Responsable y Operario
    const resAdmin = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version, debe_cambiar_password)
       VALUES ($1, 'Admin', 'MQ', $2, $3, TRUE, 1, FALSE) RETURNING id`,
      [`ADM_MQ_${suf}`, passHash, perfilMap['ADMINISTRADOR']]
    );
    const adminId = Number(resAdmin.rows[0].id);
    createdUsuarioIds.push(adminId);

    const resResp = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version, debe_cambiar_password)
       VALUES ($1, 'Resp', 'MQ', $2, $3, TRUE, 1, FALSE) RETURNING id`,
      [`RSP_MQ_${suf}`, passHash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
    );
    const respId = Number(resResp.rows[0].id);
    createdUsuarioIds.push(respId);

    const resOp = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version, debe_cambiar_password)
       VALUES ($1, 'Op', 'MQ', $2, $3, TRUE, 1, FALSE) RETURNING id`,
      [`OP_MQ_${suf}`, passHash, perfilMap['OPERARIO']]
    );
    const opId = Number(resOp.rows[0].id);
    createdUsuarioIds.push(opId);

    // Conceder a respId NOTIFICACIONES_FALLAS_RECIBIR e INTERVENCIONES_VER con alcance TODAS para MQ-10
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, otorgado_por_usuario_id)
       SELECT $1, p.id, 'CONCEDER', 'TODAS', $2
       FROM permisos p
       WHERE p.codigo IN ('NOTIFICACIONES_FALLAS_RECIBIR', 'INTERVENCIONES_VER')
       ON CONFLICT (usuario_id, permiso_id) DO UPDATE SET efecto = 'CONCEDER', alcance = 'TODAS'`,
      [respId, adminId]
    );

    const login = async (legajo: string) => {
      const r = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legajo, password: 'pass123' }),
      });
      assert.strictEqual(r.status, 200);
      return ((await r.json()) as any).token as string;
    };

    const adminToken = await login(`ADM_MQ_${suf}`);
    const respToken = await login(`RSP_MQ_${suf}`);
    const opToken = await login(`OP_MQ_${suf}`);

    // Crear planta y sectores base para las pruebas
    const resPlantaBase = await client.query(
      'INSERT INTO plantas (nombre, descripcion) VALUES ($1, $2) RETURNING id, nombre',
      [`B_Planta_MQ_${suf}`, 'Planta Base MQ']
    );
    const plantaBaseId = Number(resPlantaBase.rows[0].id);
    const plantaBaseNombre = resPlantaBase.rows[0].nombre;
    createdPlantaIds.push(plantaBaseId);

    const resPlantaA = await client.query(
      'INSERT INTO plantas (nombre, descripcion) VALUES ($1, $2) RETURNING id, nombre',
      [`A_Planta_MQ_${suf}`, 'Planta A MQ']
    );
    const plantaAId = Number(resPlantaA.rows[0].id);
    createdPlantaIds.push(plantaAId);

    const resSecConPlanta = await client.query(
      'INSERT INTO sectores (nombre, descripcion, planta_id) VALUES ($1, $2, $3) RETURNING id',
      [`Sector_ConPlanta_MQ_${suf}`, 'Con planta', plantaBaseId]
    );
    const sectorConPlantaId = Number(resSecConPlanta.rows[0].id);
    createdSectorIds.push(sectorConPlantaId);

    const resSecSinPlanta = await client.query(
      'INSERT INTO sectores (nombre, descripcion, planta_id) VALUES ($1, $2, NULL) RETURNING id',
      [`Sector_SinPlanta_MQ_${suf}`, 'Sin planta']
    );
    const sectorSinPlantaId = Number(resSecSinPlanta.rows[0].id);
    createdSectorIds.push(sectorSinPlantaId);

    // =========================================================================
    // MQ-01: Catálogos, con un operario
    // =========================================================================
    await t.test('MQ-01: Catálogos con un operario responden 200 en orden y excluyen niveles inactivos', async () => {
      // Crear un nivel inactivo en cada catálogo (orden desde 900)
      const resCritInact = await client.query(
        `INSERT INTO criticidades (codigo, nombre, orden, prioridad_alta, por_omision, activo)
         VALUES ($1, $2, 900, FALSE, FALSE, FALSE) RETURNING id`,
        [`CRIT_INACT_${suf}`, `Crit Inactiva ${suf}`]
      );
      const critInactId = Number(resCritInact.rows[0].id);
      createdCriticidadIds.push(critInactId);

      const resTipoInact = await client.query(
        `INSERT INTO tipos_equipo (codigo, nombre, orden, por_omision, activo)
         VALUES ($1, $2, 900, FALSE, FALSE) RETURNING id`,
        [`TIPO_INACT_${suf}`, `Tipo Inactivo ${suf}`]
      );
      const tipoInactId = Number(resTipoInact.rows[0].id);
      createdTipoEquipoIds.push(tipoInactId);

      const resPlantaInact = await client.query(
        `INSERT INTO plantas (nombre, descripcion, activo)
         VALUES ($1, 'Inactiva', FALSE) RETURNING id`,
        [`Z_Planta_Inact_${suf}`]
      );
      const plantaInactId = Number(resPlantaInact.rows[0].id);
      createdPlantaIds.push(plantaInactId);

      // 1. GET /api/criticidades
      const rCrit = await app.request('/api/criticidades', {
        headers: { Authorization: `Bearer ${opToken}` },
      });
      assert.strictEqual(rCrit.status, 200);
      const crits = (await rCrit.json()) as any[];
      assert.ok(crits.length > 0);
      assert.strictEqual(crits.some((c) => c.id === critInactId), false, 'No debe incluir criticidad inactiva');
      for (let i = 1; i < crits.length; i++) {
        assert.ok(crits[i - 1].orden <= crits[i].orden, 'Criticidades deben estar ordenadas por orden');
      }

      // 2. GET /api/tipos-equipo
      const rTipos = await app.request('/api/tipos-equipo', {
        headers: { Authorization: `Bearer ${opToken}` },
      });
      assert.strictEqual(rTipos.status, 200);
      const tipos = (await rTipos.json()) as any[];
      assert.ok(tipos.length > 0);
      assert.strictEqual(tipos.some((te) => te.id === tipoInactId), false, 'No debe incluir tipo_equipo inactivo');
      for (let i = 1; i < tipos.length; i++) {
        assert.ok(tipos[i - 1].orden <= tipos[i].orden, 'Tipos de equipo deben estar ordenados por orden');
      }

      // 3. GET /api/plantas
      const rPlantas = await app.request('/api/plantas', {
        headers: { Authorization: `Bearer ${opToken}` },
      });
      assert.strictEqual(rPlantas.status, 200);
      const plantas = (await rPlantas.json()) as any[];
      assert.ok(plantas.length >= 2);
      assert.strictEqual(plantas.some((p) => p.id === plantaInactId), false, 'No debe incluir planta inactiva');
      const idxA = plantas.findIndex((p) => p.id === plantaAId);
      const idxB = plantas.findIndex((p) => p.id === plantaBaseId);
      assert.ok(idxA !== -1 && idxB !== -1 && idxA < idxB, 'Plantas deben estar ordenadas por nombre');
    });

    // =========================================================================
    // MQ-02: Representación
    // =========================================================================
    await t.test('MQ-02: GET /api/maquinas y /:id traen todos los campos de 3.1 con ids numéricos y son iguales', async () => {
      const resM1 = await client.query(
        `INSERT INTO maquinas (codigo, nombre, modelo, sector_id, ubicacion, observaciones)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [`MQ02-A-${suf}`, `Maquina MQ02 ConPlanta ${suf}`, 'Modelo X-100', sectorConPlantaId, 'Nave 1', 'Obs 1']
      );
      const m1Id = Number(resM1.rows[0].id);
      createdMaquinaIds.push(m1Id);

      const resM2 = await client.query(
        `INSERT INTO maquinas (codigo, nombre, sector_id)
         VALUES (NULL, $1, $2) RETURNING id`,
        [`Maquina MQ02 SinPlanta ${suf}`, sectorSinPlantaId]
      );
      const m2Id = Number(resM2.rows[0].id);
      createdMaquinaIds.push(m2Id);

      const rLista = await app.request('/api/maquinas', {
        headers: { Authorization: `Bearer ${opToken}` },
      });
      assert.strictEqual(rLista.status, 200);
      const lista = (await rLista.json()) as any[];

      for (const mId of [m1Id, m2Id]) {
        const enLista = lista.find((m) => m.id === mId);
        assert.ok(enLista, `Máquina ${mId} debe estar en la lista`);

        const rDet = await app.request(`/api/maquinas/${mId}`, {
          headers: { Authorization: `Bearer ${opToken}` },
        });
        assert.strictEqual(rDet.status, 200);
        const det = await rDet.json();

        assert.deepStrictEqual(enLista, det, 'El elemento de la lista y el detalle deben ser idénticos');

        assert.strictEqual(typeof det.id, 'number');
        assert.strictEqual(typeof det.criticidad.id, 'number');
        assert.strictEqual(typeof det.criticidad.orden, 'number');
        assert.strictEqual(typeof det.criticidad.prioridad_alta, 'boolean');
        assert.strictEqual(typeof det.tipo_equipo.id, 'number');
        assert.strictEqual(typeof det.sector.id, 'number');
        assert.strictEqual(typeof det.intervenciones_abiertas, 'number');
        assert.strictEqual('tipo' in det, false, 'No debe incluir el campo viejo tipo');
        assert.strictEqual('modelo' in det, true, 'Debe incluir el campo modelo');
        assert.ok(det.estado_desde, 'Debe incluir estado_desde');
      }

      const detM1 = lista.find((m) => m.id === m1Id);
      assert.deepStrictEqual(detM1.sector.planta, { id: plantaBaseId, nombre: plantaBaseNombre });

      const detM2 = lista.find((m) => m.id === m2Id);
      assert.strictEqual(detM2.sector.planta, null);
    });

    // =========================================================================
    // MQ-03: estado_desde
    // =========================================================================
    await t.test('MQ-03: estado_desde reflejado en máquina nueva, falla con detención, recuperación y registro sin cambio', async () => {
      const rPostMaq = await app.request('/api/maquinas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          nombre: `Maquina MQ03 ${suf}`,
          sector_id: sectorConPlantaId,
        }),
      });
      assert.strictEqual(rPostMaq.status, 201);
      const maqNueva = await rPostMaq.json();
      const maqId = maqNueva.id;
      createdMaquinaIds.push(maqId);

      // (a) Máquina nueva: creado_en
      assert.strictEqual(maqNueva.estado_desde, maqNueva.creado_en);

      // (b) Reportar falla que la detiene
      const rFalla = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({
          maquina_id: maqId,
          descripcion: 'Falla que detiene MQ03',
          detiene_maquina: true,
        }),
      });
      assert.strictEqual(rFalla.status, 201);
      const falla = await rFalla.json();
      createdIntervencionIds.push(falla.id);

      const resHistDet = await client.query(
        `SELECT cambiado_en FROM historial_estados_maquina
         WHERE maquina_id = $1 AND estado_nuevo = 'DETENIDA'
         ORDER BY cambiado_en DESC, id DESC LIMIT 1`,
        [maqId]
      );
      const esperadoDet = resHistDet.rows[0].cambiado_en.toISOString();

      const rDetB = await app.request(`/api/maquinas/${maqId}`, {
        headers: { Authorization: `Bearer ${opToken}` },
      });
      const maqDet = await rDetB.json();
      assert.strictEqual(maqDet.estado, 'DETENIDA');
      assert.strictEqual(maqDet.estado_desde, esperadoDet);

      // (c) Confirmar recuperación
      const rRec = await app.request(`/api/maquinas/${maqId}/confirmar-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${respToken}` },
        body: JSON.stringify({ periodo_ids: [falla.periodo_detencion_id] }),
      });
      assert.strictEqual(rRec.status, 200);

      const resHistRec = await client.query(
        `SELECT cambiado_en FROM historial_estados_maquina
         WHERE maquina_id = $1 AND estado_nuevo = 'OPERATIVA' AND estado_anterior IS DISTINCT FROM estado_nuevo
         ORDER BY cambiado_en DESC, id DESC LIMIT 1`,
        [maqId]
      );
      const esperadoRec = resHistRec.rows[0].cambiado_en.toISOString();

      const rDetC = await app.request(`/api/maquinas/${maqId}`, {
        headers: { Authorization: `Bearer ${opToken}` },
      });
      const maqRec = await rDetC.json();
      assert.strictEqual(maqRec.estado, 'OPERATIVA');
      assert.strictEqual(maqRec.estado_desde, esperadoRec);

      // (d) Insertar a mano un registro con el mismo estado anterior y nuevo
      await client.query(
        `INSERT INTO historial_estados_maquina (maquina_id, estado_anterior, estado_nuevo, motivo, cambiado_por_usuario_id, cambiado_en)
         VALUES ($1, 'OPERATIVA', 'OPERATIVA', 'Sin cambio de estado', $2, NOW() + INTERVAL '10 minutes')`,
        [maqId, adminId]
      );

      const rDetD = await app.request(`/api/maquinas/${maqId}`, {
        headers: { Authorization: `Bearer ${opToken}` },
      });
      const maqSinCambio = await rDetD.json();
      assert.strictEqual(maqSinCambio.estado_desde, esperadoRec, 'Un registro sin cambio de estado no debe mover estado_desde');
    });

    // =========================================================================
    // MQ-04: Alta
    // =========================================================================
    await t.test('MQ-04: Alta de máquina (omisión, ids válidos, inexistentes/inactivos, tipo rechazado, código duplicado 409, respuesta igual a GET)', async () => {
      const resOmision = await client.query(
        'SELECT fn_criticidad_por_omision() AS crit_id, fn_tipo_equipo_por_omision() AS tipo_id'
      );
      const defaultCritId = Number(resOmision.rows[0].crit_id);
      const defaultTipoId = Number(resOmision.rows[0].tipo_id);

      // Crear criticidad y tipo_equipo propios activos e inactivos
      const rCritAct = await client.query(
        `INSERT INTO criticidades (codigo, nombre, orden, prioridad_alta, por_omision, activo)
         VALUES ($1, $2, 910, TRUE, FALSE, TRUE) RETURNING id`,
        [`CRIT_MQ04_${suf}`, `Crit MQ04 ${suf}`]
      );
      const critValidaId = Number(rCritAct.rows[0].id);
      createdCriticidadIds.push(critValidaId);

      const rCritInact = await client.query(
        `INSERT INTO criticidades (codigo, nombre, orden, prioridad_alta, por_omision, activo)
         VALUES ($1, $2, 911, FALSE, FALSE, FALSE) RETURNING id`,
        [`CRIT_MQ04_IN_${suf}`, `Crit MQ04 Inact ${suf}`]
      );
      const critInactId = Number(rCritInact.rows[0].id);
      createdCriticidadIds.push(critInactId);

      const rTipoAct = await client.query(
        `INSERT INTO tipos_equipo (codigo, nombre, orden, por_omision, activo)
         VALUES ($1, $2, 910, FALSE, TRUE) RETURNING id`,
        [`TIPO_MQ04_${suf}`, `Tipo MQ04 ${suf}`]
      );
      const tipoValidoId = Number(rTipoAct.rows[0].id);
      createdTipoEquipoIds.push(tipoValidoId);

      const rTipoInact = await client.query(
        `INSERT INTO tipos_equipo (codigo, nombre, orden, por_omision, activo)
         VALUES ($1, $2, 911, FALSE, FALSE) RETURNING id`,
        [`TIPO_MQ04_IN_${suf}`, `Tipo MQ04 Inact ${suf}`]
      );
      const tipoInactId = Number(rTipoInact.rows[0].id);
      createdTipoEquipoIds.push(tipoInactId);

      // (a) Sin criticidad ni tipo -> los de por omisión
      const rA = await app.request('/api/maquinas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          nombre: `MQ04 A ${suf}`,
          sector_id: sectorConPlantaId,
          codigo: `COD-MQ04-A-${suf}`,
        }),
      });
      assert.strictEqual(rA.status, 201);
      const maqA = await rA.json();
      createdMaquinaIds.push(maqA.id);
      assert.strictEqual(maqA.criticidad.id, defaultCritId);
      assert.strictEqual(maqA.tipo_equipo.id, defaultTipoId);

      // (f) Respuesta igual a GET /:id
      const rGetA = await app.request(`/api/maquinas/${maqA.id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.deepStrictEqual(maqA, await rGetA.json());

      // (b) Con ids válidos -> esos
      const rB = await app.request('/api/maquinas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          nombre: `MQ04 B ${suf}`,
          sector_id: sectorConPlantaId,
          criticidad_id: critValidaId,
          tipo_equipo_id: tipoValidoId,
          modelo: 'Siemens S7',
        }),
      });
      assert.strictEqual(rB.status, 201);
      const maqB = await rB.json();
      createdMaquinaIds.push(maqB.id);
      assert.strictEqual(maqB.criticidad.id, critValidaId);
      assert.strictEqual(maqB.tipo_equipo.id, tipoValidoId);
      assert.strictEqual(maqB.modelo, 'Siemens S7');

      // (c) Con un id inexistente o inactivo -> 400
      for (const payloadInv of [
        { nombre: 'M', sector_id: sectorConPlantaId, criticidad_id: 999999999 },
        { nombre: 'M', sector_id: sectorConPlantaId, criticidad_id: critInactId },
        { nombre: 'M', sector_id: sectorConPlantaId, tipo_equipo_id: 999999999 },
        { nombre: 'M', sector_id: sectorConPlantaId, tipo_equipo_id: tipoInactId },
      ]) {
        const rInv = await app.request('/api/maquinas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify(payloadInv),
        });
        assert.strictEqual(rInv.status, 400);
        assert.strictEqual((await rInv.json()).codigo, 'DATOS_INVALIDOS');
      }

      // (d) Con tipo -> 400
      const rD = await app.request('/api/maquinas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          nombre: `MQ04 D ${suf}`,
          sector_id: sectorConPlantaId,
          tipo: 'Torno',
        }),
      });
      assert.strictEqual(rD.status, 400);
      assert.strictEqual((await rD.json()).codigo, 'DATOS_INVALIDOS');

      // (e) Con código repetido -> 409 CODIGO_MAQUINA_DUPLICADO
      const rE = await app.request('/api/maquinas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          nombre: `MQ04 E ${suf}`,
          sector_id: sectorConPlantaId,
          codigo: `COD-MQ04-A-${suf}`,
        }),
      });
      assert.strictEqual(rE.status, 409);
      assert.strictEqual((await rE.json()).codigo, 'CODIGO_MAQUINA_DUPLICADO');
    });

    // =========================================================================
    // MQ-05: Edición
    // =========================================================================
    await t.test('MQ-05: Edición de máquina (parcial, vaciado con null y "", validaciones, 409 código duplicado y 422 estado)', async () => {
      const rCritNueva = await client.query(
        `INSERT INTO criticidades (codigo, nombre, orden, prioridad_alta, por_omision, activo)
         VALUES ($1, $2, 920, FALSE, FALSE, TRUE) RETURNING id`,
        [`CRIT_MQ05_${suf}`, `Crit MQ05 ${suf}`]
      );
      const critNuevaId = Number(rCritNueva.rows[0].id);
      createdCriticidadIds.push(critNuevaId);

      const rTipoNuevo = await client.query(
        `INSERT INTO tipos_equipo (codigo, nombre, orden, por_omision, activo)
         VALUES ($1, $2, 920, FALSE, TRUE) RETURNING id`,
        [`TIPO_MQ05_${suf}`, `Tipo MQ05 ${suf}`]
      );
      const tipoNuevoId = Number(rTipoNuevo.rows[0].id);
      createdTipoEquipoIds.push(tipoNuevoId);

      // Crear dos máquinas para probar edición y código repetido
      const rM1 = await app.request('/api/maquinas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          nombre: `MQ05 M1 ${suf}`,
          sector_id: sectorConPlantaId,
          codigo: `COD-MQ05-1-${suf}`,
          modelo: 'Modelo Inicial',
          ubicacion: 'Ubicacion Inicial',
          observaciones: 'Obs Inicial',
        }),
      });
      const m1 = await rM1.json();
      createdMaquinaIds.push(m1.id);

      const rM2 = await app.request('/api/maquinas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          nombre: `MQ05 M2 ${suf}`,
          sector_id: sectorConPlantaId,
          codigo: `COD-MQ05-2-${suf}`,
        }),
      });
      const m2 = await rM2.json();
      createdMaquinaIds.push(m2.id);

      // (a) Campo que no viene: no cambia
      const rPutA = await app.request(`/api/maquinas/${m1.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ nombre: `MQ05 M1 Editada ${suf}` }),
      });
      assert.strictEqual(rPutA.status, 200);
      const m1A = await rPutA.json();
      assert.strictEqual(m1A.nombre, `MQ05 M1 Editada ${suf}`);
      assert.strictEqual(m1A.codigo, `COD-MQ05-1-${suf}`);
      assert.strictEqual(m1A.modelo, 'Modelo Inicial');
      assert.strictEqual(m1A.ubicacion, 'Ubicacion Inicial');
      assert.strictEqual(m1A.observaciones, 'Obs Inicial');

      // (b) null y "" vacían codigo, modelo, ubicacion y observaciones
      const rPutB = await app.request(`/api/maquinas/${m1.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          codigo: null,
          modelo: '',
          ubicacion: null,
          observaciones: '',
        }),
      });
      assert.strictEqual(rPutB.status, 200);
      const m1B = await rPutB.json();
      assert.strictEqual(m1B.codigo, null);
      assert.strictEqual(m1B.modelo, null);
      assert.strictEqual(m1B.ubicacion, null);
      assert.strictEqual(m1B.observaciones, null);

      // (c) nombre: null -> 400
      const rPutC = await app.request(`/api/maquinas/${m1.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ nombre: null }),
      });
      assert.strictEqual(rPutC.status, 400);
      assert.strictEqual((await rPutC.json()).codigo, 'DATOS_INVALIDOS');

      // (d) Cambio de criticidad y de tipo
      const rPutD = await app.request(`/api/maquinas/${m1.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          criticidad_id: critNuevaId,
          tipo_equipo_id: tipoNuevoId,
        }),
      });
      assert.strictEqual(rPutD.status, 200);
      const m1D = await rPutD.json();
      assert.strictEqual(m1D.criticidad.id, critNuevaId);
      assert.strictEqual(m1D.tipo_equipo.id, tipoNuevoId);

      // (e) Código repetido -> 409
      const rPutE = await app.request(`/api/maquinas/${m1.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ codigo: `COD-MQ05-2-${suf}` }),
      });
      assert.strictEqual(rPutE.status, 409);
      assert.strictEqual((await rPutE.json()).codigo, 'CODIGO_MAQUINA_DUPLICADO');

      // (f) estado -> 422
      const rPutF = await app.request(`/api/maquinas/${m1.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ estado: 'DETENIDA' }),
      });
      assert.strictEqual(rPutF.status, 422);
      assert.strictEqual((await rPutF.json()).codigo, 'ESTADO_NO_EDITABLE');
    });

    // =========================================================================
    // MQ-06: Desactivar y reactivar
    // =========================================================================
    await t.test('MQ-06: Desactivar y reactivar máquina según intervenciones abiertas, detenciones abiertas y estado del sector', async () => {
      const rSecMQ06 = await client.query(
        'INSERT INTO sectores (nombre, activo) VALUES ($1, TRUE) RETURNING id',
        [`Sector MQ06 ${suf}`]
      );
      const secMQ06Id = Number(rSecMQ06.rows[0].id);
      createdSectorIds.push(secMQ06Id);
      await client.query(
        'INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [respId, secMQ06Id]
      );

      const rMaq = await app.request('/api/maquinas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          nombre: `MQ06 Maquina ${suf}`,
          sector_id: secMQ06Id,
        }),
      });
      const maq = await rMaq.json();
      const maqId = maq.id;
      createdMaquinaIds.push(maqId);

      // Crear intervención pendiente con detención
      const rInt = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({
          maquina_id: maqId,
          descripcion: 'Falla MQ06',
          detiene_maquina: true,
        }),
      });
      assert.strictEqual(rInt.status, 201);
      const intData = await rInt.json();
      createdIntervencionIds.push(intData.id);

      // (a) Con una intervención pendiente -> 409 MAQUINA_CON_INTERVENCIONES_ABIERTAS por DELETE y por PUT
      const rDelA = await app.request(`/api/maquinas/${maqId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(rDelA.status, 409);
      assert.strictEqual((await rDelA.json()).codigo, 'MAQUINA_CON_INTERVENCIONES_ABIERTAS');

      const rPutA = await app.request(`/api/maquinas/${maqId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ activo: false }),
      });
      assert.strictEqual(rPutA.status, 409);
      assert.strictEqual((await rPutA.json()).codigo, 'MAQUINA_CON_INTERVENCIONES_ABIERTAS');

      // Iniciar y finalizar indicando que sigue detenida (maquina_recuperada: false)
      const rIni = await app.request(`/api/intervenciones/${intData.id}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${respToken}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
        }),
      });
      assert.strictEqual(rIni.status, 200);

      const rRes = await app.request(`/api/intervenciones/${intData.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${respToken}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Reparación parcial MQ06',
          ejecucion: 'INTERNA',
          maquina_recuperada: false,
        }),
      });
      assert.strictEqual(rRes.status, 200);

      // (b) Con una intervención finalizada "sigue detenida" -> 409 MAQUINA_CON_DETENCIONES_ABIERTAS
      const rDelB = await app.request(`/api/maquinas/${maqId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(rDelB.status, 409);
      assert.strictEqual((await rDelB.json()).codigo, 'MAQUINA_CON_DETENCIONES_ABIERTAS');

      const rPutB = await app.request(`/api/maquinas/${maqId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ activo: false }),
      });
      assert.strictEqual(rPutB.status, 409);
      assert.strictEqual((await rPutB.json()).codigo, 'MAQUINA_CON_DETENCIONES_ABIERTAS');

      // Confirmar recuperación para cerrar la detención
      const rConf = await app.request(`/api/maquinas/${maqId}/confirmar-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${respToken}` },
        body: JSON.stringify({ periodo_ids: [intData.periodo_detencion_id] }),
      });
      assert.strictEqual(rConf.status, 200);

      // (c) Sin nada abierto -> 200, y no aparece en GET /api/maquinas
      const rDelC = await app.request(`/api/maquinas/${maqId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(rDelC.status, 200);

      const rListaC = await app.request('/api/maquinas', {
        headers: { Authorization: `Bearer ${opToken}` },
      });
      const listaC = (await rListaC.json()) as any[];
      assert.strictEqual(listaC.some((m) => m.id === maqId), false, 'Máquina desactivada no debe aparecer en GET /api/maquinas');

      // (d) PUT con activo: true -> vuelve a aparecer
      const rPutD = await app.request(`/api/maquinas/${maqId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ activo: true }),
      });
      assert.strictEqual(rPutD.status, 200);

      const rListaD = await app.request('/api/maquinas', {
        headers: { Authorization: `Bearer ${opToken}` },
      });
      const listaD = (await rListaD.json()) as any[];
      assert.strictEqual(listaD.some((m) => m.id === maqId), true, 'Máquina reactivada debe volver a aparecer');

      // (e) Desactivar máquina y su sector, luego intentar reactivar con sector inactivo -> 400
      await app.request(`/api/maquinas/${maqId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ activo: false }),
      });
      await client.query('UPDATE sectores SET activo = FALSE WHERE id = $1', [secMQ06Id]);

      const rPutE = await app.request(`/api/maquinas/${maqId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ activo: true }),
      });
      assert.strictEqual(rPutE.status, 400);
      assert.strictEqual((await rPutE.json()).codigo, 'DATOS_INVALIDOS');
    });

    // =========================================================================
    // MQ-07: Sectores con planta
    // =========================================================================
    await t.test('MQ-07: Sectores con planta en alta, edición y validación de planta inexistente', async () => {
      // (a) Alta con planta -> GET la muestra
      const rPost = await app.request('/api/sectores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          nombre: `Sector MQ07 ${suf}`,
          descripcion: 'Descripción inicial',
          planta_id: plantaBaseId,
        }),
      });
      assert.strictEqual(rPost.status, 201);
      const secCreado = await rPost.json();
      const secId = secCreado.id;
      createdSectorIds.push(secId);
      assert.deepStrictEqual(secCreado.planta, { id: plantaBaseId, nombre: plantaBaseNombre });

      const rGet = await app.request(`/api/sectores/${secId}`, {
        headers: { Authorization: `Bearer ${opToken}` },
      });
      assert.strictEqual(rGet.status, 200);
      const secGet = await rGet.json();
      assert.deepStrictEqual(secGet.planta, { id: plantaBaseId, nombre: plantaBaseNombre });

      // (b) PUT con planta_id: null -> queda sin planta
      const rPutB = await app.request(`/api/sectores/${secId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ planta_id: null }),
      });
      assert.strictEqual(rPutB.status, 200);
      const secB = await rPutB.json();
      assert.strictEqual(secB.planta, null);
      assert.strictEqual(secB.descripcion, 'Descripción inicial', 'La descripción que no vino no debe cambiar');

      // (c) PUT con descripcion: "" -> la vacía
      const rPutC = await app.request(`/api/sectores/${secId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ descripcion: '' }),
      });
      assert.strictEqual(rPutC.status, 200);
      const secC = await rPutC.json();
      assert.strictEqual(secC.descripcion, null);

      // (d) Planta inexistente -> 400
      const rPostInv = await app.request('/api/sectores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          nombre: `Sector MQ07 Inv ${suf}`,
          planta_id: 999999999,
        }),
      });
      assert.strictEqual(rPostInv.status, 400);
      assert.strictEqual((await rPostInv.json()).codigo, 'DATOS_INVALIDOS');

      const rPutInv = await app.request(`/api/sectores/${secId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ planta_id: 999999999 }),
      });
      assert.strictEqual(rPutInv.status, 400);
      assert.strictEqual((await rPutInv.json()).codigo, 'DATOS_INVALIDOS');
    });

    // =========================================================================
    // MQ-08 y MQ-09: Tablero (orden por criticidad y filtro por planta_id)
    // =========================================================================
    let plantaTabId = 0;
    let plantaTabNombre = '';
    let crit901Id = 0;
    let m901Id = 0;
    let m902Id = 0;

    await t.test('MQ-08: Orden de detenidas_ahora en el tablero por criticidad.orden', async () => {
      // Crear planta exclusiva para MQ-08 y MQ-09
      const rPlantaTab = await client.query(
        'INSERT INTO plantas (nombre, descripcion) VALUES ($1, $2) RETURNING id, nombre',
        [`Planta_Tablero_MQ08_${suf}`, 'Planta Tablero']
      );
      plantaTabId = Number(rPlantaTab.rows[0].id);
      plantaTabNombre = rPlantaTab.rows[0].nombre;
      createdPlantaIds.push(plantaTabId);

      const rSecTab = await client.query(
        'INSERT INTO sectores (nombre, planta_id) VALUES ($1, $2) RETURNING id',
        [`Sector_Tablero_MQ08_${suf}`, plantaTabId]
      );
      const secTabId = Number(rSecTab.rows[0].id);
      createdSectorIds.push(secTabId);

      // Niveles de criticidad con orden 901 y 902
      const rCrit901 = await client.query(
        `INSERT INTO criticidades (codigo, nombre, orden, prioridad_alta, por_omision, activo)
         VALUES ($1, $2, 901, TRUE, FALSE, TRUE) RETURNING id`,
        [`CRIT_901_${suf}`, `Crit 901 ${suf}`]
      );
      crit901Id = Number(rCrit901.rows[0].id);
      createdCriticidadIds.push(crit901Id);

      const rCrit902 = await client.query(
        `INSERT INTO criticidades (codigo, nombre, orden, prioridad_alta, por_omision, activo)
         VALUES ($1, $2, 902, FALSE, FALSE, TRUE) RETURNING id`,
        [`CRIT_902_${suf}`, `Crit 902 ${suf}`]
      );
      const crit902Id = Number(rCrit902.rows[0].id);
      createdCriticidadIds.push(crit902Id);

      // Dos máquinas en esa planta: M901 (orden 901) y M902 (orden 902), más una tercera operativa
      const rM901 = await client.query(
        `INSERT INTO maquinas (nombre, codigo, sector_id, criticidad_id, estado)
         VALUES ($1, $2, $3, $4, 'DETENIDA') RETURNING id`,
        [`Maq 901 ${suf}`, `M901-${suf}`, secTabId, crit901Id]
      );
      m901Id = Number(rM901.rows[0].id);
      createdMaquinaIds.push(m901Id);

      const rM902 = await client.query(
        `INSERT INTO maquinas (nombre, codigo, sector_id, criticidad_id, estado)
         VALUES ($1, $2, $3, $4, 'DETENIDA') RETURNING id`,
        [`Maq 902 ${suf}`, `M902-${suf}`, secTabId, crit902Id]
      );
      m902Id = Number(rM902.rows[0].id);
      createdMaquinaIds.push(m902Id);

      const rMOp = await client.query(
        `INSERT INTO maquinas (nombre, codigo, sector_id, criticidad_id, estado)
         VALUES ($1, $2, $3, $4, 'OPERATIVA') RETURNING id`,
        [`Maq Op ${suf}`, `MOP-${suf}`, secTabId, crit902Id]
      );
      const mOpId = Number(rMOp.rows[0].id);
      createdMaquinaIds.push(mOpId);

      const rTipoCorr = await client.query("SELECT id FROM tipos_intervencion WHERE codigo = 'CORRECTIVO' LIMIT 1");
      const tipoCorrId = Number(rTipoCorr.rows[0].id);

      // Intervención y período de detención en M902 (hace 180 minutos -> más tiempo detenida)
      const rI902 = await client.query(
        `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, descripcion, estado, creado_por_usuario_id, fecha_creacion)
         VALUES ($1, $2, 'Detencion 902', 'PENDIENTE', $3, NOW() - INTERVAL '180 minutes') RETURNING id`,
        [m902Id, tipoCorrId, opId]
      );
      const i902Id = Number(rI902.rows[0].id);
      createdIntervencionIds.push(i902Id);
      await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, abierto_por_usuario_id)
         VALUES ($1, $2, NOW() - INTERVAL '180 minutes', $3)`,
        [i902Id, m902Id, opId]
      );

      // Intervención y período de detención en M901 (hace 20 minutos -> menos tiempo detenida, pero mayor criticidad)
      const rI901 = await client.query(
        `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, descripcion, estado, creado_por_usuario_id, responsable_usuario_id, fecha_inicio, fecha_creacion)
         VALUES ($1, $2, 'Detencion 901', 'EN_PROCESO', $3, $4, NOW() - INTERVAL '15 minutes', NOW() - INTERVAL '20 minutes') RETURNING id`,
        [m901Id, tipoCorrId, opId, respId]
      );
      const i901Id = Number(rI901.rows[0].id);
      createdIntervencionIds.push(i901Id);
      await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, abierto_por_usuario_id)
         VALUES ($1, $2, NOW() - INTERVAL '20 minutes', $3)`,
        [i901Id, m901Id, opId]
      );

      const rTab = await app.request('/api/tablero', {
        headers: { Authorization: `Bearer ${respToken}` },
      });
      assert.strictEqual(rTab.status, 200);
      const tab = await rTab.json();

      // MQ-08: M901 (orden 901) aparece antes que M902 (orden 902) aunque M902 lleve más tiempo detenida
      const idx901 = tab.detenidas_ahora.findIndex((d: any) => d.maquina.id === m901Id);
      const idx902 = tab.detenidas_ahora.findIndex((d: any) => d.maquina.id === m902Id);
      assert.ok(idx901 !== -1 && idx902 !== -1 && idx901 < idx902, 'La de orden 901 debe aparecer antes que la de 902');
      const det0 = tab.detenidas_ahora[idx901];
      const det1 = tab.detenidas_ahora[idx902];
      assert.ok(det1.inactividad_en_curso_minutos > det0.inactividad_en_curso_minutos);
      assert.deepStrictEqual(det0.maquina.criticidad, {
        id: crit901Id,
        codigo: `CRIT_901_${suf}`,
        nombre: `Crit 901 ${suf}`,
        orden: 901,
      });
      assert.deepStrictEqual(det0.maquina.sector.planta, {
        id: plantaTabId,
        nombre: plantaTabNombre,
      });
    });

    await t.test('MQ-09: Tablero filtrado con planta_id (conteo de 3 bloques, 404 inexistente y 400 no numérico)', async () => {
      // (a) Los tres bloques cuentan solo máquinas de esa planta
      const rTab = await app.request(`/api/tablero?planta_id=${plantaTabId}`, {
        headers: { Authorization: `Bearer ${respToken}` },
      });
      assert.strictEqual(rTab.status, 200);
      const tab = await rTab.json();

      assert.deepStrictEqual(tab.maquinas, {
        OPERATIVA: 1,
        DETENIDA: 2,
        EN_MANTENIMIENTO: 0,
        FUERA_DE_SERVICIO: 0,
      });
      assert.deepStrictEqual(tab.intervenciones, {
        PENDIENTE: 1,
        EN_PROCESO: 1,
        EN_ESPERA_REPUESTOS: 0,
        sin_asignar: 1,
        mias_abiertas: 1,
      });
      assert.strictEqual(tab.detenidas_ahora.length, 2);
      assert.strictEqual(tab.detenidas_ahora[0].maquina.id, m901Id);
      assert.strictEqual(tab.detenidas_ahora[1].maquina.id, m902Id);

      // (b) Planta inexistente -> 404 PLANTA_NO_ENCONTRADA
      const rTab404 = await app.request('/api/tablero?planta_id=999999999', {
        headers: { Authorization: `Bearer ${respToken}` },
      });
      assert.strictEqual(rTab404.status, 404);
      assert.strictEqual((await rTab404.json()).codigo, 'PLANTA_NO_ENCONTRADA');

      // (c) No numérico -> 400 DATOS_INVALIDOS
      const rTab400 = await app.request('/api/tablero?planta_id=abc', {
        headers: { Authorization: `Bearer ${respToken}` },
      });
      assert.strictEqual(rTab400.status, 400);
      assert.strictEqual((await rTab400.json()).codigo, 'DATOS_INVALIDOS');
    });

    // =========================================================================
    // MQ-10: Aviso de falla
    // =========================================================================
    await t.test('MQ-10: Aviso FALLA_REGISTRADA según prioridad_alta de la criticidad y detención', async () => {
      const nombreNivelCritico = `Crítica MQ10 ${suf}`;
      const rCritAlta = await client.query(
        `INSERT INTO criticidades (codigo, nombre, orden, prioridad_alta, por_omision, activo)
         VALUES ($1, $2, 930, TRUE, FALSE, TRUE) RETURNING id`,
        [`CRIT_ALTA_MQ10_${suf}`, nombreNivelCritico]
      );
      const critAltaId = Number(rCritAlta.rows[0].id);
      createdCriticidadIds.push(critAltaId);

      const rCritNormal = await client.query(
        `INSERT INTO criticidades (codigo, nombre, orden, prioridad_alta, por_omision, activo)
         VALUES ($1, $2, 931, FALSE, FALSE, TRUE) RETURNING id`,
        [`CRIT_NORM_MQ10_${suf}`, `Normal MQ10 ${suf}`]
      );
      const critNormalId = Number(rCritNormal.rows[0].id);
      createdCriticidadIds.push(critNormalId);

      const nombreMaqCrit = `Compresor Crit ${suf}`;
      const rMaqCrit = await client.query(
        `INSERT INTO maquinas (nombre, sector_id, criticidad_id, estado)
         VALUES ($1, $2, $3, 'OPERATIVA') RETURNING id`,
        [nombreMaqCrit, sectorConPlantaId, critAltaId]
      );
      const maqCritId = Number(rMaqCrit.rows[0].id);
      createdMaquinaIds.push(maqCritId);

      const nombreMaqNorm = `Bomba Norm ${suf}`;
      const rMaqNorm = await client.query(
        `INSERT INTO maquinas (nombre, sector_id, criticidad_id, estado)
         VALUES ($1, $2, $3, 'OPERATIVA') RETURNING id`,
        [nombreMaqNorm, sectorConPlantaId, critNormalId]
      );
      const maqNormId = Number(rMaqNorm.rows[0].id);
      createdMaquinaIds.push(maqNormId);

      // (a) Máquina con nivel de prioridad_alta, sin detención
      const rFallaA = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({
          maquina_id: maqCritId,
          descripcion: 'Falla sin detención en crítica',
          detiene_maquina: false,
        }),
      });
      assert.strictEqual(rFallaA.status, 201);
      const intA = await rFallaA.json();
      createdIntervencionIds.push(intA.id);

      const resNotifA = await client.query(
        'SELECT prioridad, titulo FROM notificaciones WHERE intervencion_id = $1 AND usuario_id = $2',
        [intA.id, respId]
      );
      assert.strictEqual(resNotifA.rows.length, 1);
      assert.strictEqual(resNotifA.rows[0].prioridad, 'ALTA');
      assert.strictEqual(
        resNotifA.rows[0].titulo,
        `Nueva falla en ${nombreMaqCrit} — criticidad ${nombreNivelCritico}`
      );

      // (b) La misma máquina, con detención
      const rFallaB = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({
          maquina_id: maqCritId,
          descripcion: 'Falla con detención en crítica',
          detiene_maquina: true,
        }),
      });
      assert.strictEqual(rFallaB.status, 201);
      const intB = await rFallaB.json();
      createdIntervencionIds.push(intB.id);

      const resNotifB = await client.query(
        'SELECT prioridad, titulo FROM notificaciones WHERE intervencion_id = $1 AND usuario_id = $2',
        [intB.id, respId]
      );
      assert.strictEqual(resNotifB.rows.length, 1);
      assert.strictEqual(resNotifB.rows[0].prioridad, 'ALTA');
      assert.strictEqual(
        resNotifB.rows[0].titulo,
        `Nueva falla en ${nombreMaqCrit} — máquina detenida`
      );

      // (c) Nivel sin prioridad_alta y sin detención
      const rFallaC = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({
          maquina_id: maqNormId,
          descripcion: 'Falla sin detención en normal',
          detiene_maquina: false,
        }),
      });
      assert.strictEqual(rFallaC.status, 201);
      const intC = await rFallaC.json();
      createdIntervencionIds.push(intC.id);

      const resNotifC = await client.query(
        'SELECT prioridad, titulo FROM notificaciones WHERE intervencion_id = $1 AND usuario_id = $2',
        [intC.id, respId]
      );
      assert.strictEqual(resNotifC.rows.length, 1);
      assert.strictEqual(resNotifC.rows[0].prioridad, 'NORMAL');
      assert.strictEqual(resNotifC.rows[0].titulo, `Nueva falla en ${nombreMaqNorm}`);
    });

    // =========================================================================
    // MQ-11: Filtro planta_id en GET /api/intervenciones
    // =========================================================================
    await t.test('MQ-11: GET /api/intervenciones filtrado por planta_id (solo, combinado con estado y 422 con abc)', async () => {
      const rP1 = await client.query(
        'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id',
        [`Planta MQ11 A ${suf}`]
      );
      const p1Id = Number(rP1.rows[0].id);
      createdPlantaIds.push(p1Id);

      const rP2 = await client.query(
        'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id',
        [`Planta MQ11 B ${suf}`]
      );
      const p2Id = Number(rP2.rows[0].id);
      createdPlantaIds.push(p2Id);

      const rSec1 = await client.query(
        'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id',
        [`Sector MQ11 A ${suf}`, p1Id]
      );
      const s1Id = Number(rSec1.rows[0].id);
      createdSectorIds.push(s1Id);

      const rSec2 = await client.query(
        'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id',
        [`Sector MQ11 B ${suf}`, p2Id]
      );
      const s2Id = Number(rSec2.rows[0].id);
      createdSectorIds.push(s2Id);

      const rMaq1 = await client.query(
        "INSERT INTO maquinas (nombre, sector_id, estado) VALUES ($1, $2, 'OPERATIVA') RETURNING id",
        [`Maq MQ11 A ${suf}`, s1Id]
      );
      const m1Id = Number(rMaq1.rows[0].id);
      createdMaquinaIds.push(m1Id);

      const rMaq2 = await client.query(
        "INSERT INTO maquinas (nombre, sector_id, estado) VALUES ($1, $2, 'OPERATIVA') RETURNING id",
        [`Maq MQ11 B ${suf}`, s2Id]
      );
      const m2Id = Number(rMaq2.rows[0].id);
      createdMaquinaIds.push(m2Id);

      const rTipo = await client.query("SELECT id FROM tipos_intervencion WHERE codigo = 'CORRECTIVO' LIMIT 1");
      const tipoId = Number(rTipo.rows[0].id);

      const rInt1 = await client.query(
        `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, estado, descripcion)
         VALUES ($1, $2, $3, 'PENDIENTE', 'Int MQ11 P1 Pendiente') RETURNING id`,
        [m1Id, tipoId, opId]
      );
      const int1Id = Number(rInt1.rows[0].id);
      createdIntervencionIds.push(int1Id);

      const rInt2 = await client.query(
        `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, responsable_usuario_id, estado, descripcion, fecha_inicio)
         VALUES ($1, $2, $3, $4, 'EN_PROCESO', 'Int MQ11 P1 En Proceso', NOW()) RETURNING id`,
        [m1Id, tipoId, opId, respId]
      );
      const int2Id = Number(rInt2.rows[0].id);
      createdIntervencionIds.push(int2Id);

      const rInt3 = await client.query(
        `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, estado, descripcion)
         VALUES ($1, $2, $3, 'PENDIENTE', 'Int MQ11 P2 Pendiente') RETURNING id`,
        [m2Id, tipoId, opId]
      );
      const int3Id = Number(rInt3.rows[0].id);
      createdIntervencionIds.push(int3Id);

      // (a) Con planta_id salen solo las de esa planta y X-Total-Count coincide
      const resA = await app.request(`/api/intervenciones?planta_id=${p1Id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resA.status, 200);
      assert.strictEqual(resA.headers.get('X-Total-Count'), '2');
      const itemsA = (await resA.json()) as any[];
      assert.strictEqual(itemsA.length, 2);
      const idsA = itemsA.map((i) => i.id).sort((a, b) => a - b);
      assert.deepStrictEqual(idsA, [int1Id, int2Id].sort((a, b) => a - b));

      // (b) Combinado con estado
      const resB = await app.request(`/api/intervenciones?planta_id=${p1Id}&estado=EN_PROCESO`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resB.status, 200);
      assert.strictEqual(resB.headers.get('X-Total-Count'), '1');
      const itemsB = (await resB.json()) as any[];
      assert.strictEqual(itemsB.length, 1);
      assert.strictEqual(itemsB[0].id, int2Id);

      // Planta inexistente -> vacía
      const resInex = await app.request('/api/intervenciones?planta_id=999999999', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resInex.status, 200);
      assert.strictEqual(resInex.headers.get('X-Total-Count'), '0');
      assert.deepStrictEqual(await resInex.json(), []);

      // (c) Con abc: 422 DATOS_INVALIDOS
      const resC = await app.request('/api/intervenciones?planta_id=abc', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resC.status, 422);
      const errC = await resC.json();
      assert.strictEqual(errC.codigo, 'DATOS_INVALIDOS');
    });
  } finally {
    client = await clienteSano(client);
    await limpiarIntervenciones(createdIntervencionIds);

    if (createdMaquinaIds.length > 0) {
      await client.query('DELETE FROM historial_estados_maquina WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
      await client.query('DELETE FROM maquinas WHERE id = ANY($1)', [createdMaquinaIds]);
    }
    if (createdSectorIds.length > 0) {
      await client.query('DELETE FROM usuario_sector WHERE sector_id = ANY($1)', [createdSectorIds]);
      await client.query('DELETE FROM sectores WHERE id = ANY($1)', [createdSectorIds]);
    }
    if (createdPlantaIds.length > 0) {
      await client.query('DELETE FROM plantas WHERE id = ANY($1)', [createdPlantaIds]);
    }
    if (createdCriticidadIds.length > 0) {
      await client.query('DELETE FROM criticidades WHERE id = ANY($1)', [createdCriticidadIds]);
    }
    if (createdTipoEquipoIds.length > 0) {
      await client.query('DELETE FROM tipos_equipo WHERE id = ANY($1)', [createdTipoEquipoIds]);
    }
    if (createdUsuarioIds.length > 0) {
      await client.query('DELETE FROM usuario_sector WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
      await client.query('DELETE FROM usuario_permiso WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
      await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [createdUsuarioIds]);
    }
    client.release();
  }
});

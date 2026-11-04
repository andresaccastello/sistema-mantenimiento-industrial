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
  console.error(' BLOQUEO DE SEGURIDAD (ADMINISTRACION TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

// Helpers para requests
async function getJson(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: 'GET',
    headers,
  });
}

async function postJson(path: string, body: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function putJson(path: string, body: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
}

async function deleteJson(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: 'DELETE',
    headers,
  });
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

test('Etapa F4a — API para las pantallas de administración', async (t) => {
  const client = await pool.connect();

  const createdUserIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdPlantaIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdCriticidadIds: number[] = [];
  const createdTipoEquipoIds: number[] = [];

  const suf = Date.now();

  // Guardar estado inicial de criticidades y tipos de equipo (Regla 4 sección 0)
  const resInitCrit = await client.query('SELECT id, codigo, orden, por_omision FROM criticidades ORDER BY id');
  const initCriticidades = resInitCrit.rows.map((r) => ({
    id: Number(r.id),
    codigo: r.codigo,
    orden: Number(r.orden),
    por_omision: Boolean(r.por_omision),
  }));

  const resInitTipos = await client.query('SELECT id, codigo, orden, por_omision FROM tipos_equipo ORDER BY id');
  const initTiposEquipo = resInitTipos.rows.map((r) => ({
    id: Number(r.id),
    codigo: r.codigo,
    orden: Number(r.orden),
    por_omision: Boolean(r.por_omision),
  }));

  try {
    // 1. Obtener perfil de administrador y operario
    const resPerfiles = await client.query('SELECT id, nombre FROM perfiles');
    let adminPerfilId = 0;
    let operarioPerfilId = 0;
    for (const r of resPerfiles.rows) {
      if (r.nombre === 'ADMINISTRADOR') adminPerfilId = Number(r.id);
      if (r.nombre === 'OPERARIO') operarioPerfilId = Number(r.id);
    }

    const passHash = await bcrypt.hash('pass123', 10);

    // Crear usuario Administrador
    const insAdmin = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, debe_cambiar_password, sesion_version)
       VALUES ($1, $2, $3, $4, $5, TRUE, FALSE, 1) RETURNING id, legajo, sesion_version`,
      [`ADM_F4_${suf}`, 'Admin', 'F4', passHash, adminPerfilId]
    );
    const testAdmin = insAdmin.rows[0];
    const testAdminId = Number(testAdmin.id);
    createdUserIds.push(testAdminId);
    const adminToken = await getTokenForUser(testAdmin);

    // Crear usuario Operario
    const insOp = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, debe_cambiar_password, sesion_version)
       VALUES ($1, $2, $3, $4, $5, TRUE, FALSE, 1) RETURNING id, legajo, sesion_version`,
      [`OP_F4_${suf}`, 'Operario', 'F4', passHash, operarioPerfilId]
    );
    const testOp = insOp.rows[0];
    const testOpId = Number(testOp.id);
    createdUserIds.push(testOpId);
    const opToken = await getTokenForUser(testOp);

    // =========================================================================
    // AD-01: Permisos, con un operario
    // =========================================================================
    await t.test('AD-01: Permisos, con un operario', async () => {
      // (a) GET sin all en las cuatro rutas: 200
      for (const ruta of ['/api/sectores', '/api/plantas', '/api/criticidades', '/api/tipos-equipo']) {
        const res = await getJson(ruta, opToken);
        assert.strictEqual(res.status, 200, `GET ${ruta} sin all debe responder 200 para operario`);
      }

      // (b) ?all=true en las cuatro: 403 PERMISO_INSUFICIENTE
      for (const ruta of ['/api/sectores?all=true', '/api/plantas?all=true', '/api/criticidades?all=true', '/api/tipos-equipo?all=true']) {
        const res = await getJson(ruta, opToken);
        assert.strictEqual(res.status, 403, `GET ${ruta} debe responder 403 para operario`);
        const json = await res.json();
        assert.strictEqual(json.codigo, 'PERMISO_INSUFICIENTE');
      }

      // (c) POST, PUT, DELETE y PUT /orden: 403
      for (const ruta of ['/api/sectores', '/api/plantas', '/api/criticidades', '/api/tipos-equipo']) {
        const resPost = await postJson(ruta, { nombre: 'Test' }, opToken);
        assert.strictEqual(resPost.status, 403, `POST ${ruta} debe ser 403`);

        const resPut = await putJson(`${ruta}/1`, { nombre: 'Test' }, opToken);
        assert.strictEqual(resPut.status, 403, `PUT ${ruta}/1 debe ser 403`);

        const resDel = await deleteJson(`${ruta}/1`, opToken);
        assert.strictEqual(resDel.status, 403, `DELETE ${ruta}/1 debe ser 403`);
      }

      const resOrdCrit = await putJson('/api/criticidades/orden', { ids: [1] }, opToken);
      assert.strictEqual(resOrdCrit.status, 403, 'PUT /api/criticidades/orden debe ser 403');

      const resOrdTipos = await putJson('/api/tipos-equipo/orden', { ids: [1] }, opToken);
      assert.strictEqual(resOrdTipos.status, 403, 'PUT /api/tipos-equipo/orden debe ser 403');
    });

    // =========================================================================
    // AD-02: Sectores con ?all=true
    // =========================================================================
    await t.test('AD-02: Sectores con ?all=true', async () => {
      // Sector de prueba activo
      const insSec = await client.query(
        'INSERT INTO sectores (nombre, activo) VALUES ($1, TRUE) RETURNING id',
        [`Sector_AD02_${suf}`]
      );
      const sId = Number(insSec.rows[0].id);
      createdSectorIds.push(sId);

      // 2 máquinas activas y 1 inactiva
      const m1 = await client.query('INSERT INTO maquinas (nombre, sector_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`M1_${suf}`, sId]);
      const m2 = await client.query('INSERT INTO maquinas (nombre, sector_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`M2_${suf}`, sId]);
      const m3 = await client.query('INSERT INTO maquinas (nombre, sector_id, activo) VALUES ($1, $2, FALSE) RETURNING id', [`M3_${suf}`, sId]);
      createdMaquinaIds.push(Number(m1.rows[0].id), Number(m2.rows[0].id), Number(m3.rows[0].id));

      // 1 usuario activo y 1 inactivo asignados al sector
      const uAct = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, debe_cambiar_password, sesion_version)
         VALUES ($1, $2, $3, $4, $5, TRUE, FALSE, 1) RETURNING id`,
        [`U_ACT_${suf}`, 'Usuario', 'Activo', passHash, operarioPerfilId]
      );
      const uInact = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, debe_cambiar_password, sesion_version)
         VALUES ($1, $2, $3, $4, $5, FALSE, FALSE, 1) RETURNING id`,
        [`U_INACT_${suf}`, 'Usuario', 'Inactivo', passHash, operarioPerfilId]
      );
      createdUserIds.push(Number(uAct.rows[0].id), Number(uInact.rows[0].id));

      await client.query('INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2), ($3, $4)', [
        Number(uAct.rows[0].id), sId, Number(uInact.rows[0].id), sId
      ]);

      // Sector inactivo
      const insSecInact = await client.query(
        'INSERT INTO sectores (nombre, activo) VALUES ($1, FALSE) RETURNING id',
        [`Sector_Inact_${suf}`]
      );
      const sInactId = Number(insSecInact.rows[0].id);
      createdSectorIds.push(sInactId);

      // Consultar con ?all=true
      const resAll = await getJson('/api/sectores?all=true', adminToken);
      assert.strictEqual(resAll.status, 200);
      const sectoresAll: any[] = await resAll.json();

      const secItem = sectoresAll.find((s) => s.id === sId);
      assert.ok(secItem, 'El sector activo debe figurar en ?all=true');
      assert.strictEqual(secItem.maquinas_activas, 2);
      assert.strictEqual(secItem.usuarios_activos, 1);
      assert.strictEqual(secItem.activo, true);

      const secInactItem = sectoresAll.find((s) => s.id === sInactId);
      assert.ok(secInactItem, 'El sector inactivo debe figurar en ?all=true');
      assert.strictEqual(secInactItem.activo, false);

      // Sin all, el sector inactivo no aparece
      const resSinAll = await getJson('/api/sectores', adminToken);
      assert.strictEqual(resSinAll.status, 200);
      const sectoresSinAll: any[] = await resSinAll.json();
      assert.ok(!sectoresSinAll.some((s) => s.id === sInactId), 'Sector inactivo no debe figurar sin all');
      assert.ok(sectoresSinAll.some((s) => s.id === sId), 'Sector activo sí debe figurar sin all');
    });

    // =========================================================================
    // AD-03: Sector: baja
    // =========================================================================
    await t.test('AD-03: Sector: baja y reactivación', async () => {
      // Planta de prueba
      const insPlanta = await client.query('INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`Planta_AD03_${suf}`]);
      const pId = Number(insPlanta.rows[0].id);
      createdPlantaIds.push(pId);

      const insSec = await client.query('INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`Sec_Baja_${suf}`, pId]);
      const sId = Number(insSec.rows[0].id);
      createdSectorIds.push(sId);

      // (a) Con una máquina activa: 409 EN_USO con maquinas_activas 1, por DELETE y por PUT
      const insM = await client.query('INSERT INTO maquinas (nombre, sector_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`M_AD03_${suf}`, sId]);
      const mId = Number(insM.rows[0].id);
      createdMaquinaIds.push(mId);

      const resDel1 = await deleteJson(`/api/sectores/${sId}`, adminToken);
      assert.strictEqual(resDel1.status, 409);
      const jsonDel1 = await resDel1.json();
      assert.strictEqual(jsonDel1.codigo, 'EN_USO');
      assert.strictEqual(jsonDel1.maquinas_activas, 1);

      const resPut1 = await putJson(`/api/sectores/${sId}`, { activo: false }, adminToken);
      assert.strictEqual(resPut1.status, 409);
      const jsonPut1 = await resPut1.json();
      assert.strictEqual(jsonPut1.codigo, 'EN_USO');
      assert.strictEqual(jsonPut1.maquinas_activas, 1);

      // Desactivar máquina y asignar usuario activo
      await client.query('UPDATE maquinas SET activo = FALSE WHERE id = $1', [mId]);

      const insUser = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, debe_cambiar_password, sesion_version)
         VALUES ($1, $2, $3, $4, $5, TRUE, FALSE, 1) RETURNING id`,
        [`U_AD03_${suf}`, 'Usuario', 'AD03', passHash, operarioPerfilId]
      );
      const uId = Number(insUser.rows[0].id);
      createdUserIds.push(uId);
      await client.query('INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)', [uId, sId]);

      // (b) Solo con un usuario activo: 409 EN_USO con usuarios_activos 1
      const resDel2 = await deleteJson(`/api/sectores/${sId}`, adminToken);
      assert.strictEqual(resDel2.status, 409);
      const jsonDel2 = await resDel2.json();
      assert.strictEqual(jsonDel2.codigo, 'EN_USO');
      assert.strictEqual(jsonDel2.usuarios_activos, 1);

      // Desactivar usuario
      await client.query('UPDATE usuarios SET activo = FALSE WHERE id = $1', [uId]);

      // (c) Solo con máquina y usuario inactivos: 200
      const resDel3 = await deleteJson(`/api/sectores/${sId}`, adminToken);
      assert.strictEqual(resDel3.status, 200);

      // Desactivar planta asociada
      await client.query('UPDATE plantas SET activo = FALSE WHERE id = $1', [pId]);

      // (d) Reactivarlo con su planta inactiva: 400
      const resReacFail = await putJson(`/api/sectores/${sId}`, { activo: true }, adminToken);
      assert.strictEqual(resReacFail.status, 400);

      // Reactivar planta
      await client.query('UPDATE plantas SET activo = TRUE WHERE id = $1', [pId]);

      // (e) Con la planta activa: 200
      const resReacOk = await putJson(`/api/sectores/${sId}`, { activo: true }, adminToken);
      assert.strictEqual(resReacOk.status, 200);
      const jsonReacOk = await resReacOk.json();
      assert.strictEqual(jsonReacOk.activo, true);
    });

    // =========================================================================
    // AD-04: Duplicados
    // =========================================================================
    await t.test('AD-04: Duplicados', async () => {
      // (a) Nombre repetido en sector y en planta: 409 NOMBRE_DUPLICADO, en POST y en PUT
      const secA = await postJson('/api/sectores', { nombre: `Sec_Dup_${suf}` }, adminToken);
      assert.strictEqual(secA.status, 201);
      const secAId = (await secA.json()).id;
      createdSectorIds.push(secAId);

      const secPostDup = await postJson('/api/sectores', { nombre: `Sec_Dup_${suf}` }, adminToken);
      assert.strictEqual(secPostDup.status, 409);
      assert.strictEqual((await secPostDup.json()).codigo, 'NOMBRE_DUPLICADO');

      const secB = await postJson('/api/sectores', { nombre: `Sec_DupB_${suf}` }, adminToken);
      assert.strictEqual(secB.status, 201);
      const secBId = (await secB.json()).id;
      createdSectorIds.push(secBId);

      const secPutDup = await putJson(`/api/sectores/${secBId}`, { nombre: `Sec_Dup_${suf}` }, adminToken);
      assert.strictEqual(secPutDup.status, 409);
      assert.strictEqual((await secPutDup.json()).codigo, 'NOMBRE_DUPLICADO');

      // Planta duplicada
      const plaA = await postJson('/api/plantas', { nombre: `Pla_Dup_${suf}` }, adminToken);
      assert.strictEqual(plaA.status, 201);
      const plaAId = (await plaA.json()).id;
      createdPlantaIds.push(plaAId);

      const plaPostDup = await postJson('/api/plantas', { nombre: `Pla_Dup_${suf}` }, adminToken);
      assert.strictEqual(plaPostDup.status, 409);
      assert.strictEqual((await plaPostDup.json()).codigo, 'NOMBRE_DUPLICADO');

      const plaB = await postJson('/api/plantas', { nombre: `Pla_DupB_${suf}` }, adminToken);
      assert.strictEqual(plaB.status, 201);
      const plaBId = (await plaB.json()).id;
      createdPlantaIds.push(plaBId);

      const plaPutDup = await putJson(`/api/plantas/${plaBId}`, { nombre: `Pla_Dup_${suf}` }, adminToken);
      assert.strictEqual(plaPutDup.status, 409);
      assert.strictEqual((await plaPutDup.json()).codigo, 'NOMBRE_DUPLICADO');

      // (b) Criticidad con código repetido: 409 CODIGO_DUPLICADO
      const critA = await postJson('/api/criticidades', { codigo: `T_AD_A_${suf}`, nombre: `Crit_A_${suf}` }, adminToken);
      assert.strictEqual(critA.status, 201);
      const critAId = (await critA.json()).id;
      createdCriticidadIds.push(critAId);

      const critCodDup = await postJson('/api/criticidades', { codigo: `T_AD_A_${suf}`, nombre: `Crit_Diff_${suf}` }, adminToken);
      assert.strictEqual(critCodDup.status, 409);
      assert.strictEqual((await critCodDup.json()).codigo, 'CODIGO_DUPLICADO');

      // (c) Criticidad con nombre repetido: 409 NOMBRE_DUPLICADO
      const critNomDup = await postJson('/api/criticidades', { codigo: `T_AD_B_${suf}`, nombre: `Crit_A_${suf}` }, adminToken);
      assert.strictEqual(critNomDup.status, 409);
      assert.strictEqual((await critNomDup.json()).codigo, 'NOMBRE_DUPLICADO');
    });

    // =========================================================================
    // AD-05: Plantas
    // =========================================================================
    await t.test('AD-05: Plantas', async () => {
      // (a) Alta y edición; descripcion: "" la vacía
      const resAlta = await postJson('/api/plantas', { nombre: `Planta_AD05_${suf}`, descripcion: 'Desc inicial' }, adminToken);
      assert.strictEqual(resAlta.status, 201);
      const planta = await resAlta.json();
      const pId = planta.id;
      createdPlantaIds.push(pId);
      assert.strictEqual(planta.descripcion, 'Desc inicial');
      assert.strictEqual(planta.sectores_activos, 0);

      const resEdit = await putJson(`/api/plantas/${pId}`, { descripcion: '' }, adminToken);
      assert.strictEqual(resEdit.status, 200);
      const plantaEdit = await resEdit.json();
      assert.strictEqual(plantaEdit.descripcion, null);

      // (b) ?all=true trae sectores_activos
      const insSec = await client.query('INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`Sec_AD05_${suf}`, pId]);
      const sId = Number(insSec.rows[0].id);
      createdSectorIds.push(sId);

      const resAll = await getJson('/api/plantas?all=true', adminToken);
      assert.strictEqual(resAll.status, 200);
      const plantasAll: any[] = await resAll.json();
      const itemPlanta = plantasAll.find((p) => p.id === pId);
      assert.ok(itemPlanta);
      assert.strictEqual(itemPlanta.sectores_activos, 1);

      // (c) Baja con un sector activo: 409 EN_USO con sectores_activos 1
      const resDelUso = await deleteJson(`/api/plantas/${pId}`, adminToken);
      assert.strictEqual(resDelUso.status, 409);
      const jsonDelUso = await resDelUso.json();
      assert.strictEqual(jsonDelUso.codigo, 'EN_USO');
      assert.strictEqual(jsonDelUso.sectores_activos, 1);

      // Desactivar sector
      await client.query('UPDATE sectores SET activo = FALSE WHERE id = $1', [sId]);

      // (d) Sin sectores activos: 200, y no aparece en GET /api/plantas (sin all)
      const resDelOk = await deleteJson(`/api/plantas/${pId}`, adminToken);
      assert.strictEqual(resDelOk.status, 200);

      const resSinAll = await getJson('/api/plantas', adminToken);
      assert.strictEqual(resSinAll.status, 200);
      const plantasSinAll: any[] = await resSinAll.json();
      assert.ok(!plantasSinAll.some((p) => p.id === pId));

      // (e) PUT con activo: true: vuelve a aparecer
      const resReac = await putJson(`/api/plantas/${pId}`, { activo: true }, adminToken);
      assert.strictEqual(resReac.status, 200);
      const resSinAll2 = await getJson('/api/plantas', adminToken);
      const plantasSinAll2: any[] = await resSinAll2.json();
      assert.ok(plantasSinAll2.some((p) => p.id === pId));

      // (f) Id inexistente: 404 PLANTA_NO_ENCONTRADA; abc: 400
      const res404 = await getJson('/api/plantas/99999999', adminToken);
      const resDel404 = await deleteJson('/api/plantas/99999999', adminToken);
      assert.strictEqual(resDel404.status, 404);
      assert.strictEqual((await resDel404.json()).codigo, 'PLANTA_NO_ENCONTRADA');

      const res400 = await deleteJson('/api/plantas/abc', adminToken);
      assert.strictEqual(res400.status, 400);
      assert.strictEqual((await res400.json()).codigo, 'DATOS_INVALIDOS');
    });

    // =========================================================================
    // AD-06: Criticidad: alta
    // =========================================================================
    await t.test('AD-06: Criticidad: alta', async () => {
      // (a) codigo 'alta', '1A', de 31 caracteres o faltante: 400
      for (const badCodigo of ['alta', '1A', 'A'.repeat(31), '']) {
        const res = await postJson('/api/criticidades', { codigo: badCodigo, nombre: `Crit_${suf}` }, adminToken);
        assert.strictEqual(res.status, 400, `Código inválido "${badCodigo}" debe devolver 400`);
      }
      const resMissing = await postJson('/api/criticidades', { nombre: `Crit_${suf}` }, adminToken);
      assert.strictEqual(resMissing.status, 400);

      // (b) Válida: 201, con orden = máximo + 1, por_omision: false, activa y prioridad_alta como vino
      const resMax = await client.query('SELECT COALESCE(MAX(orden), 0)::integer AS max_orden FROM criticidades');
      const maxOrdenAntes = Number(resMax.rows[0].max_orden);

      const resOk = await postJson('/api/criticidades', {
        codigo: `T_AD_CRIT_${suf}`,
        nombre: `Criticidad AD06 ${suf}`,
        prioridad_alta: true,
      }, adminToken);

      assert.strictEqual(resOk.status, 201);
      const crit = await resOk.json();
      createdCriticidadIds.push(crit.id);

      assert.strictEqual(crit.orden, maxOrdenAntes + 1);
      assert.strictEqual(crit.por_omision, false);
      assert.strictEqual(crit.activo, true);
      assert.strictEqual(crit.prioridad_alta, true);
      assert.strictEqual(crit.maquinas_activas, 0);

      // (c) Con orden o con por_omision: 400
      const resConOrden = await postJson('/api/criticidades', {
        codigo: `T_AD_ORD_${suf}`,
        nombre: `Crit con orden ${suf}`,
        orden: 1,
      }, adminToken);
      assert.strictEqual(resConOrden.status, 400);

      const resConOmision = await postJson('/api/criticidades', {
        codigo: `T_AD_OMI_${suf}`,
        nombre: `Crit con omision ${suf}`,
        por_omision: true,
      }, adminToken);
      assert.strictEqual(resConOmision.status, 400);

      // (d) La respuesta es igual a su elemento en ?all=true (deepStrictEqual)
      const resAll = await getJson('/api/criticidades?all=true', adminToken);
      const listaAll: any[] = await resAll.json();
      const critAll = listaAll.find((c) => c.id === crit.id);
      assert.deepStrictEqual(crit, critAll);
    });

    // =========================================================================
    // AD-07: Criticidad: edición
    // =========================================================================
    await t.test('AD-07: Criticidad: edición', async () => {
      const resAlta = await postJson('/api/criticidades', {
        codigo: `T_AD_ED_${suf}`,
        nombre: `Crit Ed ${suf}`,
        prioridad_alta: false,
      }, adminToken);
      const critId = (await resAlta.json()).id;
      createdCriticidadIds.push(critId);

      // (a) Cambian nombre y prioridad_alta
      const resEdit = await putJson(`/api/criticidades/${critId}`, {
        nombre: `Crit Ed Mod ${suf}`,
        prioridad_alta: true,
      }, adminToken);
      assert.strictEqual(resEdit.status, 200);
      const critEdit = await resEdit.json();
      assert.strictEqual(critEdit.nombre, `Crit Ed Mod ${suf}`);
      assert.strictEqual(critEdit.prioridad_alta, true);

      // (b) Con codigo o con orden: 400
      const resCod = await putJson(`/api/criticidades/${critId}`, { codigo: 'OTRO_CODIGO' }, adminToken);
      assert.strictEqual(resCod.status, 400);

      const resOrd = await putJson(`/api/criticidades/${critId}`, { orden: 5 }, adminToken);
      assert.strictEqual(resOrd.status, 400);

      // (c) por_omision: false: 400
      const resOmiFalse = await putJson(`/api/criticidades/${critId}`, { por_omision: false }, adminToken);
      assert.strictEqual(resOmiFalse.status, 400);

      // (d) Id inexistente: 404 CRITICIDAD_NO_ENCONTRADA
      const res404 = await putJson('/api/criticidades/99999999', { nombre: 'Inexistente' }, adminToken);
      assert.strictEqual(res404.status, 404);
      assert.strictEqual((await res404.json()).codigo, 'CRITICIDAD_NO_ENCONTRADA');
    });

    // =========================================================================
    // AD-08: Valor por omisión
    // =========================================================================
    await t.test('AD-08: Valor por omisión', async () => {
      // Crear sector para máquinas
      const insSec = await client.query('INSERT INTO sectores (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`Sec_AD08_${suf}`]);
      const sId = Number(insSec.rows[0].id);
      createdSectorIds.push(sId);

      // Crear criticidad de prueba
      const resAlta = await postJson('/api/criticidades', {
        codigo: `T_AD_DEF_${suf}`,
        nombre: `Crit Def ${suf}`,
      }, adminToken);
      const critId = (await resAlta.json()).id;
      createdCriticidadIds.push(critId);

      // (a) Marcar una de la prueba: 200. La anterior queda en false y hay una sola por omisión.
      const resMark = await putJson(`/api/criticidades/${critId}`, { por_omision: true }, adminToken);
      assert.strictEqual(resMark.status, 200);
      const critMark = await resMark.json();
      assert.strictEqual(critMark.por_omision, true);

      const resCountOmi = await client.query('SELECT COUNT(*)::integer AS total FROM criticidades WHERE por_omision = TRUE');
      assert.strictEqual(Number(resCountOmi.rows[0].total), 1);

      // (b) Una máquina nueva sin criticidad toma la nueva
      const resMaq = await postJson('/api/maquinas', {
        nombre: `Maq_AD08_${suf}`,
        sector_id: sId,
      }, adminToken);
      assert.strictEqual(resMaq.status, 201);
      const maqJson = await resMaq.json();
      createdMaquinaIds.push(maqJson.id);
      assert.strictEqual(maqJson.criticidad.id, critId);

      // (c) Desactivar la por omisión: 409 ES_POR_OMISION
      const resDelOmi = await deleteJson(`/api/criticidades/${critId}`, adminToken);
      assert.strictEqual(resDelOmi.status, 409);
      assert.strictEqual((await resDelOmi.json()).codigo, 'ES_POR_OMISION');

      // (d) Marcar una inactiva: 400
      const resCritInact = await postJson('/api/criticidades', {
        codigo: `T_AD_INACT_${suf}`,
        nombre: `Crit Inact ${suf}`,
      }, adminToken);
      const critInactId = (await resCritInact.json()).id;
      createdCriticidadIds.push(critInactId);
      await deleteJson(`/api/criticidades/${critInactId}`, adminToken); // Desactivar

      const resMarkInact = await putJson(`/api/criticidades/${critInactId}`, { por_omision: true }, adminToken);
      assert.strictEqual(resMarkInact.status, 400);

      // Al terminar este test, devolvemos la original como valor por omisión
      const originalDefault = initCriticidades.find((c) => c.por_omision);
      if (originalDefault) {
        await client.query('UPDATE criticidades SET por_omision = FALSE WHERE por_omision = TRUE');
        await client.query('UPDATE criticidades SET por_omision = TRUE WHERE id = $1', [originalDefault.id]);
      }
    });

    // =========================================================================
    // AD-09: Criticidad en uso
    // =========================================================================
    await t.test('AD-09: Criticidad en uso', async () => {
      const insSec = await client.query('INSERT INTO sectores (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`Sec_AD09_${suf}`]);
      const sId = Number(insSec.rows[0].id);
      createdSectorIds.push(sId);

      const resCrit = await postJson('/api/criticidades', {
        codigo: `T_AD_USO_${suf}`,
        nombre: `Crit Uso ${suf}`,
      }, adminToken);
      const critId = (await resCrit.json()).id;
      createdCriticidadIds.push(critId);

      const resMaq = await postJson('/api/maquinas', {
        nombre: `Maq_AD09_${suf}`,
        sector_id: sId,
        criticidad_id: critId,
      }, adminToken);
      const maqId = (await resMaq.json()).id;
      createdMaquinaIds.push(maqId);

      // (a) Una de la prueba, usada por una máquina activa: la baja da 409 EN_USO con maquinas_activas 1
      const resDelUso = await deleteJson(`/api/criticidades/${critId}`, adminToken);
      assert.strictEqual(resDelUso.status, 409);
      const jsonUso = await resDelUso.json();
      assert.strictEqual(jsonUso.codigo, 'EN_USO');
      assert.strictEqual(jsonUso.maquinas_activas, 1);

      // (b) Después de desactivar la máquina: 200. No aparece sin all; con all, aparece con activo: false
      await deleteJson(`/api/maquinas/${maqId}`, adminToken);

      const resDelOk = await deleteJson(`/api/criticidades/${critId}`, adminToken);
      assert.strictEqual(resDelOk.status, 200);

      const resSinAll = await getJson('/api/criticidades', adminToken);
      const listaSinAll: any[] = await resSinAll.json();
      assert.ok(!listaSinAll.some((c) => c.id === critId));

      const resConAll = await getJson('/api/criticidades?all=true', adminToken);
      const listaConAll: any[] = await resConAll.json();
      const critInact = listaConAll.find((c) => c.id === critId);
      assert.ok(critInact);
      assert.strictEqual(critInact.activo, false);

      // (c) Reactivar la máquina: 400
      const resReacMaqFail = await putJson(`/api/maquinas/${maqId}`, { activo: true }, adminToken);
      assert.strictEqual(resReacMaqFail.status, 400);

      // (d) Reactivar la criticidad y después la máquina: 200 las dos
      const resReacCrit = await putJson(`/api/criticidades/${critId}`, { activo: true }, adminToken);
      assert.strictEqual(resReacCrit.status, 200);

      const resReacMaqOk = await putJson(`/api/maquinas/${maqId}`, { activo: true }, adminToken);
      assert.strictEqual(resReacMaqOk.status, 200);
      assert.strictEqual((await resReacMaqOk.json()).activo, true);
    });

    // =========================================================================
    // AD-10: Orden
    // =========================================================================
    await t.test('AD-10: Orden', async () => {
      const resCrit = await postJson('/api/criticidades', {
        codigo: `T_AD_ORD_TEST_${suf}`,
        nombre: `Crit Ord ${suf}`,
      }, adminToken);
      const critId = (await resCrit.json()).id;
      createdCriticidadIds.push(critId);

      // Obtener todos los IDs actuales de criticidades
      const resAll = await client.query('SELECT id FROM criticidades');
      const allIds = resAll.rows.map((r) => Number(r.id));

      // Poner la recién creada primera
      const reorderedIds = [critId, ...allIds.filter((id) => id !== critId)];

      // (a) La lista completa, con una de la prueba primera: 200. GET la devuelve primera y los orden quedan en 1 a n
      const resOrd = await putJson('/api/criticidades/orden', { ids: reorderedIds }, adminToken);
      assert.strictEqual(resOrd.status, 200);
      const listaOrd: any[] = await resOrd.json();

      assert.strictEqual(listaOrd[0].id, critId);
      for (let i = 0; i < listaOrd.length; i++) {
        assert.strictEqual(listaOrd[i].orden, i + 1);
      }

      // (b) Falta un id, se repite uno o hay uno inexistente: 400
      const resFalta = await putJson('/api/criticidades/orden', { ids: reorderedIds.slice(1) }, adminToken);
      assert.strictEqual(resFalta.status, 400);

      const resRepite = await putJson('/api/criticidades/orden', { ids: [critId, ...reorderedIds] }, adminToken);
      assert.strictEqual(resRepite.status, 400);

      const resInexistente = await putJson('/api/criticidades/orden', { ids: [99999999, ...reorderedIds.slice(1)] }, adminToken);
      assert.strictEqual(resInexistente.status, 400);
    });

    // =========================================================================
    // AD-11: Dos escrituras a la vez
    // =========================================================================
    await t.test('AD-11: Dos escrituras a la vez', async () => {
      // (a) Dos POST simultáneos con códigos distintos: los dos 201, con orden distintos
      const [resPost1, resPost2] = await Promise.all([
        postJson('/api/criticidades', { codigo: `T_AD_SIM1_${suf}`, nombre: `Crit Sim 1 ${suf}` }, adminToken),
        postJson('/api/criticidades', { codigo: `T_AD_SIM2_${suf}`, nombre: `Crit Sim 2 ${suf}` }, adminToken),
      ]);

      assert.strictEqual(resPost1.status, 201);
      assert.strictEqual(resPost2.status, 201);
      const c1 = await resPost1.json();
      const c2 = await resPost2.json();
      createdCriticidadIds.push(c1.id, c2.id);

      assert.notStrictEqual(c1.orden, c2.orden, 'Dos altas simultáneas deben tener órdenes distintos');

      // (b) Dos PUT simultáneos que marcan por omisión dos filas distintas de la prueba: los dos 200, y al final hay una sola por omisión
      const [resPut1, resPut2] = await Promise.all([
        putJson(`/api/criticidades/${c1.id}`, { por_omision: true }, adminToken),
        putJson(`/api/criticidades/${c2.id}`, { por_omision: true }, adminToken),
      ]);

      assert.strictEqual(resPut1.status, 200);
      assert.strictEqual(resPut2.status, 200);

      const resCountOmi = await client.query('SELECT COUNT(*)::integer AS total FROM criticidades WHERE por_omision = TRUE');
      assert.strictEqual(Number(resCountOmi.rows[0].total), 1, 'Al final debe haber una sola criticidad por omisión');

      // Restaurar valor por omisión original
      const originalDefault = initCriticidades.find((c) => c.por_omision);
      if (originalDefault) {
        await client.query('UPDATE criticidades SET por_omision = FALSE WHERE por_omision = TRUE');
        await client.query('UPDATE criticidades SET por_omision = TRUE WHERE id = $1', [originalDefault.id]);
      }
    });

    // =========================================================================
    // AD-12: Tipos de equipo
    // =========================================================================
    await t.test('AD-12: Tipos de equipo', async () => {
      // Crear sector para máquinas
      const insSec = await client.query('INSERT INTO sectores (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`Sec_AD12_${suf}`]);
      const sId = Number(insSec.rows[0].id);
      createdSectorIds.push(sId);

      // Alta: 201, con orden = máximo + 1
      const resMax = await client.query('SELECT COALESCE(MAX(orden), 0)::integer AS max_orden FROM tipos_equipo');
      const maxOrdenAntes = Number(resMax.rows[0].max_orden);

      const resAlta = await postJson('/api/tipos-equipo', {
        codigo: `T_AD_TE_${suf}`,
        nombre: `Tipo AD12 ${suf}`,
      }, adminToken);
      assert.strictEqual(resAlta.status, 201);
      const teJson = await resAlta.json();
      const teId = teJson.id;
      createdTipoEquipoIds.push(teId);
      assert.strictEqual(teJson.orden, maxOrdenAntes + 1);

      // Código repetido: 409
      const resDup = await postJson('/api/tipos-equipo', {
        codigo: `T_AD_TE_${suf}`,
        nombre: `Otro Nombre ${suf}`,
      }, adminToken);
      assert.strictEqual(resDup.status, 409);
      assert.strictEqual((await resDup.json()).codigo, 'CODIGO_DUPLICADO');

      // Desactivar el por omisión: 409 ES_POR_OMISION
      const defaultTipo = initTiposEquipo.find((t) => t.por_omision);
      assert.ok(defaultTipo);
      const resDelDef = await deleteJson(`/api/tipos-equipo/${defaultTipo.id}`, adminToken);
      assert.strictEqual(resDelDef.status, 409);
      assert.strictEqual((await resDelDef.json()).codigo, 'ES_POR_OMISION');

      // Uno en uso: 409 EN_USO
      const insM = await postJson('/api/maquinas', {
        nombre: `Maq_TE_${suf}`,
        sector_id: sId,
        tipo_equipo_id: teId,
      }, adminToken);
      const mId = (await insM.json()).id;
      createdMaquinaIds.push(mId);

      const resDelUso = await deleteJson(`/api/tipos-equipo/${teId}`, adminToken);
      assert.strictEqual(resDelUso.status, 409);
      assert.strictEqual((await resDelUso.json()).codigo, 'EN_USO');

      // Orden incompleto: 400
      const resOrdIncomp = await putJson('/api/tipos-equipo/orden', { ids: [teId] }, adminToken);
      assert.strictEqual(resOrdIncomp.status, 400);

      // Id inexistente: 404 TIPO_EQUIPO_NO_ENCONTRADO
      const res404 = await deleteJson('/api/tipos-equipo/99999999', adminToken);
      assert.strictEqual(res404.status, 404);
      assert.strictEqual((await res404.json()).codigo, 'TIPO_EQUIPO_NO_ENCONTRADO');
    });

    // =========================================================================
    // AD-16: Catálogos intactos
    // =========================================================================
    await t.test('AD-16: Catálogos intactos', async () => {
      // Restaurar valores originales por SQL
      await client.query('UPDATE criticidades SET orden = orden + 1000');
      await client.query('UPDATE criticidades SET por_omision = FALSE WHERE por_omision = TRUE');
      for (const c of initCriticidades) {
        await client.query('UPDATE criticidades SET orden = $1, por_omision = $2 WHERE id = $3', [c.orden, c.por_omision, c.id]);
      }

      await client.query('UPDATE tipos_equipo SET orden = orden + 1000');
      await client.query('UPDATE tipos_equipo SET por_omision = FALSE WHERE por_omision = TRUE');
      for (const t of initTiposEquipo) {
        await client.query('UPDATE tipos_equipo SET orden = $1, por_omision = $2 WHERE id = $3', [t.orden, t.por_omision, t.id]);
      }

      // Verificar que coincidan exactamente con el inicio
      const resFinCrit = await client.query('SELECT id, codigo, orden, por_omision FROM criticidades WHERE id = ANY($1)', [
        initCriticidades.map((c) => c.id),
      ]);
      for (const row of resFinCrit.rows) {
        const init = initCriticidades.find((c) => c.id === Number(row.id))!;
        assert.strictEqual(Number(row.orden), init.orden, `Criticidad ${init.codigo} orden debe ser ${init.orden}`);
        assert.strictEqual(Boolean(row.por_omision), init.por_omision, `Criticidad ${init.codigo} por_omision debe ser ${init.por_omision}`);
      }

      const resFinTipos = await client.query('SELECT id, codigo, orden, por_omision FROM tipos_equipo WHERE id = ANY($1)', [
        initTiposEquipo.map((t) => t.id),
      ]);
      for (const row of resFinTipos.rows) {
        const init = initTiposEquipo.find((t) => t.id === Number(row.id))!;
        assert.strictEqual(Number(row.orden), init.orden, `Tipo equipo ${init.codigo} orden debe ser ${init.orden}`);
        assert.strictEqual(Boolean(row.por_omision), init.por_omision, `Tipo equipo ${init.codigo} por_omision debe ser ${init.por_omision}`);
      }
    });

  } finally {
    // Restaurar catálogos originales
    await client.query('UPDATE criticidades SET orden = orden + 1000').catch(() => {});
    await client.query('UPDATE criticidades SET por_omision = FALSE WHERE por_omision = TRUE').catch(() => {});
    for (const c of initCriticidades) {
      await client.query('UPDATE criticidades SET orden = $1, por_omision = $2 WHERE id = $3', [c.orden, c.por_omision, c.id]).catch(() => {});
    }

    await client.query('UPDATE tipos_equipo SET orden = orden + 1000').catch(() => {});
    await client.query('UPDATE tipos_equipo SET por_omision = FALSE WHERE por_omision = TRUE').catch(() => {});
    for (const t of initTiposEquipo) {
      await client.query('UPDATE tipos_equipo SET orden = $1, por_omision = $2 WHERE id = $3', [t.orden, t.por_omision, t.id]).catch(() => {});
    }

    // Borrado estricto de todos los datos creados por sus IDs
    if (createdMaquinaIds.length > 0) {
      await client.query('DELETE FROM intervenciones WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
      await client.query('DELETE FROM maquinas WHERE id = ANY($1)', [createdMaquinaIds]);
    }

    if (createdSectorIds.length > 0) {
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

    if (createdUserIds.length > 0) {
      await client.query('DELETE FROM auditoria_permisos WHERE sobre_usuario_id = ANY($1) OR realizado_por_usuario_id = ANY($1)', [createdUserIds]);
      await client.query('DELETE FROM usuario_permiso WHERE usuario_id = ANY($1) OR otorgado_por_usuario_id = ANY($1)', [createdUserIds]);
      await client.query('DELETE FROM usuario_sector WHERE usuario_id = ANY($1)', [createdUserIds]);
      await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [createdUserIds]);
    }

    client.release();
  }
});


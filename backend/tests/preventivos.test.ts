import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { pool } from '../functions/db.ts';
import app from '../functions/api.ts';
import { JWT_SECRET } from '../functions/config.ts';

// Timeout de bloqueo para las pruebas de concurrencia
process.env.LOCK_TIMEOUT = '5s';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (PREVENTIVOS TESTS)');
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

interface Respuesta {
  status: number;
  cuerpo: any;
  total: string | null;
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
  let cuerpo: any = texto;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    // no es JSON
  }
  return { status: r.status, cuerpo, total: r.headers.get('X-Total-Count') };
}

/** Suma días a una fecha YYYY-MM-DD. */
function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Suma años a una fecha YYYY-MM-DD. */
function sumarAnios(fecha: string, anios: number): string {
  return `${Number(fecha.slice(0, 4)) + anios}${fecha.slice(4)}`;
}

test('Etapa PV1 — Preventivos por calendario (PV-01 a PV-05)', async (t) => {
  const client = await pool.connect();

  const createdPlantaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdUsuarioIds: number[] = [];
  const createdProveedorIds: number[] = [];
  const createdRepuestoIds: number[] = [];

  try {
    const suf = Date.now();
    const passHash = await bcrypt.hash('pass123', 10);

    const perfilMap: Record<string, number> = {};
    for (const r of (await client.query('SELECT id, nombre FROM perfiles')).rows) {
      perfilMap[r.nombre] = Number(r.id);
    }
    const permMap: Record<string, number> = {};
    for (const r of (await client.query('SELECT id, codigo FROM permisos')).rows) {
      permMap[r.codigo] = Number(r.id);
    }

    const hoy: string = (await client.query(
      `SELECT to_char((now() AT TIME ZONE zona_horaria)::date, 'YYYY-MM-DD') AS hoy FROM configuracion_sistema WHERE id = 1`
    )).rows[0].hoy;

    // Criticidades: una de prioridad alta y una que no
    const critAlta = Number((await client.query(
      'SELECT id FROM criticidades WHERE prioridad_alta AND activo ORDER BY orden, id LIMIT 1'
    )).rows[0].id);
    const critNormal = Number((await client.query(
      'SELECT id FROM criticidades WHERE NOT prioridad_alta AND activo ORDER BY orden, id LIMIT 1'
    )).rows[0].id);

    // Plantas, sectores y máquinas: S1 en PL1, S2 en PL2
    async function crearPlanta(clave: string) {
      const id = Number((await client.query(
        'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`PV_${clave}_${suf}`]
      )).rows[0].id);
      createdPlantaIds.push(id);
      return id;
    }
    async function crearSector(clave: string, plantaId: number) {
      const id = Number((await client.query(
        'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`PV_${clave}_${suf}`, plantaId]
      )).rows[0].id);
      createdSectorIds.push(id);
      return id;
    }
    async function crearMaquina(clave: string, sectorId: number, criticidadId = critNormal, activo = true) {
      const id = Number((await client.query(
        `INSERT INTO maquinas (codigo, nombre, sector_id, criticidad_id, activo)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [`PV_${clave}_${suf}`, `Maquina PV ${clave}`, sectorId, criticidadId, activo]
      )).rows[0].id);
      createdMaquinaIds.push(id);
      return id;
    }
    const pl1 = await crearPlanta('PL1');
    const pl2 = await crearPlanta('PL2');
    const s1 = await crearSector('S1', pl1);
    const s2 = await crearSector('S2', pl2);
    const m1 = await crearMaquina('M1', s1);
    const m2 = await crearMaquina('M2', s2);

    // Usuarios
    async function crearUsuario(clave: string, nombre: string, perfil: string, sectores: number[], activo = true) {
      const res = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
         VALUES ($1, $2, 'PV', $3, $4, $5, 1) RETURNING id, legajo, sesion_version`,
        [`PV_${clave}_${suf}`, nombre, passHash, perfilMap[perfil], activo]
      );
      const u = res.rows[0];
      const id = Number(u.id);
      createdUsuarioIds.push(id);
      for (const s of sectores) {
        await client.query('INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)', [id, s]);
      }
      return { id, token: await getTokenForUser({ id, legajo: u.legajo, sesion_version: Number(u.sesion_version) }) };
    }

    const A = await crearUsuario('A', 'Admin', 'ADMINISTRADOR', []);
    const R = await crearUsuario('R', 'Resp', 'RESPONSABLE_MANTENIMIENTO', [s1, s2]);
    // R2: como R, con DENEGAR de INTERVENCIONES_ASIGNAR
    const R2 = await crearUsuario('R2', 'RespDos', 'RESPONSABLE_MANTENIMIENTO', [s1, s2]);
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'DENEGAR', 'Sin asignar', $3)`,
      [R2.id, permMap['INTERVENCIONES_ASIGNAR'], A.id]
    );
    // S: como R, con PLANES_GESTIONAR en alcance SECTORES, solo del sector de la máquina 1
    const S = await crearUsuario('S', 'Sectorial', 'RESPONSABLE_MANTENIMIENTO', [s1]);
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Planes de su sector', $3)`,
      [S.id, permMap['PLANES_GESTIONAR'], A.id]
    );
    const O = await crearUsuario('O', 'Operario', 'OPERARIO', [s1, s2]);
    // Un responsable inactivo, para los errores
    const Ri = await crearUsuario('Ri', 'RespInactivo', 'RESPONSABLE_MANTENIMIENTO', [s1, s2], false);

    // Repuesto y proveedor de la prueba, y uno inactivo de cada uno
    const rProv = await pedir('POST', '/api/proveedores', R.token, { nombre: `PV Proveedor ${suf}` });
    assert.strictEqual(rProv.status, 201, JSON.stringify(rProv.cuerpo));
    const provId = Number(rProv.cuerpo.id);
    createdProveedorIds.push(provId);
    const rRep = await pedir('POST', '/api/repuestos', R.token, {
      codigo: `PV_R1_${suf}`,
      nombre: `PV Aceite ${suf}`,
      unidad: 'litro',
      lleva_stock: false,
      costo_unitario: 100,
    });
    assert.strictEqual(rRep.status, 201, JSON.stringify(rRep.cuerpo));
    const repId = Number(rRep.cuerpo.id);
    createdRepuestoIds.push(repId);
    const provInactivo = Number((await client.query(
      'INSERT INTO proveedores (nombre, activo) VALUES ($1, FALSE) RETURNING id', [`PV Proveedor inactivo ${suf}`]
    )).rows[0].id);
    createdProveedorIds.push(provInactivo);
    const repInactivo = Number((await client.query(
      'INSERT INTO repuestos (codigo, nombre, activo) VALUES ($1, $2, FALSE) RETURNING id', [`PV_R2_${suf}`, `PV Repuesto inactivo ${suf}`]
    )).rows[0].id);
    createdRepuestoIds.push(repInactivo);

    // Helpers
    const tarea = (primera: string, extra: Record<string, unknown> = {}) => ({
      accion: 'Revisar el equipo',
      frecuencia_valor: 1,
      frecuencia_unidad: 'MESES',
      primera_fecha: primera,
      ...extra,
    });
    let numeroPlan = 0;
    async function crearPlan(maquinaId: number, tareas: unknown[], extra: Record<string, unknown> = {}, token = A.token) {
      numeroPlan++;
      const r = await pedir('POST', '/api/planes', token, {
        maquina_id: maquinaId,
        nombre: `Plan PV ${numeroPlan}`,
        tareas,
        ...extra,
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      return r.cuerpo;
    }
    const planesDeMaquina = async (maquinaId: number) =>
      Number((await client.query('SELECT count(*)::int AS n FROM planes_mantenimiento WHERE maquina_id = $1', [maquinaId])).rows[0].n);

    /** Una intervención preventiva finalizada con la tarea hecha, cargada directo en la base. */
    async function ejecucion(maquinaId: number, planId: number, tareaId: number, fin: string) {
      const tipo = Number((await client.query(`SELECT id FROM tipos_intervencion WHERE codigo = 'PREVENTIVO'`)).rows[0].id);
      const intId = Number((await client.query(
        `INSERT INTO intervenciones (
           maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, plan_mantenimiento_id,
           fecha_creacion, fecha_inicio, fecha_finalizacion, trabajo_realizado, ejecucion
         ) VALUES ($1, $2, $3, 'Preventivo PV', 'FINALIZADA', $4,
                   $5::timestamptz - interval '2 hours', $5::timestamptz - interval '1 hour', $5::timestamptz,
                   'Trabajo PV', 'INTERNA')
         RETURNING id`,
        [maquinaId, tipo, A.id, planId, fin]
      )).rows[0].id);
      await client.query(
        `INSERT INTO intervencion_tareas (intervencion_id, plan_tarea_id, orden, accion, fecha_programada, hecha, hecha_por_usuario_id, hecha_en)
         SELECT $1, t.id, t.orden, t.accion, t.primera_fecha, TRUE, $2, NOW() FROM plan_tareas t WHERE t.id = $3`,
        [intId, A.id, tareaId]
      );
      return intId;
    }

    // =========================================================================
    // PV-01: Permisos
    // =========================================================================
    await t.test('PV-01: Permisos', async () => {
      const p1 = await crearPlan(m1, [tarea(sumarDias(hoy, -2))]);
      const p2 = await crearPlan(m2, [tarea(sumarDias(hoy, -2))]);
      const t1 = p1.tareas[0].id;

      // O: 403 en todas las rutas de las secciones 4 y 5
      const rutasO: Array<[string, string, unknown?]> = [
        ['GET', '/api/planes'],
        ['GET', '/api/planes/vencimientos'],
        ['GET', `/api/planes/${p1.id}`],
        ['POST', '/api/planes', { maquina_id: m1, nombre: 'Plan de O', tareas: [tarea(hoy)] }],
        ['PATCH', `/api/planes/${p1.id}`, { nombre: 'Cambio de O' }],
        ['POST', `/api/planes/${p1.id}/desactivar`, {}],
        ['POST', `/api/planes/${p1.id}/reactivar`, {}],
        ['POST', `/api/planes/${p1.id}/tareas`, tarea(hoy)],
        ['PATCH', `/api/planes/${p1.id}/tareas/${t1}`, { accion: 'Cambio de O' }],
        ['POST', `/api/planes/${p1.id}/tareas/${t1}/desactivar`, {}],
        ['POST', `/api/planes/${p1.id}/tareas/${t1}/reactivar`, {}],
      ];
      for (const [metodo, ruta, cuerpo] of rutasO) {
        const r = await pedir(metodo, ruta, O.token, cuerpo);
        assert.strictEqual(r.status, 403, `O en ${metodo} ${ruta}: ${JSON.stringify(r.cuerpo)}`);
        assert.strictEqual(r.cuerpo.codigo, 'PERMISO_INSUFICIENTE');
      }

      // S ve los planes de la máquina 1, no los de la 2
      const lista = await pedir('GET', '/api/planes', S.token);
      assert.strictEqual(lista.status, 200);
      const ids = lista.cuerpo.map((p: any) => p.id);
      assert.ok(ids.includes(p1.id), 'S ve el plan de la máquina 1');
      assert.ok(!ids.includes(p2.id), 'S no ve el plan de la máquina 2');
      assert.ok(lista.cuerpo.every((p: any) => p.maquina.sector.id === s1), 'S solo ve su sector');

      assert.strictEqual((await pedir('GET', `/api/planes/${p1.id}`, S.token)).status, 200);
      const r404 = await pedir('GET', `/api/planes/${p2.id}`, S.token);
      assert.deepStrictEqual([r404.status, r404.cuerpo.codigo], [404, 'PLAN_NO_ENCONTRADO']);
      const rPatch = await pedir('PATCH', `/api/planes/${p2.id}`, S.token, { nombre: 'Cambio de S' });
      assert.deepStrictEqual([rPatch.status, rPatch.cuerpo.codigo], [404, 'PLAN_NO_ENCONTRADO']);

      const venc = await pedir('GET', '/api/planes/vencimientos?estado=VENCIDA,PROXIMA,EN_CURSO,AL_DIA&limit=500', S.token);
      assert.strictEqual(venc.status, 200);
      const planesVenc = venc.cuerpo.tareas.map((x: any) => x.plan.id);
      assert.ok(planesVenc.includes(p1.id), 'S ve los vencimientos de la máquina 1');
      assert.ok(!planesVenc.includes(p2.id), 'S no ve los vencimientos de la máquina 2');

      // S crea un plan en la máquina 2: 403
      const antes = await planesDeMaquina(m2);
      const rCrear = await pedir('POST', '/api/planes', S.token, { maquina_id: m2, nombre: 'Plan de S', tareas: [tarea(hoy)] });
      assert.deepStrictEqual([rCrear.status, rCrear.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);
      assert.strictEqual(await planesDeMaquina(m2), antes);
    });

    // =========================================================================
    // PV-02: Alta
    // =========================================================================
    await t.test('PV-02: Alta', async () => {
      const mInactiva = await crearMaquina('MI', s1, critNormal, false);
      const primera = sumarDias(hoy, -5);

      const r = await pedir('POST', '/api/planes', A.token, {
        maquina_id: m1,
        nombre: '  Lubricación PV  ',
        descripcion: 'Plan de la prueba',
        responsable_usuario_id: R.id,
        tareas: [
          tarea(primera, { accion: 'Cambiar el aceite', repuesto_id: repId, cantidad: 2.5, proveedor_id: provId, detalle: 'Con el equipo frío' }),
          tarea(sumarDias(hoy, 30), { accion: 'Ajustar la correa', frecuencia_valor: 2, frecuencia_unidad: 'SEMANAS' }),
        ],
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      const d = r.cuerpo;
      assert.strictEqual(d.nombre, 'Lubricación PV', 'El nombre va recortado');
      assert.strictEqual(d.descripcion, 'Plan de la prueba');
      assert.strictEqual(d.activo, true);
      assert.strictEqual(d.anticipacion_dias, 7);
      assert.strictEqual(d.hoy, hoy);
      assert.deepStrictEqual(d.maquina, {
        id: m1, codigo: `PV_M1_${suf}`, nombre: 'Maquina PV M1', activo: true, sector: { id: s1, nombre: `PV_S1_${suf}` },
      });
      assert.deepStrictEqual(d.responsable, { id: R.id, legajo: `PV_R_${suf}`, nombre: 'Resp', apellido: 'PV' });
      assert.deepStrictEqual(d.creado_por, { id: A.id, legajo: `PV_A_${suf}`, nombre: 'Admin', apellido: 'PV' });
      assert.strictEqual(typeof d.creado_en, 'string');
      assert.strictEqual(typeof d.actualizado_en, 'string');
      assert.deepStrictEqual(d.intervenciones, []);
      assert.strictEqual(d.tareas.length, 2);
      const [t0, t1] = d.tareas;
      assert.deepStrictEqual(
        { ...t0, id: 0 },
        {
          id: 0,
          orden: 1,
          accion: 'Cambiar el aceite',
          detalle: 'Con el equipo frío',
          frecuencia_valor: 1,
          frecuencia_unidad: 'MESES',
          primera_fecha: primera,
          repuesto: { id: repId, codigo: `PV_R1_${suf}`, nombre: `PV Aceite ${suf}`, unidad: 'litro' },
          cantidad: 2.5,
          proveedor: { id: provId, nombre: `PV Proveedor ${suf}` },
          activo: true,
          ultima_ejecucion: null,
          proxima_fecha: primera,
          dias: -5,
          estado: 'VENCIDA',
          intervencion_en_curso: null,
        }
      );
      assert.deepStrictEqual(
        [t1.orden, t1.repuesto, t1.cantidad, t1.proveedor, t1.estado, t1.frecuencia_unidad],
        [2, null, null, null, 'AL_DIA', 'SEMANAS']
      );

      // 422, sin guardar nada
      const antes1 = await planesDeMaquina(m1);
      const antesI = await planesDeMaquina(mInactiva);
      const tareas51 = Array.from({ length: 51 }, () => tarea(hoy));
      const casos: Array<[string, Record<string, unknown>, string, number?]> = [
        ['nombre de 2 caracteres', { nombre: 'AB' }, 'DATOS_INVALIDOS'],
        ['sin tareas', { tareas: [] }, 'DATOS_INVALIDOS'],
        ['51 tareas', { tareas: tareas51 }, 'DATOS_INVALIDOS'],
        ['la segunda con 0 meses', { tareas: [tarea(hoy), tarea(hoy, { frecuencia_valor: 0 })] }, 'DATOS_INVALIDOS', 1],
        ['HORAS', { tareas: [tarea(hoy, { frecuencia_unidad: 'HORAS' })] }, 'DATOS_INVALIDOS', 0],
        ['2026-02-30', { tareas: [tarea('2026-02-30')] }, 'DATOS_INVALIDOS', 0],
        ['2026-2-1', { tareas: [tarea('2026-2-1')] }, 'DATOS_INVALIDOS', 0],
        ['a 11 años', { tareas: [tarea(sumarAnios(hoy, 11))] }, 'DATOS_INVALIDOS', 0],
        ['repuesto sin cantidad', { tareas: [tarea(hoy, { repuesto_id: repId })] }, 'DATOS_INVALIDOS', 0],
        ['repuesto inactivo', { tareas: [tarea(hoy), tarea(hoy, { repuesto_id: repInactivo, cantidad: 1 })] }, 'REPUESTO_INVALIDO', 1],
        ['proveedor inactivo', { tareas: [tarea(hoy, { proveedor_id: provInactivo })] }, 'PROVEEDOR_INVALIDO', 0],
        ['maquina_id: true', { maquina_id: true }, 'DATOS_INVALIDOS'],
        ['máquina inactiva', { maquina_id: mInactiva }, 'MAQUINA_INACTIVA'],
        ['responsable inactivo', { responsable_usuario_id: Ri.id }, 'RESPONSABLE_NO_HABILITADO'],
        ['anticipación 91', { anticipacion_dias: 91 }, 'DATOS_INVALIDOS'],
      ];
      for (const [nombre, cambios, codigo, indice] of casos) {
        const rr = await pedir('POST', '/api/planes', A.token, {
          maquina_id: m1,
          nombre: 'Plan con error',
          tareas: [tarea(hoy)],
          ...cambios,
        });
        assert.strictEqual(rr.status, 422, `${nombre}: ${JSON.stringify(rr.cuerpo)}`);
        assert.strictEqual(rr.cuerpo.codigo, codigo, `${nombre}: ${JSON.stringify(rr.cuerpo)}`);
        assert.strictEqual(rr.cuerpo.indice, indice, `${nombre}: indice`);
      }
      assert.strictEqual(await planesDeMaquina(m1), antes1, 'No se guardó ningún plan');
      assert.strictEqual(await planesDeMaquina(mInactiva), antesI);

      // El mismo nombre con la inicial en minúscula
      const dup = await pedir('POST', '/api/planes', A.token, { maquina_id: m1, nombre: 'lubricación PV', tareas: [tarea(hoy)] });
      assert.deepStrictEqual([dup.status, dup.cuerpo.codigo], [409, 'PLAN_DUPLICADO']);
      const otra = await pedir('POST', '/api/planes', A.token, { maquina_id: m2, nombre: 'lubricación PV', tareas: [tarea(hoy)] });
      assert.strictEqual(otra.status, 201, JSON.stringify(otra.cuerpo));
    });

    // =========================================================================
    // PV-03: Edición
    // =========================================================================
    await t.test('PV-03: Edición', async () => {
      const p = await crearPlan(m1, [tarea('2025-12-01'), tarea(sumarDias(hoy, 40))], { responsable_usuario_id: R.id });
      const otro = await crearPlan(m2, [tarea(hoy)]);
      const [tx, ty] = p.tareas;

      // nombre, responsable (también a null) y anticipación
      const r1 = await pedir('PATCH', `/api/planes/${p.id}`, A.token, { nombre: 'Plan PV editado', anticipacion_dias: 15, responsable_usuario_id: null });
      assert.strictEqual(r1.status, 200, JSON.stringify(r1.cuerpo));
      assert.deepStrictEqual([r1.cuerpo.nombre, r1.cuerpo.anticipacion_dias, r1.cuerpo.responsable], ['Plan PV editado', 15, null]);
      const r2 = await pedir('PATCH', `/api/planes/${p.id}`, A.token, { responsable_usuario_id: R2.id });
      assert.strictEqual(r2.status, 200, JSON.stringify(r2.cuerpo));
      assert.strictEqual(r2.cuerpo.responsable.id, R2.id);

      // maquina_id en el cuerpo: 422
      const r3 = await pedir('PATCH', `/api/planes/${p.id}`, A.token, { maquina_id: m2 });
      assert.deepStrictEqual([r3.status, r3.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);
      const r3b = await pedir('PATCH', `/api/planes/${p.id}`, A.token, { maquina_id: m1 });
      assert.strictEqual(r3b.status, 422, 'Aunque sea la misma máquina');

      // Una tarea más: queda última en el orden
      const r4 = await pedir('POST', `/api/planes/${p.id}/tareas`, A.token, tarea(hoy, { accion: 'Tarea agregada' }));
      assert.strictEqual(r4.status, 201, JSON.stringify(r4.cuerpo));
      const ultima = r4.cuerpo.tareas[r4.cuerpo.tareas.length - 1];
      assert.deepStrictEqual([ultima.accion, ultima.orden, r4.cuerpo.tareas.length], ['Tarea agregada', 3, 3]);

      // Editar la frecuencia de una tarea con una ejecución mueve su próxima fecha
      await ejecucion(m1, p.id, tx.id, '2026-01-10 12:00:00-03');
      const antes = (await pedir('GET', `/api/planes/${p.id}`, A.token)).cuerpo.tareas.find((x: any) => x.id === tx.id);
      assert.deepStrictEqual([antes.ultima_ejecucion, antes.proxima_fecha], ['2026-01-10', '2026-02-10']);
      const r5 = await pedir('PATCH', `/api/planes/${p.id}/tareas/${tx.id}`, A.token, { frecuencia_valor: 3 });
      assert.strictEqual(r5.status, 200, JSON.stringify(r5.cuerpo));
      const despues = r5.cuerpo.tareas.find((x: any) => x.id === tx.id);
      assert.deepStrictEqual([despues.frecuencia_valor, despues.proxima_fecha], [3, '2026-04-10']);
      // Cambiar primera_fecha ya no importa
      const r5b = await pedir('PATCH', `/api/planes/${p.id}/tareas/${tx.id}`, A.token, { primera_fecha: sumarDias(hoy, 100) });
      assert.strictEqual(r5b.cuerpo.tareas.find((x: any) => x.id === tx.id).proxima_fecha, '2026-04-10');
      // 521 semanas pasan el máximo
      const r5c = await pedir('PATCH', `/api/planes/${p.id}/tareas/${tx.id}`, A.token, { frecuencia_unidad: 'SEMANAS', frecuencia_valor: 521 });
      assert.strictEqual(r5c.status, 422);

      // Desactivar y reactivar el plan; repetir da 409
      const d1 = await pedir('POST', `/api/planes/${p.id}/desactivar`, A.token, {});
      assert.deepStrictEqual([d1.status, d1.cuerpo.activo], [200, false]);
      const d2 = await pedir('POST', `/api/planes/${p.id}/desactivar`, A.token, {});
      assert.deepStrictEqual([d2.status, d2.cuerpo.codigo], [409, 'PLAN_YA_INACTIVO']);
      const d3 = await pedir('POST', `/api/planes/${p.id}/reactivar`, A.token, {});
      assert.deepStrictEqual([d3.status, d3.cuerpo.activo], [200, true]);
      const d4 = await pedir('POST', `/api/planes/${p.id}/reactivar`, A.token, {});
      assert.deepStrictEqual([d4.status, d4.cuerpo.codigo], [409, 'PLAN_YA_ACTIVO']);

      // Y una tarea
      const e1 = await pedir('POST', `/api/planes/${p.id}/tareas/${ty.id}/desactivar`, A.token, {});
      assert.strictEqual(e1.status, 200);
      const ty1 = e1.cuerpo.tareas.find((x: any) => x.id === ty.id);
      assert.deepStrictEqual([ty1.activo, ty1.estado], [false, 'INACTIVA']);
      const e2 = await pedir('POST', `/api/planes/${p.id}/tareas/${ty.id}/desactivar`, A.token, {});
      assert.deepStrictEqual([e2.status, e2.cuerpo.codigo], [409, 'TAREA_YA_INACTIVA']);
      const e3 = await pedir('POST', `/api/planes/${p.id}/tareas/${ty.id}/reactivar`, A.token, {});
      assert.strictEqual(e3.status, 200);
      const e4 = await pedir('POST', `/api/planes/${p.id}/tareas/${ty.id}/reactivar`, A.token, {});
      assert.deepStrictEqual([e4.status, e4.cuerpo.codigo], [409, 'TAREA_YA_ACTIVA']);

      // Una tarea de otro plan en la ruta: 404
      const otraTarea = otro.tareas[0].id;
      for (const [metodo, ruta, cuerpo] of [
        ['PATCH', `/api/planes/${p.id}/tareas/${otraTarea}`, { accion: 'Cambio' }],
        ['POST', `/api/planes/${p.id}/tareas/${otraTarea}/desactivar`, {}],
      ] as Array<[string, string, unknown]>) {
        const rr = await pedir(metodo, ruta, A.token, cuerpo);
        assert.deepStrictEqual([rr.status, rr.cuerpo.codigo], [404, 'TAREA_NO_ENCONTRADA'], `${metodo} ${ruta}`);
      }
      const tOtro = (await pedir('GET', `/api/planes/${otro.id}`, A.token)).cuerpo.tareas[0];
      assert.deepStrictEqual([tOtro.accion, tOtro.activo], ['Revisar el equipo', true], 'La tarea del otro plan no cambió');
    });

    // =========================================================================
    // PV-04: Estado de las tareas
    // =========================================================================
    await t.test('PV-04: Estado de las tareas', async () => {
      const m4 = await crearMaquina('M4', s1);
      const p = await crearPlan(m4, [
        tarea(sumarDias(hoy, -3)),
        tarea(hoy),
        tarea(sumarDias(hoy, 7)),
        tarea(sumarDias(hoy, 8)),
      ], { anticipacion_dias: 7 });
      assert.deepStrictEqual(
        p.tareas.map((x: any) => [x.estado, x.dias]),
        [['VENCIDA', -3], ['PROXIMA', 0], ['PROXIMA', 7], ['AL_DIA', 8]]
      );

      const vencimientosDeM4 = async () =>
        (await pedir('GET', `/api/planes/vencimientos?maquina_id=${m4}&estado=VENCIDA,PROXIMA,EN_CURSO,AL_DIA`, A.token)).cuerpo.tareas;
      assert.strictEqual((await vencimientosDeM4()).length, 4);

      // Desactivar la máquina: INACTIVA en el detalle, y fuera de los vencimientos
      await client.query('UPDATE maquinas SET activo = FALSE WHERE id = $1', [m4]);
      const d = (await pedir('GET', `/api/planes/${p.id}`, A.token)).cuerpo;
      assert.deepStrictEqual(d.tareas.map((x: any) => x.estado), ['INACTIVA', 'INACTIVA', 'INACTIVA', 'INACTIVA']);
      assert.deepStrictEqual(await vencimientosDeM4(), []);
    });

    // =========================================================================
    // PV-05: Vencimientos
    // =========================================================================
    await t.test('PV-05: Vencimientos', async () => {
      // Dos máquinas de distinta criticidad, con una tarea a la misma fecha
      const m5n = await crearMaquina('M5N', s1, critNormal);
      const m5a = await crearMaquina('M5A', s2, critAlta);
      const misma = sumarDias(hoy, -5);
      const pn = await crearPlan(m5n, [
        tarea(misma, { accion: 'Normal misma fecha' }),
        tarea(sumarDias(hoy, -9), { accion: 'Normal antes' }),
        tarea(sumarDias(hoy, 2), { accion: 'Normal próxima' }),
        tarea(sumarDias(hoy, 60), { accion: 'Normal al día' }),
      ]);
      const pa = await crearPlan(m5a, [tarea(misma, { accion: 'Alta misma fecha' })]);
      const idDe = (plan: any, accion: string) => plan.tareas.find((x: any) => x.accion === accion).id;

      const venc = (consulta: string) => pedir('GET', `/api/planes/vencimientos?${consulta}`, A.token);

      // Sin estado, no trae las AL_DIA
      const r1 = await venc(`maquina_id=${m5n}`);
      assert.strictEqual(r1.status, 200, JSON.stringify(r1.cuerpo));
      assert.strictEqual(r1.cuerpo.hoy, hoy);
      assert.deepStrictEqual(
        r1.cuerpo.tareas.map((x: any) => x.accion),
        ['Normal antes', 'Normal misma fecha', 'Normal próxima']
      );
      const sinFiltro = await venc('limit=500');
      assert.ok(sinFiltro.cuerpo.tareas.every((x: any) => x.estado !== 'AL_DIA'), 'Por omisión, sin AL_DIA');

      // Con estado=AL_DIA, solo esas
      const r2 = await venc(`maquina_id=${m5n}&estado=AL_DIA`);
      assert.deepStrictEqual(r2.cuerpo.tareas.map((x: any) => [x.accion, x.estado]), [['Normal al día', 'AL_DIA']]);

      // estado=OTRO: 422
      const r3 = await venc('estado=OTRO');
      assert.deepStrictEqual([r3.status, r3.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);
      const r3b = await venc('estado=VENCIDA,INACTIVA');
      assert.strictEqual(r3b.status, 422);

      // Los filtros por máquina, sector y planta
      const todos = 'estado=VENCIDA,PROXIMA,EN_CURSO,AL_DIA&limit=500';
      const porSector = await venc(`sector_id=${s2}&${todos}`);
      assert.ok(porSector.cuerpo.tareas.length > 0);
      assert.ok(porSector.cuerpo.tareas.every((x: any) => x.sector.id === s2), 'Filtro por sector');
      assert.ok(porSector.cuerpo.tareas.some((x: any) => x.tarea_id === idDe(pa, 'Alta misma fecha')));
      const porPlanta = await venc(`planta_id=${pl1}&${todos}`);
      assert.ok(porPlanta.cuerpo.tareas.length > 0);
      assert.ok(porPlanta.cuerpo.tareas.every((x: any) => x.sector.id === s1), 'Filtro por planta: PL1 solo tiene S1');
      const porMaquina = await venc(`maquina_id=${m5a}&${todos}`);
      assert.deepStrictEqual(porMaquina.cuerpo.tareas.map((x: any) => x.maquina.id), [m5a]);
      const malFiltro = await venc('maquina_id=abc');
      assert.deepStrictEqual([malFiltro.status, malFiltro.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);

      // El elemento, completo
      const alta = porMaquina.cuerpo.tareas[0];
      assert.deepStrictEqual(alta, {
        tarea_id: idDe(pa, 'Alta misma fecha'),
        accion: 'Alta misma fecha',
        frecuencia_valor: 1,
        frecuencia_unidad: 'MESES',
        ultima_ejecucion: null,
        proxima_fecha: misma,
        dias: -5,
        estado: 'VENCIDA',
        intervencion_en_curso: null,
        plan: { id: pa.id, nombre: pa.nombre },
        maquina: {
          id: m5a,
          codigo: `PV_M5A_${suf}`,
          nombre: 'Maquina PV M5A',
          criticidad: {
            nombre: (await client.query('SELECT nombre FROM criticidades WHERE id = $1', [critAlta])).rows[0].nombre,
            prioridad_alta: true,
          },
        },
        sector: { id: s2, nombre: `PV_S2_${suf}` },
        responsable: null,
      });

      // El orden: por fecha; a igual fecha, primero la de prioridad alta
      const mias = [idDe(pn, 'Normal antes'), idDe(pa, 'Alta misma fecha'), idDe(pn, 'Normal misma fecha'), idDe(pn, 'Normal próxima')];
      const orden = sinFiltro.cuerpo.tareas.map((x: any) => x.tarea_id).filter((id: number) => mias.includes(id));
      assert.deepStrictEqual(orden, mias, 'El orden de la sección 5');

      // resumen cuenta igual con cualquier estado
      const esperado = { vencidas: 2, proximas: 1, en_curso: 0, al_dia: 1 };
      for (const estado of ['', '&estado=AL_DIA', '&estado=VENCIDA', '&estado=EN_CURSO,PROXIMA']) {
        const rr = await venc(`maquina_id=${m5n}${estado}`);
        assert.deepStrictEqual(rr.cuerpo.resumen, esperado, `resumen con ${estado || 'sin estado'}`);
      }

      // limit=1 con X-Total-Count
      const r4 = await venc(`maquina_id=${m5n}&limit=1`);
      assert.deepStrictEqual([r4.cuerpo.tareas.length, r4.total], [1, '3']);
      const r5 = await venc(`maquina_id=${m5n}&limit=1&offset=2`);
      assert.deepStrictEqual(r5.cuerpo.tareas.map((x: any) => x.accion), ['Normal próxima']);
      for (const malo of ['limit=0', 'limit=501', 'limit=1.5', 'offset=-1']) {
        assert.strictEqual((await venc(malo)).status, 422, malo);
      }
    });
  } finally {
    // Limpieza: solo lo que creó esta prueba
    try {
      const maquinas = createdMaquinaIds;
      const intIds = (await client.query('SELECT id FROM intervenciones WHERE maquina_id = ANY($1)', [maquinas])).rows.map((r) => Number(r.id));
      if (intIds.length > 0) {
        await client.query('DELETE FROM intervencion_tareas WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM intervencion_costos WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM pedidos_repuesto WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM intervencion_repuestos WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM movimientos_stock WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE intervencion_id = ANY($1))', [intIds]);
        await client.query('DELETE FROM notificaciones WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM intervencion_auditoria WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM documentos WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM intervencion_periodos_detencion WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM historial_estados_maquina WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM intervenciones WHERE id = ANY($1)', [intIds]);
      }
      if (maquinas.length > 0) {
        await client.query(
          'DELETE FROM plan_tareas WHERE plan_id IN (SELECT id FROM planes_mantenimiento WHERE maquina_id = ANY($1))',
          [maquinas]
        );
        await client.query('DELETE FROM planes_mantenimiento WHERE maquina_id = ANY($1)', [maquinas]);
        await client.query('DELETE FROM intervencion_periodos_detencion WHERE maquina_id = ANY($1)', [maquinas]);
        await client.query('DELETE FROM historial_estados_maquina WHERE maquina_id = ANY($1)', [maquinas]);
        await client.query('DELETE FROM maquinas WHERE id = ANY($1)', [maquinas]);
      }
      if (createdRepuestoIds.length > 0) {
        await client.query('DELETE FROM movimientos_stock WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM repuesto_costos WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM repuestos WHERE id = ANY($1)', [createdRepuestoIds]);
      }
      if (createdProveedorIds.length > 0) {
        await client.query('DELETE FROM proveedores WHERE id = ANY($1)', [createdProveedorIds]);
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

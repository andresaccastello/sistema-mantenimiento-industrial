import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';
import app from '../functions/api.ts';
import { JWT_SECRET } from '../functions/config.ts';
import { mismaForma } from './contrato.ts';
import {
  planDetalleEjemplo,
  planListaEjemplo,
  vencimientosEjemplo,
  generacionEjemplo,
  tareasIntervencionEjemplo,
  tareaMarcadaEjemplo,
} from '../../frontend/src/api/contrato-preventivos.ts';

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

/** La operación esperó el bloqueo más que el lock_timeout: no hizo nada y se puede reintentar (PV3.1, 3). */
const ocupado = (r: Respuesta) => r.status === 409 && r.cuerpo?.codigo === 'RECURSO_OCUPADO';

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

test('Etapa PV1 — Preventivos por calendario (PV-01 a PV-21)', async (t) => {
  let client = await pool.connect();

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
        ['POST', `/api/planes/${p1.id}/generar`, {}],
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
          tarea(primera, { accion: 'Cambiar el aceite', repuestos: [{ repuesto_id: repId, cantidad: 2.5 }], proveedor_id: provId, detalle: 'Con el equipo frío' }),
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
          repuestos: [{ repuesto: { id: repId, codigo: `PV_R1_${suf}`, nombre: `PV Aceite ${suf}`, unidad: 'litro' }, cantidad: 2.5 }],
          proveedor: { id: provId, nombre: `PV Proveedor ${suf}` },
          activo: true,
          ultima_ejecucion: null,
          proxima_fecha: primera,
          dias: -5,
          estado_fecha: 'VENCIDA',
          uso: null,
          estado: 'VENCIDA',
          intervencion_en_curso: null,
        }
      );
      assert.deepStrictEqual(
        [t1.orden, t1.repuestos, t1.proveedor, t1.estado, t1.frecuencia_unidad],
        [2, [], null, 'AL_DIA', 'SEMANAS']
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
        ['repuesto sin cantidad', { tareas: [tarea(hoy, { repuestos: [{ repuesto_id: repId }] })] }, 'DATOS_INVALIDOS', 0],
        ['repuesto inactivo', { tareas: [tarea(hoy), tarea(hoy, { repuestos: [{ repuesto_id: repInactivo, cantidad: 1 }] })] }, 'REPUESTO_INVALIDO', 1],
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

      // El nombre repetido con tildes (PV2, 1.4)
      const electrico = await pedir('POST', '/api/planes', A.token, { maquina_id: m1, nombre: 'Eléctrico', tareas: [tarea(hoy)] });
      assert.strictEqual(electrico.status, 201, JSON.stringify(electrico.cuerpo));
      const mayusculas = await pedir('POST', '/api/planes', A.token, { maquina_id: m1, nombre: 'ELÉCTRICO', tareas: [tarea(hoy)] });
      assert.deepStrictEqual([mayusculas.status, mayusculas.cuerpo.codigo], [409, 'PLAN_DUPLICADO']);
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
        estado_fecha: 'VENCIDA',
        uso: null,
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
      const esperado = { vencidas: 2, proximas: 1, en_curso: 0, sin_lectura: 0, al_dia: 1 };
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

    // -------------------------------------------------------------------------
    // Helpers de las intervenciones preventivas (PV-06 a PV-12)
    // -------------------------------------------------------------------------
    const generar = (planId: number, body?: unknown, token = A.token) =>
      pedir('POST', `/api/planes/${planId}/generar`, token, body);
    async function generarOk(planId: number, body?: unknown, token = A.token) {
      const r = await generar(planId, body, token);
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      return r.cuerpo;
    }
    const accion = (id: number, nombre: string, body: unknown, token = R.token) =>
      pedir('POST', `/api/intervenciones/${id}/${nombre}`, token, body);
    async function accionOk(id: number, nombre: string, body: unknown, token = R.token) {
      const r = await accion(id, nombre, body, token);
      assert.strictEqual(r.status, 200, `${nombre}: ${JSON.stringify(r.cuerpo)}`);
    }
    const iniciar = (id: number) => accionOk(id, 'iniciar', { estado_esperado: 'PENDIENTE' });
    const finalizar = (id: number) =>
      accionOk(id, 'finalizar', { estado_esperado: 'EN_PROCESO', trabajo_realizado: 'Preventivo hecho', ejecucion: 'INTERNA' });
    const marcar = (intId: number, tareaId: number, body: unknown, token = R.token) =>
      pedir('PATCH', `/api/intervenciones/${intId}/tareas/${tareaId}`, token, body);
    const tareasDe = (intId: number, token = A.token) => pedir('GET', `/api/intervenciones/${intId}/tareas`, token);
    const detallePlan = async (planId: number) => (await pedir('GET', `/api/planes/${planId}`, A.token)).cuerpo;
    const tareaDelPlan = async (planId: number, tareaId: number) =>
      (await detallePlan(planId)).tareas.find((x: any) => x.id === tareaId);
    const intervencionesDelPlan = async (planId: number) =>
      Number((await client.query('SELECT count(*)::int AS n FROM intervenciones WHERE plan_mantenimiento_id = $1', [planId])).rows[0].n);
    /** hoy más un intervalo de PostgreSQL, como YYYY-MM-DD. */
    const hoyMas = async (intervalo: string) =>
      (await client.query(`SELECT to_char(($1::date + $2::interval)::date, 'YYYY-MM-DD') AS f`, [hoy, intervalo])).rows[0].f as string;

    // =========================================================================
    // PV-06: Generar
    // =========================================================================
    await t.test('PV-06: Generar', async () => {
      const p = await crearPlan(m1, [
        tarea(sumarDias(hoy, -3), { accion: 'Vencida' }),
        tarea(hoy, { accion: 'Próxima hoy' }),
        tarea(sumarDias(hoy, 5), { accion: 'Próxima en 5', detalle: 'Con cuidado' }),
        tarea(sumarDias(hoy, 30), { accion: 'Al día' }),
      ], { responsable_usuario_id: R.id, anticipacion_dias: 7 });
      const [tv, tp0, tp5, tad] = p.tareas.map((x: any) => x.id);

      // Sin cuerpo: la vencida y las próximas, no la AL_DIA
      const g = await generarOk(p.id);
      const intId = g.intervencion.id;
      assert.deepStrictEqual(g.intervencion, {
        id: intId,
        estado: 'PENDIENTE',
        responsable: { id: R.id, legajo: `PV_R_${suf}`, nombre: 'Resp', apellido: 'PV' },
      });
      assert.strictEqual(g.responsable_omitido, false);
      assert.deepStrictEqual(
        g.tareas.map((x: any) => ({ ...x, id: 0 })),
        [
          { id: 0, plan_tarea_id: tv, orden: 1, accion: 'Vencida', fecha_programada: sumarDias(hoy, -3) },
          { id: 0, plan_tarea_id: tp0, orden: 2, accion: 'Próxima hoy', fecha_programada: hoy },
          { id: 0, plan_tarea_id: tp5, orden: 3, accion: 'Próxima en 5', fecha_programada: sumarDias(hoy, 5) },
        ]
      );

      // La intervención: PREVENTIVO, PENDIENTE, con el plan, la descripción y el historial
      const resI = await client.query(
        `SELECT i.estado, ti.codigo AS tipo, i.plan_mantenimiento_id, i.descripcion, i.creado_por_usuario_id,
                i.responsable_usuario_id
         FROM intervenciones i JOIN tipos_intervencion ti ON ti.id = i.tipo_intervencion_id WHERE i.id = $1`,
        [intId]
      );
      assert.deepStrictEqual(resI.rows[0], {
        estado: 'PENDIENTE',
        tipo: 'PREVENTIVO',
        plan_mantenimiento_id: String(p.id),
        descripcion: `Preventivo: ${p.nombre}. Tareas: Vencida; Próxima hoy; Próxima en 5.`,
        creado_por_usuario_id: String(A.id),
        responsable_usuario_id: String(R.id),
      });
      const resH = await client.query(
        'SELECT estado_anterior, estado_nuevo, observacion, cambiado_por_usuario_id FROM historial_estados_intervencion WHERE intervencion_id = $1',
        [intId]
      );
      assert.deepStrictEqual(resH.rows, [{
        estado_anterior: null,
        estado_nuevo: 'PENDIENTE',
        observacion: `Generada desde el plan «${p.nombre}»`,
        cambiado_por_usuario_id: String(A.id),
      }]);
      const resT = await client.query(
        `SELECT plan_tarea_id, orden, accion, detalle, to_char(fecha_programada, 'YYYY-MM-DD') AS fp, hecha
         FROM intervencion_tareas WHERE intervencion_id = $1 ORDER BY orden`,
        [intId]
      );
      assert.deepStrictEqual(resT.rows[2], {
        plan_tarea_id: String(tp5), orden: 3, accion: 'Próxima en 5', detalle: 'Con cuidado', fp: sumarDias(hoy, 5), hecha: false,
      });

      // El responsable: auditoría ASIGNACION y una notificación para él, ninguna para quien genera
      const resA = await client.query(
        'SELECT tipo_evento, valor_anterior, valor_nuevo, motivo, realizado_por_usuario_id FROM intervencion_auditoria WHERE intervencion_id = $1',
        [intId]
      );
      assert.deepStrictEqual(resA.rows, [{
        tipo_evento: 'ASIGNACION',
        valor_anterior: null,
        valor_nuevo: String(R.id),
        motivo: 'Responsable del plan preventivo',
        realizado_por_usuario_id: String(A.id),
      }]);
      const resN = await client.query(
        'SELECT usuario_id, tipo_evento FROM notificaciones WHERE intervencion_id = $1 ORDER BY id',
        [intId]
      );
      assert.deepStrictEqual(resN.rows, [{ usuario_id: String(R.id), tipo_evento: 'INTERVENCION_ASIGNADA' }]);

      // Esas tareas pasan a EN_CURSO; generar otra vez: 409
      const d = await detallePlan(p.id);
      assert.deepStrictEqual(
        d.tareas.map((x: any) => [x.estado, x.intervencion_en_curso]),
        [
          ['EN_CURSO', { id: intId, estado: 'PENDIENTE' }],
          ['EN_CURSO', { id: intId, estado: 'PENDIENTE' }],
          ['EN_CURSO', { id: intId, estado: 'PENDIENTE' }],
          ['AL_DIA', null],
        ]
      );
      assert.deepStrictEqual(d.intervenciones.map((x: any) => x.id), [intId]);
      const otra = await generar(p.id);
      assert.deepStrictEqual([otra.status, otra.cuerpo.codigo], [409, 'SIN_TAREAS_PARA_GENERAR']);

      // Con tarea_ids de una AL_DIA: 201
      const g2 = await generarOk(p.id, { tarea_ids: [tad] });
      assert.deepStrictEqual(g2.tareas.map((x: any) => x.plan_tarea_id), [tad]);

      // Una en curso: 409 con sus detalles
      const enCurso = await generar(p.id, { tarea_ids: [tv] });
      assert.deepStrictEqual(
        [enCurso.status, enCurso.cuerpo.codigo, enCurso.cuerpo.tarea_id, enCurso.cuerpo.intervencion_id],
        [409, 'TAREA_EN_CURSO', tv, intId]
      );

      // Una de otro plan, o inactiva: 422 TAREA_INVALIDA
      const otroPlan = await crearPlan(m1, [tarea(hoy)]);
      const ajena = otroPlan.tareas[0].id;
      const rAjena = await generar(p.id, { tarea_ids: [ajena] });
      assert.deepStrictEqual([rAjena.status, rAjena.cuerpo.codigo, rAjena.cuerpo.tarea_id], [422, 'TAREA_INVALIDA', ajena]);
      const conNueva = await pedir('POST', `/api/planes/${p.id}/tareas`, A.token, tarea(hoy, { accion: 'Se desactiva' }));
      const inactiva = conNueva.cuerpo.tareas[conNueva.cuerpo.tareas.length - 1].id;
      assert.strictEqual((await pedir('POST', `/api/planes/${p.id}/tareas/${inactiva}/desactivar`, A.token, {})).status, 200);
      const rInactiva = await generar(p.id, { tarea_ids: [inactiva] });
      assert.deepStrictEqual([rInactiva.status, rInactiva.cuerpo.codigo, rInactiva.cuerpo.tarea_id], [422, 'TAREA_INVALIDA', inactiva]);

      // tarea_ids con repetidos, con un id como texto, vacío o que no es un arreglo: 422
      for (const tareaIds of [[ajena, ajena], [String(ajena)], [], ajena, [true]]) {
        const rr = await generar(otroPlan.id, { tarea_ids: tareaIds });
        assert.deepStrictEqual([rr.status, rr.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], JSON.stringify(tareaIds));
      }
      assert.strictEqual(await intervencionesDelPlan(otroPlan.id), 0, 'Nada se generó con los errores');

      // Plan inactivo: 409. Máquina inactiva: 422.
      assert.strictEqual((await pedir('POST', `/api/planes/${otroPlan.id}/desactivar`, A.token, {})).status, 200);
      const rPlanInactivo = await generar(otroPlan.id);
      assert.deepStrictEqual([rPlanInactivo.status, rPlanInactivo.cuerpo.codigo], [409, 'PLAN_INACTIVO']);
      const m6 = await crearMaquina('M6', s1);
      const pM6 = await crearPlan(m6, [tarea(hoy)]);
      await client.query('UPDATE maquinas SET activo = FALSE WHERE id = $1', [m6]);
      const rMaqInactiva = await generar(pM6.id);
      assert.deepStrictEqual([rMaqInactiva.status, rMaqInactiva.cuerpo.codigo], [422, 'MAQUINA_INACTIVA']);
      assert.strictEqual(await intervencionesDelPlan(otroPlan.id), 0);
      assert.strictEqual(await intervencionesDelPlan(pM6.id), 0);

      // Un responsable del plan desactivado después: 201, sin responsable
      const Rx = await crearUsuario('Rx', 'RespTemporal', 'RESPONSABLE_MANTENIMIENTO', [s1, s2]);
      const pRx = await crearPlan(m1, [tarea(hoy)], { responsable_usuario_id: Rx.id });
      await client.query('UPDATE usuarios SET activo = FALSE WHERE id = $1', [Rx.id]);
      const gRx = await generarOk(pRx.id);
      assert.deepStrictEqual([gRx.intervencion.responsable, gRx.responsable_omitido], [null, true]);
      const resRx = await client.query(
        'SELECT responsable_usuario_id FROM intervenciones WHERE id = $1', [gRx.intervencion.id]
      );
      assert.strictEqual(resRx.rows[0].responsable_usuario_id, null);
      const audRx = await client.query('SELECT count(*)::int AS n FROM intervencion_auditoria WHERE intervencion_id = $1', [gRx.intervencion.id]);
      assert.strictEqual(audRx.rows[0].n, 0);

      // Ninguna FALLA_REGISTRADA para las generadas
      const fallas = await client.query(
        `SELECT count(*)::int AS n FROM notificaciones
         WHERE tipo_evento = 'FALLA_REGISTRADA' AND intervencion_id IN (SELECT id FROM intervenciones WHERE plan_mantenimiento_id IS NOT NULL AND maquina_id = ANY($1))`,
        [createdMaquinaIds]
      );
      assert.strictEqual(fallas.rows[0].n, 0);
    });

    // =========================================================================
    // PV-07: Marcar tareas
    // =========================================================================
    await t.test('PV-07: Marcar tareas', async () => {
      const p = await crearPlan(m1, [
        tarea(sumarDias(hoy, -1), { accion: 'Tarea X' }),
        tarea(sumarDias(hoy, -1), { accion: 'Tarea Y' }),
      ], { responsable_usuario_id: R.id });
      const g = await generarOk(p.id);
      const intId = g.intervencion.id;
      const [x, y] = g.tareas;

      // En PENDIENTE, el responsable R marca
      const r1 = await marcar(intId, x.id, { hecha: true, observacion: 'Sin novedades' });
      assert.strictEqual(r1.status, 200, JSON.stringify(r1.cuerpo));
      assert.deepStrictEqual(
        [r1.cuerpo.hecha, r1.cuerpo.hecha_por, r1.cuerpo.observacion, typeof r1.cuerpo.hecha_en, r1.cuerpo.proxima_fecha],
        [true, { id: R.id, legajo: `PV_R_${suf}`, nombre: 'Resp', apellido: 'PV' }, 'Sin novedades', 'string', sumarDias(hoy, -1)]
      );

      // R2 y O: 403
      for (const [quien, token] of [['R2', R2.token], ['O', O.token]]) {
        const rr = await marcar(intId, y.id, { hecha: true }, token);
        assert.deepStrictEqual([rr.status, rr.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE'], quien);
      }

      // hecha: "true", y una observación de 501 caracteres: 422
      const r2 = await marcar(intId, y.id, { hecha: 'true' });
      assert.deepStrictEqual([r2.status, r2.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);
      const r3 = await marcar(intId, y.id, { hecha: true, observacion: 'x'.repeat(501) });
      assert.deepStrictEqual([r3.status, r3.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);

      // Repetir el mismo valor: 200, sin cambios
      const fila = async (id: number) =>
        (await client.query('SELECT hecha, hecha_por_usuario_id, hecha_en, observacion FROM intervencion_tareas WHERE id = $1', [id])).rows[0];
      const antes = await fila(x.id);
      const r4 = await marcar(intId, x.id, { hecha: true }, A.token);
      assert.strictEqual(r4.status, 200);
      assert.deepStrictEqual(await fila(x.id), antes, 'Nada cambió');
      assert.strictEqual((await fila(y.id)).hecha, false, 'Los rechazos no cambiaron Y');

      // Una tarea de otra intervención: 404
      const pOtro = await crearPlan(m1, [tarea(hoy)]);
      const gOtro = await generarOk(pOtro.id);
      const r5 = await marcar(intId, gOtro.tareas[0].id, { hecha: true });
      assert.deepStrictEqual([r5.status, r5.cuerpo.codigo], [404, 'TAREA_NO_ENCONTRADA']);

      // Cancelada: 409
      await accionOk(gOtro.intervencion.id, 'cancelar', { estado_esperado: 'PENDIENTE', motivo: 'Cancelada prueba PV' }, A.token);
      const r6 = await marcar(gOtro.intervencion.id, gOtro.tareas[0].id, { hecha: true }, A.token);
      assert.deepStrictEqual([r6.status, r6.cuerpo.codigo], [409, 'ESTADO_NO_PERMITE_TAREAS']);

      // Finalizada
      await iniciar(intId);
      await finalizar(intId);
      const auditorias = async () =>
        (await client.query(
          `SELECT valor_nuevo, motivo, realizado_por_usuario_id FROM intervencion_auditoria
           WHERE intervencion_id = $1 AND tipo_evento = 'CORRECCION_TAREA' ORDER BY id`,
          [intId]
        )).rows;

      const r7 = await marcar(intId, y.id, { hecha: true, motivo: 'Se hizo y no se marcó' }, R.token);
      assert.deepStrictEqual([r7.status, r7.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE'], 'R sin INTERVENCIONES_CORREGIR');
      const r8 = await marcar(intId, y.id, { hecha: true }, A.token);
      assert.deepStrictEqual([r8.status, r8.cuerpo.codigo], [422, 'MOTIVO_REQUERIDO']);
      assert.deepStrictEqual(await auditorias(), []);

      const antesY = await tareaDelPlan(p.id, y.plan_tarea_id);
      assert.deepStrictEqual([antesY.ultima_ejecucion, antesY.estado], [null, 'VENCIDA']);
      const r9 = await marcar(intId, y.id, { hecha: true, motivo: 'Se hizo y no se marcó' }, A.token);
      assert.strictEqual(r9.status, 200, JSON.stringify(r9.cuerpo));
      const proxima = await hoyMas('1 month');
      assert.deepStrictEqual([r9.cuerpo.hecha, r9.cuerpo.hecha_por.id, r9.cuerpo.proxima_fecha], [true, A.id, proxima]);
      const despuesY = await tareaDelPlan(p.id, y.plan_tarea_id);
      assert.deepStrictEqual([despuesY.ultima_ejecucion, despuesY.proxima_fecha, despuesY.estado], [hoy, proxima, 'AL_DIA']);

      // La observación con la intervención finalizada también queda en la auditoría
      const r10 = await marcar(intId, y.id, { hecha: true, observacion: 'Faltó el filtro', motivo: 'Dato del técnico' }, A.token);
      assert.strictEqual(r10.status, 200);
      assert.deepStrictEqual(await auditorias(), [
        { valor_nuevo: 'Se marcó como hecha: Tarea Y', motivo: 'Se hizo y no se marcó', realizado_por_usuario_id: String(A.id) },
        { valor_nuevo: 'Se cambió la observación: Tarea Y', motivo: 'Dato del técnico', realizado_por_usuario_id: String(A.id) },
      ]);

      // Desmarcar: vuelve a VENCIDA
      const r11 = await marcar(intId, y.id, { hecha: false, motivo: 'Se marcó por error' }, A.token);
      assert.deepStrictEqual([r11.status, r11.cuerpo.hecha, r11.cuerpo.hecha_por, r11.cuerpo.hecha_en], [200, false, null, null]);
      assert.strictEqual((await auditorias())[2].valor_nuevo, 'Se desmarcó: Tarea Y');
      assert.strictEqual((await tareaDelPlan(p.id, y.plan_tarea_id)).estado, 'VENCIDA');
    });

    // =========================================================================
    // PV-08: La próxima fecha se mueve sola
    // =========================================================================
    await t.test('PV-08: La próxima fecha se mueve sola', async () => {
      const p = await crearPlan(m1, [
        tarea(sumarDias(hoy, -10), { accion: 'Tarea X', frecuencia_valor: 2 }),
        tarea(sumarDias(hoy, -10), { accion: 'Tarea Y' }),
      ], { responsable_usuario_id: R.id });
      const g = await generarOk(p.id);
      const intId = g.intervencion.id;
      const [x, y] = g.tareas;

      // Finalizar con X hecha e Y sin marcar
      await iniciar(intId);
      assert.strictEqual((await marcar(intId, x.id, { hecha: true })).status, 200);
      await finalizar(intId);
      const enDos = await hoyMas('2 months');
      const fx = await tareaDelPlan(p.id, x.plan_tarea_id);
      assert.deepStrictEqual([fx.ultima_ejecucion, fx.proxima_fecha, fx.estado], [hoy, enDos, 'AL_DIA']);
      const fy = await tareaDelPlan(p.id, y.plan_tarea_id);
      assert.deepStrictEqual([fy.ultima_ejecucion, fy.estado, fy.intervencion_en_curso], [null, 'VENCIDA', null]);

      // Reabrir: X vuelve a su próxima fecha anterior y a EN_CURSO
      await accionOk(intId, 'reabrir', { estado_esperado: 'FINALIZADA', motivo: 'Sigue perdiendo aceite', maquina_detenida: false });
      const rx = await tareaDelPlan(p.id, x.plan_tarea_id);
      assert.deepStrictEqual(
        [rx.ultima_ejecucion, rx.proxima_fecha, rx.estado, rx.intervencion_en_curso?.id],
        [null, sumarDias(hoy, -10), 'EN_CURSO', intId]
      );

      // Cancelar otra intervención preventiva: sus tareas vuelven a estar disponibles
      const p2 = await crearPlan(m1, [tarea(sumarDias(hoy, -2), { accion: 'Tarea Z' })], { responsable_usuario_id: R.id });
      const z = p2.tareas[0].id;
      const g2 = await generarOk(p2.id);
      assert.strictEqual((await tareaDelPlan(p2.id, z)).estado, 'EN_CURSO');
      await accionOk(g2.intervencion.id, 'cancelar', { estado_esperado: 'PENDIENTE', motivo: 'Se reprograma' });
      assert.strictEqual((await tareaDelPlan(p2.id, z)).estado, 'VENCIDA');
      const g3 = await generarOk(p2.id);
      assert.deepStrictEqual(g3.tareas.map((t3: any) => t3.plan_tarea_id), [z]);

      // Eliminar una: lo mismo
      await accionOk(g3.intervencion.id, 'eliminar', { motivo: 'Generada de más' });
      assert.strictEqual((await tareaDelPlan(p2.id, z)).estado, 'VENCIDA');
      const g4 = await generarOk(p2.id);
      assert.deepStrictEqual(g4.tareas.map((t4: any) => t4.plan_tarea_id), [z]);
      // La eliminada no aparece en las del plan
      const ids = (await detallePlan(p2.id)).intervenciones.map((i: any) => i.id);
      assert.deepStrictEqual(ids, [g4.intervencion.id, g2.intervencion.id]);
    });

    // =========================================================================
    // PV-09: Concurrencia
    // =========================================================================
    await t.test('PV-09: Concurrencia', async () => {
      for (let vuelta = 1; vuelta <= 10; vuelta++) {
        // Dos generar a la vez del mismo plan
        const p = await crearPlan(m1, [tarea(sumarDias(hoy, -1)), tarea(hoy)]);
        const [a, b] = await Promise.all([generar(p.id), generar(p.id)]);
        const estados = [a.status, b.status].sort();
        assert.deepStrictEqual(estados, [201, 409], `Vuelta ${vuelta}: ${JSON.stringify([a.cuerpo, b.cuerpo])}`);
        const perdedor = a.status === 409 ? a : b;
        // Contra Neon, el que espera el bloqueo puede pasar el lock_timeout: no hizo nada (PV3.1, 3)
        assert.ok(['SIN_TAREAS_PARA_GENERAR', 'RECURSO_OCUPADO'].includes(perdedor.cuerpo.codigo), `Vuelta ${vuelta}: ${perdedor.cuerpo.codigo}`);
        assert.strictEqual(await intervencionesDelPlan(p.id), 1, `Vuelta ${vuelta}: una sola intervención`);
        const resUna = await client.query(
          `SELECT plan_tarea_id, count(*)::int AS n FROM intervencion_tareas
           WHERE plan_tarea_id = ANY($1) GROUP BY plan_tarea_id`,
          [p.tareas.map((x: any) => x.id)]
        );
        assert.deepStrictEqual(resUna.rows.map((r) => r.n), [1, 1], `Vuelta ${vuelta}: cada tarea en una sola intervención`);

        // Generar y desactivar el plan a la vez
        const q = await crearPlan(m1, [tarea(sumarDias(hoy, -1))]);
        const [gen, des] = await Promise.all([generar(q.id), pedir('POST', `/api/planes/${q.id}/desactivar`, A.token, {})]);
        const generadas = await intervencionesDelPlan(q.id);
        if (ocupado(des)) {
          // Desactivar perdió la carrera por el lock_timeout: el plan sigue activo
          assert.deepStrictEqual([gen.status, generadas], [201, 1], `Vuelta ${vuelta}: ${JSON.stringify(gen.cuerpo)}`);
          assert.strictEqual((await detallePlan(q.id)).activo, true, `Vuelta ${vuelta}`);
        } else {
          assert.strictEqual(des.status, 200, `Vuelta ${vuelta}: ${JSON.stringify(des.cuerpo)}`);
          if (gen.status === 201) {
            assert.strictEqual(generadas, 1, `Vuelta ${vuelta}`);
          } else {
            assert.strictEqual(gen.status, 409, `Vuelta ${vuelta}: ${JSON.stringify(gen.cuerpo)}`);
            assert.ok(['PLAN_INACTIVO', 'RECURSO_OCUPADO'].includes(gen.cuerpo.codigo), `Vuelta ${vuelta}: ${gen.cuerpo.codigo}`);
            assert.strictEqual(generadas, 0, `Vuelta ${vuelta}: ninguna generada`);
          }
          assert.strictEqual((await detallePlan(q.id)).activo, false);
        }

        // Dos altas a la vez con el mismo nombre en la misma máquina
        const cuerpo = { maquina_id: m1, nombre: `Plan simultáneo ${vuelta}`, tareas: [tarea(hoy)] };
        const [c1, c2] = await Promise.all([
          pedir('POST', '/api/planes', A.token, cuerpo),
          pedir('POST', '/api/planes', A.token, { ...cuerpo, nombre: `plan simultáneo ${vuelta}` }),
        ]);
        assert.deepStrictEqual([c1.status, c2.status].sort(), [201, 409], `Vuelta ${vuelta}: ${JSON.stringify([c1.cuerpo, c2.cuerpo])}`);
        const codigoAlta = (c1.status === 409 ? c1 : c2).cuerpo.codigo;
        assert.ok(['PLAN_DUPLICADO', 'RECURSO_OCUPADO'].includes(codigoAlta), `Vuelta ${vuelta}: ${codigoAlta}`);
        const conEseNombre = (await client.query(
          'SELECT count(*)::int AS n FROM planes_mantenimiento WHERE maquina_id = $1 AND lower(nombre) = lower($2)',
          [m1, cuerpo.nombre]
        )).rows[0].n;
        assert.strictEqual(conEseNombre, 1, `Vuelta ${vuelta}: nada duplicado`);
      }
    });

    // =========================================================================
    // PV-10: tipo y plan
    // =========================================================================
    await t.test('PV-10: tipo y plan', async () => {
      const m7 = await crearMaquina('M7', s1);
      const rFalla = await pedir('POST', '/api/intervenciones', O.token, { maquina_id: m7, descripcion: 'Falla prueba PV' });
      assert.strictEqual(rFalla.status, 201, JSON.stringify(rFalla.cuerpo));
      const correctiva = rFalla.cuerpo.id;
      const p = await crearPlan(m7, [tarea(hoy)]);
      const preventiva = (await generarOk(p.id)).intervencion.id;

      const lista = (await pedir('GET', `/api/intervenciones?maquina_id=${m7}`, A.token)).cuerpo;
      const enLista = (id: number) => lista.find((i: any) => i.id === id);
      assert.deepStrictEqual([enLista(correctiva).tipo, enLista(correctiva).plan], ['CORRECTIVO', null]);
      assert.deepStrictEqual([enLista(preventiva).tipo, enLista(preventiva).plan], ['PREVENTIVO', { id: p.id, nombre: p.nombre }]);

      const detC = (await pedir('GET', `/api/intervenciones/${correctiva}`, A.token)).cuerpo;
      assert.deepStrictEqual([detC.tipo, detC.plan], ['CORRECTIVO', null]);
      const detP = (await pedir('GET', `/api/intervenciones/${preventiva}`, A.token)).cuerpo;
      assert.deepStrictEqual([detP.tipo, detP.plan], ['PREVENTIVO', { id: p.id, nombre: p.nombre }]);

      const soloPrev = (await pedir('GET', `/api/intervenciones?maquina_id=${m7}&tipo=PREVENTIVO`, A.token)).cuerpo;
      assert.deepStrictEqual(soloPrev.map((i: any) => i.id), [preventiva]);
    });

    // =========================================================================
    // PV-11: puede_marcar
    // =========================================================================
    await t.test('PV-11: puede_marcar', async () => {
      const p = await crearPlan(m1, [tarea(sumarDias(hoy, -1), { accion: 'Tarea PV-11' })], { responsable_usuario_id: R.id });
      const g = await generarOk(p.id);
      const intId = g.intervencion.id;
      const tareaId = g.tareas[0].id;
      await iniciar(intId);

      const usuarios: Array<[string, string]> = [['A', A.token], ['R', R.token], ['R2', R2.token], ['O', O.token]];
      const comparar = async (estado: string, esperado: Record<string, boolean>) => {
        for (const [quien, token] of usuarios) {
          const get = await tareasDe(intId, token);
          // El mismo valor que ya tiene: si puede, responde 200 sin cambiar nada
          const patch = await marcar(intId, tareaId, { hecha: false, motivo: 'Control de PV-11' }, token);
          if (quien === 'O') {
            // O no ve la intervención: 404 en el GET y 403 en el PATCH
            assert.strictEqual(get.status, 404, `${estado} ${quien}`);
            assert.strictEqual(patch.status, 403, `${estado} ${quien}`);
            continue;
          }
          assert.strictEqual(get.status, 200, `${estado} ${quien}`);
          assert.strictEqual(get.cuerpo.puede_marcar, esperado[quien], `${estado} ${quien}: puede_marcar`);
          assert.strictEqual(patch.status === 200, get.cuerpo.puede_marcar, `${estado} ${quien}: el PATCH dio ${patch.status}`);
        }
      };

      await comparar('EN_PROCESO', { A: true, R: true, R2: false });
      await finalizar(intId);
      await comparar('FINALIZADA', { A: true, R: false, R2: false });

      // Una intervención sin plan: sin tareas y sin marcar
      const rFalla = await pedir('POST', '/api/intervenciones', O.token, { maquina_id: m1, descripcion: 'Falla prueba PV-11' });
      const sinPlan = await tareasDe(rFalla.cuerpo.id);
      assert.deepStrictEqual(sinPlan.cuerpo, { tareas: [], resumen: { total: 0, hechas: 0, previstos_sin_confirmar: 0 }, puede_marcar: false });
    });

    // =========================================================================
    // PV-12: Contrato
    // =========================================================================
    await t.test('PV-12: Contrato', async () => {
      const p = await crearPlan(m1, [
        tarea(sumarDias(hoy, -3), { accion: 'Cambiar el aceite', detalle: 'Con el equipo frío', repuestos: [{ repuesto_id: repId, cantidad: 2.5 }], proveedor_id: provId }),
      ], { responsable_usuario_id: R.id, descripcion: 'Plan del contrato' });
      const g = await generarOk(p.id);
      await iniciar(g.intervencion.id);
      const [previstoContrato] = (await tareasDe(g.intervencion.id)).cuerpo.tareas[0].repuestos_previstos;
      const marcada = await marcar(g.intervencion.id, g.tareas[0].id, {
        hecha: true,
        observacion: 'Sin novedades',
        repuestos: [{ id: previstoContrato.id, cantidad: 2 }],
      });
      assert.strictEqual(marcada.status, 200, JSON.stringify(marcada.cuerpo));

      const detalle = await detallePlan(p.id);
      const lista = (await pedir('GET', `/api/planes?maquina_id=${m1}`, A.token)).cuerpo.find((x: any) => x.id === p.id);
      const vencimientos = (await pedir('GET', `/api/planes/vencimientos?maquina_id=${m1}&estado=EN_CURSO`, A.token)).cuerpo;
      vencimientos.tareas = vencimientos.tareas.filter((x: any) => x.plan.id === p.id);
      const tareas = (await tareasDe(g.intervencion.id)).cuerpo;

      const verificar = (ruta: string, real: unknown, ejemplo: unknown) => {
        const diferencias = mismaForma(real, ejemplo);
        assert.deepStrictEqual(diferencias, [], `${ruta}:\n${diferencias.join('\n')}`);
      };
      verificar('GET /api/planes/:id', detalle, planDetalleEjemplo);
      verificar('GET /api/planes (un elemento)', lista, planListaEjemplo);
      verificar('GET /api/planes/vencimientos', vencimientos, vencimientosEjemplo);
      verificar('POST /api/planes/:id/generar', g, generacionEjemplo);
      verificar('GET /api/intervenciones/:id/tareas', tareas, tareasIntervencionEjemplo);
    });

    // =========================================================================
    // PV-13: Responsables para un plan (PV2, 1.1)
    // =========================================================================
    await t.test('PV-13: Responsables para un plan', async () => {
      // Un responsable con INTERVENCIONES_VER en alcance SECTORES, solo del sector 2
      const Rs = await crearUsuario('Rs', 'RespSector', 'RESPONSABLE_MANTENIMIENTO', [s2]);
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
         VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Solo su sector', $3)`,
        [Rs.id, permMap['INTERVENCIONES_VER'], A.id]
      );

      const r = await pedir('GET', `/api/planes/responsables-habilitados?maquina_id=${m1}`, A.token);
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      const ids = r.cuerpo.map((u: any) => u.id);

      // Los mismos usuarios que el endpoint de intervenciones, para una intervención de esa máquina
      const rFalla = await pedir('POST', '/api/intervenciones', O.token, { maquina_id: m1, descripcion: 'Falla prueba PV-13' });
      assert.strictEqual(rFalla.status, 201, JSON.stringify(rFalla.cuerpo));
      const deIntervencion = await pedir('GET', `/api/intervenciones/${rFalla.cuerpo.id}/responsables-habilitados`, A.token);
      assert.strictEqual(deIntervencion.status, 200);
      assert.deepStrictEqual(
        [...ids].sort((a, b) => a - b),
        deIntervencion.cuerpo.map((u: any) => u.id).sort((a: number, b: number) => a - b)
      );

      // Con R y R2, sin O, sin el inactivo y sin el de otro sector
      const rr = r.cuerpo.find((u: any) => u.id === R.id);
      assert.deepStrictEqual(rr, { id: R.id, legajo: `PV_R_${suf}`, nombre: 'Resp', apellido: 'PV' });
      assert.ok(ids.includes(R2.id));
      for (const [quien, id] of [['O', O.id], ['Ri', Ri.id], ['Rs', Rs.id]] as Array<[string, number]>) {
        assert.ok(!ids.includes(id), `${quien} no está`);
      }
      // Rs sí está para una máquina de su sector
      const r2 = await pedir('GET', `/api/planes/responsables-habilitados?maquina_id=${m2}`, A.token);
      assert.ok(r2.cuerpo.some((u: any) => u.id === Rs.id), 'Rs está para la máquina 2');

      // Por apellido y nombre: "PV, Resp" antes que "PV, RespDos"
      assert.ok(ids.indexOf(R.id) < ids.indexOf(R2.id), 'Ordenados por apellido y nombre');

      // Los errores de la 1.1
      for (const consulta of ['', '?maquina_id=', '?maquina_id=abc', '?maquina_id=0']) {
        const e = await pedir('GET', `/api/planes/responsables-habilitados${consulta}`, A.token);
        assert.deepStrictEqual([e.status, e.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], consulta);
      }
      const e404 = await pedir('GET', '/api/planes/responsables-habilitados?maquina_id=999999999', A.token);
      assert.deepStrictEqual([e404.status, e404.cuerpo.codigo], [404, 'MAQUINA_NO_ENCONTRADA']);
      const e403 = await pedir('GET', `/api/planes/responsables-habilitados?maquina_id=${m2}`, S.token);
      assert.deepStrictEqual([e403.status, e403.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);
      assert.strictEqual((await pedir('GET', `/api/planes/responsables-habilitados?maquina_id=${m1}`, S.token)).status, 200);

      // O: 403
      const eO = await pedir('GET', `/api/planes/responsables-habilitados?maquina_id=${m1}`, O.token);
      assert.deepStrictEqual([eO.status, eO.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);
    });

    // =========================================================================
    // PV-14: Opciones de repuestos y proveedores (PV2, 1.2)
    // =========================================================================
    await t.test('PV-14: Opciones de repuestos y proveedores', async () => {
      // Un operario con CONCEDER de PLANES_GESTIONAR
      const Op = await crearUsuario('Op', 'OperarioPlanes', 'OPERARIO', [s1]);
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
         VALUES ($1, $2, 'CONCEDER', 'TODAS', 'Planes', $3)`,
        [Op.id, permMap['PLANES_GESTIONAR'], A.id]
      );
      for (const ruta of ['/api/repuestos/opciones', '/api/proveedores/opciones']) {
        const conExcepcion = await pedir('GET', ruta, Op.token);
        assert.strictEqual(conExcepcion.status, 200, `${ruta}: ${JSON.stringify(conExcepcion.cuerpo)}`);
        assert.ok(Array.isArray(conExcepcion.cuerpo));
        const sinExcepcion = await pedir('GET', ruta, O.token);
        assert.deepStrictEqual([sinExcepcion.status, sinExcepcion.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE'], ruta);
      }
    });

    // -------------------------------------------------------------------------
    // Helpers de los repuestos previstos (PV-15 a PV-21)
    // -------------------------------------------------------------------------
    let numeroRepuesto = 0;
    async function crearRepuesto(stock: number | null, costo = 100) {
      numeroRepuesto++;
      const r = await pedir('POST', '/api/repuestos', R.token, {
        codigo: `PV_P${numeroRepuesto}_${suf}`,
        nombre: `PV Previsto ${numeroRepuesto}`,
        unidad: 'litro',
        lleva_stock: stock !== null,
        ...(stock !== null ? { stock_inicial: stock } : {}),
        costo_unitario: costo,
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      const id = Number(r.cuerpo.id);
      createdRepuestoIds.push(id);
      return id;
    }
    const stockDe = async (id: number) =>
      Number((await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [id])).rows[0].cantidad_disponible);
    const consumosDe = async (intId: number) =>
      (await client.query(
        `SELECT id, repuesto_id, cantidad, observacion, movimiento_id, anulado_en, motivo_anulacion
         FROM intervencion_repuestos WHERE intervencion_id = $1 ORDER BY id`,
        [intId]
      )).rows;
    const movimientosDe = async (intId: number) =>
      Number((await client.query('SELECT count(*)::int AS n FROM movimientos_stock WHERE intervencion_id = $1', [intId])).rows[0].n);
    const tareaInt = async (intId: number, tareaId: number) =>
      (await tareasDe(intId)).cuerpo.tareas.find((x: any) => x.id === tareaId);
    const previsto = (repuesto_id: number, cantidad: number) => ({ repuesto_id, cantidad });
    /** Un plan con esas tareas vencidas, generado, con R de responsable. */
    async function generarConPrevistos(maquinaId: number, listas: Array<Array<{ repuesto_id: number; cantidad: number }>>) {
      const p = await crearPlan(
        maquinaId,
        listas.map((repuestos, i) => tarea(sumarDias(hoy, -1), { accion: `Tarea ${i + 1}`, repuestos })),
        { responsable_usuario_id: R.id }
      );
      const g = await generarOk(p.id);
      return { plan: p, intId: g.intervencion.id as number, tareas: g.tareas as any[] };
    }
    /** Los ids de los previstos de una tarea, en su orden. */
    const idsPrevistos = async (intId: number, tareaId: number): Promise<number[]> =>
      (await tareaInt(intId, tareaId)).repuestos_previstos.map((x: any) => x.id);

    // =========================================================================
    // PV-15: Previstos en el plan
    // =========================================================================
    await t.test('PV-15: Previstos en el plan', async () => {
      const a = await crearRepuesto(10);
      const b = await crearRepuesto(10);
      const c = await crearRepuesto(10);

      // Una tarea con dos previstos
      const p = await crearPlan(m1, [tarea(hoy, { accion: 'Con dos', repuestos: [previsto(a, 2.5), previsto(b, 1)] })]);
      assert.deepStrictEqual(
        p.tareas[0].repuestos.map((x: any) => [x.repuesto.id, x.cantidad]),
        [[a, 2.5], [b, 1]]
      );
      assert.deepStrictEqual(Object.keys(p.tareas[0].repuestos[0].repuesto).sort(), ['codigo', 'id', 'nombre', 'unidad']);
      assert.ok(!('repuesto' in p.tareas[0]) && !('cantidad' in p.tareas[0]), 'Sin los campos viejos');
      const tareaId = p.tareas[0].id;

      // Errores del alta, sin guardar nada
      const antes = await planesDeMaquina(m1);
      const once = Array.from({ length: 11 }, () => previsto(a, 1));
      const casos: Array<[string, Record<string, unknown>, string, number, number | undefined, string?]> = [
        ['el mismo repuesto dos veces', { repuestos: [previsto(a, 1), previsto(a, 2)] }, 'DATOS_INVALIDOS', 1, 1],
        ['11 previstos', { repuestos: once }, 'DATOS_INVALIDOS', 1, undefined],
        ['cantidad 0', { repuestos: [previsto(a, 0)] }, 'DATOS_INVALIDOS', 1, 0],
        ['repuesto inactivo', { repuestos: [previsto(a, 1), previsto(repInactivo, 1)] }, 'REPUESTO_INVALIDO', 1, 1],
        ['repuesto_id suelto', { repuesto_id: a }, 'DATOS_INVALIDOS', 1, undefined, 'Usá repuestos.'],
        ['cantidad suelta', { cantidad: 2 }, 'DATOS_INVALIDOS', 1, undefined, 'Usá repuestos.'],
      ];
      for (const [nombre, cambios, codigo, indice, indiceRepuesto, mensaje] of casos) {
        const rr = await pedir('POST', '/api/planes', A.token, {
          maquina_id: m1,
          nombre: 'Plan con previsto mal',
          tareas: [tarea(hoy), tarea(hoy, cambios)],
        });
        assert.strictEqual(rr.status, 422, `${nombre}: ${JSON.stringify(rr.cuerpo)}`);
        assert.strictEqual(rr.cuerpo.codigo, codigo, nombre);
        assert.strictEqual(rr.cuerpo.indice, indice, `${nombre}: indice`);
        assert.strictEqual(rr.cuerpo.indice_repuesto, indiceRepuesto, `${nombre}: indice_repuesto`);
        if (mensaje) assert.strictEqual(rr.cuerpo.error, mensaje, nombre);
      }
      assert.strictEqual(await planesDeMaquina(m1), antes, 'No se guardó ningún plan');

      // Una tarea más, con indice_repuesto y sin indice
      const rMas = await pedir('POST', `/api/planes/${p.id}/tareas`, A.token, tarea(hoy, { repuestos: [previsto(repInactivo, 1)] }));
      assert.deepStrictEqual(
        [rMas.status, rMas.cuerpo.codigo, rMas.cuerpo.indice_repuesto, rMas.cuerpo.indice],
        [422, 'REPUESTO_INVALIDO', 0, undefined]
      );

      // El PATCH con repuestos reemplaza la lista; sin repuestos no la toca
      const parche = (cuerpo: unknown) => pedir('PATCH', `/api/planes/${p.id}/tareas/${tareaId}`, A.token, cuerpo);
      const listaDe = (r: Respuesta) =>
        r.cuerpo.tareas.find((x: any) => x.id === tareaId).repuestos.map((x: any) => [x.repuesto.id, x.cantidad]);
      const r1 = await parche({ repuestos: [previsto(c, 4), previsto(a, 1)] });
      assert.strictEqual(r1.status, 200, JSON.stringify(r1.cuerpo));
      assert.deepStrictEqual(listaDe(r1), [[c, 4], [a, 1]]);
      const r2 = await parche({ accion: 'Con dos, otra acción' });
      assert.deepStrictEqual(listaDe(r2), [[c, 4], [a, 1]], 'Sin repuestos no cambia');
      const suelto = await parche({ repuesto_id: a, cantidad: 1 });
      assert.deepStrictEqual([suelto.status, suelto.cuerpo.codigo, suelto.cuerpo.error], [422, 'DATOS_INVALIDOS', 'Usá repuestos.']);

      // Uno que ya estaba y se desactivó no impide guardar la misma lista; uno nuevo inactivo, sí
      await client.query('UPDATE repuestos SET activo = FALSE WHERE id = $1', [c]);
      const r3 = await parche({ repuestos: [previsto(c, 5), previsto(a, 1)] });
      assert.strictEqual(r3.status, 200, JSON.stringify(r3.cuerpo));
      assert.deepStrictEqual(listaDe(r3), [[c, 5], [a, 1]]);
      const r4 = await parche({ repuestos: [previsto(c, 5), previsto(repInactivo, 1)] });
      assert.deepStrictEqual([r4.status, r4.cuerpo.codigo, r4.cuerpo.indice_repuesto], [422, 'REPUESTO_INVALIDO', 1]);

      const r5 = await parche({ repuestos: [] });
      assert.deepStrictEqual(listaDe(r5), [], 'La lista vacía la deja sin previstos');
    });

    // =========================================================================
    // PV-16: Generar copia los previstos
    // =========================================================================
    await t.test('PV-16: Generar copia los previstos', async () => {
      const a = await crearRepuesto(10);
      const inactivo = await crearRepuesto(10);

      const p = await crearPlan(m1, [
        tarea(sumarDias(hoy, -1), { accion: 'Uno', repuestos: [previsto(a, 2.5), previsto(inactivo, 1)] }),
        tarea(sumarDias(hoy, -1), { accion: 'Dos', repuestos: [previsto(a, 3)] }),
        tarea(sumarDias(hoy, -1), { accion: 'Tres' }),
      ]);
      await client.query('UPDATE repuestos SET activo = FALSE WHERE id = $1', [inactivo]);
      const g = await generarOk(p.id);
      const id = g.intervencion.id;

      const d = (await tareasDe(id)).cuerpo;
      assert.deepStrictEqual(d.resumen, { total: 3, hechas: 0, previstos_sin_confirmar: 3 });
      assert.deepStrictEqual(
        d.tareas.map((x: any) => x.repuestos_previstos.map((y: any) => [y.repuesto.id, y.cantidad_prevista, y.estado, y.consumo])),
        [
          [[a, 2.5, 'PREVISTO', null], [inactivo, 1, 'PREVISTO', null]],
          [[a, 3, 'PREVISTO', null]],
          [],
        ]
      );
      assert.ok(!('repuesto' in d.tareas[0]) && !('cantidad' in d.tareas[0]), 'Sin los campos viejos');
      assert.deepStrictEqual(
        Object.keys(d.tareas[0].repuestos_previstos[0].repuesto).sort(),
        ['cantidad_disponible', 'codigo', 'id', 'lleva_stock', 'nombre', 'unidad']
      );
      assert.strictEqual(d.tareas[0].repuestos_previstos[0].repuesto.cantidad_disponible, 10);
      assert.strictEqual(await stockDe(a), 10, 'Un previsto no mueve stock');

      // Cambiar el plan después no cambia la intervención
      const r = await pedir('PATCH', `/api/planes/${p.id}/tareas/${p.tareas[0].id}`, A.token, { repuestos: [] });
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      const despues = (await tareasDe(id)).cuerpo;
      assert.deepStrictEqual(
        despues.tareas[0].repuestos_previstos.map((y: any) => [y.repuesto.id, y.cantidad_prevista]),
        [[a, 2.5], [inactivo, 1]]
      );

      // Sin permiso para ver el stock: cantidad_disponible en null
      const Vista = await crearUsuario('Vista', 'SoloVer', 'CONSULTA', []);
      const conVista = (await tareasDe(id, Vista.token)).cuerpo;
      assert.strictEqual(conVista.tareas[0].repuestos_previstos[0].repuesto.cantidad_disponible, null);
    });

    // =========================================================================
    // PV-17: Confirmar
    // =========================================================================
    await t.test('PV-17: Confirmar', async () => {
      const a = await crearRepuesto(10, 100);
      const b = await crearRepuesto(10, 50);
      const sinStock = await crearRepuesto(null, 70);
      const { intId, tareas } = await generarConPrevistos(m1, [
        [previsto(a, 2.5), previsto(b, 1)],
        [previsto(b, 1)],
        [previsto(b, 2)],
        [previsto(sinStock, 3)],
      ]);
      await iniciar(intId);
      const [t1, t2, t3, t4] = tareas;
      const [pa, pb] = await idsPrevistos(intId, t1.id);

      // Sin repuestos: 422. Un id de otra tarea: 422.
      const sinLista = await marcar(intId, t1.id, { hecha: true });
      assert.deepStrictEqual([sinLista.status, sinLista.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);
      const [otroPrevisto] = await idsPrevistos(intId, t2.id);
      const ajeno = await marcar(intId, t1.id, { hecha: true, repuestos: [{ id: otroPrevisto, cantidad: 1 }] });
      assert.deepStrictEqual([ajeno.status, ajeno.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);
      const repetido = await marcar(intId, t1.id, { hecha: true, repuestos: [{ id: pa, cantidad: 1 }, { id: pa, cantidad: 2 }] });
      assert.deepStrictEqual([repetido.status, repetido.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);
      const cero = await marcar(intId, t1.id, { hecha: true, repuestos: [{ id: pa, cantidad: 0 }] });
      assert.deepStrictEqual([cero.status, cero.cuerpo.previsto_id], [422, pa]);
      assert.strictEqual((await consumosDe(intId)).length, 0);

      // Un previsto usado con otra cantidad y otro sin usar
      const r = await marcar(intId, t1.id, { hecha: true, repuestos: [{ id: pa, cantidad: 2 }] });
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      const consumos = await consumosDe(intId);
      assert.strictEqual(consumos.length, 1);
      assert.deepStrictEqual(
        [Number(consumos[0].repuesto_id), Number(consumos[0].cantidad), consumos[0].observacion],
        [a, 2, 'Previsto en la tarea «Tarea 1»']
      );
      assert.ok(consumos[0].movimiento_id !== null, 'Movió stock');
      assert.strictEqual(await stockDe(a), 8);
      assert.strictEqual(await stockDe(b), 10);
      const costo = (await client.query('SELECT costo_repuestos FROM intervenciones WHERE id = $1', [intId])).rows[0].costo_repuestos;
      assert.strictEqual(Number(costo), 200, 'El costo de repuestos se recalcula');
      assert.strictEqual(r.cuerpo.hecha, true);
      assert.deepStrictEqual(
        r.cuerpo.repuestos_previstos.map((x: any) => [x.id, x.estado, x.consumo]),
        [
          [pa, 'USADO', { id: Number(consumos[0].id), cantidad: 2, anulado: false }],
          [pb, 'NO_USADO', null],
        ]
      );

      // Marcarla otra vez, aunque venga repuestos: 200 sin cambios
      const otra = await marcar(intId, t1.id, { hecha: true, repuestos: [{ id: pb, cantidad: 1 }] });
      assert.strictEqual(otra.status, 200);
      assert.strictEqual((await consumosDe(intId)).length, 1);

      // repuestos: []: hecha y sin consumos
      const vacia = await marcar(intId, t2.id, { hecha: true, repuestos: [] });
      assert.deepStrictEqual([vacia.status, vacia.cuerpo.hecha], [200, true]);
      assert.strictEqual(vacia.cuerpo.repuestos_previstos[0].estado, 'NO_USADO');
      assert.strictEqual((await consumosDe(intId)).length, 1);

      // Se puede usar más de lo previsto
      const [pt3] = await idsPrevistos(intId, t3.id);
      const mas = await marcar(intId, t3.id, { hecha: true, repuestos: [{ id: pt3, cantidad: 3.5 }] });
      assert.strictEqual(mas.status, 200, JSON.stringify(mas.cuerpo));
      assert.strictEqual(await stockDe(b), 6.5);

      // Un repuesto que no lleva stock: consumo sin movimiento
      const [pt4] = await idsPrevistos(intId, t4.id);
      const movAntes = await movimientosDe(intId);
      const sin = await marcar(intId, t4.id, { hecha: true, repuestos: [{ id: pt4, cantidad: 3 }] });
      assert.strictEqual(sin.status, 200, JSON.stringify(sin.cuerpo));
      const ultimo = (await consumosDe(intId)).at(-1);
      assert.deepStrictEqual([Number(ultimo.repuesto_id), Number(ultimo.cantidad), ultimo.movimiento_id], [sinStock, 3, null]);
      assert.strictEqual(await movimientosDe(intId), movAntes, 'Sin movimiento de stock');
      assert.strictEqual((await tareasDe(intId)).cuerpo.resumen.previstos_sin_confirmar, 0);
    });

    // =========================================================================
    // PV-18: Todo o nada
    // =========================================================================
    await t.test('PV-18: Todo o nada', async () => {
      const con = await crearRepuesto(10);
      const poco = await crearRepuesto(1);
      const baja = await crearRepuesto(10);
      const { intId, tareas } = await generarConPrevistos(m1, [
        [previsto(con, 2), previsto(poco, 5)],
        [previsto(con, 2), previsto(baja, 1)],
      ]);
      await iniciar(intId);
      const [pc, pp] = await idsPrevistos(intId, tareas[0].id);

      const r = await marcar(intId, tareas[0].id, { hecha: true, repuestos: [{ id: pc, cantidad: 2 }, { id: pp, cantidad: 5 }] });
      assert.deepStrictEqual([r.status, r.cuerpo.codigo, r.cuerpo.previsto_id, r.cuerpo.disponible], [409, 'STOCK_INSUFICIENTE', pp, 1]);
      assert.strictEqual((await consumosDe(intId)).length, 0, 'Ningún consumo');
      assert.strictEqual(await movimientosDe(intId), 0, 'Ningún movimiento');
      assert.strictEqual(await stockDe(con), 10, 'El stock de los otros no cambia');
      assert.strictEqual(await stockDe(poco), 1);
      assert.strictEqual((await tareaInt(intId, tareas[0].id)).hecha, false);

      // Un repuesto que se desactivó: 409 REPUESTO_INACTIVO, con previsto_id
      const [pc2, pb2] = await idsPrevistos(intId, tareas[1].id);
      await client.query('UPDATE repuestos SET activo = FALSE WHERE id = $1', [baja]);
      const ri = await marcar(intId, tareas[1].id, { hecha: true, repuestos: [{ id: pc2, cantidad: 2 }, { id: pb2, cantidad: 1 }] });
      assert.deepStrictEqual([ri.status, ri.cuerpo.codigo, ri.cuerpo.previsto_id], [409, 'REPUESTO_INACTIVO', pb2]);
      assert.strictEqual((await consumosDe(intId)).length, 0);
      assert.strictEqual(await stockDe(con), 10);

      // Dejándolo sin usar, se puede
      const ok = await marcar(intId, tareas[1].id, { hecha: true, repuestos: [{ id: pc2, cantidad: 2 }] });
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.cuerpo));
    });

    // =========================================================================
    // PV-19: Desmarcar
    // =========================================================================
    await t.test('PV-19: Desmarcar', async () => {
      const a = await crearRepuesto(10);
      const b = await crearRepuesto(10);
      const { intId, tareas } = await generarConPrevistos(m1, [[previsto(a, 2), previsto(b, 1)]]);
      await iniciar(intId);
      const tareaId = tareas[0].id;
      const [pa, pb] = await idsPrevistos(intId, tareaId);
      const usar = { hecha: true, repuestos: [{ id: pa, cantidad: 2 }, { id: pb, cantidad: 1 }] };

      assert.strictEqual((await marcar(intId, tareaId, usar)).status, 200);
      assert.deepStrictEqual([await stockDe(a), await stockDe(b)], [8, 9]);

      // Anula los consumos y el stock vuelve
      const d1 = await marcar(intId, tareaId, { hecha: false });
      assert.strictEqual(d1.status, 200, JSON.stringify(d1.cuerpo));
      assert.deepStrictEqual([await stockDe(a), await stockDe(b)], [10, 10]);
      const anulados = await consumosDe(intId);
      assert.strictEqual(anulados.length, 2);
      for (const c of anulados) {
        assert.ok(c.anulado_en !== null);
        assert.strictEqual(c.motivo_anulacion, 'Se desmarcó la tarea «Tarea 1»');
      }
      assert.deepStrictEqual(
        d1.cuerpo.repuestos_previstos.map((x: any) => [x.estado, x.consumo]),
        [['PREVISTO', null], ['PREVISTO', null]]
      );
      const costo = (await client.query('SELECT costo_repuestos FROM intervenciones WHERE id = $1', [intId])).rows[0].costo_repuestos;
      assert.strictEqual(Number(costo), 0);

      // Se vuelve a marcar; un consumo anulado antes desde el bloque deja el previsto NO_USADO
      const m2Res = await marcar(intId, tareaId, usar);
      assert.strictEqual(m2Res.status, 200, JSON.stringify(m2Res.cuerpo));
      assert.deepStrictEqual([await stockDe(a), await stockDe(b)], [8, 9]);
      const consumoA = m2Res.cuerpo.repuestos_previstos[0].consumo.id;
      const an = await pedir('POST', `/api/intervenciones/${intId}/repuestos/${consumoA}/anular`, R.token, { motivo: 'Se cargó de más' });
      assert.strictEqual(an.status, 200, JSON.stringify(an.cuerpo));
      assert.strictEqual(await stockDe(a), 10);
      const con = await tareaInt(intId, tareaId);
      assert.deepStrictEqual(
        [con.repuestos_previstos[0].estado, con.repuestos_previstos[0].consumo.anulado],
        ['NO_USADO', true]
      );

      // Al desmarcar se saltea: el stock no vuelve dos veces, y su motivo no cambia
      const d2 = await marcar(intId, tareaId, { hecha: false });
      assert.strictEqual(d2.status, 200, JSON.stringify(d2.cuerpo));
      assert.deepStrictEqual([await stockDe(a), await stockDe(b)], [10, 10]);
      const fila = (await consumosDe(intId)).find((c) => Number(c.id) === consumoA);
      assert.strictEqual(fila.motivo_anulacion, 'Se cargó de más');
    });

    // =========================================================================
    // PV-20: Estados y permisos
    // =========================================================================
    await t.test('PV-20: Estados y permisos', async () => {
      const a = await crearRepuesto(10);
      const p = await crearPlan(m1, [
        tarea(sumarDias(hoy, -1), { accion: 'Con previsto', repuestos: [previsto(a, 2)] }),
        tarea(sumarDias(hoy, -1), { accion: 'Sin previsto' }),
      ], { responsable_usuario_id: R.id });
      const g = await generarOk(p.id);
      const intId = g.intervencion.id;
      const [conP, sinP] = g.tareas;
      const [pa] = await idsPrevistos(intId, conP.id);
      const usar = { hecha: true, repuestos: [{ id: pa, cantidad: 2 }] };

      // En PENDIENTE
      const r1 = await marcar(intId, conP.id, usar);
      assert.deepStrictEqual(
        [r1.status, r1.cuerpo.codigo, r1.cuerpo.error],
        [409, 'ESTADO_NO_PERMITE_REPUESTOS', 'Iniciá el trabajo para confirmar los repuestos de esta tarea.']
      );
      assert.strictEqual((await marcar(intId, sinP.id, { hecha: true })).status, 200, 'Sin previstos se marca');

      await iniciar(intId);

      // R2: 403
      const r2 = await marcar(intId, conP.id, usar, R2.token);
      assert.strictEqual(r2.status, 403, JSON.stringify(r2.cuerpo));

      // En FINALIZADA: R, 403; A con motivo registra los consumos con ese motivo
      await finalizar(intId);
      const r3 = await marcar(intId, conP.id, { ...usar, motivo: 'Se usó y no se cargó' }, R.token);
      assert.deepStrictEqual([r3.status, r3.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);
      const sinMotivo = await marcar(intId, conP.id, usar, A.token);
      assert.deepStrictEqual([sinMotivo.status, sinMotivo.cuerpo.codigo], [422, 'MOTIVO_REQUERIDO']);
      assert.strictEqual(await stockDe(a), 10);

      const r4 = await marcar(intId, conP.id, { ...usar, motivo: 'Se usó y no se cargó' }, A.token);
      assert.strictEqual(r4.status, 200, JSON.stringify(r4.cuerpo));
      assert.strictEqual(await stockDe(a), 8);
      const auditoria = async () =>
        (await client.query(
          `SELECT tipo_evento, valor_nuevo, motivo FROM intervencion_auditoria
           WHERE intervencion_id = $1 AND tipo_evento IN ('CORRECCION_COSTO', 'CORRECCION_TAREA') ORDER BY id`,
          [intId]
        )).rows;
      const nombreA = `PV Previsto ${numeroRepuesto}`;
      assert.deepStrictEqual(await auditoria(), [
        { tipo_evento: 'CORRECCION_COSTO', valor_nuevo: `Se agregó: ${nombreA} × 2 litro`, motivo: 'Se usó y no se cargó' },
        { tipo_evento: 'CORRECCION_TAREA', valor_nuevo: 'Se marcó como hecha: Con previsto', motivo: 'Se usó y no se cargó' },
      ]);

      // Desmarcar en FINALIZADA: anula con el motivo del pedido
      const r5 = await marcar(intId, conP.id, { hecha: false, motivo: 'Corrección del pañol' }, A.token);
      assert.strictEqual(r5.status, 200, JSON.stringify(r5.cuerpo));
      assert.strictEqual(await stockDe(a), 10);
      const consumo = (await consumosDe(intId))[0];
      assert.strictEqual(consumo.motivo_anulacion, 'Corrección del pañol');

      // En CANCELADA: 409
      const { intId: intC, tareas: tC } = await generarConPrevistos(m1, [[previsto(a, 1)]]);
      await accionOk(intC, 'cancelar', { estado_esperado: 'PENDIENTE', motivo: 'Se reprograma' }, A.token);
      const [pc] = await idsPrevistos(intC, tC[0].id);
      const r6 = await marcar(intC, tC[0].id, { hecha: true, repuestos: [{ id: pc, cantidad: 1 }] }, A.token);
      assert.deepStrictEqual([r6.status, r6.cuerpo.codigo], [409, 'ESTADO_NO_PERMITE_TAREAS']);
    });

    // =========================================================================
    // PV-21: Concurrencia
    // =========================================================================
    await t.test('PV-21: Concurrencia', async () => {
      for (let vuelta = 1; vuelta <= 10; vuelta++) {
        // Dos confirmaciones de la misma tarea a la vez: un solo juego de consumos
        const a = await crearRepuesto(10);
        const uno = await generarConPrevistos(m1, [[previsto(a, 2)]]);
        await iniciar(uno.intId);
        const [pa] = await idsPrevistos(uno.intId, uno.tareas[0].id);
        const cuerpo = { hecha: true, repuestos: [{ id: pa, cantidad: 2 }] };
        const [c1, c2] = await Promise.all([marcar(uno.intId, uno.tareas[0].id, cuerpo), marcar(uno.intId, uno.tareas[0].id, cuerpo)]);
        // Una de las dos puede perder por el lock_timeout (PV3.1, 3): la otra la marcó
        const estadosC = [c1, c2].map((r) => (ocupado(r) ? 'OCUPADO' : r.status)).sort();
        assert.ok(
          JSON.stringify(estadosC) === JSON.stringify([200, 200]) || JSON.stringify(estadosC) === JSON.stringify([200, 'OCUPADO']),
          `Vuelta ${vuelta}: ${JSON.stringify([c1.cuerpo, c2.cuerpo])}`
        );
        assert.strictEqual((await tareaInt(uno.intId, uno.tareas[0].id)).hecha, true, `Vuelta ${vuelta}`);
        assert.strictEqual((await consumosDe(uno.intId)).length, 1, `Vuelta ${vuelta}: un solo consumo`);
        assert.strictEqual(await stockDe(a), 8, `Vuelta ${vuelta}`);

        // Dos tareas de máquinas distintas que comparten repuesto, con stock para una sola
        const z = await crearRepuesto(1);
        const t1 = await generarConPrevistos(m1, [[previsto(z, 1)]]);
        const t2 = await generarConPrevistos(m2, [[previsto(z, 1)]]);
        await iniciar(t1.intId);
        await iniciar(t2.intId);
        const [p1] = await idsPrevistos(t1.intId, t1.tareas[0].id);
        const [p2] = await idsPrevistos(t2.intId, t2.tareas[0].id);
        const [r1, r2] = await Promise.all([
          marcar(t1.intId, t1.tareas[0].id, { hecha: true, repuestos: [{ id: p1, cantidad: 1 }] }),
          marcar(t2.intId, t2.tareas[0].id, { hecha: true, repuestos: [{ id: p2, cantidad: 1 }] }),
        ]);
        assert.deepStrictEqual([r1.status, r2.status].sort(), [200, 409], `Vuelta ${vuelta}: ${JSON.stringify([r1.cuerpo, r2.cuerpo])}`);
        const [perdio, deQuien] = r1.status === 409 ? [r1, t1] : [r2, t2];
        assert.ok(['STOCK_INSUFICIENTE', 'RECURSO_OCUPADO'].includes(perdio.cuerpo.codigo), `Vuelta ${vuelta}: ${perdio.cuerpo.codigo}`);
        assert.strictEqual((await tareaInt(deQuien.intId, deQuien.tareas[0].id)).hecha, false, `Vuelta ${vuelta}: la que perdió no se marcó`);
        assert.strictEqual((await consumosDe(deQuien.intId)).length, 0, `Vuelta ${vuelta}: sin consumos de la que perdió`);
        assert.strictEqual(await stockDe(z), 0, `Vuelta ${vuelta}: nunca negativo`);
      }
    });

    // -------------------------------------------------------------------------
    // Helpers de los medidores (PV-22 a PV-31)
    // -------------------------------------------------------------------------
    let numeroMedidor = 0;
    /** Un medidor con nombre único; con `lecturas`, se cargan en orden. */
    async function crearMedidor(maquinaId: number, lecturas: number[] = []) {
      numeroMedidor++;
      const r = await pedir('POST', '/api/medidores', A.token, { maquina_id: maquinaId, nombre: `Horómetro ${numeroMedidor}`, unidad: 'horas' });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      const id = Number(r.cuerpo.id);
      for (const valor of lecturas) await cargarLectura(id, valor);
      return id;
    }
    async function cargarLectura(medidorId: number, valor: number) {
      const r = await pedir('POST', `/api/medidores/${medidorId}/lecturas`, A.token, { valor });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      return r.cuerpo;
    }
    const lecturasDe = async (medidorId: number) =>
      (await client.query(
        `SELECT l.id, l.valor, l.origen, l.intervencion_tarea_id, l.anulada_en, it.intervencion_id
         FROM lecturas_medidor l LEFT JOIN intervencion_tareas it ON it.id = l.intervencion_tarea_id
         WHERE l.medidor_id = $1 ORDER BY l.id`,
        [medidorId]
      )).rows;
    const USO = { cada: 250, primera: 500, anticipacion: 25 };
    /** Una tarea solo por uso, sobre el medidor. */
    const tareaUso = (medidorId: number, extra: Record<string, unknown> = {}, uso: Record<string, unknown> = {}) => ({
      accion: 'Cambiar el aceite',
      uso: { medidor_id: medidorId, cada: 250, primera: 500, ...uso },
      ...extra,
    });
    /** Una intervención cargada en la base, con la tarea y su valor del medidor. */
    async function ejecucionUso(
      maquinaId: number,
      planId: number,
      tareaId: number,
      opciones: { fin?: string; medidorId: number; valor: number | null; estado?: string; eliminada?: boolean }
    ) {
      const fin = opciones.fin ?? '2026-03-10 12:00:00-03';
      const estado = opciones.estado ?? 'FINALIZADA';
      const finalizada = estado === 'FINALIZADA';
      const tipo = Number((await client.query(`SELECT id FROM tipos_intervencion WHERE codigo = 'PREVENTIVO'`)).rows[0].id);
      const intId = Number((await client.query(
        `INSERT INTO intervenciones (
           maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, plan_mantenimiento_id,
           fecha_creacion, fecha_inicio, fecha_finalizacion, trabajo_realizado, ejecucion,
           eliminado_en, eliminado_por_usuario_id, motivo_eliminacion
         ) VALUES ($1, $2, $3, 'Preventivo PV', $4, $5,
                   $6::timestamptz - interval '2 hours',
                   CASE WHEN $7 THEN $6::timestamptz - interval '1 hour' ELSE NULL END,
                   CASE WHEN $7 THEN $6::timestamptz ELSE NULL END,
                   CASE WHEN $7 THEN 'Trabajo PV' ELSE NULL END,
                   CASE WHEN $7 THEN 'INTERNA' ELSE NULL END,
                   CASE WHEN $8 THEN NOW() ELSE NULL END,
                   CASE WHEN $8 THEN $3::bigint ELSE NULL END,
                   CASE WHEN $8 THEN 'Baja de prueba' ELSE NULL END)
         RETURNING id`,
        [maquinaId, tipo, A.id, estado, planId, fin, finalizada, Boolean(opciones.eliminada)]
      )).rows[0].id);
      await client.query(
        `INSERT INTO intervencion_tareas (
           intervencion_id, plan_tarea_id, orden, accion, medidor_id, uso_programado, valor_medidor,
           hecha, hecha_por_usuario_id, hecha_en
         )
         SELECT $1, t.id, t.orden, t.accion, $2::bigint, 500, $3::numeric,
                $4::boolean, CASE WHEN $4::boolean THEN $5::bigint ELSE NULL END, CASE WHEN $4::boolean THEN NOW() ELSE NULL END
         FROM plan_tareas t WHERE t.id = $6`,
        [intId, opciones.medidorId, opciones.valor, opciones.valor !== null, A.id, tareaId]
      );
      return intId;
    }
    const usoDe = async (planId: number, tareaId: number) => (await tareaDelPlan(planId, tareaId)).uso;
    /** Un plan con R de responsable y una tarea por uso, generado eligiéndola. */
    async function generarUso(medidorId: number, uso: Record<string, unknown> = {}, extraTarea: Record<string, unknown> = {}) {
      const p = await crearPlan(m1, [tareaUso(medidorId, extraTarea, uso)], { responsable_usuario_id: R.id });
      const tareaPlanId = p.tareas[0].id;
      const g = await generarOk(p.id, { tarea_ids: [tareaPlanId] });
      return { p, tareaPlanId, intId: g.intervencion.id as number, tareaId: g.tareas[0].id as number };
    }

    // =========================================================================
    // PV-22: La tarea por uso en el plan
    // =========================================================================
    await t.test('PV-22: La tarea por uso en el plan', async () => {
      const med = await crearMedidor(m1);
      const otroMed = await crearMedidor(m1);
      const deOtraMaquina = await crearMedidor(m2);
      const inactivo = await crearMedidor(m1);
      assert.strictEqual((await pedir('POST', `/api/medidores/${inactivo}/desactivar`, A.token, {})).status, 200);

      // Solo por uso
      const p = await crearPlan(m1, [tareaUso(med)]);
      const t0 = p.tareas[0];
      assert.deepStrictEqual(
        [t0.frecuencia_valor, t0.frecuencia_unidad, t0.primera_fecha, t0.proxima_fecha, t0.dias, t0.estado_fecha],
        [null, null, null, null, null, null]
      );
      assert.deepStrictEqual(
        [t0.uso.medidor.id, t0.uso.cada, t0.uso.primera, t0.uso.anticipacion, t0.uso.ultimo, t0.uso.proximo, t0.uso.estado],
        [med, 250, 500, 25, null, 500, 'SIN_LECTURA']
      );

      // Con los dos criterios
      const dos = await crearPlan(m1, [tarea(sumarDias(hoy, 30), { uso: { medidor_id: med, cada: 100, primera: 100, anticipacion: 0 } })]);
      assert.deepStrictEqual(
        [dos.tareas[0].frecuencia_valor, dos.tareas[0].uso.anticipacion, dos.tareas[0].estado_fecha],
        [1, 0, 'AL_DIA']
      );

      // 422 con indice, sin guardar nada
      const antes = await planesDeMaquina(m1);
      const invalidos: Array<[string, unknown, string]> = [
        ['sin criterio', { accion: 'Sin criterio' }, 'DATOS_INVALIDOS'],
        ['sin primera_fecha', tareaUso(med, { frecuencia_valor: 1, frecuencia_unidad: 'MESES' }), 'DATOS_INVALIDOS'],
        ['cada 0', tareaUso(med, {}, { cada: 0 }), 'DATOS_INVALIDOS'],
        ['cada "250"', tareaUso(med, {}, { cada: '250' }), 'DATOS_INVALIDOS'],
        ['primera -1', tareaUso(med, {}, { primera: -1 }), 'DATOS_INVALIDOS'],
        ['anticipación mayor que cada', tareaUso(med, {}, { anticipacion: 251 }), 'DATOS_INVALIDOS'],
        ['3 decimales', tareaUso(med, {}, { cada: 1.234 }), 'DATOS_INVALIDOS'],
        ['un medidor de otra máquina', tareaUso(deOtraMaquina), 'MEDIDOR_INVALIDO'],
        ['un medidor inactivo', tareaUso(inactivo), 'MEDIDOR_INVALIDO'],
        ['un medidor que no existe', tareaUso(2147483000), 'MEDIDOR_INVALIDO'],
        ['medidor_id: true', tareaUso(true as unknown as number), 'MEDIDOR_INVALIDO'],
      ];
      for (const [nombre, mala, codigo] of invalidos) {
        const r = await pedir('POST', '/api/planes', A.token, { maquina_id: m1, nombre: 'Plan con error', tareas: [tarea(hoy), mala] });
        assert.strictEqual(r.status, 422, `${nombre}: ${JSON.stringify(r.cuerpo)}`);
        assert.strictEqual(r.cuerpo.codigo, codigo, `${nombre}: ${JSON.stringify(r.cuerpo)}`);
        assert.strictEqual(r.cuerpo.indice, 1, `${nombre}: indice`);
      }
      const sinCriterio = await pedir('POST', '/api/planes', A.token, { maquina_id: m1, nombre: 'Plan con error', tareas: [{ accion: 'Sin criterio' }] });
      assert.strictEqual(sinCriterio.cuerpo.error, 'Una tarea vence por fecha, por uso o por las dos');
      assert.strictEqual(await planesDeMaquina(m1), antes, 'No se guardó ningún plan');

      // POST de una tarea
      const agregada = await pedir('POST', `/api/planes/${p.id}/tareas`, A.token, tareaUso(med, { accion: 'Engrasar' }));
      assert.strictEqual(agregada.status, 201, JSON.stringify(agregada.cuerpo));
      const agregadaInv = await pedir('POST', `/api/planes/${p.id}/tareas`, A.token, tareaUso(deOtraMaquina));
      assert.deepStrictEqual([agregadaInv.status, agregadaInv.cuerpo.codigo], [422, 'MEDIDOR_INVALIDO']);

      // PATCH: sacar la fecha, con uso
      const conFecha = await crearPlan(m1, [tarea(sumarDias(hoy, 30), { uso: { medidor_id: med, ...USO } })]);
      const tf = conFecha.tareas[0].id;
      const patch = (cuerpo: unknown) => pedir('PATCH', `/api/planes/${conFecha.id}/tareas/${tf}`, A.token, cuerpo);
      const sacar = await patch({ frecuencia_valor: null, frecuencia_unidad: null, primera_fecha: null });
      assert.strictEqual(sacar.status, 200, JSON.stringify(sacar.cuerpo));
      assert.deepStrictEqual(
        [sacar.cuerpo.tareas[0].primera_fecha, sacar.cuerpo.tareas[0].proxima_fecha, sacar.cuerpo.tareas[0].dias],
        [null, null, null]
      );

      // uso: null sin fecha: 422
      const sinNada = await patch({ uso: null });
      assert.deepStrictEqual([sinNada.status, sinNada.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);

      // Solo primera_fecha: null: 422 (en una tarea con fecha)
      const conDos = await crearPlan(m1, [tarea(sumarDias(hoy, 30), { uso: { medidor_id: med, ...USO } })]);
      const soloNull = await pedir('PATCH', `/api/planes/${conDos.id}/tareas/${conDos.tareas[0].id}`, A.token, { primera_fecha: null });
      assert.deepStrictEqual([soloNull.status, soloNull.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);
      const dosDeTres = await pedir('PATCH', `/api/planes/${conDos.id}/tareas/${conDos.tareas[0].id}`, A.token, { frecuencia_valor: null, frecuencia_unidad: null });
      assert.deepStrictEqual([dosDeTres.status, dosDeTres.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);

      // Sin tocar el uso, sigue igual
      const soloAccion = await patch({ accion: 'Solo cambia la acción' });
      assert.deepStrictEqual([soloAccion.status, soloAccion.cuerpo.tareas[0].uso.medidor.id], [200, med]);

      // Cambiar de medidor, con una ejecución en el otro: la próxima vuelve a primera
      await ejecucionUso(m1, conFecha.id, tf, { medidorId: med, valor: 510 });
      assert.strictEqual((await usoDe(conFecha.id, tf)).proximo, 760);
      const cambio = await patch({ uso: { medidor_id: otroMed, ...USO } });
      assert.strictEqual(cambio.status, 200, JSON.stringify(cambio.cuerpo));
      assert.deepStrictEqual(
        [cambio.cuerpo.tareas[0].uso.medidor.id, cambio.cuerpo.tareas[0].uso.ultimo, cambio.cuerpo.tareas[0].uso.proximo],
        [otroMed, null, 500]
      );

      // Desactivar un medidor con una tarea activa
      const enUso = await crearMedidor(m1);
      const pu = await crearPlan(m1, [tareaUso(enUso)]);
      const tu = pu.tareas[0].id;
      const baja = await pedir('POST', `/api/medidores/${enUso}/desactivar`, A.token, {});
      assert.deepStrictEqual([baja.status, baja.cuerpo.codigo, baja.cuerpo.tarea_ids], [409, 'MEDIDOR_EN_USO', [tu]]);

      assert.strictEqual((await pedir('POST', `/api/planes/${pu.id}/tareas/${tu}/desactivar`, A.token, {})).status, 200);
      assert.strictEqual((await pedir('POST', `/api/medidores/${enUso}/desactivar`, A.token, {})).status, 200);
      const reactivar = await pedir('POST', `/api/planes/${pu.id}/tareas/${tu}/reactivar`, A.token, {});
      assert.deepStrictEqual([reactivar.status, reactivar.cuerpo.codigo], [409, 'MEDIDOR_INACTIVO']);
    });

    // =========================================================================
    // PV-23: Estado por uso
    // =========================================================================
    await t.test('PV-23: Estado por uso', async () => {
      const med = await crearMedidor(m1);
      const p = await crearPlan(m1, [tareaUso(med)]);
      const id = p.tareas[0].id;
      const leer = async () => {
        const x = await tareaDelPlan(p.id, id);
        return [x.estado, x.uso.estado, x.uso.faltan];
      };

      assert.deepStrictEqual(await leer(), ['SIN_LECTURA', 'SIN_LECTURA', null]);
      await cargarLectura(med, 400);
      assert.deepStrictEqual(await leer(), ['AL_DIA', 'AL_DIA', 100]);
      await cargarLectura(med, 475);
      assert.deepStrictEqual(await leer(), ['PROXIMA', 'PROXIMA', 25]);
      await cargarLectura(med, 500);
      assert.deepStrictEqual(await leer(), ['PROXIMA', 'PROXIMA', 0]);
      const l = await cargarLectura(med, 500.5);
      assert.deepStrictEqual(await leer(), ['VENCIDA', 'VENCIDA', -0.5]);
      const uso505 = await usoDe(p.id, id);
      assert.deepStrictEqual(
        [uso505.lectura_actual.valor, typeof uso505.lectura_actual.registrada_en, uso505.proximo],
        [500.5, 'string', 500]
      );

      const an = await pedir('POST', `/api/medidores/${med}/lecturas/${l.id}/anular`, A.token, { motivo: 'Mal cargada' });
      assert.strictEqual(an.status, 200, JSON.stringify(an.cuerpo));
      assert.deepStrictEqual(await leer(), ['PROXIMA', 'PROXIMA', 0]);

      // Finalizada con la tarea hecha en 510
      await ejecucionUso(m1, p.id, id, { medidorId: med, valor: 510 });
      const hecha = await usoDe(p.id, id);
      assert.deepStrictEqual([hecha.ultimo, hecha.proximo], [510, 760]);

      // Cancelada, eliminada o sin la tarea hecha: no cuenta
      const pNo = await crearPlan(m1, [tareaUso(med)]);
      const tNo = pNo.tareas[0].id;
      await ejecucionUso(m1, pNo.id, tNo, { medidorId: med, valor: 900, estado: 'CANCELADA' });
      await ejecucionUso(m1, pNo.id, tNo, { medidorId: med, valor: 900, eliminada: true });
      await ejecucionUso(m1, pNo.id, tNo, { medidorId: med, valor: null });
      const noCuenta = await usoDe(pNo.id, tNo);
      assert.deepStrictEqual([noCuenta.ultimo, noCuenta.proximo], [null, 500]);

      // Un valor de otro medidor no cuenta
      const otro = await crearMedidor(m1);
      const pOtro = await crearPlan(m1, [tareaUso(med)]);
      await ejecucionUso(m1, pOtro.id, pOtro.tareas[0].id, { medidorId: otro, valor: 900 });
      assert.deepStrictEqual((await usoDe(pOtro.id, pOtro.tareas[0].id)).ultimo, null);

      // El medidor inactivo: INACTIVA (una tarea activa no deja desactivarlo: va directo a la base)
      const pIn = await crearPlan(m1, [tareaUso(await crearMedidor(m1))]);
      await client.query('UPDATE medidores SET activo = FALSE WHERE id = $1', [pIn.tareas[0].uso.medidor.id]);
      assert.strictEqual((await tareaDelPlan(pIn.id, pIn.tareas[0].id)).estado, 'INACTIVA');

      // Combinadas, con la anticipación por omisión del plan (7 días)
      const combinada = async (lectura: number | null, fecha: string) => {
        const m = await crearMedidor(m1, lectura === null ? [] : [lectura]);
        const pc = await crearPlan(m1, [tarea(fecha, { uso: { medidor_id: m, ...USO } })]);
        const x = pc.tareas[0];
        return [x.estado_fecha, x.uso.estado, x.estado];
      };
      assert.deepStrictEqual(await combinada(600, sumarDias(hoy, 100)), ['AL_DIA', 'VENCIDA', 'VENCIDA']);
      assert.deepStrictEqual(await combinada(100, sumarDias(hoy, -3)), ['VENCIDA', 'AL_DIA', 'VENCIDA']);
      assert.deepStrictEqual(await combinada(null, sumarDias(hoy, 3)), ['PROXIMA', 'SIN_LECTURA', 'PROXIMA']);
      assert.deepStrictEqual(await combinada(null, sumarDias(hoy, 100)), ['AL_DIA', 'SIN_LECTURA', 'SIN_LECTURA']);
    });

    // =========================================================================
    // PV-24: Vencimientos con uso
    // =========================================================================
    await t.test('PV-24: Vencimientos con uso', async () => {
      const m24 = await crearMaquina('M24', s1, critNormal);
      const medVencida = await crearMedidor(m24, [600]);
      const medSinLectura = await crearMedidor(m24);

      const pFecha = await crearPlan(m24, [
        tarea(sumarDias(hoy, -3), { accion: 'Vencida con fecha' }),
        tarea(sumarDias(hoy, 2), { accion: 'Próxima' }),
        tarea(sumarDias(hoy, 60), { accion: 'Al día' }),
      ]);
      const pUso = await crearPlan(m24, [
        tareaUso(medVencida, { accion: 'Vencida solo por uso' }),
        tareaUso(medSinLectura, { accion: 'Sin lectura' }),
      ]);
      const pCurso = await crearPlan(m24, [tarea(sumarDias(hoy, -1), { accion: 'En curso' })]);
      await generarOk(pCurso.id);

      const r = await pedir('GET', `/api/planes/vencimientos?maquina_id=${m24}`, A.token);
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      assert.deepStrictEqual(
        r.cuerpo.tareas.map((x: any) => [x.accion, x.estado]),
        [
          ['Vencida con fecha', 'VENCIDA'],
          ['Vencida solo por uso', 'VENCIDA'],
          ['Próxima', 'PROXIMA'],
          ['Sin lectura', 'SIN_LECTURA'],
          ['En curso', 'EN_CURSO'],
        ],
        'El orden de la 4.2'
      );
      assert.strictEqual(r.total, '5');
      assert.deepStrictEqual(r.cuerpo.resumen, { vencidas: 2, proximas: 1, en_curso: 1, sin_lectura: 1, al_dia: 1 });

      const soloUso = r.cuerpo.tareas.find((x: any) => x.accion === 'Vencida solo por uso');
      assert.deepStrictEqual(
        [soloUso.frecuencia_valor, soloUso.proxima_fecha, soloUso.dias, soloUso.estado_fecha, soloUso.uso.estado, soloUso.uso.faltan],
        [null, null, null, null, 'VENCIDA', -100]
      );
      const conFecha = r.cuerpo.tareas.find((x: any) => x.accion === 'Vencida con fecha');
      assert.deepStrictEqual([conFecha.estado_fecha, conFecha.uso], ['VENCIDA', null]);

      const solo = await pedir('GET', `/api/planes/vencimientos?maquina_id=${m24}&estado=SIN_LECTURA`, A.token);
      assert.deepStrictEqual(solo.cuerpo.tareas.map((x: any) => x.accion), ['Sin lectura']);

      const lista = (await pedir('GET', `/api/planes?maquina_id=${m24}`, A.token)).cuerpo;
      const deUso = lista.find((x: any) => x.id === pUso.id);
      assert.deepStrictEqual([deUso.sin_lectura, deUso.vencidas, deUso.proxima_fecha], [1, 1, null], 'Un plan solo por uso, sin próxima fecha');
      const deFecha = lista.find((x: any) => x.id === pFecha.id);
      assert.deepStrictEqual([deFecha.sin_lectura, deFecha.proxima_fecha], [0, sumarDias(hoy, -3)]);
    });

    // =========================================================================
    // PV-25: Generar con uso
    // =========================================================================
    await t.test('PV-25: Generar con uso', async () => {
      const med = await crearMedidor(m1, [600]);
      const otro = await crearMedidor(m1);
      const p = await crearPlan(m1, [tareaUso(med)], { responsable_usuario_id: R.id });
      const tareaPlanId = p.tareas[0].id;

      // Sin cuerpo, lleva la vencida por uso
      const g = await generarOk(p.id);
      assert.deepStrictEqual(g.tareas.map((x: any) => [x.plan_tarea_id, x.fecha_programada]), [[tareaPlanId, null]]);

      const fila = (await client.query(
        'SELECT medidor_id, uso_programado, fecha_programada, valor_medidor FROM intervencion_tareas WHERE id = $1',
        [g.tareas[0].id]
      )).rows[0];
      assert.deepStrictEqual(
        [Number(fila.medidor_id), Number(fila.uso_programado), fila.fecha_programada, fila.valor_medidor],
        [med, 500, null, null]
      );

      const leerUso = async () => (await tareasDe(g.intervencion.id)).cuerpo.tareas[0].uso;
      const antes = await leerUso();
      assert.deepStrictEqual(
        [antes.medidor.id, antes.medidor.nombre, antes.medidor.unidad, antes.medidor.activo, antes.medidor.ultima_lectura.valor, antes.programado, antes.valor],
        [med, (await pedir('GET', `/api/medidores/${med}`, A.token)).cuerpo.nombre, 'horas', true, 600, 500, null]
      );

      // Cambiar el medidor de la tarea del plan después no cambia la de la intervención
      const cambio = await pedir('PATCH', `/api/planes/${p.id}/tareas/${tareaPlanId}`, A.token, { uso: { medidor_id: otro, ...USO } });
      assert.strictEqual(cambio.status, 200, JSON.stringify(cambio.cuerpo));
      const despues = await leerUso();
      assert.deepStrictEqual([despues.medidor.id, despues.programado], [med, 500]);

      // Una tarea sin medidor: uso null
      const pf = await crearPlan(m1, [tarea(sumarDias(hoy, -1))], { responsable_usuario_id: R.id });
      const gf = await generarOk(pf.id);
      assert.strictEqual((await tareasDe(gf.intervencion.id)).cuerpo.tareas[0].uso, null);

      // Una próxima por uso que no entra en la columna: 422, nunca 500
      const grande = await crearMedidor(m1, [999999999999.99]);
      const pg = await crearPlan(m1, [tareaUso(grande, {}, { cada: 999999999999.99, primera: 0, anticipacion: 0 })]);
      await ejecucionUso(m1, pg.id, pg.tareas[0].id, { medidorId: grande, valor: 999999999999.99 });
      const fuera = await generar(pg.id, { tarea_ids: [pg.tareas[0].id] });
      assert.deepStrictEqual([fuera.status, fuera.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], JSON.stringify(fuera.cuerpo));
    });

    // =========================================================================
    // PV-26: Marcar con lectura
    // =========================================================================
    await t.test('PV-26: Marcar con lectura', async () => {
      // Sin lecturas y sin lectura: 422
      const sinNada = await generarUso(await crearMedidor(m1));
      const r0 = await marcar(sinNada.intId, sinNada.tareaId, { hecha: true });
      assert.deepStrictEqual([r0.status, r0.cuerpo.codigo], [422, 'LECTURA_REQUERIDA']);

      // Menor: 422, con ultima. Igual: 200, sin lectura nueva
      const medIgual = await crearMedidor(m1, [100]);
      const a = await generarUso(medIgual);
      const menor = await marcar(a.intId, a.tareaId, { hecha: true, lectura: 50 });
      assert.deepStrictEqual([menor.status, menor.cuerpo.codigo, menor.cuerpo.ultima.valor], [422, 'LECTURA_MENOR', 100]);
      const igual = await marcar(a.intId, a.tareaId, { hecha: true, lectura: 100 });
      assert.strictEqual(igual.status, 200, JSON.stringify(igual.cuerpo));
      assert.deepStrictEqual([igual.cuerpo.hecha, igual.cuerpo.uso.valor, igual.cuerpo.proximo_uso], [true, 100, 500]);
      assert.strictEqual((await lecturasDe(medIgual)).length, 1, 'Igual: sin lectura nueva');

      // Mayor: 200, con una lectura TAREA con su intervencion_id
      const medMayor = await crearMedidor(m1, [100]);
      const b = await generarUso(medMayor);
      const mayor = await marcar(b.intId, b.tareaId, { hecha: true, lectura: 150.5 });
      assert.strictEqual(mayor.status, 200, JSON.stringify(mayor.cuerpo));
      assert.strictEqual(mayor.cuerpo.uso.valor, 150.5);
      const lecturas = await lecturasDe(medMayor);
      assert.strictEqual(lecturas.length, 2);
      assert.deepStrictEqual(
        [Number(lecturas[1].valor), lecturas[1].origen, Number(lecturas[1].intervencion_tarea_id), Number(lecturas[1].intervencion_id)],
        [150.5, 'TAREA', b.tareaId, b.intId]
      );
      const api = (await pedir('GET', `/api/medidores/${medMayor}/lecturas`, A.token)).cuerpo[0];
      assert.deepStrictEqual([api.origen, api.intervencion_id], ['TAREA', b.intId]);
      assert.strictEqual(api.registrada_por.id, R.id, 'A nombre de quien marca');

      // Sin lecturas, con lectura: se registra
      const medPrimera = await crearMedidor(m1);
      const c = await generarUso(medPrimera);
      const primera = await marcar(c.intId, c.tareaId, { hecha: true, lectura: 10 });
      assert.deepStrictEqual([primera.status, primera.cuerpo.uso.valor], [200, 10]);
      assert.strictEqual((await lecturasDe(medPrimera)).length, 1);

      // Sin lectura, con lecturas: el valor es la última
      const medUltima = await crearMedidor(m1, [100, 120]);
      const d = await generarUso(medUltima);
      const conUltima = await marcar(d.intId, d.tareaId, { hecha: true });
      assert.deepStrictEqual([conUltima.status, conUltima.cuerpo.uso.valor], [200, 120]);
      assert.strictEqual((await lecturasDe(medUltima)).length, 2, 'Sin lectura nueva');

      // 422: sin medidor, con hecha: false y "600"
      const pf = await crearPlan(m1, [tarea(sumarDias(hoy, -1))], { responsable_usuario_id: R.id });
      const gf = await generarOk(pf.id);
      const sinMedidor = await marcar(gf.intervencion.id, gf.tareas[0].id, { hecha: true, lectura: 100 });
      assert.deepStrictEqual([sinMedidor.status, sinMedidor.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);
      const conFalse = await marcar(d.intId, d.tareaId, { hecha: false, lectura: 100 });
      assert.deepStrictEqual([conFalse.status, conFalse.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);
      const texto = await marcar(d.intId, d.tareaId, { hecha: true, lectura: '600' });
      assert.deepStrictEqual([texto.status, texto.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);

      // Repetir hecha: true con otra lectura: 200, sin cambios ni lectura nueva
      const repite = await marcar(d.intId, d.tareaId, { hecha: true, lectura: 999 });
      assert.deepStrictEqual([repite.status, repite.cuerpo.uso.valor], [200, 120]);
      assert.strictEqual((await lecturasDe(medUltima)).length, 2);

      // Desmarcar: valor null, y la lectura queda
      const desm = await marcar(b.intId, b.tareaId, { hecha: false });
      assert.deepStrictEqual([desm.status, desm.cuerpo.hecha, desm.cuerpo.uso.valor], [200, false, null]);
      assert.strictEqual((await lecturasDe(medMayor)).length, 2, 'La lectura queda');

      // El medidor inactivo: con la última, 200; con una mayor, 409
      const medInactivo = await crearMedidor(m1, [100]);
      const e = await generarUso(medInactivo);
      const f = await crearPlan(m1, [tareaUso(medInactivo)], { responsable_usuario_id: R.id });
      const gF = await generarOk(f.id, { tarea_ids: [f.tareas[0].id] });
      await client.query('UPDATE medidores SET activo = FALSE WHERE id = $1', [medInactivo]);
      const inactMayor = await marcar(e.intId, e.tareaId, { hecha: true, lectura: 150 });
      assert.deepStrictEqual([inactMayor.status, inactMayor.cuerpo.codigo], [409, 'MEDIDOR_INACTIVO']);
      const inactUltima = await marcar(gF.intervencion.id, gF.tareas[0].id, { hecha: true });
      assert.deepStrictEqual([inactUltima.status, inactUltima.cuerpo.uso.valor], [200, 100]);

      // proximo_uso, también en una tarea sin medidor
      const marcadaSinMedidor = await marcar(gf.intervencion.id, gf.tareas[0].id, { hecha: true });
      assert.deepStrictEqual([marcadaSinMedidor.status, marcadaSinMedidor.cuerpo.proximo_uso, marcadaSinMedidor.cuerpo.uso], [200, null, null]);

      // Todo o nada: una tarea con previstos y una lectura menor
      const repu = await crearRepuesto(10);
      const medTodo = await crearMedidor(m1, [100]);
      const g = await generarUso(medTodo, {}, { repuestos: [previsto(repu, 2)] });
      await iniciar(g.intId);
      const [previstoId] = await idsPrevistos(g.intId, g.tareaId);
      const fallo = await marcar(g.intId, g.tareaId, { hecha: true, lectura: 50, repuestos: [{ id: previstoId, cantidad: 2 }] });
      assert.deepStrictEqual([fallo.status, fallo.cuerpo.codigo], [422, 'LECTURA_MENOR']);
      assert.strictEqual((await tareaInt(g.intId, g.tareaId)).hecha, false, 'La tarea no se marcó');
      assert.strictEqual((await consumosDe(g.intId)).length, 0, 'Ningún consumo');
      assert.strictEqual(await stockDe(repu), 10, 'El stock sigue igual');
    });

    // =========================================================================
    // PV-27: La próxima por uso se mueve sola
    // =========================================================================
    await t.test('PV-27: La próxima por uso se mueve sola', async () => {
      const med = await crearMedidor(m1, [480]);
      const a = await generarUso(med);
      await iniciar(a.intId);
      assert.strictEqual((await marcar(a.intId, a.tareaId, { hecha: true, lectura: 512.5 })).status, 200);
      await finalizar(a.intId);

      const hecha = await tareaDelPlan(a.p.id, a.tareaPlanId);
      assert.deepStrictEqual([hecha.uso.ultimo, hecha.uso.proximo, hecha.uso.estado, hecha.estado], [512.5, 762.5, 'AL_DIA', 'AL_DIA']);

      // Reabrir: vuelve
      await accionOk(a.intId, 'reabrir', { estado_esperado: 'FINALIZADA', motivo: 'Sigue perdiendo aceite', maquina_detenida: false });
      const reabierta = await tareaDelPlan(a.p.id, a.tareaPlanId);
      assert.deepStrictEqual([reabierta.uso.ultimo, reabierta.uso.proximo, reabierta.estado], [null, 500, 'EN_CURSO']);

      // Cancelar o eliminar otra con la tarea: no cuenta
      const otro = await crearMedidor(m1, [600]);
      const b = await generarUso(otro);
      assert.strictEqual((await marcar(b.intId, b.tareaId, { hecha: true, lectura: 700 })).status, 200);
      await accionOk(b.intId, 'cancelar', { estado_esperado: 'PENDIENTE', motivo: 'Se reprograma' });
      const cancelada = await usoDe(b.p.id, b.tareaPlanId);
      assert.deepStrictEqual([cancelada.ultimo, cancelada.proximo], [null, 500]);

      const g2 = await generarOk(b.p.id);
      assert.strictEqual((await marcar(g2.intervencion.id, g2.tareas[0].id, { hecha: true, lectura: 800 })).status, 200);
      await accionOk(g2.intervencion.id, 'eliminar', { motivo: 'Generada de más' });
      const eliminada = await usoDe(b.p.id, b.tareaPlanId);
      assert.deepStrictEqual([eliminada.ultimo, eliminada.proximo], [null, 500]);
    });

    // =========================================================================
    // PV-28: Corrección en FINALIZADA
    // =========================================================================
    await t.test('PV-28: Corrección en FINALIZADA', async () => {
      const med = await crearMedidor(m1, [500]);
      const p = await crearPlan(m1, [tareaUso(med, { accion: 'Tarea X' }), tareaUso(med, { accion: 'Tarea Y' })], { responsable_usuario_id: R.id });
      const g = await generarOk(p.id, { tarea_ids: p.tareas.map((x: any) => x.id) });
      const intId = g.intervencion.id;
      const [x, y] = g.tareas;
      await iniciar(intId);
      await finalizar(intId);
      await cargarLectura(med, 600);
      const antes = (await lecturasDe(med)).length;

      const motivo = 'Se olvidó de marcarla';
      const r403 = await marcar(intId, x.id, { hecha: true, lectura: 480, motivo }, R.token);
      assert.deepStrictEqual([r403.status, r403.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);
      const sinMotivo = await marcar(intId, x.id, { hecha: true, lectura: 480 }, A.token);
      assert.deepStrictEqual([sinMotivo.status, sinMotivo.cuerpo.codigo], [422, 'MOTIVO_REQUERIDO']);
      const sinLectura = await marcar(intId, x.id, { hecha: true, motivo }, A.token);
      assert.deepStrictEqual([sinLectura.status, sinLectura.cuerpo.codigo], [422, 'LECTURA_REQUERIDA']);
      const mayor = await marcar(intId, x.id, { hecha: true, lectura: 700, motivo }, A.token);
      assert.deepStrictEqual([mayor.status, mayor.cuerpo.codigo, mayor.cuerpo.ultima.valor], [422, 'LECTURA_MAYOR', 600]);

      const ok = await marcar(intId, x.id, { hecha: true, lectura: 480, motivo }, A.token);
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.cuerpo));
      assert.deepStrictEqual([ok.cuerpo.uso.valor, ok.cuerpo.proximo_uso], [480, 730]);
      assert.strictEqual((await lecturasDe(med)).length, antes, 'Ninguna lectura nueva');
      assert.deepStrictEqual((await usoDe(p.id, x.plan_tarea_id)).ultimo, 480, 'La próxima, movida');

      // El valor, con coma decimal y sin separador de miles
      await cargarLectura(med, 2000);
      const conDecimal = await marcar(intId, y.id, { hecha: true, lectura: 1234.5, motivo }, A.token);
      assert.strictEqual(conDecimal.status, 200, JSON.stringify(conDecimal.cuerpo));

      const aud = (await client.query(
        `SELECT valor_nuevo, motivo FROM intervencion_auditoria
         WHERE intervencion_id = $1 AND tipo_evento = 'CORRECCION_TAREA' ORDER BY id`,
        [intId]
      )).rows;
      assert.deepStrictEqual(aud, [
        { valor_nuevo: 'Se marcó como hecha: Tarea X, con el medidor en 480 horas', motivo },
        { valor_nuevo: 'Se marcó como hecha: Tarea Y, con el medidor en 1234,5 horas', motivo },
      ]);
    });

    // =========================================================================
    // PV-29: Lo que llegue primero
    // =========================================================================
    await t.test('PV-29: Lo que llegue primero', async () => {
      const seisMeses = { frecuencia_valor: 6, frecuencia_unidad: 'MESES' };

      // Por uso: la lectura pasa el valor
      const med = await crearMedidor(m1, [600]);
      const p = await crearPlan(m1, [tarea(sumarDias(hoy, 100), { ...seisMeses, uso: { medidor_id: med, ...USO } })], { responsable_usuario_id: R.id });
      const id = p.tareas[0].id;
      assert.deepStrictEqual([p.tareas[0].estado, p.tareas[0].estado_fecha, p.tareas[0].uso.estado], ['VENCIDA', 'AL_DIA', 'VENCIDA']);

      const g = await generarOk(p.id);
      assert.strictEqual(g.tareas[0].fecha_programada, sumarDias(hoy, 100));
      await iniciar(g.intervencion.id);
      assert.strictEqual((await marcar(g.intervencion.id, g.tareas[0].id, { hecha: true, lectura: 610 })).status, 200);
      await finalizar(g.intervencion.id);

      const hecha = await tareaDelPlan(p.id, id);
      assert.deepStrictEqual(
        [hecha.ultima_ejecucion, hecha.proxima_fecha, hecha.uso.ultimo, hecha.uso.proximo, hecha.estado_fecha, hecha.uso.estado, hecha.estado],
        [hoy, await hoyMas('6 months'), 610, 860, 'AL_DIA', 'AL_DIA', 'AL_DIA']
      );

      // Por fecha: una ejecución hace 7 meses, con valor 100, y la lectura en 200
      const medF = await crearMedidor(m1, [200]);
      const pf = await crearPlan(m1, [tarea(sumarDias(hoy, 100), { ...seisMeses, uso: { medidor_id: medF, ...USO } })]);
      const tf = pf.tareas[0].id;
      const hace7 = await hoyMas('-7 months');
      await ejecucionUso(m1, pf.id, tf, { medidorId: medF, valor: 100, fin: `${hace7} 12:00:00-03` });
      const porFecha = await tareaDelPlan(pf.id, tf);
      assert.deepStrictEqual(
        [porFecha.estado, porFecha.estado_fecha, porFecha.uso.estado, porFecha.uso.ultimo, porFecha.uso.proximo],
        ['VENCIDA', 'VENCIDA', 'AL_DIA', 100, 350]
      );
    });

    // =========================================================================
    // PV-30: Concurrencia
    // =========================================================================
    await t.test('PV-30: Concurrencia', async () => {
      for (let vuelta = 1; vuelta <= 10; vuelta++) {
        // Marcar con una lectura mayor y cargar una lectura manual a la vez
        const med = await crearMedidor(m1, [10]);
        const a = await generarUso(med);
        const [marca, manual] = await Promise.all([
          marcar(a.intId, a.tareaId, { hecha: true, lectura: 20 }),
          pedir('POST', `/api/medidores/${med}/lecturas`, A.token, { valor: 30 }),
        ]);
        // La que pierde por el lock_timeout no deja nada hecho (PV3.1, 3)
        const lecturasMed = await lecturasDe(med);
        if (ocupado(manual)) {
          assert.ok(!lecturasMed.some((x) => x.origen === 'MANUAL' && Number(x.valor) === 30), `Vuelta ${vuelta}: sin la manual`);
        } else {
          assert.strictEqual(manual.status, 201, `Vuelta ${vuelta}: ${JSON.stringify(manual.cuerpo)}`);
        }
        if (marca.status !== 200) {
          assert.strictEqual(marca.status, marca.cuerpo.codigo === 'RECURSO_OCUPADO' ? 409 : 422, `Vuelta ${vuelta}: ${JSON.stringify(marca.cuerpo)}`);
          assert.ok(['LECTURA_MENOR', 'RECURSO_OCUPADO'].includes(marca.cuerpo.codigo), `Vuelta ${vuelta}: ${JSON.stringify(marca.cuerpo)}`);
          assert.strictEqual((await tareaInt(a.intId, a.tareaId)).hecha, false, `Vuelta ${vuelta}: la tarea no se marcó`);
          assert.ok(!lecturasMed.some((x) => x.origen === 'TAREA'), `Vuelta ${vuelta}: sin lectura de la tarea`);
        }
        const vigentes = lecturasMed.filter((x) => x.anulada_en === null).map((x) => Number(x.valor));
        for (let i = 1; i < vigentes.length; i++) {
          assert.ok(vigentes[i] >= vigentes[i - 1], `Vuelta ${vuelta}: las vigentes, por id, nunca bajan: ${vigentes}`);
        }

        // Cambiar una tarea a un medidor y desactivarlo a la vez
        const nuevo = await crearMedidor(m1);
        const p = await crearPlan(m1, [tarea(sumarDias(hoy, 30))]);
        const [cambio, baja] = await Promise.all([
          pedir('PATCH', `/api/planes/${p.id}/tareas/${p.tareas[0].id}`, A.token, { uso: { medidor_id: nuevo, ...USO } }),
          pedir('POST', `/api/medidores/${nuevo}/desactivar`, A.token, {}),
        ]);
        const detalleMed = (await pedir('GET', `/api/medidores/${nuevo}`, A.token)).cuerpo;
        const usoTarea = (await tareaDelPlan(p.id, p.tareas[0].id)).uso;
        if (ocupado(cambio)) {
          // El cambio perdió por el lock_timeout: la tarea sigue sin uso
          assert.deepStrictEqual([usoTarea, baja.status, detalleMed.activo], [null, 200, false], `Vuelta ${vuelta}: ${JSON.stringify(baja.cuerpo)}`);
        } else if (ocupado(baja)) {
          // Desactivar perdió por el lock_timeout: el medidor sigue activo
          assert.deepStrictEqual([cambio.status, usoTarea?.medidor.id, detalleMed.activo], [200, nuevo, true], `Vuelta ${vuelta}: ${JSON.stringify(cambio.cuerpo)}`);
        } else if (cambio.status === 200) {
          assert.deepStrictEqual([baja.status, baja.cuerpo.codigo, detalleMed.activo], [409, 'MEDIDOR_EN_USO', true], `Vuelta ${vuelta}: ${JSON.stringify(baja.cuerpo)}`);
        } else {
          assert.deepStrictEqual([cambio.status, cambio.cuerpo.codigo], [422, 'MEDIDOR_INVALIDO'], `Vuelta ${vuelta}: ${JSON.stringify(cambio.cuerpo)}`);
          assert.deepStrictEqual([baja.status, detalleMed.activo], [200, false], `Vuelta ${vuelta}: ${JSON.stringify(baja.cuerpo)}`);
        }
      }
    });

    // =========================================================================
    // PV-31: Contrato del uso
    // =========================================================================
    await t.test('PV-31: Contrato del uso', async () => {
      const med = await crearMedidor(m1, [512.5]);
      const p = await crearPlan(m1, [
        tarea(sumarDias(hoy, -3), {
          accion: 'Cambiar el aceite',
          detalle: 'Con el equipo frío',
          repuestos: [{ repuesto_id: repId, cantidad: 2.5 }],
          proveedor_id: provId,
          uso: { medidor_id: med, ...USO },
        }),
      ], { responsable_usuario_id: R.id, descripcion: 'Plan del contrato' });
      const g = await generarOk(p.id);
      await iniciar(g.intervencion.id);
      const [previstoContrato] = (await tareasDe(g.intervencion.id)).cuerpo.tareas[0].repuestos_previstos;
      const marcada = await marcar(g.intervencion.id, g.tareas[0].id, {
        hecha: true,
        observacion: 'Sin novedades',
        repuestos: [{ id: previstoContrato.id, cantidad: 2 }],
        lectura: 512.5,
      });
      assert.strictEqual(marcada.status, 200, JSON.stringify(marcada.cuerpo));

      const detalle = await detallePlan(p.id);
      const lista = (await pedir('GET', `/api/planes?maquina_id=${m1}`, A.token)).cuerpo.find((x: any) => x.id === p.id);
      const vencimientos = (await pedir('GET', `/api/planes/vencimientos?maquina_id=${m1}&estado=EN_CURSO`, A.token)).cuerpo;
      vencimientos.tareas = vencimientos.tareas.filter((x: any) => x.plan.id === p.id);
      const tareas = (await tareasDe(g.intervencion.id)).cuerpo;

      const verificar = (ruta: string, real: unknown, ejemplo: unknown) => {
        const diferencias = mismaForma(real, ejemplo);
        assert.deepStrictEqual(diferencias, [], `${ruta}:\n${diferencias.join('\n')}`);
      };
      assert.notStrictEqual(detalle.tareas[0].uso, null);
      assert.notStrictEqual(vencimientos.tareas[0].uso, null);
      assert.notStrictEqual(tareas.tareas[0].uso, null);
      verificar('GET /api/planes/:id', detalle, planDetalleEjemplo);
      verificar('GET /api/planes (un elemento)', lista, planListaEjemplo);
      verificar('GET /api/planes/vencimientos', vencimientos, vencimientosEjemplo);
      verificar('GET /api/intervenciones/:id/tareas', tareas, tareasIntervencionEjemplo);
      verificar('PATCH /api/intervenciones/:id/tareas/:tareaId', marcada.cuerpo, tareaMarcadaEjemplo);
    });
  } finally {
    client = await clienteSano(client);
    // Limpieza: solo lo que creó esta prueba
    try {
      const maquinas = createdMaquinaIds;
      const intIds = (await client.query('SELECT id FROM intervenciones WHERE maquina_id = ANY($1)', [maquinas])).rows.map((r) => Number(r.id));
      if (maquinas.length > 0) {
        await client.query(
          'DELETE FROM lecturas_medidor WHERE medidor_id IN (SELECT id FROM medidores WHERE maquina_id = ANY($1))',
          [maquinas]
        );
      }
      if (intIds.length > 0) {
        await client.query(
          'DELETE FROM intervencion_tarea_repuestos WHERE intervencion_tarea_id IN (SELECT id FROM intervencion_tareas WHERE intervencion_id = ANY($1))',
          [intIds]
        );
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
          `DELETE FROM plan_tarea_repuestos WHERE plan_tarea_id IN (
             SELECT t.id FROM plan_tareas t JOIN planes_mantenimiento p ON p.id = t.plan_id WHERE p.maquina_id = ANY($1)
           )`,
          [maquinas]
        );
        await client.query(
          'DELETE FROM plan_tareas WHERE plan_id IN (SELECT id FROM planes_mantenimiento WHERE maquina_id = ANY($1))',
          [maquinas]
        );
        await client.query('DELETE FROM planes_mantenimiento WHERE maquina_id = ANY($1)', [maquinas]);
        await client.query('DELETE FROM medidores WHERE maquina_id = ANY($1)', [maquinas]);
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

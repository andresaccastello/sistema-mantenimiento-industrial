import { test } from 'node:test';
import assert from 'node:assert';
import { sign } from 'hono/jwt';
import app from '../functions/api.ts';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';
import { JWT_SECRET } from '../functions/config.ts';
import { mismaForma } from './contrato.ts';
import {
  reportePreventivosSectorEjemplo,
  reportePreventivosMaquinaEjemplo,
  reportePreventivosPlanEjemplo,
} from '../../frontend/src/api/contrato-reportes.ts';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (REPORTES PREVENTIVOS TESTS)');
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

test('Etapa R1 — Cumplimiento de los preventivos en los reportes (RPV-01 a RPV-09)', async (t) => {
  let client = await pool.connect();

  const createdPlantaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdMedidorIds: number[] = [];
  const createdPlanIds: number[] = [];
  const createdTareaIds: number[] = [];
  const createdIntervencionIds: number[] = [];
  const createdUsuarioIds: number[] = [];

  const suf = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // Período de prueba fijo: junio 2025 en hora local (-03:00)
  const DESDE = '2025-06-01T03:00:00.000Z'; // 2025-06-01 00:00:00 -03:00
  const HASTA = '2025-06-11T02:59:59.999Z'; // 2025-06-10 23:59:59.999 -03:00

  let adminToken = '';
  let operarioToken = '';
  let respSectoresToken = '';

  let adminUserId = 0;
  let tipoPreventivoId = 2;
  let tipoCorrectivoId = 1;

  async function crearPlanta(nombre: string): Promise<number> {
    const res = await client.query(
      'INSERT INTO plantas (nombre, descripcion, activo) VALUES ($1, $2, TRUE) RETURNING id',
      [`${nombre} ${suf}`, `Desc ${nombre} ${suf}`]
    );
    const id = Number(res.rows[0].id);
    createdPlantaIds.push(id);
    return id;
  }

  async function crearSector(plantaId: number, nombre: string): Promise<number> {
    const res = await client.query(
      'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id',
      [nombre, plantaId]
    );
    const id = Number(res.rows[0].id);
    createdSectorIds.push(id);
    return id;
  }

  async function crearMaquina(sectorId: number, codigo: string, nombre: string): Promise<number> {
    const res = await client.query(
      'INSERT INTO maquinas (codigo, nombre, sector_id, activo) VALUES ($1, $2, $3, TRUE) RETURNING id',
      [codigo, nombre, sectorId]
    );
    const id = Number(res.rows[0].id);
    createdMaquinaIds.push(id);
    return id;
  }

  async function crearMedidor(maquinaId: number, nombre = 'Horómetro', unidad = 'hs'): Promise<number> {
    const res = await client.query(
      `INSERT INTO medidores (maquina_id, nombre, unidad, activo, creado_por_usuario_id)
       VALUES ($1, $2, $3, TRUE, $4) RETURNING id`,
      [maquinaId, `${nombre} ${suf}`, unidad, adminUserId]
    );
    const id = Number(res.rows[0].id);
    createdMedidorIds.push(id);
    return id;
  }

  async function crearPlan(maquinaId: number, nombre: string, anticipacion = 7): Promise<number> {
    const res = await client.query(
      `INSERT INTO planes_mantenimiento (maquina_id, nombre, anticipacion_dias, creado_por_usuario_id, activo)
       VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
      [maquinaId, nombre, anticipacion, adminUserId]
    );
    const id = Number(res.rows[0].id);
    createdPlanIds.push(id);
    return id;
  }

  async function crearTareaPlan(opciones: {
    planId: number;
    orden: number;
    accion?: string;
    primeraFecha?: string | null;
    frecuenciaValor?: number | null;
    frecuenciaUnidad?: string | null;
    medidorId?: number | null;
    usoCada?: number | null;
    usoPrimera?: number | null;
    usoAnticipacion?: number | null;
  }): Promise<number> {
    const tieneFecha = opciones.primeraFecha !== null;
    const primeraFecha = tieneFecha ? (opciones.primeraFecha ?? '2030-01-01') : null;
    const frecuenciaValor = tieneFecha ? (opciones.frecuenciaValor ?? 10) : null;
    const frecuenciaUnidad = tieneFecha ? (opciones.frecuenciaUnidad ?? 'ANIOS') : null;

    const res = await client.query(
      `INSERT INTO plan_tareas (
         plan_id, orden, accion,
         frecuencia_valor, frecuencia_unidad, primera_fecha,
         medidor_id, uso_cada, uso_primera, uso_anticipacion,
         activo
       ) VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, TRUE)
       RETURNING id`,
      [
        opciones.planId,
        opciones.orden,
        opciones.accion ?? `Tarea RPV ${opciones.orden}`,
        frecuenciaValor,
        frecuenciaUnidad,
        primeraFecha,
        opciones.medidorId ?? null,
        opciones.usoCada ?? null,
        opciones.usoPrimera ?? null,
        opciones.usoAnticipacion ?? null,
      ]
    );
    const id = Number(res.rows[0].id);
    createdTareaIds.push(id);
    return id;
  }

  async function crearIntervencion(opciones: {
    maquinaId: number;
    planId?: number | null;
    tipoId?: number;
    estado?: 'PENDIENTE' | 'EN_PROCESO' | 'FINALIZADA' | 'CANCELADA';
    fechaFinalizacion?: string;
    eliminada?: boolean;
  }): Promise<number> {
    const estado = opciones.estado ?? 'FINALIZADA';
    const fin = opciones.fechaFinalizacion ?? '2025-06-05T12:00:00-03:00';
    const esFinalizada = estado === 'FINALIZADA';
    const eliminada = Boolean(opciones.eliminada);

    const res = await client.query(
      `INSERT INTO intervenciones (
         maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, plan_mantenimiento_id,
         fecha_creacion, fecha_inicio, fecha_finalizacion, trabajo_realizado, ejecucion,
         eliminado_en, eliminado_por_usuario_id, motivo_eliminacion
       ) VALUES (
         $1, $2, $3, 'Intervención RPV', $4, $5,
         $6::timestamptz - interval '2 hours',
         CASE WHEN $7 THEN $6::timestamptz - interval '1 hour' ELSE NULL END,
         CASE WHEN $7 THEN $6::timestamptz ELSE NULL END,
         CASE WHEN $7 THEN 'Trabajo RPV' ELSE NULL END,
         CASE WHEN $7 THEN 'INTERNA' ELSE NULL END,
         CASE WHEN $8 THEN NOW() ELSE NULL END,
         CASE WHEN $8 THEN $3::bigint ELSE NULL END,
         CASE WHEN $8 THEN 'Eliminada RPV' ELSE NULL END
       ) RETURNING id`,
      [
        opciones.maquinaId,
        opciones.tipoId ?? tipoPreventivoId,
        adminUserId,
        estado,
        opciones.planId === undefined ? null : opciones.planId,
        fin,
        esFinalizada,
        eliminada,
      ]
    );
    const id = Number(res.rows[0].id);
    createdIntervencionIds.push(id);
    return id;
  }

  async function crearIntervencionTarea(opciones: {
    intervencionId: number;
    planTareaId: number;
    orden: number;
    fechaProgramada?: string | null;
    medidorId?: number | null;
    usoProgramado?: number | null;
    valorMedidor?: number | null;
    hecha?: boolean;
  }): Promise<number> {
    const hecha = opciones.hecha ?? true;
    const res = await client.query(
      `INSERT INTO intervencion_tareas (
         intervencion_id, plan_tarea_id, orden, accion,
         fecha_programada, medidor_id, uso_programado, valor_medidor,
         hecha, hecha_por_usuario_id, hecha_en
       ) VALUES (
         $1, $2, $3, $4,
         $5::date, $6, $7, $8,
         $9,
         CASE WHEN $9 THEN $10::bigint ELSE NULL END,
         CASE WHEN $9 THEN NOW() ELSE NULL END
       ) RETURNING id`,
      [
        opciones.intervencionId,
        opciones.planTareaId,
        opciones.orden,
        `Tarea int ${opciones.orden}`,
        opciones.fechaProgramada === undefined ? '2025-06-05' : opciones.fechaProgramada,
        opciones.medidorId ?? null,
        opciones.usoProgramado ?? null,
        opciones.valorMedidor ?? null,
        hecha,
        adminUserId,
      ]
    );
    return Number(res.rows[0].id);
  }

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

    // 3. Crear usuarios de prueba
    const resAdmin = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
       VALUES ($1, 'Admin', 'RPV', 'hash', $2, TRUE, 1) RETURNING id, legajo, sesion_version`,
      ['ADM_RPV_' + suf, adminPerfilId]
    );
    adminUserId = Number(resAdmin.rows[0].id);
    createdUsuarioIds.push(adminUserId);
    adminToken = await getTokenForUser(resAdmin.rows[0]);

    const resOp = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
       VALUES ($1, 'Operario', 'RPV', 'hash', $2, TRUE, 1) RETURNING id, legajo, sesion_version`,
      ['OP_RPV_' + suf, operarioPerfilId]
    );
    createdUsuarioIds.push(Number(resOp.rows[0].id));
    operarioToken = await getTokenForUser(resOp.rows[0]);

    // =========================================================================
    // RPV-01: Permisos y parámetros
    // =========================================================================
    await t.test('RPV-01: Permisos y parámetros (403 sin REPORTES_CONSULTAR; 422 con agrupar o sector_id inválido)', async () => {
      // Sin REPORTES_CONSULTAR -> 403
      const res403 = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&agrupar=sector`,
        { headers: { Authorization: `Bearer ${operarioToken}` } }
      );
      assert.strictEqual(res403.status, 403);

      // Sin agrupar -> 422
      const resSinAgrupar = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resSinAgrupar.status, 422);
      const bodySinAgrupar = (await resSinAgrupar.json()) as any;
      assert.strictEqual(bodySinAgrupar.codigo, 'DATOS_INVALIDOS');

      // Con agrupar=tipo -> 422
      const resAgruparInvalido = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&agrupar=tipo`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resAgruparInvalido.status, 422);
      const bodyAgruparInvalido = (await resAgruparInvalido.json()) as any;
      assert.strictEqual(bodyAgruparInvalido.codigo, 'DATOS_INVALIDOS');

      // Con sector_id=abc -> 422
      const resSectorInvalido = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&agrupar=sector&sector_id=abc`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resSectorInvalido.status, 422);
      const bodySectorInvalido = (await resSectorInvalido.json()) as any;
      assert.strictEqual(bodySectorInvalido.codigo, 'DATOS_INVALIDOS');
    });

    // =========================================================================
    // RPV-02: A tiempo y tarde por fecha
    // =========================================================================
    await t.test('RPV-02: A tiempo y tarde por fecha (mismo día, 1 día después, y 23:30 local que en UTC es día siguiente)', async () => {
      const plantaId = await crearPlanta('P-RPV02');
      const s1 = await crearSector(plantaId, 'S1-MismoDia');
      const s2 = await crearSector(plantaId, 'S2-UnDiaDespues');
      const s3 = await crearSector(plantaId, 'S3-2330Local');

      const m1 = await crearMaquina(s1, `M02A-${suf}`, 'Maq 02A');
      const m2 = await crearMaquina(s2, `M02B-${suf}`, 'Maq 02B');
      const m3 = await crearMaquina(s3, `M02C-${suf}`, 'Maq 02C');

      const p1 = await crearPlan(m1, 'Plan 02A');
      const p2 = await crearPlan(m2, 'Plan 02B');
      const p3 = await crearPlan(m3, 'Plan 02C');

      const t1 = await crearTareaPlan({ planId: p1, orden: 1 });
      const t2 = await crearTareaPlan({ planId: p2, orden: 1 });
      const t3 = await crearTareaPlan({ planId: p3, orden: 1 });

      // 1) Hecha el mismo día programado (2025-06-05 12:00 -03:00): a tiempo
      const i1 = await crearIntervencion({
        maquinaId: m1,
        planId: p1,
        fechaFinalizacion: '2025-06-05T12:00:00-03:00',
      });
      await crearIntervencionTarea({
        intervencionId: i1,
        planTareaId: t1,
        orden: 1,
        fechaProgramada: '2025-06-05',
      });

      // 2) Un día después (programada 2025-06-05, finalizada 2025-06-06 12:00 -03:00): tarde, atraso 1
      const i2 = await crearIntervencion({
        maquinaId: m2,
        planId: p2,
        fechaFinalizacion: '2025-06-06T12:00:00-03:00',
      });
      await crearIntervencionTarea({
        intervencionId: i2,
        planTareaId: t2,
        orden: 1,
        fechaProgramada: '2025-06-05',
      });

      // 3) Finalizada a las 23:30 locales del día programado (2025-06-05T23:30:00-03:00 = 2025-06-06T02:30:00Z): a tiempo
      const i3 = await crearIntervencion({
        maquinaId: m3,
        planId: p3,
        fechaFinalizacion: '2025-06-05T23:30:00-03:00',
      });
      await crearIntervencionTarea({
        intervencionId: i3,
        planTareaId: t3,
        orden: 1,
        fechaProgramada: '2025-06-05',
      });

      // Consultar S1 (mismo día)
      const res1 = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&sector_id=${s1}&agrupar=sector`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(res1.status, 200);
      const b1 = (await res1.json()) as any;
      assert.strictEqual(b1.resumen.hechas, 1);
      assert.strictEqual(b1.resumen.a_tiempo, 1);
      assert.strictEqual(b1.resumen.tarde, 0);
      assert.strictEqual(b1.resumen.cumplimiento, 100);
      assert.strictEqual(b1.resumen.atraso_promedio_dias, null);

      // Consultar S2 (un día después)
      const res2 = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&sector_id=${s2}&agrupar=sector`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(res2.status, 200);
      const b2 = (await res2.json()) as any;
      assert.strictEqual(b2.resumen.hechas, 1);
      assert.strictEqual(b2.resumen.a_tiempo, 0);
      assert.strictEqual(b2.resumen.tarde, 1);
      assert.strictEqual(b2.resumen.cumplimiento, 0);
      assert.strictEqual(b2.resumen.atraso_promedio_dias, 1);

      // Consultar S3 (23:30 local = 02:30 UTC del día siguiente -> a tiempo)
      const res3 = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&sector_id=${s3}&agrupar=sector`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(res3.status, 200);
      const b3 = (await res3.json()) as any;
      assert.strictEqual(b3.resumen.hechas, 1);
      assert.strictEqual(b3.resumen.a_tiempo, 1);
      assert.strictEqual(b3.resumen.tarde, 0);
      assert.strictEqual(b3.resumen.cumplimiento, 100);
      assert.strictEqual(b3.resumen.atraso_promedio_dias, null);
    });

    // =========================================================================
    // RPV-03: Por uso, y por las dos
    // =========================================================================
    await t.test('RPV-03: Por uso y por las dos (250/250 a tiempo, 260/250 tarde, y a tiempo en fecha pero pasada en uso -> tarde)', async () => {
      const plantaId = await crearPlanta('P-RPV03');
      const sUsoOk = await crearSector(plantaId, 'S-Uso250');
      const sUsoTarde = await crearSector(plantaId, 'S-Uso260');
      const sAmbas = await crearSector(plantaId, 'S-Ambas');

      const m1 = await crearMaquina(sUsoOk, `M03A-${suf}`, 'Maq 03A');
      const m2 = await crearMaquina(sUsoTarde, `M03B-${suf}`, 'Maq 03B');
      const m3 = await crearMaquina(sAmbas, `M03C-${suf}`, 'Maq 03C');

      const med1 = await crearMedidor(m1);
      const med2 = await crearMedidor(m2);
      const med3 = await crearMedidor(m3);

      const p1 = await crearPlan(m1, 'Plan 03A');
      const p2 = await crearPlan(m2, 'Plan 03B');
      const p3 = await crearPlan(m3, 'Plan 03C');

      // Tareas por uso (sin fecha)
      const t1 = await crearTareaPlan({
        planId: p1,
        orden: 1,
        primeraFecha: null,
        medidorId: med1,
        usoCada: 250,
        usoPrimera: 250,
        usoAnticipacion: 25,
      });
      const t2 = await crearTareaPlan({
        planId: p2,
        orden: 1,
        primeraFecha: null,
        medidorId: med2,
        usoCada: 250,
        usoPrimera: 250,
        usoAnticipacion: 25,
      });
      // Tarea con fecha y uso
      const t3 = await crearTareaPlan({
        planId: p3,
        orden: 1,
        primeraFecha: '2030-01-01',
        frecuenciaValor: 10,
        frecuenciaUnidad: 'ANIOS',
        medidorId: med3,
        usoCada: 250,
        usoPrimera: 250,
        usoAnticipacion: 25,
      });

      // 1) valor_medidor 250 con uso_programado 250 -> a tiempo
      const i1 = await crearIntervencion({ maquinaId: m1, planId: p1 });
      await crearIntervencionTarea({
        intervencionId: i1,
        planTareaId: t1,
        orden: 1,
        fechaProgramada: null,
        medidorId: med1,
        usoProgramado: 250,
        valorMedidor: 250,
      });

      // 2) valor_medidor 260 con uso_programado 250 -> tarde
      const i2 = await crearIntervencion({ maquinaId: m2, planId: p2 });
      await crearIntervencionTarea({
        intervencionId: i2,
        planTareaId: t2,
        orden: 1,
        fechaProgramada: null,
        medidorId: med2,
        usoProgramado: 250,
        valorMedidor: 260,
      });

      // 3) Con las dos: a tiempo en fecha (2025-06-05 <= 2025-06-05) pero pasada en uso (260 > 250) -> tarde, sin atraso en días
      const i3 = await crearIntervencion({
        maquinaId: m3,
        planId: p3,
        fechaFinalizacion: '2025-06-05T12:00:00-03:00',
      });
      await crearIntervencionTarea({
        intervencionId: i3,
        planTareaId: t3,
        orden: 1,
        fechaProgramada: '2025-06-05',
        medidorId: med3,
        usoProgramado: 250,
        valorMedidor: 260,
      });

      const res1 = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&sector_id=${sUsoOk}&agrupar=sector`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(res1.status, 200);
      const b1 = (await res1.json()) as any;
      assert.strictEqual(b1.resumen.hechas, 1);
      assert.strictEqual(b1.resumen.a_tiempo, 1);
      assert.strictEqual(b1.resumen.tarde, 0);

      const res2 = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&sector_id=${sUsoTarde}&agrupar=sector`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(res2.status, 200);
      const b2 = (await res2.json()) as any;
      assert.strictEqual(b2.resumen.hechas, 1);
      assert.strictEqual(b2.resumen.a_tiempo, 0);
      assert.strictEqual(b2.resumen.tarde, 1);
      assert.strictEqual(b2.resumen.atraso_promedio_dias, null);

      const res3 = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&sector_id=${sAmbas}&agrupar=sector`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(res3.status, 200);
      const b3 = (await res3.json()) as any;
      assert.strictEqual(b3.resumen.hechas, 1);
      assert.strictEqual(b3.resumen.a_tiempo, 0);
      assert.strictEqual(b3.resumen.tarde, 1);
      assert.strictEqual(b3.resumen.atraso_promedio_dias, null);
    });

    // =========================================================================
    // RPV-04: Lo que no cuenta
    // =========================================================================
    await t.test('RPV-04: Lo que no cuenta (tarea sin hacer, intervención cancelada/eliminada, fuera del período, correctiva)', async () => {
      const plantaId = await crearPlanta('P-RPV04');
      const sectorId = await crearSector(plantaId, 'S-NoCuenta');
      const maqId = await crearMaquina(sectorId, `M04-${suf}`, 'Maq 04');
      const planId = await crearPlan(maqId, 'Plan 04');

      // Tareas con primeraFecha futura para que no cuenten como vencidas_sin_hacer
      const tSinHacer = await crearTareaPlan({ planId, orden: 1, primeraFecha: '2030-01-01' });
      const tCancelada = await crearTareaPlan({ planId, orden: 2, primeraFecha: '2030-01-01' });
      const tEliminada = await crearTareaPlan({ planId, orden: 3, primeraFecha: '2030-01-01' });
      const tFueraPeriodo = await crearTareaPlan({ planId, orden: 4, primeraFecha: '2030-01-01' });

      // 1) Tarea sin hacer (hecha = false) en intervención finalizada en el período
      const iSinHacer = await crearIntervencion({
        maquinaId: maqId,
        planId,
        estado: 'FINALIZADA',
        fechaFinalizacion: '2025-06-05T12:00:00-03:00',
      });
      await crearIntervencionTarea({
        intervencionId: iSinHacer,
        planTareaId: tSinHacer,
        orden: 1,
        fechaProgramada: '2025-06-05',
        hecha: false,
      });

      // 2) Intervención CANCELADA con tarea hecha
      const iCancelada = await crearIntervencion({
        maquinaId: maqId,
        planId,
        estado: 'CANCELADA',
        fechaFinalizacion: '2025-06-05T12:00:00-03:00',
      });
      await crearIntervencionTarea({
        intervencionId: iCancelada,
        planTareaId: tCancelada,
        orden: 2,
        fechaProgramada: '2025-06-05',
        hecha: true,
      });

      // 3) Intervención eliminada lógicamente (FINALIZADA en el período pero eliminado_en IS NOT NULL)
      const iEliminada = await crearIntervencion({
        maquinaId: maqId,
        planId,
        estado: 'FINALIZADA',
        fechaFinalizacion: '2025-06-05T12:00:00-03:00',
        eliminada: true,
      });
      await crearIntervencionTarea({
        intervencionId: iEliminada,
        planTareaId: tEliminada,
        orden: 3,
        fechaProgramada: '2025-06-05',
        hecha: true,
      });

      // 4) Intervención finalizada fuera del período (mayo 2025)
      const iFuera = await crearIntervencion({
        maquinaId: maqId,
        planId,
        estado: 'FINALIZADA',
        fechaFinalizacion: '2025-05-20T12:00:00-03:00',
      });
      await crearIntervencionTarea({
        intervencionId: iFuera,
        planTareaId: tFueraPeriodo,
        orden: 4,
        fechaProgramada: '2025-05-20',
        hecha: true,
      });

      // 5) Intervención correctiva finalizada en el período (sin tareas de plan)
      await crearIntervencion({
        maquinaId: maqId,
        planId: null,
        tipoId: tipoCorrectivoId,
        estado: 'FINALIZADA',
        fechaFinalizacion: '2025-06-05T12:00:00-03:00',
      });

      const res = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&sector_id=${sectorId}&agrupar=sector`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(res.status, 200);
      const body = (await res.json()) as any;
      assert.strictEqual(body.resumen.hechas, 0);
      assert.strictEqual(body.resumen.a_tiempo, 0);
      assert.strictEqual(body.resumen.tarde, 0);
      assert.strictEqual(body.resumen.vencidas_sin_hacer, 0);
      assert.strictEqual(body.resumen.cumplimiento, null);
      assert.deepStrictEqual(body.grupos, []);
    });

    // =========================================================================
    // RPV-05: Vencidas sin hacer
    // =========================================================================
    await t.test('RPV-05: Vencidas sin hacer (VENCIDA con proxima_fecha en el período cuenta; fuera del período o solo por uso no cuenta)', async () => {
      const plantaId = await crearPlanta('P-RPV05');
      const sectorId = await crearSector(plantaId, 'S-Vencidas');
      const maqId = await crearMaquina(sectorId, `M05-${suf}`, 'Maq 05');
      const medId = await crearMedidor(maqId, 'Ciclos', 'ciclos');
      const planId = await crearPlan(maqId, 'Plan 05');

      // 1) Tarea VENCIDA con proxima_fecha en el período (2025-06-05) -> cuenta
      await crearTareaPlan({
        planId,
        orden: 1,
        primeraFecha: '2025-06-05',
        frecuenciaValor: 1,
        frecuenciaUnidad: 'MESES',
      });

      // 2) Tarea VENCIDA con proxima_fecha fuera del período (2025-05-15) -> no cuenta
      await crearTareaPlan({
        planId,
        orden: 2,
        primeraFecha: '2025-05-15',
        frecuenciaValor: 1,
        frecuenciaUnidad: 'MESES',
      });

      // 3) Tarea VENCIDA solo por uso (primeraFecha = null, usoPrimera = 100, lectura actual = 150) -> no cuenta
      await crearTareaPlan({
        planId,
        orden: 3,
        primeraFecha: null,
        medidorId: medId,
        usoCada: 100,
        usoPrimera: 100,
        usoAnticipacion: 10,
      });
      await client.query(
        `INSERT INTO lecturas_medidor (medidor_id, valor, registrada_por_usuario_id, origen)
         VALUES ($1, 150, $2, 'MANUAL')`,
        [medId, adminUserId]
      );

      const res = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&sector_id=${sectorId}&agrupar=sector`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(res.status, 200);
      const body = (await res.json()) as any;
      assert.strictEqual(body.resumen.hechas, 0);
      assert.strictEqual(body.resumen.a_tiempo, 0);
      assert.strictEqual(body.resumen.tarde, 0);
      assert.strictEqual(body.resumen.vencidas_sin_hacer, 1);
      assert.strictEqual(body.resumen.cumplimiento, 0);
      assert.strictEqual(body.resumen.atraso_promedio_dias, null);
      assert.strictEqual(body.grupos.length, 1);
      assert.strictEqual(body.grupos[0].vencidas_sin_hacer, 1);
    });

    // =========================================================================
    // RPV-06: Cumplimiento y atraso
    // =========================================================================
    await t.test('RPV-06: Cumplimiento y atraso (3 a tiempo, 1 tarde de 2 días y 1 vencida sin hacer -> 60.0 y 2.0; vacío -> null)', async () => {
      const plantaId = await crearPlanta('P-RPV06');
      const sectorDatos = await crearSector(plantaId, 'S-Calculo');
      const sectorVacio = await crearSector(plantaId, 'S-Vacio');

      const maqId = await crearMaquina(sectorDatos, `M06-${suf}`, 'Maq 06');
      const planId = await crearPlan(maqId, 'Plan 06');

      const t1 = await crearTareaPlan({ planId, orden: 1, primeraFecha: '2030-01-01' });
      const t2 = await crearTareaPlan({ planId, orden: 2, primeraFecha: '2030-01-01' });
      const t3 = await crearTareaPlan({ planId, orden: 3, primeraFecha: '2030-01-01' });
      const tTarde = await crearTareaPlan({ planId, orden: 4, primeraFecha: '2030-01-01' });
      // 1 vencida sin hacer con proxima_fecha en el período
      await crearTareaPlan({
        planId,
        orden: 5,
        primeraFecha: '2025-06-08',
        frecuenciaValor: 1,
        frecuenciaUnidad: 'MESES',
      });

      // 3 tareas a tiempo
      const iATiempo = await crearIntervencion({
        maquinaId: maqId,
        planId,
        fechaFinalizacion: '2025-06-05T14:00:00-03:00',
      });
      await crearIntervencionTarea({ intervencionId: iATiempo, planTareaId: t1, orden: 1, fechaProgramada: '2025-06-05' });
      await crearIntervencionTarea({ intervencionId: iATiempo, planTareaId: t2, orden: 2, fechaProgramada: '2025-06-05' });
      await crearIntervencionTarea({ intervencionId: iATiempo, planTareaId: t3, orden: 3, fechaProgramada: '2025-06-06' });

      // 1 tarea tarde (2 días de atraso: programada 2025-06-05, finalizada 2025-06-07)
      const iTarde = await crearIntervencion({
        maquinaId: maqId,
        planId,
        fechaFinalizacion: '2025-06-07T14:00:00-03:00',
      });
      await crearIntervencionTarea({ intervencionId: iTarde, planTareaId: tTarde, orden: 4, fechaProgramada: '2025-06-05' });

      const res = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&sector_id=${sectorDatos}&agrupar=sector`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(res.status, 200);
      const body = (await res.json()) as any;
      assert.deepStrictEqual(body.resumen, {
        hechas: 4,
        a_tiempo: 3,
        tarde: 1,
        vencidas_sin_hacer: 1,
        cumplimiento: 60.0,
        atraso_promedio_dias: 2.0,
      });

      // Sin nada en el período
      const resVacio = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&sector_id=${sectorVacio}&agrupar=sector`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resVacio.status, 200);
      const bodyVacio = (await resVacio.json()) as any;
      assert.deepStrictEqual(bodyVacio, {
        resumen: {
          hechas: 0,
          a_tiempo: 0,
          tarde: 0,
          vencidas_sin_hacer: 0,
          cumplimiento: null,
          atraso_promedio_dias: null,
        },
        grupos: [],
      });
    });

    // =========================================================================
    // RPV-07: Agrupar y ordenar + RPV-09: Contrato (mismaForma)
    // =========================================================================
    let rpv07PlantaId = 0;
    await t.test('RPV-07: Agrupar y ordenar por sector, maquina y plan (menor cumplimiento primero)', async () => {
      rpv07PlantaId = await crearPlanta('P-RPV07');
      const sAlto = await crearSector(rpv07PlantaId, 'Sector A Alto');
      const sBajo = await crearSector(rpv07PlantaId, 'Sector B Bajo');

      const mAlto = await crearMaquina(sAlto, `MA-${suf}`, 'Máquina Alta');
      const mBajo = await crearMaquina(sBajo, `MB-${suf}`, 'Máquina Baja');

      const pAlto = await crearPlan(mAlto, 'Plan Alto');
      const pBajo = await crearPlan(mBajo, 'Plan Bajo');

      const tAlto = await crearTareaPlan({ planId: pAlto, orden: 1, primeraFecha: '2030-01-01' });
      const tBajo1 = await crearTareaPlan({ planId: pBajo, orden: 1, primeraFecha: '2030-01-01' });
      const tBajo2 = await crearTareaPlan({ planId: pBajo, orden: 2, primeraFecha: '2030-01-01' });

      // Grupo Alto: 100% cumplimiento (1 a tiempo)
      const iAlto = await crearIntervencion({
        maquinaId: mAlto,
        planId: pAlto,
        fechaFinalizacion: '2025-06-05T10:00:00-03:00',
      });
      await crearIntervencionTarea({ intervencionId: iAlto, planTareaId: tAlto, orden: 1, fechaProgramada: '2025-06-05' });

      // Grupo Bajo: 50% cumplimiento (1 a tiempo, 1 tarde con 3 días de atraso)
      const iBajo = await crearIntervencion({
        maquinaId: mBajo,
        planId: pBajo,
        fechaFinalizacion: '2025-06-08T10:00:00-03:00',
      });
      await crearIntervencionTarea({ intervencionId: iBajo, planTareaId: tBajo1, orden: 1, fechaProgramada: '2025-06-08' });
      await crearIntervencionTarea({ intervencionId: iBajo, planTareaId: tBajo2, orden: 2, fechaProgramada: '2025-06-05' });

      // 1) agrupar=sector
      const resSector = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&planta_id=${rpv07PlantaId}&agrupar=sector`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resSector.status, 200);
      const bodySector = (await resSector.json()) as any;
      assert.strictEqual(bodySector.grupos.length, 2);
      assert.strictEqual(bodySector.grupos[0].sector.id, sBajo);
      assert.strictEqual(bodySector.grupos[0].cumplimiento, 50);
      assert.strictEqual(bodySector.grupos[0].atraso_promedio_dias, 3);
      assert.strictEqual(bodySector.grupos[1].sector.id, sAlto);
      assert.strictEqual(bodySector.grupos[1].cumplimiento, 100);

      // 2) agrupar=maquina
      const resMaq = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&planta_id=${rpv07PlantaId}&agrupar=maquina`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resMaq.status, 200);
      const bodyMaq = (await resMaq.json()) as any;
      assert.strictEqual(bodyMaq.grupos.length, 2);
      assert.strictEqual(bodyMaq.grupos[0].maquina.id, mBajo);
      assert.strictEqual(bodyMaq.grupos[0].maquina.codigo, `MB-${suf}`);
      assert.strictEqual(bodyMaq.grupos[0].cumplimiento, 50);
      assert.strictEqual(bodyMaq.grupos[1].maquina.id, mAlto);
      assert.strictEqual(bodyMaq.grupos[1].cumplimiento, 100);

      // 3) agrupar=plan
      const resPlan = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&planta_id=${rpv07PlantaId}&agrupar=plan`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resPlan.status, 200);
      const bodyPlan = (await resPlan.json()) as any;
      assert.strictEqual(bodyPlan.grupos.length, 2);
      assert.strictEqual(bodyPlan.grupos[0].plan.id, pBajo);
      assert.strictEqual(bodyPlan.grupos[0].maquina.id, mBajo);
      assert.strictEqual(bodyPlan.grupos[0].cumplimiento, 50);
      assert.strictEqual(bodyPlan.grupos[1].plan.id, pAlto);
      assert.strictEqual(bodyPlan.grupos[1].maquina.id, mAlto);
      assert.strictEqual(bodyPlan.grupos[1].cumplimiento, 100);
    });

    // =========================================================================
    // RPV-08: Alcance
    // =========================================================================
    await t.test('RPV-08: Alcance SECTORES (solo ve sus sectores; con sector_id ajeno devuelve vacío)', async () => {
      const plantaId = await crearPlanta('P-RPV08');
      const sectorPropio = await crearSector(plantaId, 'Sector Propio RPV08');
      const sectorAjeno = await crearSector(plantaId, 'Sector Ajeno RPV08');

      // Crear usuario con perfil RESPONSABLE_MANTENIMIENTO (alcance SECTORES en REPORTES_CONSULTAR)
      const resResp = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
         VALUES ($1, 'Resp', 'RPV', 'hash', $2, TRUE, 1) RETURNING id, legajo, sesion_version`,
        ['RESP_RPV_' + suf, respPerfilId]
      );
      const respUserId = Number(resResp.rows[0].id);
      createdUsuarioIds.push(respUserId);
      await client.query(
        'INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)',
        [respUserId, sectorPropio]
      );
      const resPermRep = await client.query("SELECT id FROM permisos WHERE codigo = 'REPORTES_CONSULTAR'");
      const permRepId = Number(resPermRep.rows[0].id);
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
         VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Test RPV-08 alcance SECTORES', $3)`,
        [respUserId, permRepId, adminUserId]
      );
      respSectoresToken = await getTokenForUser(resResp.rows[0]);

      const mPropia = await crearMaquina(sectorPropio, `M08P-${suf}`, 'Maq Propia');
      const mAjena = await crearMaquina(sectorAjeno, `M08A-${suf}`, 'Maq Ajena');

      const pPropio = await crearPlan(mPropia, 'Plan Propio');
      const pAjeno = await crearPlan(mAjena, 'Plan Ajeno');

      const tPropia = await crearTareaPlan({ planId: pPropio, orden: 1, primeraFecha: '2030-01-01' });
      const tAjena = await crearTareaPlan({ planId: pAjeno, orden: 1, primeraFecha: '2030-01-01' });

      const iPropia = await crearIntervencion({ maquinaId: mPropia, planId: pPropio });
      await crearIntervencionTarea({ intervencionId: iPropia, planTareaId: tPropia, orden: 1 });

      const iAjena = await crearIntervencion({ maquinaId: mAjena, planId: pAjeno });
      await crearIntervencionTarea({ intervencionId: iAjena, planTareaId: tAjena, orden: 1 });

      // Sin sector_id: solo ve sectorPropio
      const resSinFiltro = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&agrupar=sector`,
        { headers: { Authorization: `Bearer ${respSectoresToken}` } }
      );
      assert.strictEqual(resSinFiltro.status, 200);
      const bodySinFiltro = (await resSinFiltro.json()) as any;
      assert.strictEqual(bodySinFiltro.resumen.hechas, 1);
      assert.strictEqual(bodySinFiltro.grupos.length, 1);
      assert.strictEqual(bodySinFiltro.grupos[0].sector.id, sectorPropio);

      // Con sector_id de otro sector: resultado vacío
      const resAjeno = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&sector_id=${sectorAjeno}&agrupar=sector`,
        { headers: { Authorization: `Bearer ${respSectoresToken}` } }
      );
      assert.strictEqual(resAjeno.status, 200);
      const bodyAjeno = (await resAjeno.json()) as any;
      assert.strictEqual(bodyAjeno.resumen.hechas, 0);
      assert.strictEqual(bodyAjeno.resumen.cumplimiento, null);
      assert.deepStrictEqual(bodyAjeno.grupos, []);
    });

    // =========================================================================
    // RPV-09: Contrato (mismaForma)
    // =========================================================================
    await t.test('RPV-09: Contrato mismaForma sin diferencias para agrupar=sector, maquina y plan', async () => {
      const resSector = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&planta_id=${rpv07PlantaId}&agrupar=sector`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resSector.status, 200);
      const realSector = await resSector.json();
      assert.deepStrictEqual(mismaForma(realSector, reportePreventivosSectorEjemplo), []);

      const resMaquina = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&planta_id=${rpv07PlantaId}&agrupar=maquina`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resMaquina.status, 200);
      const realMaquina = await resMaquina.json();
      assert.deepStrictEqual(mismaForma(realMaquina, reportePreventivosMaquinaEjemplo), []);

      const resPlan = await app.request(
        `/api/reportes/preventivos?desde=${DESDE}&hasta=${HASTA}&planta_id=${rpv07PlantaId}&agrupar=plan`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      assert.strictEqual(resPlan.status, 200);
      const realPlan = await resPlan.json();
      assert.deepStrictEqual(mismaForma(realPlan, reportePreventivosPlanEjemplo), []);
    });
  } finally {
    client = await clienteSano(client);
    try {
      if (createdMedidorIds.length > 0) {
        await client.query('DELETE FROM lecturas_medidor WHERE medidor_id = ANY($1)', [createdMedidorIds]);
      }
      if (createdIntervencionIds.length > 0) {
        await client.query('DELETE FROM intervencion_tareas WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervenciones WHERE id = ANY($1)', [createdIntervencionIds]);
      }
      if (createdTareaIds.length > 0) {
        await client.query('DELETE FROM plan_tareas WHERE id = ANY($1)', [createdTareaIds]);
      }
      if (createdPlanIds.length > 0) {
        await client.query('DELETE FROM planes_mantenimiento WHERE id = ANY($1)', [createdPlanIds]);
      }
      if (createdMedidorIds.length > 0) {
        await client.query('DELETE FROM medidores WHERE id = ANY($1)', [createdMedidorIds]);
      }
      if (createdMaquinaIds.length > 0) {
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
    } catch (cleanErr) {
      console.error('Error limpiando datos de reportes_preventivos.test.ts:', cleanErr);
    } finally {
      client.release();
    }
  }
});


import { test } from 'node:test';
import assert from 'node:assert';
import { sign } from 'hono/jwt';
import app from '../functions/api.ts';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';
import { JWT_SECRET } from '../functions/config.ts';
import { armarPeriodos, MAXIMO_PERIODOS } from '../functions/reportes/periodos.ts';
import { ErrorNegocio } from '../functions/intervenciones/errores.ts';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (REPORTES EVOLUCIÓN TESTS)');
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

interface Periodo {
  inicio: string;
  fin: string;
  fallas: number;
  correctivas_finalizadas: number;
  preventivas_finalizadas: number;
  inactividad_minutos: number;
  disponibilidad: number | null;
  costo: Record<string, number> | null;
}

const centavos = (n: number) => Math.round(n * 100);

test('Etapa GR1 — Evolución por período en reportes (EV-01 a EV-08)', async (t) => {
  let client = await pool.connect();

  const createdPlantaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdIntervencionIds: number[] = [];
  const createdUsuarioIds: number[] = [];
  const createdRepuestoIds: number[] = [];

  const suf = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  try {
    // La zona de la instalación: las fechas de la prueba son locales
    const zona: string = (
      await client.query(
        `SELECT COALESCE((SELECT zona_horaria FROM configuracion_sistema WHERE id = 1), 'America/Argentina/Buenos_Aires') AS z`
      )
    ).rows[0].z;
    /** "2025-08-05 10:00" local de la instalación, como ISO. */
    const local = async (texto: string): Promise<string> =>
      new Date((await client.query('SELECT ($1::timestamp AT TIME ZONE $2) AS ts', [texto, zona])).rows[0].ts).toISOString();

    const tipos = await client.query('SELECT id, codigo FROM tipos_intervencion');
    const tipo = (codigo: string) => Number(tipos.rows.find((r: any) => r.codigo === codigo).id);
    const CORRECTIVO = tipo('CORRECTIVO');
    const PREVENTIVO = tipo('PREVENTIVO');

    const perfiles = await client.query('SELECT id, nombre FROM perfiles');
    const perfil = (nombre: string) => Number(perfiles.rows.find((r: any) => r.nombre === nombre).id);
    const permisos = await client.query(`SELECT id, codigo FROM permisos WHERE codigo IN ('REPORTES_CONSULTAR', 'COSTOS_VER')`);
    const permiso = (codigo: string) => Number(permisos.rows.find((r: any) => r.codigo === codigo).id);

    // Planta, dos sectores y tres máquinas propias
    const plantaId = Number(
      (await client.query('INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', ['Planta EV ' + suf])).rows[0].id
    );
    createdPlantaIds.push(plantaId);
    const sector = async (nombre: string) => {
      const id = Number(
        (await client.query('INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [nombre + suf, plantaId]))
          .rows[0].id
      );
      createdSectorIds.push(id);
      return id;
    };
    const sectorId = await sector('Sector EV ');
    const otroSectorId = await sector('Sector EV otro ');

    const maquina = async (nombre: string, sId: number) => {
      const id = Number(
        (
          await client.query(
            "INSERT INTO maquinas (nombre, codigo, sector_id, estado, activo) VALUES ($1, $2, $3, 'OPERATIVA', TRUE) RETURNING id",
            [nombre + ' ' + suf, nombre.slice(0, 3).toUpperCase() + '-' + suf, sId]
          )
        ).rows[0].id
      );
      createdMaquinaIds.push(id);
      return id;
    };
    const m1 = await maquina('Torno EV', sectorId);
    const m2 = await maquina('Fresa EV', sectorId);
    const m3 = await maquina('Prensa EV', otroSectorId);

    // Usuarios: administrador, sin costos, con alcance a otro sector y operario
    const usuario = async (nombre: string, perfilNombre: string) => {
      const r = (
        await client.query(
          `INSERT INTO usuarios (nombre, apellido, legajo, email, password_hash, perfil_id, activo, sesion_version, debe_cambiar_password)
           VALUES ($1, 'EV', $2, $3, 'hash', $4, TRUE, 1, FALSE) RETURNING id, legajo, sesion_version`,
          [nombre, `${nombre}-${suf}`, `${nombre.toLowerCase()}_${suf}@prueba.com`, perfil(perfilNombre)]
        )
      ).rows[0];
      const id = Number(r.id);
      createdUsuarioIds.push(id);
      return { id, token: await getTokenForUser({ id, legajo: r.legajo, sesion_version: r.sesion_version }) };
    };
    const admin = await usuario('Admin', 'ADMINISTRADOR');
    const sinCostos = await usuario('SinCostos', 'ADMINISTRADOR');
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'DENEGAR', 'Sin costos', $3)`,
      [sinCostos.id, permiso('COSTOS_VER'), admin.id]
    );
    const deOtroSector = await usuario('OtroSector', 'RESPONSABLE_MANTENIMIENTO');
    await client.query('INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)', [deOtroSector.id, otroSectorId]);
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Alcance a su sector', $3)`,
      [deOtroSector.id, permiso('REPORTES_CONSULTAR'), admin.id]
    );
    const operario = await usuario('Operario', 'OPERARIO');

    // Intervenciones con fechas fijas, locales
    const intervencion = async (
      maquinaId: number,
      tipoId: number,
      estado: string,
      creada: string,
      finalizada: string | null = null
    ) => {
      const id = Number(
        (
          await client.query(
            `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, ejecucion,
               trabajo_realizado, fecha_creacion, fecha_inicio, fecha_finalizacion)
             VALUES ($1, $2, $3, 'Intervención de prueba EV', $4::text, 'INTERNA',
               CASE WHEN $4::text = 'FINALIZADA' THEN 'Hecho' END,
               $5::timestamptz, CASE WHEN $4::text IN ('EN_PROCESO', 'FINALIZADA') THEN $5::timestamptz END, $6::timestamptz)
             RETURNING id`,
            [maquinaId, tipoId, admin.id, estado, await local(creada), finalizada ? await local(finalizada) : null]
          )
        ).rows[0].id
      );
      createdIntervencionIds.push(id);
      return id;
    };
    const detencion = async (intervencionId: number, maquinaId: number, desde: string, hasta: string) =>
      client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, hasta, abierto_por_usuario_id, confirmado_por_usuario_id)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [intervencionId, maquinaId, await local(desde), await local(hasta), admin.id]
      );

    // M1: una correctiva de agosto finalizada, una de septiembre abierta, una cancelada y una justo al 1/9 a las 0:00
    const f1 = await intervencion(m1, CORRECTIVO, 'FINALIZADA', '2025-08-05 10:00', '2025-08-06 12:00');
    const f2 = await intervencion(m1, CORRECTIVO, 'EN_PROCESO', '2025-09-10 09:00');
    await intervencion(m1, CORRECTIVO, 'CANCELADA', '2025-09-12 09:00');
    await intervencion(m1, CORRECTIVO, 'PENDIENTE', '2025-09-01 00:00');
    // M2: una preventiva finalizada en octubre, con una detención que cruza del 31/8 al 1/9
    const p1 = await intervencion(m2, PREVENTIVO, 'FINALIZADA', '2025-08-31 20:00', '2025-10-15 16:00');
    await detencion(p1, m2, '2025-08-31 22:00', '2025-09-01 03:00');
    // M1: dos detenciones de 30 segundos en semanas distintas (el redondeo por llamada daría 2 minutos)
    await detencion(f2, m1, '2025-10-10 10:00:30', '2025-10-10 10:01:00');
    await detencion(f2, m1, '2025-10-20 10:00:30', '2025-10-20 10:01:00');
    // M3, del otro sector: una falla en agosto
    await intervencion(m3, CORRECTIVO, 'PENDIENTE', '2025-08-20 08:00');
    // EV-08: una falla el domingo 8/6 a las 23:30 y otra el lunes 9/6 a las 0:30
    await intervencion(m1, CORRECTIVO, 'PENDIENTE', '2025-06-08 23:30');
    await intervencion(m1, CORRECTIVO, 'PENDIENTE', '2025-06-09 00:30');

    // Costos de F1, de agosto a octubre, uno justo al 1/10 a las 0:00 y un ajuste negativo
    const repuestoId = Number(
      (await client.query('INSERT INTO repuestos (nombre, lleva_stock) VALUES ($1, FALSE) RETURNING id', ['Rodamiento EV ' + suf])).rows[0].id
    );
    createdRepuestoIds.push(repuestoId);
    await client.query(
      `INSERT INTO intervencion_repuestos (intervencion_id, repuesto_id, cantidad, costo_unitario_aplicado, registrado_por_usuario_id, creado_en)
       VALUES ($1, $2, 2, 1500.50, $3, $4)`,
      [f1, repuestoId, admin.id, await local('2025-08-06 11:00')]
    );
    const renglon = async (tipoCosto: string, importe: number, cuando: string, extra: { horas?: number; motivo?: string } = {}) =>
      client.query(
        `INSERT INTO intervencion_costos (intervencion_id, tipo, descripcion, importe, horas, usuario_id, motivo, registrado_por_usuario_id, registrado_en)
         VALUES ($1, $2, 'Renglón EV', $3, $4, $5, $6, $7, $8)`,
        [
          f1,
          tipoCosto,
          importe,
          extra.horas ?? null,
          tipoCosto === 'MANO_OBRA' ? admin.id : null,
          extra.motivo ?? null,
          admin.id,
          await local(cuando),
        ]
      );
    await renglon('MANO_OBRA', 15000, '2025-09-02 10:00', { horas: 2 });
    await renglon('SERVICIO_EXTERNO', 20000.25, '2025-09-30 23:59');
    await renglon('TRANSPORTE', 3000, '2025-10-01 00:00');
    await renglon('OTRO', 1200, '2025-10-05 12:00');
    await renglon('AJUSTE', -500, '2025-10-06 12:00', { motivo: 'Descuento de prueba' });

    const getJson = async (url: string, token: string) => {
      const res = await app.request(url, { headers: { Authorization: `Bearer ${token}` } });
      return { status: res.status, body: (await res.json()) as any };
    };
    const consulta = (params: Record<string, string>) => new URLSearchParams(params).toString();

    // Del 1/8 al 31/10 locales: 92 días, el fin como lo manda el front (la medianoche siguiente)
    const desde = await local('2025-08-01 00:00');
    const hasta = await local('2025-11-01 00:00');
    const base = { desde, hasta, sector_id: String(sectorId) };

    await t.test('EV-01: La forma, los recortes y los períodos vacíos', async () => {
      const d = await local('2025-08-13 10:00'); // miércoles
      const h = await local('2025-09-10 15:00'); // miércoles
      const r = await getJson(`/api/reportes/evolucion?${consulta({ desde: d, hasta: h, sector_id: String(sectorId), agrupar: 'semana' })}`, admin.token);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.agrupar, 'semana');
      assert.strictEqual(r.body.desde, d);
      assert.strictEqual(r.body.hasta, h);
      const p: Periodo[] = r.body.periodos;
      assert.deepStrictEqual(
        p.map((x) => [x.inicio, x.fin]),
        [
          ['2025-08-13', '2025-08-17'],
          ['2025-08-18', '2025-08-24'],
          ['2025-08-25', '2025-08-31'],
          ['2025-09-01', '2025-09-07'],
          ['2025-09-08', '2025-09-10'],
        ]
      );
      for (const x of p) {
        assert.match(x.inicio, /^\d{4}-\d{2}-\d{2}$/);
        assert.match(x.fin, /^\d{4}-\d{2}-\d{2}$/);
        for (const campo of ['fallas', 'correctivas_finalizadas', 'preventivas_finalizadas', 'inactividad_minutos', 'disponibilidad'] as const) {
          assert.strictEqual(typeof x[campo], 'number', `${campo} es número`);
        }
        assert.ok(x.costo !== null);
        for (const v of Object.values(x.costo!)) assert.strictEqual(typeof v, 'number');
      }
      // La semana del 18/8 no tiene nada (la falla de M3 es de otro sector): ceros y disponibilidad 1
      assert.deepStrictEqual(p[1], {
        inicio: '2025-08-18',
        fin: '2025-08-24',
        fallas: 0,
        correctivas_finalizadas: 0,
        preventivas_finalizadas: 0,
        inactividad_minutos: 0,
        disponibilidad: 1,
        costo: { repuestos: 0, mano_obra: 0, servicio_externo: 0, transporte: 0, otro: 0, ajuste: 0, total: 0 },
      });
      // La detención del 31/8 a las 22:00 al 1/9 a las 3:00: 120 en la semana del 25/8 y 180 en la del 1/9
      assert.strictEqual(p[2].inactividad_minutos, 120);
      assert.strictEqual(p[3].inactividad_minutos, 180);
      // La falla del 1/9 a las 0:00 va en la semana que empieza ese día
      assert.strictEqual(p[3].fallas, 1);
      assert.strictEqual(p[4].fallas, 1, 'La falla del 10/9 a las 9:00');

      // Por mes: agosto, septiembre y octubre, enteros
      const m = await getJson(`/api/reportes/evolucion?${consulta({ ...base, agrupar: 'mes' })}`, admin.token);
      assert.strictEqual(m.status, 200);
      assert.deepStrictEqual(
        (m.body.periodos as Periodo[]).map((x) => [x.inicio, x.fin, x.fallas, x.correctivas_finalizadas, x.preventivas_finalizadas]),
        [
          ['2025-08-01', '2025-08-31', 1, 1, 0],
          ['2025-09-01', '2025-09-30', 2, 0, 0],
          ['2025-10-01', '2025-10-31', 0, 0, 1],
        ]
      );
    });

    await t.test('EV-02: agrupar por omisión, agrupar inválido y el máximo de períodos', async () => {
      const r92 = await getJson(`/api/reportes/evolucion?${consulta(base)}`, admin.token);
      assert.strictEqual(r92.status, 200);
      assert.strictEqual(r92.body.agrupar, 'semana', '92 días: por semana');
      assert.strictEqual(r92.body.periodos[0].inicio, '2025-08-01');
      assert.strictEqual(r92.body.periodos.at(-1).fin, '2025-10-31');

      const r93 = await getJson(`/api/reportes/evolucion?${consulta({ ...base, hasta: await local('2025-11-02 00:00') })}`, admin.token);
      assert.strictEqual(r93.status, 200);
      assert.strictEqual(r93.body.agrupar, 'mes', '93 días: por mes');
      assert.deepStrictEqual(
        (r93.body.periodos as Periodo[]).map((x) => [x.inicio, x.fin]),
        [
          ['2025-08-01', '2025-08-31'],
          ['2025-09-01', '2025-09-30'],
          ['2025-10-01', '2025-10-31'],
          ['2025-11-01', '2025-11-01'],
        ],
        'Meses calendario: el 1/11 es su propio período, recortado'
      );

      for (const malo of ['anio', 'MES', 'dia']) {
        const r = await getJson(`/api/reportes/evolucion?${consulta({ ...base, agrupar: malo })}`, admin.token);
        assert.strictEqual(r.status, 422, malo);
        assert.strictEqual(r.body.codigo, 'DATOS_INVALIDOS');
      }

      // Por la API no se llega a 60: el intervalo ya está limitado a 366 días (como /indicadores)
      const largo = await getJson(
        `/api/reportes/evolucion?${consulta({ desde: await local('2024-01-01 00:00'), hasta: await local('2025-03-01 00:00'), agrupar: 'semana' })}`,
        admin.token
      );
      assert.strictEqual(largo.status, 422);
      assert.strictEqual(largo.body.codigo, 'DATOS_INVALIDOS');

      // El control de los 60 períodos, en la función que los arma
      assert.strictEqual(armarPeriodos('2024-01-01', '2025-02-23', 'semana').length, MAXIMO_PERIODOS);
      assert.throws(
        () => armarPeriodos('2024-01-01', '2025-03-01', 'semana'),
        (e: unknown) =>
          e instanceof ErrorNegocio && e.status === 422 && e.codigo === 'DATOS_INVALIDOS' && e.message === 'Acortá el período o agrupá por mes'
      );
      assert.strictEqual(armarPeriodos('2024-01-01', '2025-03-01', 'mes').length, 15);
    });

    const sumar = (p: Periodo[], campo: keyof Periodo) => p.reduce((acc, x) => acc + (x[campo] as number), 0);

    await t.test('EV-03: La suma de los períodos es igual a /indicadores', async () => {
      const ind = await getJson(`/api/reportes/indicadores?${consulta(base)}`, admin.token);
      assert.strictEqual(ind.status, 200);
      assert.strictEqual(ind.body.fallas, 3);
      assert.strictEqual(ind.body.inactividad_minutos, 301, '300 de la detención que cruza y 1 de los dos medios minutos');
      for (const agrupar of ['semana', 'mes']) {
        const r = await getJson(`/api/reportes/evolucion?${consulta({ ...base, agrupar })}`, admin.token);
        assert.strictEqual(r.status, 200);
        const p: Periodo[] = r.body.periodos;
        for (const campo of ['fallas', 'correctivas_finalizadas', 'preventivas_finalizadas', 'inactividad_minutos'] as const) {
          assert.strictEqual(sumar(p, campo), ind.body[campo], `${agrupar}: ${campo}`);
        }
      }
    });

    await t.test('EV-04: La suma de los costos es igual a /costos', async () => {
      const cos = await getJson(`/api/reportes/costos?${consulta(base)}`, admin.token);
      assert.strictEqual(cos.status, 200);
      assert.strictEqual(cos.body.total, 41701.25);
      for (const agrupar of ['semana', 'mes']) {
        const r = await getJson(`/api/reportes/evolucion?${consulta({ ...base, agrupar })}`, admin.token);
        const p: Periodo[] = r.body.periodos;
        for (const tipoCosto of ['repuestos', 'mano_obra', 'servicio_externo', 'transporte', 'otro', 'ajuste']) {
          const suma = p.reduce((acc, x) => acc + centavos(x.costo![tipoCosto]), 0);
          assert.strictEqual(suma, centavos(cos.body.por_tipo[tipoCosto]), `${agrupar}: ${tipoCosto}`);
        }
        assert.strictEqual(
          p.reduce((acc, x) => acc + centavos(x.costo!.total), 0),
          centavos(cos.body.total),
          `${agrupar}: total`
        );
      }
      // El servicio del 30/9 a las 23:59 queda en septiembre; el transporte del 1/10 a las 0:00, en octubre
      const m = await getJson(`/api/reportes/evolucion?${consulta({ ...base, agrupar: 'mes' })}`, admin.token);
      assert.deepStrictEqual(
        (m.body.periodos as Periodo[]).map((x) => x.costo),
        [
          { repuestos: 3001, mano_obra: 0, servicio_externo: 0, transporte: 0, otro: 0, ajuste: 0, total: 3001 },
          { repuestos: 0, mano_obra: 15000, servicio_externo: 20000.25, transporte: 0, otro: 0, ajuste: 0, total: 35000.25 },
          { repuestos: 0, mano_obra: 0, servicio_externo: 0, transporte: 3000, otro: 1200, ajuste: -500, total: 3700 },
        ]
      );
    });

    await t.test('EV-05: Una detención que cruza dos meses se reparte entre los dos', async () => {
      const m = await getJson(`/api/reportes/evolucion?${consulta({ ...base, agrupar: 'mes' })}`, admin.token);
      const p: Periodo[] = m.body.periodos;
      assert.deepStrictEqual(
        p.map((x) => x.inactividad_minutos),
        [120, 180, 1]
      );
      const ind = await getJson(`/api/reportes/indicadores?${consulta(base)}`, admin.token);
      assert.strictEqual(sumar(p, 'inactividad_minutos'), ind.body.inactividad_minutos);
      // Agosto: 2 máquinas por 31 días, menos 120 minutos
      assert.strictEqual(p[0].disponibilidad, Number((1 - 120 / (2 * 31 * 24 * 60)).toFixed(4)));
    });

    await t.test('EV-06: Sin COSTOS_VER, costo es null y el resto viene igual', async () => {
      const conCostos = await getJson(`/api/reportes/evolucion?${consulta({ ...base, agrupar: 'mes' })}`, admin.token);
      const sin = await getJson(`/api/reportes/evolucion?${consulta({ ...base, agrupar: 'mes' })}`, sinCostos.token);
      assert.strictEqual(sin.status, 200);
      for (const x of sin.body.periodos as Periodo[]) assert.strictEqual(x.costo, null);
      assert.deepStrictEqual(
        (sin.body.periodos as Periodo[]).map(({ costo, ...resto }) => resto),
        (conCostos.body.periodos as Periodo[]).map(({ costo, ...resto }) => resto)
      );
    });

    await t.test('EV-07: El alcance y los permisos', async () => {
      // Con SECTORES en el otro sector: solo la falla de M3, igual que /indicadores
      const conAlcance = { desde, hasta, agrupar: 'mes', planta_id: String(plantaId) };
      const r = await getJson(`/api/reportes/evolucion?${consulta(conAlcance)}`, deOtroSector.token);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      const ind = await getJson(`/api/reportes/indicadores?${consulta({ desde, hasta, planta_id: String(plantaId) })}`, deOtroSector.token);
      assert.strictEqual(ind.body.fallas, 1);
      assert.strictEqual(sumar(r.body.periodos, 'fallas'), 1);
      assert.strictEqual(r.body.periodos[0].fallas, 1, 'La falla del 20/8 de M3');

      // Un sector fuera del alcance responde como /indicadores: 200 y en cero
      const fuera = await getJson(`/api/reportes/evolucion?${consulta({ ...base, agrupar: 'mes' })}`, deOtroSector.token);
      const indFuera = await getJson(`/api/reportes/indicadores?${consulta(base)}`, deOtroSector.token);
      assert.strictEqual(fuera.status, 200);
      assert.strictEqual(indFuera.status, 200);
      assert.strictEqual(indFuera.body.fallas, 0);
      assert.strictEqual(indFuera.body.disponibilidad, null);
      for (const x of fuera.body.periodos as Periodo[]) {
        assert.strictEqual(x.fallas, 0);
        assert.strictEqual(x.inactividad_minutos, 0);
        assert.strictEqual(x.disponibilidad, null);
      }

      // Sin REPORTES_CONSULTAR: 403; sin sesión: 401
      const op = await getJson(`/api/reportes/evolucion?${consulta(base)}`, operario.token);
      assert.strictEqual(op.status, 403);
      const anon = await app.request(`/api/reportes/evolucion?${consulta(base)}`);
      assert.strictEqual(anon.status, 401);

      // Los errores de los filtros, como en /indicadores
      for (const params of [{ ...base, sector_id: 'abc' }, { ...base, planta_id: '0' }, { desde: hasta, hasta: desde }]) {
        const e = await getJson(`/api/reportes/evolucion?${consulta(params)}`, admin.token);
        const i = await getJson(`/api/reportes/indicadores?${consulta(params)}`, admin.token);
        assert.strictEqual(e.status, 422);
        assert.deepStrictEqual(e.body, i.body);
      }
    });

    await t.test('EV-08: Las semanas empiezan el lunes, según la fecha local', async () => {
      const r = await getJson(
        `/api/reportes/evolucion?${consulta({
          desde: await local('2025-06-02 00:00'),
          hasta: await local('2025-06-16 00:00'),
          sector_id: String(sectorId),
          agrupar: 'semana',
        })}`,
        admin.token
      );
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(
        (r.body.periodos as Periodo[]).map((x) => [x.inicio, x.fin, x.fallas]),
        [
          ['2025-06-02', '2025-06-08', 1],
          ['2025-06-09', '2025-06-15', 1],
        ],
        'La del domingo 23:30 queda en su semana; la del lunes 0:30, en la siguiente'
      );
    });
  } finally {
    client = await clienteSano(client);
    if (createdIntervencionIds.length > 0) {
      await client.query('DELETE FROM intervencion_costos WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
      await client.query('DELETE FROM intervencion_repuestos WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
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
    if (createdRepuestoIds.length > 0) {
      await client.query('DELETE FROM intervencion_repuestos WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
      await client.query('DELETE FROM movimientos_stock WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
      await client.query('DELETE FROM repuestos WHERE id = ANY($1)', [createdRepuestoIds]);
    }
    if (createdMaquinaIds.length > 0) {
      await client.query('DELETE FROM intervencion_periodos_detencion WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
      await client.query('DELETE FROM historial_estados_maquina WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
      await client.query('DELETE FROM maquinas WHERE id = ANY($1)', [createdMaquinaIds]);
    }
    if (createdUsuarioIds.length > 0) {
      await client.query(
        'DELETE FROM auditoria_permisos WHERE sobre_usuario_id = ANY($1) OR realizado_por_usuario_id = ANY($1)',
        [createdUsuarioIds]
      );
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

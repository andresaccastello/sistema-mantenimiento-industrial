import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';
import app from '../functions/api.ts';
import { JWT_SECRET } from '../functions/config.ts';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (RUTINAS TESTS)');
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
}

async function pedir(method: string, path: string, token: string | null, body?: unknown): Promise<Respuesta> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
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
  return { status: r.status, cuerpo };
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

test('Etapa RT1 — Tareas de rutina (RT-01 a RT-13)', async (t) => {
  let client = await pool.connect();

  const createdPlantaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdUsuarioIds: number[] = [];

  try {
    const suf = Date.now();
    const passHash = await bcrypt.hash('pass123', 10);
    const perfilMap: Record<string, number> = {};
    for (const r of (await client.query('SELECT id, nombre FROM perfiles')).rows) {
      perfilMap[r.nombre] = Number(r.id);
    }
    const permisoId = async (codigo: string) =>
      Number((await client.query('SELECT id FROM permisos WHERE codigo = $1', [codigo])).rows[0].id);

    /** El "hoy" de la base y las funciones de la 1.3: nunca el reloj de la máquina. */
    const sql1 = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows[0];
    const hoy: string = (await sql1(`SELECT to_char(hoy_instalacion(), 'YYYY-MM-DD') AS d`)).d;
    const diaHoy = async (delta: number): Promise<string> =>
      (await sql1(`SELECT to_char(hoy_instalacion() + $1::int, 'YYYY-MM-DD') AS d`, [delta])).d;
    const lunesDe = async (fecha: string): Promise<string> =>
      (await sql1(`SELECT to_char(periodo_rutina('SEMANAL', $1::date), 'YYYY-MM-DD') AS d`, [fecha])).d;
    const diariaHoy: boolean = (await sql1(`SELECT rutina_corresponde('DIARIA', FALSE, hoy_instalacion()) AS x`)).x;

    const pl = Number((await client.query(
      'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`RT_PL_${suf}`]
    )).rows[0].id);
    createdPlantaIds.push(pl);
    async function crearSector(nombre: string) {
      const id = Number((await client.query(
        'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`${nombre}_${suf}`, pl]
      )).rows[0].id);
      createdSectorIds.push(id);
      return id;
    }
    const s1 = await crearSector('RT_S1');
    const s2 = await crearSector('RT_S2');
    let numeroMaquina = 0;
    async function crearMaquina(sectorId = s1) {
      numeroMaquina++;
      const n = String(numeroMaquina).padStart(2, '0');
      const r = await client.query(
        `INSERT INTO maquinas (codigo, nombre, sector_id, activo) VALUES ($1, $2, $3, TRUE) RETURNING id`,
        [`RT_M${n}_${suf}`, `Maquina RT ${n}`, sectorId]
      );
      const id = Number(r.rows[0].id);
      createdMaquinaIds.push(id);
      return id;
    }

    async function crearUsuario(clave: string, perfil: string, sectores: number[]) {
      const res = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
         VALUES ($1, $2, 'RT', $3, $4, TRUE, 1) RETURNING id, legajo, sesion_version`,
        [`RT_${clave}_${suf}`, clave, passHash, perfilMap[perfil]]
      );
      const u = res.rows[0];
      const id = Number(u.id);
      createdUsuarioIds.push(id);
      for (const s of sectores) {
        await client.query('INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)', [id, s]);
      }
      return { id, token: await getTokenForUser({ id, legajo: u.legajo, sesion_version: Number(u.sesion_version) }) };
    }
    const A = await crearUsuario('Admin', 'ADMINISTRADOR', []);
    const R = await crearUsuario('Resp', 'RESPONSABLE_MANTENIMIENTO', [s1]);
    const O1 = await crearUsuario('Oper1', 'OPERARIO', [s1]);
    const O2 = await crearUsuario('Oper2', 'OPERARIO', [s1]);
    const O0 = await crearUsuario('Oper0', 'OPERARIO', []);
    // G: planes solo de s2. Rep: reportes solo de s2.
    const G = await crearUsuario('Gestor', 'OPERARIO', [s2]);
    const Rep = await crearUsuario('Reportes', 'OPERARIO', [s2]);
    const conceder = (usuarioId: number, permiso: number) =>
      client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
         VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Prueba de alcance', $3)`,
        [usuarioId, permiso, A.id]
      );
    await conceder(G.id, await permisoId('PLANES_GESTIONAR'));
    await conceder(Rep.id, await permisoId('REPORTES_CONSULTAR'));

    const m1 = await crearMaquina(s1);
    const m2 = await crearMaquina(s2);

    let numeroRutina = 0;
    async function rutina(maquinaId: number, frecuencia: 'DIARIA' | 'SEMANAL', extra: Record<string, unknown> = {}) {
      const r = await pedir('POST', `/api/maquinas/${maquinaId}/rutinas`, A.token, {
        descripcion: `Tarea ${++numeroRutina}`,
        frecuencia,
        ...extra,
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      return r.cuerpo;
    }
    const registrar = (rutinaId: number, periodo: string, usuarioId = O1.id) =>
      client.query('INSERT INTO rutina_registros (rutina_id, periodo, usuario_id) VALUES ($1, $2, $3)', [rutinaId, periodo, usuarioId]);
    const hoyDe = async (token: string, maquinaId?: number) => {
      const r = await pedir('GET', `/api/rutinas/hoy${maquinaId ? `?maquina_id=${maquinaId}` : ''}`, token);
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      return r.cuerpo;
    };
    const desdeIso = async (delta: number) =>
      new Date((await sql1(
        `SELECT ((hoy_instalacion() + $1::int)::timestamp AT TIME ZONE COALESCE(
           (SELECT zona_horaria FROM configuracion_sistema WHERE id = 1), 'America/Argentina/Buenos_Aires')) AS d`,
        [delta]
      )).d).toISOString();
    const reporte = async (query: string, token = A.token) => pedir('GET', `/api/reportes/rutinas?${query}`, token);

    // =========================================================================
    await t.test('RT-01: Alta válida y validaciones', async () => {
      const d = await pedir('POST', `/api/maquinas/${m1}/rutinas`, A.token, {
        descripcion: '  Limpiar el lente  ', frecuencia: 'DIARIA', incluye_sabado: true,
      });
      assert.strictEqual(d.status, 201, JSON.stringify(d.cuerpo));
      assert.strictEqual(d.cuerpo.descripcion, 'Limpiar el lente');
      assert.deepStrictEqual(
        [d.cuerpo.frecuencia, d.cuerpo.incluye_sabado, d.cuerpo.activa, d.cuerpo.vigente_desde, d.cuerpo.baja_en],
        ['DIARIA', true, true, hoy, null]
      );
      assert.deepStrictEqual(d.cuerpo.maquina.sector, { id: s1, nombre: `RT_S1_${suf}` });
      assert.deepStrictEqual(d.cuerpo.maquina.planta, { id: pl, nombre: `RT_PL_${suf}` });

      const s = await pedir('POST', `/api/maquinas/${m1}/rutinas`, A.token, { descripcion: 'Cambiar el agua', frecuencia: 'SEMANAL' });
      assert.strictEqual(s.status, 201, JSON.stringify(s.cuerpo));
      assert.deepStrictEqual([s.cuerpo.frecuencia, s.cuerpo.incluye_sabado], ['SEMANAL', false]);

      const malos: Array<[string, unknown]> = [
        ['descripción vacía', { descripcion: '   ', frecuencia: 'DIARIA' }],
        ['más de 200', { descripcion: 'x'.repeat(201), frecuencia: 'DIARIA' }],
        ['frecuencia inválida', { descripcion: 'Otra', frecuencia: 'MENSUAL' }],
        ['sábado en semanal', { descripcion: 'Otra', frecuencia: 'SEMANAL', incluye_sabado: true }],
        ['sábado "true"', { descripcion: 'Otra', frecuencia: 'DIARIA', incluye_sabado: 'true' }],
      ];
      for (const [caso, cuerpo] of malos) {
        const r = await pedir('POST', `/api/maquinas/${m1}/rutinas`, A.token, cuerpo);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], `${caso}: ${JSON.stringify(r.cuerpo)}`);
      }
      const inactiva = await crearMaquina(s1);
      await client.query('UPDATE maquinas SET activo = FALSE WHERE id = $1', [inactiva]);
      const ri = await pedir('POST', `/api/maquinas/${inactiva}/rutinas`, A.token, { descripcion: 'Otra', frecuencia: 'DIARIA' });
      assert.strictEqual(ri.status, 422, JSON.stringify(ri.cuerpo));
      assert.strictEqual((await sql1('SELECT count(*)::int AS n FROM rutinas WHERE maquina_id = $1', [inactiva])).n, 0);
    });

    // =========================================================================
    await t.test('RT-02: Descripción repetida', async () => {
      const m = await crearMaquina(s1);
      const a = await rutina(m, 'DIARIA', { descripcion: 'Purgar el aire' });
      const rep = await pedir('POST', `/api/maquinas/${m}/rutinas`, A.token, { descripcion: ' purgar el AIRE ', frecuencia: 'SEMANAL' });
      assert.deepStrictEqual([rep.status, rep.cuerpo.codigo], [409, 'RUTINA_DUPLICADA']);

      const baja = await pedir('PATCH', `/api/rutinas/${a.id}`, A.token, { activa: false });
      assert.strictEqual(baja.status, 200, JSON.stringify(baja.cuerpo));
      const b = await pedir('POST', `/api/maquinas/${m}/rutinas`, A.token, { descripcion: 'Purgar el aire', frecuencia: 'SEMANAL' });
      assert.strictEqual(b.status, 201, JSON.stringify(b.cuerpo));

      const reactivar = await pedir('PATCH', `/api/rutinas/${a.id}`, A.token, { activa: true });
      assert.deepStrictEqual([reactivar.status, reactivar.cuerpo.codigo], [409, 'RUTINA_DUPLICADA']);
      assert.strictEqual((await sql1('SELECT activa FROM rutinas WHERE id = $1', [a.id])).activa, false, 'Sigue de baja');
    });

    // =========================================================================
    await t.test('RT-03: Permisos y alcance de la gestión', async () => {
      const sin = await pedir('POST', `/api/maquinas/${m1}/rutinas`, O1.token, { descripcion: 'Otra', frecuencia: 'DIARIA' });
      assert.deepStrictEqual([sin.status, sin.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);
      const r = await rutina(m1, 'DIARIA');
      const sinPatch = await pedir('PATCH', `/api/rutinas/${r.id}`, O1.token, { descripcion: 'Cambiada' });
      assert.deepStrictEqual([sinPatch.status, sinPatch.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);

      // G gestiona planes solo de s2: la máquina de s1 da la respuesta de siempre para los planes
      const fuera = await pedir('POST', `/api/maquinas/${m1}/rutinas`, G.token, { descripcion: 'Otra', frecuencia: 'DIARIA' });
      assert.deepStrictEqual([fuera.status, fuera.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);
      const fueraPatch = await pedir('PATCH', `/api/rutinas/${r.id}`, G.token, { descripcion: 'Cambiada' });
      assert.deepStrictEqual([fueraPatch.status, fueraPatch.cuerpo.codigo], [404, 'RUTINA_NO_ENCONTRADA']);
      const fueraGet = await pedir('GET', `/api/maquinas/${m1}/rutinas`, G.token);
      assert.deepStrictEqual([fueraGet.status, fueraGet.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);

      const dentro = await pedir('POST', `/api/maquinas/${m2}/rutinas`, G.token, { descripcion: 'De s2', frecuencia: 'SEMANAL' });
      assert.strictEqual(dentro.status, 201, JSON.stringify(dentro.cuerpo));
      // Rep (reportes de s2) ve las de m2, no las de m1; el operario sin ninguno de los dos, 403
      assert.strictEqual((await pedir('GET', `/api/maquinas/${m2}/rutinas`, Rep.token)).status, 200);
      assert.strictEqual((await pedir('GET', `/api/maquinas/${m1}/rutinas`, Rep.token)).status, 403);
      assert.strictEqual((await pedir('GET', `/api/maquinas/${m1}/rutinas`, O1.token)).status, 403);
    });

    // =========================================================================
    await t.test('RT-04: PATCH', async () => {
      const r = await rutina(m1, 'DIARIA');
      await client.query(`UPDATE rutinas SET vigente_desde = hoy_instalacion() - 30 WHERE id = $1`, [r.id]);

      const frec = await pedir('PATCH', `/api/rutinas/${r.id}`, A.token, { frecuencia: 'SEMANAL' });
      assert.deepStrictEqual([frec.status, frec.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);

      const cambio = await pedir('PATCH', `/api/rutinas/${r.id}`, A.token, { descripcion: ' Nueva descripción ', incluye_sabado: true });
      assert.strictEqual(cambio.status, 200, JSON.stringify(cambio.cuerpo));
      assert.deepStrictEqual([cambio.cuerpo.descripcion, cambio.cuerpo.incluye_sabado], ['Nueva descripción', true]);

      const baja = await pedir('PATCH', `/api/rutinas/${r.id}`, A.token, { activa: false });
      assert.deepStrictEqual([baja.cuerpo.activa, baja.cuerpo.baja_en, baja.cuerpo.vigente_desde], [false, hoy, await diaHoy(-30)]);

      const re = await pedir('PATCH', `/api/rutinas/${r.id}`, A.token, { activa: true });
      assert.deepStrictEqual([re.status, re.cuerpo.activa, re.cuerpo.baja_en, re.cuerpo.vigente_desde], [200, true, null, hoy]);

      const sem = await rutina(m1, 'SEMANAL');
      const sab = await pedir('PATCH', `/api/rutinas/${sem.id}`, A.token, { incluye_sabado: true });
      assert.deepStrictEqual([sab.status, sab.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);
    });

    // =========================================================================
    await t.test('RT-05: Las tareas de hoy y su alcance', async () => {
      const m = await crearMaquina(s1);
      const mOtro = await crearMaquina(s2);
      const mInactiva = await crearMaquina(s1);
      const diaria = await rutina(m, 'DIARIA');
      const semanal = await rutina(m, 'SEMANAL');
      const deBaja = await rutina(m, 'SEMANAL');
      await pedir('PATCH', `/api/rutinas/${deBaja.id}`, A.token, { activa: false });
      const otra = await rutina(mOtro, 'SEMANAL');
      const deInactiva = await rutina(mInactiva, 'SEMANAL');
      await client.query('UPDATE maquinas SET activo = FALSE WHERE id = $1', [mInactiva]);

      const ids = (cuerpo: any) => cuerpo.rutinas.map((x: any) => x.id);
      const nuestras = (cuerpo: any) =>
        ids(cuerpo).filter((id: number) => [diaria.id, semanal.id, deBaja.id, otra.id, deInactiva.id].includes(id)).sort();

      const o = await hoyDe(O1.token);
      assert.strictEqual(o.hoy, hoy);
      assert.strictEqual(o.sin_sectores, false);
      const esperadasO = (diariaHoy ? [diaria.id, semanal.id] : [semanal.id]).sort();
      assert.deepStrictEqual(nuestras(o), esperadasO, 'El operario: solo s1, sin las de baja ni las de máquinas inactivas');
      for (const x of o.rutinas) assert.strictEqual(x.maquina.sector.id, s1, 'Todo de su sector');

      const o0 = await hoyDe(O0.token);
      assert.deepStrictEqual([o0.sin_sectores, o0.rutinas], [true, []]);

      const resp = await hoyDe(R.token);
      assert.deepStrictEqual(nuestras(resp), [...esperadasO, otra.id].sort(), 'El responsable, con TODAS, ve también s2');

      const filtro = await hoyDe(R.token, mOtro);
      assert.deepStrictEqual(ids(filtro), [otra.id]);
      const malFiltro = await pedir('GET', '/api/rutinas/hoy?maquina_id=abc', R.token);
      assert.strictEqual(malFiltro.status, 422);

      const sinPermiso = await pedir('GET', '/api/rutinas/hoy', Rep.token);
      assert.strictEqual(sinPermiso.status, 200, 'Rep es operario: tiene RUTINAS_REALIZAR');
      const sinRutinas = await crearUsuario('Consulta', 'CONSULTA', [s1]);
      assert.deepStrictEqual(
        [(await pedir('GET', '/api/rutinas/hoy', sinRutinas.token)).status],
        [403],
        'Sin RUTINAS_REALIZAR'
      );
    });

    // =========================================================================
    await t.test('RT-06: Marcar', async () => {
      const m = await crearMaquina(s1);
      const r = await rutina(m, 'SEMANAL');
      const ok = await pedir('POST', `/api/rutinas/${r.id}/hecha`, O1.token, { nota: ' Todo bien ' });
      assert.strictEqual(ok.status, 201, JSON.stringify(ok.cuerpo));
      assert.deepStrictEqual([ok.cuerpo.rutina_id, ok.cuerpo.periodo, ok.cuerpo.nota, ok.cuerpo.usuario.id], [r.id, await lunesDe(hoy), 'Todo bien', O1.id]);

      const otraVez = await pedir('POST', `/api/rutinas/${r.id}/hecha`, O1.token, {});
      assert.deepStrictEqual([otraVez.status, otraVez.cuerpo.codigo], [409, 'RUTINA_YA_HECHA']);
      const otroUsuario = await pedir('POST', `/api/rutinas/${r.id}/hecha`, O2.token, {});
      assert.deepStrictEqual([otroUsuario.status, otroUsuario.cuerpo.codigo], [409, 'RUTINA_YA_HECHA']);

      // Una semanal con registro en el lunes de esta semana aparece hecha
      const r2 = await rutina(m, 'SEMANAL');
      await registrar(r2.id, await lunesDe(hoy), O2.id);
      const r3 = await rutina(m, 'SEMANAL');
      const lista = await hoyDe(O1.token, m);
      assert.strictEqual(lista.rutinas[0].id, r3.id, 'La que falta va primero');
      const x = lista.rutinas.find((y: any) => y.id === r2.id);
      assert.ok(x.registro, 'Hecha');
      assert.strictEqual(x.registro.usuario.id, O2.id);
      assert.strictEqual(x.periodo, await lunesDe(hoy));
      // Las que faltan van primero
      const hechas = lista.rutinas.map((y: any) => y.registro !== null);
      assert.deepStrictEqual(hechas, [...hechas].sort((a: boolean, b: boolean) => Number(a) - Number(b)));

      if (diariaHoy) {
        const d = await rutina(m, 'DIARIA');
        const rd = await pedir('POST', `/api/rutinas/${d.id}/hecha`, O1.token, {});
        assert.deepStrictEqual([rd.status, rd.cuerpo.periodo], [201, hoy]);
      }
    });

    // =========================================================================
    await t.test('RT-07: Marcar lo que no corresponde', async () => {
      const m = await crearMaquina(s1);
      const baja = await rutina(m, 'SEMANAL');
      await pedir('PATCH', `/api/rutinas/${baja.id}`, A.token, { activa: false });
      const rb = await pedir('POST', `/api/rutinas/${baja.id}/hecha`, O1.token, {});
      assert.deepStrictEqual([rb.status, rb.cuerpo.codigo], [422, 'RUTINA_NO_CORRESPONDE']);

      // Una diaria sin sábado: corresponde solo si rutina_corresponde(…, hoy)
      const d = await rutina(m, 'DIARIA');
      const rd = await pedir('POST', `/api/rutinas/${d.id}/hecha`, O1.token, {});
      if (diariaHoy) {
        assert.strictEqual(rd.status, 201, 'Hoy toca');
      } else {
        assert.deepStrictEqual([rd.status, rd.cuerpo.codigo], [422, 'RUTINA_NO_CORRESPONDE']);
      }

      // Máquina inactiva
      const mi = await crearMaquina(s1);
      const ri = await rutina(mi, 'SEMANAL');
      await client.query('UPDATE maquinas SET activo = FALSE WHERE id = $1', [mi]);
      const rmi = await pedir('POST', `/api/rutinas/${ri.id}/hecha`, O1.token, {});
      assert.deepStrictEqual([rmi.status, rmi.cuerpo.codigo], [422, 'RUTINA_NO_CORRESPONDE']);

      // Fuera del alcance: 404
      const fuera = await rutina(m2, 'SEMANAL');
      const rf = await pedir('POST', `/api/rutinas/${fuera.id}/hecha`, O1.token, {});
      assert.deepStrictEqual([rf.status, rf.cuerpo.codigo], [404, 'RUTINA_NO_ENCONTRADA']);
      const noExiste = await pedir('POST', '/api/rutinas/999999999/hecha', O1.token, {});
      assert.deepStrictEqual([noExiste.status, noExiste.cuerpo.codigo], [404, 'RUTINA_NO_ENCONTRADA']);
    });

    // =========================================================================
    await t.test('RT-08: Deshacer', async () => {
      const m = await crearMaquina(s1);
      const r = await rutina(m, 'SEMANAL');
      const sinMarca = await pedir('DELETE', `/api/rutinas/${r.id}/hecha`, O1.token);
      assert.deepStrictEqual([sinMarca.status, sinMarca.cuerpo.codigo], [404, 'RUTINA_NO_ENCONTRADA']);

      assert.strictEqual((await pedir('POST', `/api/rutinas/${r.id}/hecha`, O1.token, {})).status, 201);
      const ajeno = await pedir('DELETE', `/api/rutinas/${r.id}/hecha`, O2.token);
      assert.deepStrictEqual([ajeno.status, ajeno.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);
      const propio = await pedir('DELETE', `/api/rutinas/${r.id}/hecha`, O1.token);
      assert.strictEqual(propio.status, 200, JSON.stringify(propio.cuerpo));
      assert.strictEqual((await sql1('SELECT count(*)::int AS n FROM rutina_registros WHERE rutina_id = $1', [r.id])).n, 0);

      // Un período pasado no se toca
      const pasada = await rutina(m, 'SEMANAL');
      await client.query(`UPDATE rutinas SET vigente_desde = hoy_instalacion() - 21 WHERE id = $1`, [pasada.id]);
      await registrar(pasada.id, await lunesDe(await diaHoy(-7)), O1.id);
      const rp = await pedir('DELETE', `/api/rutinas/${pasada.id}/hecha`, O1.token);
      assert.deepStrictEqual([rp.status, rp.cuerpo.codigo], [404, 'RUTINA_NO_ENCONTRADA']);
      assert.strictEqual((await sql1('SELECT count(*)::int AS n FROM rutina_registros WHERE rutina_id = $1', [pasada.id])).n, 1);
    });

    // =========================================================================
    await t.test('RT-09: Concurrencia al marcar', async () => {
      const m = await crearMaquina(s1);
      for (let i = 0; i < 3; i++) {
        const r = await rutina(m, 'SEMANAL');
        const [a, b] = await Promise.all([
          pedir('POST', `/api/rutinas/${r.id}/hecha`, O1.token, {}),
          pedir('POST', `/api/rutinas/${r.id}/hecha`, O2.token, {}),
        ]);
        assert.deepStrictEqual([a.status, b.status].sort(), [201, 409], `${JSON.stringify(a.cuerpo)} ${JSON.stringify(b.cuerpo)}`);
        const perdedor = a.status === 409 ? a : b;
        assert.strictEqual(perdedor.cuerpo.codigo, 'RUTINA_YA_HECHA');
        assert.strictEqual((await sql1('SELECT count(*)::int AS n FROM rutina_registros WHERE rutina_id = $1', [r.id])).n, 1);
      }
    });

    // =========================================================================
    await t.test('RT-10: Reporte de una diaria', async () => {
      const m = await crearMaquina(s1);
      const r = await rutina(m, 'DIARIA');
      await client.query(`UPDATE rutinas SET vigente_desde = hoy_instalacion() - 14 WHERE id = $1`, [r.id]);

      // Los días esperados, con la función de la base
      const esperados: string[] = (await client.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS d
         FROM generate_series(hoy_instalacion() - 14, hoy_instalacion(), interval '1 day') AS d
         WHERE rutina_corresponde('DIARIA', FALSE, d::date) ORDER BY d`
      )).rows.map((x) => x.d);
      const pasados = esperados.filter((d) => d !== hoy);
      await registrar(r.id, pasados[0], O1.id);
      await registrar(r.id, pasados[2], O2.id);
      // Antes de vigente_desde no se espera nada, aunque haya un registro
      const antes: string = (await sql1(
        `SELECT to_char(max(d), 'YYYY-MM-DD') AS d FROM generate_series(hoy_instalacion() - 30, hoy_instalacion() - 15, interval '1 day') AS d
         WHERE rutina_corresponde('DIARIA', FALSE, d::date)`
      )).d;
      await registrar(r.id, antes, O1.id);

      const rep = await reporte(`desde=${encodeURIComponent(await desdeIso(-20))}&maquina_id=${m}`);
      assert.strictEqual(rep.status, 200, JSON.stringify(rep.cuerpo));
      assert.strictEqual(rep.cuerpo.hoy, hoy);
      assert.strictEqual(rep.cuerpo.rutinas.length, 1);
      const x = rep.cuerpo.rutinas[0];
      assert.deepStrictEqual(x.periodos.map((p: any) => p.periodo), esperados);
      const estadoDe = (d: string) => x.periodos.find((p: any) => p.periodo === d).estado;
      assert.strictEqual(estadoDe(pasados[0]), 'HECHA');
      assert.strictEqual(estadoDe(pasados[2]), 'HECHA');
      assert.strictEqual(estadoDe(pasados[1]), 'NO_HECHA');
      const hecha = x.periodos.find((p: any) => p.periodo === pasados[2]);
      assert.strictEqual(hecha.usuario.id, O2.id);
      assert.ok(typeof hecha.hecha_en === 'string');
      const noHecha = x.periodos.find((p: any) => p.periodo === pasados[1]);
      assert.deepStrictEqual([noHecha.usuario, noHecha.hecha_en, noHecha.nota], [null, null, null]);
      if (diariaHoy) assert.strictEqual(estadoDe(hoy), 'PENDIENTE');

      const noHechas = pasados.length - 2;
      const resumen = {
        esperadas: esperados.length,
        hechas: 2,
        no_hechas: noHechas,
        pendientes: diariaHoy ? 1 : 0,
        porcentaje: Math.round((2 / (2 + noHechas)) * 100),
      };
      assert.deepStrictEqual(x.resumen, resumen);
      assert.deepStrictEqual(rep.cuerpo.resumen, resumen, 'Con el filtro, el total es esta rutina');
    });

    // =========================================================================
    await t.test('RT-11: Reporte de una semanal y de una dada de baja', async () => {
      const m = await crearMaquina(s1);
      const r = await rutina(m, 'SEMANAL');
      await client.query(`UPDATE rutinas SET vigente_desde = hoy_instalacion() - 10 WHERE id = $1`, [r.id]);
      const semanas: string[] = (await client.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS d
         FROM generate_series(periodo_rutina('SEMANAL', hoy_instalacion() - 10), hoy_instalacion(), interval '7 days') AS d
         ORDER BY d`
      )).rows.map((x) => x.d);
      assert.ok(semanas[0] <= (await diaHoy(-10)), 'La semana de alta empieza antes de vigente_desde');
      await registrar(r.id, semanas[0], O1.id);

      const baja = await rutina(m, 'SEMANAL');
      await client.query(
        `UPDATE rutinas SET vigente_desde = hoy_instalacion() - 30, activa = FALSE, baja_en = hoy_instalacion() - 15 WHERE id = $1`,
        [baja.id]
      );

      const rep = await reporte(`desde=${encodeURIComponent(await desdeIso(-40))}&maquina_id=${m}`);
      assert.strictEqual(rep.status, 200, JSON.stringify(rep.cuerpo));
      const x = rep.cuerpo.rutinas.find((y: any) => y.id === r.id);
      assert.deepStrictEqual(x.periodos.map((p: any) => p.periodo), semanas, 'La semana de alta cuenta');
      assert.strictEqual(x.periodos[0].estado, 'HECHA');
      assert.strictEqual(x.periodos[x.periodos.length - 1].estado, 'PENDIENTE', 'La semana actual');

      const xb = rep.cuerpo.rutinas.find((y: any) => y.id === baja.id);
      assert.ok(xb, 'La dada de baja entra: estuvo vigente en el intervalo');
      const bajaEn = await diaHoy(-15);
      assert.ok(xb.periodos.length > 0);
      for (const p of xb.periodos) {
        assert.ok(p.periodo <= bajaEn, `${p.periodo} no es posterior a la baja`);
        assert.strictEqual(p.estado, 'NO_HECHA');
      }
      assert.strictEqual(xb.resumen.porcentaje, 0);
    });

    // =========================================================================
    await t.test('RT-12: Validaciones y alcance del reporte', async () => {
      const casos: Array<[string, string]> = [
        ['más de 92 días', `desde=${encodeURIComponent(await desdeIso(-100))}`],
        ['desde > hasta', `desde=${encodeURIComponent(await desdeIso(-5))}&hasta=${encodeURIComponent(await desdeIso(-10))}`],
        ['planta_id inválido', 'planta_id=abc'],
        ['sector_id inválido', 'sector_id=-1'],
        ['maquina_id inválido', 'maquina_id=0'],
      ];
      for (const [caso, q] of casos) {
        const r = await reporte(q);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], `${caso}: ${JSON.stringify(r.cuerpo)}`);
      }

      const rep = await reporte(`planta_id=${pl}`, Rep.token);
      assert.strictEqual(rep.status, 200, JSON.stringify(rep.cuerpo));
      assert.ok(rep.cuerpo.rutinas.length > 0);
      for (const x of rep.cuerpo.rutinas) assert.strictEqual(x.maquina.sector.id, s2, 'Solo s2');
      const otroSector = await reporte(`sector_id=${s1}`, Rep.token);
      assert.deepStrictEqual(otroSector.cuerpo.rutinas, []);

      const todas = await reporte(`planta_id=${pl}`, A.token);
      assert.ok(todas.cuerpo.rutinas.some((x: any) => x.maquina.sector.id === s1), 'El admin ve s1');

      const sin = await reporte('', O1.token);
      assert.deepStrictEqual([sin.status, sin.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);
    });

    // =========================================================================
    await t.test('RT-13: Tipos en la respuesta y la nota', async () => {
      const m = await crearMaquina(s1);
      const r = await rutina(m, 'SEMANAL');
      await client.query(`UPDATE rutinas SET vigente_desde = hoy_instalacion() - 20 WHERE id = $1`, [r.id]);
      await registrar(r.id, await lunesDe(await diaHoy(-7)), O1.id);

      const larga = await pedir('POST', `/api/rutinas/${r.id}/hecha`, O1.token, { nota: 'x'.repeat(501) });
      assert.deepStrictEqual([larga.status, larga.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);
      const blanco = await pedir('POST', `/api/rutinas/${r.id}/hecha`, O1.token, { nota: '   ' });
      assert.strictEqual(blanco.status, 201, JSON.stringify(blanco.cuerpo));
      assert.strictEqual(blanco.cuerpo.nota, null);
      assert.strictEqual(typeof blanco.cuerpo.id, 'number');
      assert.match(blanco.cuerpo.periodo, FECHA);

      const lista = await pedir('GET', `/api/maquinas/${m}/rutinas?incluir_inactivas=true`, A.token);
      assert.strictEqual(lista.status, 200, JSON.stringify(lista.cuerpo));
      const x = lista.cuerpo[0];
      assert.strictEqual(typeof x.id, 'number');
      assert.strictEqual(typeof x.activa, 'boolean');
      assert.strictEqual(typeof x.incluye_sabado, 'boolean');
      assert.match(x.vigente_desde, FECHA);
      assert.strictEqual(x.baja_en, null);
      assert.strictEqual(typeof x.maquina.id, 'number');
      assert.strictEqual(typeof x.maquina.sector.id, 'number');
      assert.strictEqual(typeof x.maquina.planta.id, 'number');
      assert.deepStrictEqual([x.ultima.periodo, x.ultima.usuario.id], [await lunesDe(hoy), O1.id]);
      assert.ok(x.recientes.length >= 1 && x.recientes.length <= 7);
      for (const p of x.recientes) {
        assert.match(p.periodo, FECHA);
        assert.ok(['HECHA', 'NO_HECHA', 'PENDIENTE'].includes(p.estado));
      }
      assert.deepStrictEqual(x.recientes[x.recientes.length - 1], { periodo: await lunesDe(hoy), estado: 'HECHA' });

      const rep = await reporte(`maquina_id=${m}`);
      for (const campo of ['desde', 'hasta', 'hoy']) assert.match(rep.cuerpo[campo], FECHA, campo);
      for (const p of rep.cuerpo.rutinas[0].periodos) assert.match(p.periodo, FECHA);

      // Una dada de baja va al final con incluir_inactivas, y no aparece sin él
      const baja = await rutina(m, 'DIARIA', { descripcion: 'AAA primero por nombre' });
      await pedir('PATCH', `/api/rutinas/${baja.id}`, A.token, { activa: false });
      const con = await pedir('GET', `/api/maquinas/${m}/rutinas?incluir_inactivas=true`, A.token);
      assert.deepStrictEqual(con.cuerpo.map((y: any) => y.id), [r.id, baja.id]);
      assert.match(con.cuerpo[1].baja_en, FECHA);
      const sinInactivas = await pedir('GET', `/api/maquinas/${m}/rutinas`, A.token);
      assert.deepStrictEqual(sinInactivas.cuerpo.map((y: any) => y.id), [r.id]);
    });
  } finally {
    client = await clienteSano(client);
    try {
      if (createdMaquinaIds.length > 0) {
        await client.query(
          'DELETE FROM rutina_registros WHERE rutina_id IN (SELECT id FROM rutinas WHERE maquina_id = ANY($1))',
          [createdMaquinaIds]
        );
        await client.query('DELETE FROM rutinas WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
      }
      if (createdUsuarioIds.length > 0) {
        await client.query('DELETE FROM usuario_permiso WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM usuario_sector WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
      }
      if (createdMaquinaIds.length > 0) await client.query('DELETE FROM maquinas WHERE id = ANY($1)', [createdMaquinaIds]);
      if (createdUsuarioIds.length > 0) await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [createdUsuarioIds]);
      if (createdSectorIds.length > 0) await client.query('DELETE FROM sectores WHERE id = ANY($1)', [createdSectorIds]);
      if (createdPlantaIds.length > 0) await client.query('DELETE FROM plantas WHERE id = ANY($1)', [createdPlantaIds]);
    } finally {
      client.release();
    }
  }
});

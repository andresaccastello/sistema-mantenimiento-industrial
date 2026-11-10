import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { pool } from '../functions/db.ts';
import app from '../functions/api.ts';
import { JWT_SECRET } from '../functions/config.ts';
import { mismaForma } from './contrato.ts';
import {
  medidorListaEjemplo,
  medidorDetalleEjemplo,
  lecturasEjemplo,
  lecturaCargadaEjemplo,
} from '../../frontend/src/api/contrato-medidores.ts';

// Timeout de bloqueo para las pruebas de concurrencia
process.env.LOCK_TIMEOUT = '5s';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (MEDIDORES TESTS)');
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

test('Etapa PV3 — Medidores y lecturas (ME-01 a ME-06)', async (t) => {
  const client = await pool.connect();

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
    const permisoPlanes = Number((await client.query(`SELECT id FROM permisos WHERE codigo = 'PLANES_GESTIONAR'`)).rows[0].id);

    async function crearSector(clave: string) {
      const plantaId = Number((await client.query(
        'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`ME_PL${clave}_${suf}`]
      )).rows[0].id);
      createdPlantaIds.push(plantaId);
      const id = Number((await client.query(
        'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`ME_S${clave}_${suf}`, plantaId]
      )).rows[0].id);
      createdSectorIds.push(id);
      return id;
    }
    async function crearMaquina(clave: string, sectorId: number, activo = true) {
      const id = Number((await client.query(
        'INSERT INTO maquinas (codigo, nombre, sector_id, activo) VALUES ($1, $2, $3, $4) RETURNING id',
        [`ME_${clave}_${suf}`, `Maquina ME ${clave}`, sectorId, activo]
      )).rows[0].id);
      createdMaquinaIds.push(id);
      return id;
    }
    const s1 = await crearSector('1');
    const s2 = await crearSector('2');
    const m1 = await crearMaquina('M1', s1);
    const m2 = await crearMaquina('M2', s2);

    async function crearUsuario(clave: string, nombre: string, perfil: string, sectores: number[]) {
      const res = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
         VALUES ($1, $2, 'ME', $3, $4, TRUE, 1) RETURNING id, legajo, sesion_version`,
        [`ME_${clave}_${suf}`, nombre, passHash, perfilMap[perfil]]
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
    const O = await crearUsuario('O', 'Operario', 'OPERARIO', [s1, s2]);
    const C = await crearUsuario('C', 'Consulta', 'CONSULTA', [s1, s2]);
    // S: PLANES_GESTIONAR en alcance SECTORES, solo del sector de la máquina 1
    const S = await crearUsuario('S', 'Sectorial', 'RESPONSABLE_MANTENIMIENTO', [s1]);
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Planes de su sector', $3)`,
      [S.id, permisoPlanes, A.id]
    );

    let numero = 0;
    /** Un medidor con nombre único, dado de alta por A. */
    async function medidor(maquinaId = m1, extra: Record<string, unknown> = {}) {
      numero++;
      const r = await pedir('POST', '/api/medidores', A.token, {
        maquina_id: maquinaId,
        nombre: `Horómetro ${numero}`,
        unidad: 'horas',
        ...extra,
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      return r.cuerpo;
    }
    const lectura = (id: number, valor: unknown, token = A.token) =>
      pedir('POST', `/api/medidores/${id}/lecturas`, token, { valor });
    async function lecturaOk(id: number, valor: number, token = A.token) {
      const r = await lectura(id, valor, token);
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      return r.cuerpo;
    }
    const anular = (medidorId: number, lecturaId: number, motivo: unknown, token = A.token) =>
      pedir('POST', `/api/medidores/${medidorId}/lecturas/${lecturaId}/anular`, token, { motivo });
    const detalle = async (id: number) => (await pedir('GET', `/api/medidores/${id}`, A.token)).cuerpo;
    /** Las lecturas del medidor en la base, por id. */
    const lecturasBase = async (medidorId: number) =>
      (await client.query('SELECT id, valor, anulada_en FROM lecturas_medidor WHERE medidor_id = $1 ORDER BY id', [medidorId])).rows;

    // =========================================================================
    // ME-01: Permisos
    // =========================================================================
    await t.test('ME-01: Permisos', async () => {
      const med1 = await medidor(m1);
      const med2 = await medidor(m2);
      const lec1 = await lecturaOk(med1.id, 10);
      const lec2 = await lecturaOk(med2.id, 10);

      // O: ve y carga lecturas; no gestiona
      assert.strictEqual((await pedir('GET', '/api/medidores', O.token)).status, 200);
      assert.strictEqual((await pedir('GET', `/api/medidores/${med1.id}`, O.token)).status, 200);
      assert.strictEqual((await pedir('GET', `/api/medidores/${med1.id}/lecturas`, O.token)).status, 200);
      const carga = await lectura(med1.id, 20, O.token);
      assert.strictEqual(carga.status, 201, JSON.stringify(carga.cuerpo));

      const gestion: Array<[string, string, unknown]> = [
        ['POST', '/api/medidores', { maquina_id: m1, nombre: 'Medidor de O', unidad: 'horas' }],
        ['PATCH', `/api/medidores/${med1.id}`, { nombre: 'Cambio de O' }],
        ['POST', `/api/medidores/${med1.id}/desactivar`, {}],
        ['POST', `/api/medidores/${med1.id}/reactivar`, {}],
        ['POST', `/api/medidores/${med1.id}/lecturas/${lec1.id}/anular`, { motivo: 'Motivo de O' }],
      ];
      for (const [metodo, ruta, cuerpo] of gestion) {
        const r = await pedir(metodo, ruta, O.token, cuerpo);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE'], `O en ${metodo} ${ruta}`);
      }

      // C: 403 en todas las rutas
      const todas: Array<[string, string, unknown?]> = [
        ['GET', '/api/medidores'],
        ['GET', `/api/medidores/${med1.id}`],
        ['GET', `/api/medidores/${med1.id}/lecturas`],
        ['POST', `/api/medidores/${med1.id}/lecturas`, { valor: 50 }],
        ...gestion,
      ];
      for (const [metodo, ruta, cuerpo] of todas) {
        const r = await pedir(metodo, ruta, C.token, cuerpo);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE'], `C en ${metodo} ${ruta}`);
      }

      // S: gestiona solo la máquina 1
      const altaS = await pedir('POST', '/api/medidores', S.token, { maquina_id: m1, nombre: 'Medidor de S', unidad: 'horas' });
      assert.strictEqual(altaS.status, 201, JSON.stringify(altaS.cuerpo));
      const altaOtra = await pedir('POST', '/api/medidores', S.token, { maquina_id: m2, nombre: 'Medidor de S', unidad: 'horas' });
      assert.deepStrictEqual([altaOtra.status, altaOtra.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);

      const deOtroSector: Array<[string, string, unknown]> = [
        ['PATCH', `/api/medidores/${med2.id}`, { nombre: 'Cambio de S' }],
        ['POST', `/api/medidores/${med2.id}/desactivar`, {}],
        ['POST', `/api/medidores/${med2.id}/lecturas/${lec2.id}/anular`, { motivo: 'Motivo de S' }],
      ];
      for (const [metodo, ruta, cuerpo] of deOtroSector) {
        const r = await pedir(metodo, ruta, S.token, cuerpo);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE'], `S en ${metodo} ${ruta}`);
      }
      const ve = await pedir('GET', `/api/medidores/${med2.id}`, S.token);
      assert.strictEqual(ve.status, 200, 'S lo ve, aunque sea de otro sector');

      // Nada cambió en el medidor de la máquina 2
      assert.strictEqual((await detalle(med2.id)).activo, true);
      assert.strictEqual((await lecturasBase(med2.id))[0].anulada_en, null);
    });

    // =========================================================================
    // ME-02: Alta y edición
    // =========================================================================
    await t.test('ME-02: Alta y edición', async () => {
      const mInactiva = await crearMaquina('MI', s1, false);
      const maquinaDos = await crearMaquina('M3', s1);

      const alta = await pedir('POST', '/api/medidores', A.token, {
        maquina_id: maquinaDos,
        nombre: '  Horómetro  ',
        unidad: ' horas ',
        lectura_inicial: 120.5,
      });
      assert.strictEqual(alta.status, 201, JSON.stringify(alta.cuerpo));
      const d = alta.cuerpo;
      assert.deepStrictEqual([d.nombre, d.unidad, d.activo, d.tareas_activas, d.tareas], ['Horómetro', 'horas', true, 0, []]);
      assert.deepStrictEqual(d.maquina, {
        id: maquinaDos, codigo: `ME_M3_${suf}`, nombre: 'Maquina ME M3', activo: true, sector: { id: s1, nombre: `ME_S1_${suf}` },
      });
      assert.strictEqual(d.ultima_lectura.valor, 120.5);
      assert.deepStrictEqual(d.ultima_lectura.registrada_por, { id: A.id, legajo: `ME_A_${suf}`, nombre: 'Admin', apellido: 'ME' });
      const [primera] = (await pedir('GET', `/api/medidores/${d.id}/lecturas`, A.token)).cuerpo;
      assert.deepStrictEqual([primera.origen, primera.valor, primera.intervencion_id], ['MANUAL', 120.5, null]);

      // Sin lectura_inicial: sin lecturas
      const sinLectura = await medidor(maquinaDos);
      assert.strictEqual(sinLectura.ultima_lectura, null);

      // 422, sin guardar nada
      const antes = (await client.query('SELECT count(*)::int AS n FROM medidores WHERE maquina_id = $1', [maquinaDos])).rows[0].n;
      const base = { maquina_id: maquinaDos, nombre: 'Medidor nuevo', unidad: 'horas' };
      const casos: Array<[string, Record<string, unknown>]> = [
        ['nombre de 2', { nombre: 'AB' }],
        ['nombre de 61', { nombre: 'N'.repeat(61) }],
        ['unidad vacía', { unidad: '   ' }],
        ['unidad de 21', { unidad: 'U'.repeat(21) }],
        ['maquina_id: true', { maquina_id: true }],
        ['lectura_inicial -1', { lectura_inicial: -1 }],
        ['lectura_inicial "10"', { lectura_inicial: '10' }],
        ['lectura_inicial 1,234', { lectura_inicial: 1.234 }],
      ];
      for (const [nombre, cambios] of casos) {
        const r = await pedir('POST', '/api/medidores', A.token, { ...base, ...cambios });
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], `${nombre}: ${JSON.stringify(r.cuerpo)}`);
      }
      assert.strictEqual(
        (await client.query('SELECT count(*)::int AS n FROM medidores WHERE maquina_id = $1', [maquinaDos])).rows[0].n,
        antes,
        'No se guardó ningún medidor'
      );

      const noExiste = await pedir('POST', '/api/medidores', A.token, { ...base, maquina_id: 2147483000 });
      assert.deepStrictEqual([noExiste.status, noExiste.cuerpo.codigo], [404, 'MAQUINA_NO_ENCONTRADA']);
      const inactiva = await pedir('POST', '/api/medidores', A.token, { ...base, maquina_id: mInactiva });
      assert.deepStrictEqual([inactiva.status, inactiva.cuerpo.codigo], [422, 'MAQUINA_INACTIVA']);

      // Nombre repetido, sin importar mayúsculas
      const dup = await pedir('POST', '/api/medidores', A.token, { maquina_id: maquinaDos, nombre: 'horómetro', unidad: 'horas' });
      assert.deepStrictEqual([dup.status, dup.cuerpo.codigo], [409, 'MEDIDOR_DUPLICADO']);
      const otraMaquina = await pedir('POST', '/api/medidores', A.token, { maquina_id: m2, nombre: 'horómetro', unidad: 'horas' });
      assert.strictEqual(otraMaquina.status, 201, JSON.stringify(otraMaquina.cuerpo));

      // PATCH
      const cambio = await pedir('PATCH', `/api/medidores/${d.id}`, A.token, { nombre: 'Horómetro nuevo', unidad: 'hs' });
      assert.strictEqual(cambio.status, 200, JSON.stringify(cambio.cuerpo));
      assert.deepStrictEqual([cambio.cuerpo.nombre, cambio.cuerpo.unidad], ['Horómetro nuevo', 'hs']);
      const conMaquina = await pedir('PATCH', `/api/medidores/${d.id}`, A.token, { maquina_id: m2 });
      assert.deepStrictEqual([conMaquina.status, conMaquina.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);
      const dupPatch = await pedir('PATCH', `/api/medidores/${sinLectura.id}`, A.token, { nombre: 'HORÓMETRO NUEVO' });
      assert.deepStrictEqual([dupPatch.status, dupPatch.cuerpo.codigo], [409, 'MEDIDOR_DUPLICADO']);

      // La baja y el alta de nuevo
      const baja = await pedir('POST', `/api/medidores/${d.id}/desactivar`, A.token, {});
      assert.deepStrictEqual([baja.status, baja.cuerpo.activo], [200, false]);
      const bajaOtra = await pedir('POST', `/api/medidores/${d.id}/desactivar`, A.token, {});
      assert.deepStrictEqual([bajaOtra.status, bajaOtra.cuerpo.codigo], [409, 'MEDIDOR_YA_INACTIVO']);

      const lista = await pedir('GET', `/api/medidores?maquina_id=${maquinaDos}`, A.token);
      assert.ok(!lista.cuerpo.some((x: any) => x.id === d.id), 'Sin ?all=true, el inactivo no está');
      const listaTodos = await pedir('GET', `/api/medidores?maquina_id=${maquinaDos}&all=true`, A.token);
      assert.ok(listaTodos.cuerpo.some((x: any) => x.id === d.id), 'Con ?all=true, está');
      const mal = await pedir('GET', '/api/medidores?maquina_id=abc', A.token);
      assert.deepStrictEqual([mal.status, mal.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);

      const alta2 = await pedir('POST', `/api/medidores/${d.id}/reactivar`, A.token, {});
      assert.deepStrictEqual([alta2.status, alta2.cuerpo.activo], [200, true]);
      const altaOtra = await pedir('POST', `/api/medidores/${d.id}/reactivar`, A.token, {});
      assert.deepStrictEqual([altaOtra.status, altaOtra.cuerpo.codigo], [409, 'MEDIDOR_YA_ACTIVO']);

      const noHay = await pedir('GET', '/api/medidores/2147483000', A.token);
      assert.deepStrictEqual([noHay.status, noHay.cuerpo.codigo], [404, 'MEDIDOR_NO_ENCONTRADO']);
    });

    // =========================================================================
    // ME-03: Lecturas
    // =========================================================================
    await t.test('ME-03: Lecturas', async () => {
      const med = await medidor();

      // Sin lecturas, cualquier valor desde 0
      const cero = await lecturaOk(med.id, 0);
      assert.deepStrictEqual(
        { ...cero, id: 0, registrada_en: '' },
        {
          id: 0,
          valor: 0,
          registrada_en: '',
          registrada_por: { id: A.id, legajo: `ME_A_${suf}`, nombre: 'Admin', apellido: 'ME' },
          origen: 'MANUAL',
          intervencion_id: null,
          observacion: null,
          anulada: false,
          anulada_en: null,
          anulada_por: null,
          motivo_anulacion: null,
        }
      );
      await lecturaOk(med.id, 100);

      const menor = await lectura(med.id, 99.99);
      assert.deepStrictEqual([menor.status, menor.cuerpo.codigo], [422, 'LECTURA_MENOR']);
      assert.strictEqual(menor.cuerpo.ultima.valor, 100);
      assert.strictEqual(typeof menor.cuerpo.ultima.registrada_en, 'string');

      await lecturaOk(med.id, 100); // Igual se acepta
      await lecturaOk(med.id, 100.25);
      const conObs = await pedir('POST', `/api/medidores/${med.id}/lecturas`, O.token, { valor: 200, observacion: ' Lectura de control ' });
      assert.strictEqual(conObs.status, 201, JSON.stringify(conObs.cuerpo));
      assert.strictEqual(conObs.cuerpo.observacion, 'Lectura de control');
      assert.strictEqual(conObs.cuerpo.registrada_por.id, O.id);

      const cuantas = (await lecturasBase(med.id)).length;
      const malos: Array<[string, Record<string, unknown>]> = [
        ['"100"', { valor: '100' }],
        ['-1', { valor: -1 }],
        ['1,234', { valor: 1.234 }],
        ['1.000.000.000.000', { valor: 1000000000000 }],
        ['sin valor', {}],
        ['null', { valor: null }],
        ['true', { valor: true }],
        ['observación de 201', { valor: 300, observacion: 'o'.repeat(201) }],
      ];
      for (const [nombre, cuerpo] of malos) {
        const r = await pedir('POST', `/api/medidores/${med.id}/lecturas`, A.token, cuerpo);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], `${nombre}: ${JSON.stringify(r.cuerpo)}`);
      }
      assert.strictEqual((await lecturasBase(med.id)).length, cuantas, 'No se guardó ninguna');

      // El máximo entra
      const mediMax = await medidor();
      await lecturaOk(mediMax.id, 999999999999.99);
      assert.strictEqual((await detalle(mediMax.id)).ultima_lectura.valor, 999999999999.99);

      // Medidor inactivo, máquina inactiva e inexistente
      const inactivo = await medidor();
      await pedir('POST', `/api/medidores/${inactivo.id}/desactivar`, A.token, {});
      const rI = await lectura(inactivo.id, 1);
      assert.deepStrictEqual([rI.status, rI.cuerpo.codigo], [409, 'MEDIDOR_INACTIVO']);

      const mBaja = await crearMaquina('MB', s1);
      const deBaja = await medidor(mBaja);
      await client.query('UPDATE maquinas SET activo = FALSE WHERE id = $1', [mBaja]);
      const rM = await lectura(deBaja.id, 1);
      assert.deepStrictEqual([rM.status, rM.cuerpo.codigo], [422, 'MAQUINA_INACTIVA']);

      const rN = await lectura(2147483000, 1);
      assert.deepStrictEqual([rN.status, rN.cuerpo.codigo], [404, 'MEDIDOR_NO_ENCONTRADO']);

      // La lista
      const lista = await pedir('GET', `/api/medidores/${med.id}/lecturas`, A.token);
      assert.strictEqual(lista.status, 200);
      assert.deepStrictEqual(lista.cuerpo.map((x: any) => x.valor), [200, 100.25, 100, 100, 0], 'De la más nueva a la más vieja');
      assert.strictEqual(lista.total, '5');
      const uno = await pedir('GET', `/api/medidores/${med.id}/lecturas?limit=1`, A.token);
      assert.deepStrictEqual([uno.cuerpo.length, uno.cuerpo[0].valor, uno.total], [1, 200, '5']);
      const segunda = await pedir('GET', `/api/medidores/${med.id}/lecturas?limit=1&offset=1`, A.token);
      assert.deepStrictEqual(segunda.cuerpo.map((x: any) => x.valor), [100.25]);
      for (const malo of ['limit=0', 'limit=501', 'limit=1.5', 'offset=-1']) {
        assert.strictEqual((await pedir('GET', `/api/medidores/${med.id}/lecturas?${malo}`, A.token)).status, 422, malo);
      }
    });

    // =========================================================================
    // ME-04: Anular
    // =========================================================================
    await t.test('ME-04: Anular', async () => {
      const med = await medidor();
      const otro = await medidor();
      const l1 = await lecturaOk(med.id, 100);
      const l2 = await lecturaOk(med.id, 200);
      const deOtro = await lecturaOk(otro.id, 50);

      for (const motivo of [undefined, 'cua4']) {
        const r = await anular(med.id, l2.id, motivo);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'MOTIVO_REQUERIDO']);
      }

      const r = await anular(med.id, l2.id, '  Mal cargada  ');
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      assert.deepStrictEqual(
        [r.cuerpo.id, r.cuerpo.anulada, r.cuerpo.motivo_anulacion, r.cuerpo.anulada_por],
        [l2.id, true, 'Mal cargada', { id: A.id, legajo: `ME_A_${suf}`, nombre: 'Admin', apellido: 'ME' }]
      );
      assert.strictEqual(typeof r.cuerpo.anulada_en, 'string');

      const otraVez = await anular(med.id, l2.id, 'Mal cargada');
      assert.deepStrictEqual([otraVez.status, otraVez.cuerpo.codigo], [409, 'LECTURA_YA_ANULADA']);
      const ajena = await anular(med.id, deOtro.id, 'De otro medidor');
      assert.deepStrictEqual([ajena.status, ajena.cuerpo.codigo], [404, 'LECTURA_NO_ENCONTRADA']);

      // La última vuelve a la anterior, y se acepta un valor menor que la anulada
      assert.strictEqual((await detalle(med.id)).ultima_lectura.id, l1.id);
      await lecturaOk(med.id, 150);

      const lista = await pedir('GET', `/api/medidores/${med.id}/lecturas`, A.token);
      const anulada = lista.cuerpo.find((x: any) => x.id === l2.id);
      assert.deepStrictEqual([anulada.anulada, anulada.valor], [true, 200], 'La anulada sigue en la lista');
    });

    // =========================================================================
    // ME-05: Concurrencia
    // =========================================================================
    await t.test('ME-05: Concurrencia', async () => {
      for (let vuelta = 1; vuelta <= 10; vuelta++) {
        // Dos lecturas a la vez, 100 y 90, con la última en 50
        const med = await medidor();
        await lecturaOk(med.id, 50);
        const [r100, r90] = await Promise.all([lectura(med.id, 100), lectura(med.id, 90)]);
        assert.strictEqual(r100.status, 201, `Vuelta ${vuelta}: ${JSON.stringify(r100.cuerpo)}`);
        if (r90.status !== 201) {
          assert.deepStrictEqual([r90.status, r90.cuerpo.codigo], [422, 'LECTURA_MENOR'], `Vuelta ${vuelta}`);
        }
        const valores = (await lecturasBase(med.id)).filter((x) => x.anulada_en === null).map((x) => Number(x.valor));
        for (let i = 1; i < valores.length; i++) {
          assert.ok(valores[i] >= valores[i - 1], `Vuelta ${vuelta}: las vigentes, por id, nunca bajan: ${valores}`);
        }

        // Una lectura y desactivar a la vez
        const d = await medidor();
        const [carga, baja] = await Promise.all([
          lectura(d.id, 10),
          pedir('POST', `/api/medidores/${d.id}/desactivar`, A.token, {}),
        ]);
        assert.strictEqual(baja.status, 200, `Vuelta ${vuelta}: ${JSON.stringify(baja.cuerpo)}`);
        assert.strictEqual((await detalle(d.id)).activo, false);
        if (carga.status === 201) {
          assert.strictEqual((await lecturasBase(d.id)).length, 1, `Vuelta ${vuelta}`);
        } else {
          assert.deepStrictEqual([carga.status, carga.cuerpo.codigo], [409, 'MEDIDOR_INACTIVO'], `Vuelta ${vuelta}`);
          assert.strictEqual((await lecturasBase(d.id)).length, 0, `Vuelta ${vuelta}: ninguna lectura nueva`);
        }

        // Dos altas con el mismo nombre en la misma máquina
        const cuerpo = { maquina_id: m1, nombre: `Concurrente ${vuelta}`, unidad: 'ciclos' };
        const [a1, a2] = await Promise.all([
          pedir('POST', '/api/medidores', A.token, cuerpo),
          pedir('POST', '/api/medidores', A.token, cuerpo),
        ]);
        assert.deepStrictEqual([a1.status, a2.status].sort(), [201, 409], `Vuelta ${vuelta}: ${JSON.stringify([a1.cuerpo, a2.cuerpo])}`);
        assert.strictEqual((a1.status === 409 ? a1 : a2).cuerpo.codigo, 'MEDIDOR_DUPLICADO', `Vuelta ${vuelta}`);
      }
    });

    // =========================================================================
    // ME-06: Contrato
    // =========================================================================
    await t.test('ME-06: Contrato', async () => {
      const med = await medidor(m1, { lectura_inicial: 500 });

      // Una tarea activa que lo usa: para que el detalle traiga `tareas`
      const planId = Number((await client.query(
        'INSERT INTO planes_mantenimiento (maquina_id, nombre, creado_por_usuario_id) VALUES ($1, $2, $3) RETURNING id',
        [m1, `Plan ME ${suf}`, A.id]
      )).rows[0].id);
      await client.query(
        `INSERT INTO plan_tareas (plan_id, orden, accion, medidor_id, uso_cada, uso_primera, uso_anticipacion)
         VALUES ($1, 1, 'Cambiar el aceite', $2, 250, 500, 25)`,
        [planId, med.id]
      );

      const cargada = await lecturaOk(med.id, 512.5);
      const lista = (await pedir('GET', `/api/medidores?maquina_id=${m1}`, A.token)).cuerpo.find((x: any) => x.id === med.id);
      const det = await detalle(med.id);
      const lecturas = (await pedir('GET', `/api/medidores/${med.id}/lecturas`, A.token)).cuerpo;

      const verificar = (ruta: string, real: unknown, ejemplo: unknown) => {
        const diferencias = mismaForma(real, ejemplo);
        assert.deepStrictEqual(diferencias, [], `${ruta}:\n${diferencias.join('\n')}`);
      };
      verificar('GET /api/medidores (un elemento)', lista, medidorListaEjemplo);
      verificar('GET /api/medidores/:id', det, medidorDetalleEjemplo);
      verificar('GET /api/medidores/:id/lecturas', lecturas, lecturasEjemplo);
      verificar('POST /api/medidores/:id/lecturas', cargada, lecturaCargadaEjemplo);
    });
  } finally {
    // Limpieza: solo lo que creó esta prueba
    try {
      if (createdMaquinaIds.length > 0) {
        const maquinas = createdMaquinaIds;
        await client.query(
          'DELETE FROM lecturas_medidor WHERE medidor_id IN (SELECT id FROM medidores WHERE maquina_id = ANY($1))',
          [maquinas]
        );
        await client.query(
          'DELETE FROM plan_tareas WHERE plan_id IN (SELECT id FROM planes_mantenimiento WHERE maquina_id = ANY($1))',
          [maquinas]
        );
        await client.query('DELETE FROM planes_mantenimiento WHERE maquina_id = ANY($1)', [maquinas]);
        await client.query('DELETE FROM medidores WHERE maquina_id = ANY($1)', [maquinas]);
        await client.query('DELETE FROM maquinas WHERE id = ANY($1)', [maquinas]);
      }
      if (createdUsuarioIds.length > 0) {
        await client.query('DELETE FROM usuario_sector WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM usuario_permiso WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query(
          'DELETE FROM auditoria_permisos WHERE sobre_usuario_id = ANY($1) OR realizado_por_usuario_id = ANY($1)',
          [createdUsuarioIds]
        );
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

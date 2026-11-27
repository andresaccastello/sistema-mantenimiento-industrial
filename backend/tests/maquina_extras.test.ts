// Las pruebas nunca mandan un mail de verdad
process.env.EMAIL_TRANSPORTE = 'simulado';

import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';
import app from '../functions/api.ts';
import { JWT_SECRET } from '../functions/config.ts';
import { fijarMaximoExportacion, textoSeguro } from '../functions/intervenciones/exportar.ts';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (MAQUINA EXTRAS TESTS)');
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

/** El CSV tal cual llega: los bytes, para ver el BOM, y el texto sin él. */
async function exportar(token: string, query: string) {
  const r = await app.request(`/api/intervenciones/exportar${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const bytes = new Uint8Array(await r.arrayBuffer());
  const texto = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  return {
    status: r.status,
    bytes,
    texto,
    tipo: r.headers.get('Content-Type'),
    disposicion: r.headers.get('Content-Disposition'),
  };
}

/** Las filas del CSV, separadas por ";" (los datos de la prueba no llevan comillas ni ";"). */
function filas(texto: string): string[][] {
  return texto
    .replace(/^﻿/, '')
    .split('\r\n')
    .filter((x) => x !== '')
    .map((x) => x.split(';'));
}

test('Etapa MQ1 — Documentos, participantes, exportación y proveedores (MX-01 a MX-06)', async (t) => {
  let client = await pool.connect();

  const createdPlantaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdUsuarioIds: number[] = [];
  const createdIntervencionIds: number[] = [];
  const createdProveedorIds: number[] = [];
  const createdDocumentoIds: number[] = [];
  const suf = Date.now();

  try {
    const passHash = await bcrypt.hash('pass123', 10);
    const perfilMap: Record<string, number> = {};
    for (const r of (await client.query('SELECT id, nombre FROM perfiles')).rows) {
      perfilMap[r.nombre] = Number(r.id);
    }

    const pl = Number((await client.query('INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`MX_PL_${suf}`])).rows[0].id);
    createdPlantaIds.push(pl);
    async function crearSector(nombre: string) {
      const id = Number((await client.query(
        'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`${nombre}_${suf}`, pl]
      )).rows[0].id);
      createdSectorIds.push(id);
      return id;
    }
    const s1 = await crearSector('MX_S1');
    const s2 = await crearSector('MX_S2');

    // La criticidad por omisión, sin prioridad alta si hay una así: no se toca el catálogo
    const crit = Number((await client.query(
      'SELECT id FROM criticidades WHERE activo ORDER BY prioridad_alta, por_omision DESC, id LIMIT 1'
    )).rows[0].id);
    let numeroMaquina = 0;
    async function crearMaquina(sectorId: number, activo = true) {
      numeroMaquina++;
      const n = String(numeroMaquina).padStart(2, '0');
      const id = Number((await client.query(
        `INSERT INTO maquinas (codigo, nombre, sector_id, criticidad_id, activo)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [`MX_M${n}_${suf}`, `Maquina MX ${n}`, sectorId, crit, activo]
      )).rows[0].id);
      createdMaquinaIds.push(id);
      return id;
    }
    const m1 = await crearMaquina(s1);
    const m2 = await crearMaquina(s2);
    const mInactiva = await crearMaquina(s1, false);

    async function crearUsuario(clave: string, perfil: string, apellido: string, sectores: number[] = []) {
      const res = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
         VALUES ($1, $2, $3, $4, $5, TRUE, 1) RETURNING id, legajo, sesion_version`,
        [`MX_${clave}_${suf}`, clave, apellido, passHash, perfilMap[perfil]]
      );
      const u = res.rows[0];
      const id = Number(u.id);
      createdUsuarioIds.push(id);
      for (const s of sectores) {
        await client.query('INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)', [id, s]);
      }
      return {
        id,
        legajo: u.legajo as string,
        token: await getTokenForUser({ id, legajo: u.legajo, sesion_version: Number(u.sesion_version) }),
      };
    }
    const A = await crearUsuario('Admin', 'ADMINISTRADOR', 'Admin');
    const R = await crearUsuario('Resp', 'RESPONSABLE_MANTENIMIENTO', 'Zeta', [s1]);
    const OP = await crearUsuario('Oper', 'OPERARIO', 'Oper', [s1]);
    const U1 = await crearUsuario('Uno', 'RESPONSABLE_MANTENIMIENTO', 'Alfa', [s1]);
    const U2 = await crearUsuario('Dos', 'RESPONSABLE_MANTENIMIENTO', 'Beta', [s1]);
    const U3 = await crearUsuario('Tres', 'RESPONSABLE_MANTENIMIENTO', 'Anulado', [s1]);

    // =========================================================================
    await t.test('MX-01: Documentos: alta, edición y borrado con DOCUMENTOS_GESTIONAR; ver la lista sin el permiso', async () => {
      const alta = await pedir('POST', `/api/maquinas/${m1}/documentos`, A.token, {
        titulo: '  Manual del fabricante  ',
        tipo: 'MANUAL',
        url: ' https://ejemplo.com/manual.pdf ',
        notas: '  Versión 2  ',
      });
      assert.strictEqual(alta.status, 201, JSON.stringify(alta.cuerpo));
      createdDocumentoIds.push(alta.cuerpo.id);
      assert.deepStrictEqual(
        [alta.cuerpo.maquina_id, alta.cuerpo.titulo, alta.cuerpo.tipo, alta.cuerpo.url, alta.cuerpo.notas],
        [m1, 'Manual del fabricante', 'MANUAL', 'https://ejemplo.com/manual.pdf', 'Versión 2']
      );
      assert.strictEqual(alta.cuerpo.creado_por.id, A.id);

      const foto = await pedir('POST', `/api/maquinas/${m1}/documentos`, A.token, {
        titulo: 'Placa', tipo: 'FOTO', url: 'http://ejemplo.com/placa.jpg',
      });
      assert.strictEqual(foto.status, 201);
      createdDocumentoIds.push(foto.cuerpo.id);
      assert.strictEqual(foto.cuerpo.notas, null);
      const otroManual = await pedir('POST', `/api/maquinas/${m1}/documentos`, R.token, {
        titulo: 'Apuntes de lubricación', tipo: 'MANUAL', url: 'https://ejemplo.com/apuntes',
      });
      assert.strictEqual(otroManual.status, 201, 'El responsable también tiene el permiso');
      createdDocumentoIds.push(otroManual.cuerpo.id);

      // Sin el permiso: 403 en el alta, la edición y el borrado
      const sinPermiso = [
        await pedir('POST', `/api/maquinas/${m1}/documentos`, OP.token, { titulo: 'X', tipo: 'OTRO', url: 'https://ejemplo.com' }),
        await pedir('PATCH', `/api/documentos/${alta.cuerpo.id}`, OP.token, { titulo: 'X' }),
        await pedir('DELETE', `/api/documentos/${alta.cuerpo.id}`, OP.token),
      ];
      for (const r of sinPermiso) assert.deepStrictEqual([r.status, r.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);

      // La lista, por tipo (en el orden de la tabla) y título; el operario la ve
      const lista = await pedir('GET', `/api/maquinas/${m1}/documentos`, OP.token);
      assert.strictEqual(lista.status, 200);
      assert.deepStrictEqual(
        lista.cuerpo.map((d: any) => [d.tipo, d.titulo]),
        [['MANUAL', 'Apuntes de lubricación'], ['MANUAL', 'Manual del fabricante'], ['FOTO', 'Placa']]
      );
      assert.deepStrictEqual((await pedir('GET', `/api/maquinas/${m2}/documentos`, OP.token)).cuerpo, []);

      // Edición
      const edit = await pedir('PATCH', `/api/documentos/${alta.cuerpo.id}`, A.token, { tipo: 'INSTRUCTIVO', notas: null });
      assert.strictEqual(edit.status, 200, JSON.stringify(edit.cuerpo));
      assert.deepStrictEqual([edit.cuerpo.tipo, edit.cuerpo.notas, edit.cuerpo.titulo], ['INSTRUCTIVO', null, 'Manual del fabricante']);
      assert.ok(new Date(edit.cuerpo.actualizado_en) >= new Date(alta.cuerpo.actualizado_en));

      // Borrado de verdad
      const borrar = await pedir('DELETE', `/api/documentos/${foto.cuerpo.id}`, A.token);
      assert.strictEqual(borrar.status, 200);
      const quedan = await client.query('SELECT count(*)::int AS n FROM maquina_documentos WHERE id = $1', [foto.cuerpo.id]);
      assert.strictEqual(quedan.rows[0].n, 0);

      // Inexistentes
      for (const r of [
        await pedir('DELETE', `/api/documentos/${foto.cuerpo.id}`, A.token),
        await pedir('PATCH', `/api/documentos/${foto.cuerpo.id}`, A.token, { titulo: 'Otro' }),
        await pedir('PATCH', '/api/documentos/abc', A.token, { titulo: 'Otro' }),
      ]) {
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [404, 'DOCUMENTO_NO_ENCONTRADO']);
      }
      const sinMaquina = await pedir('GET', '/api/maquinas/999999999/documentos', A.token);
      assert.deepStrictEqual([sinMaquina.status, sinMaquina.cuerpo.codigo], [404, 'MAQUINA_NO_ENCONTRADA']);
    });

    // =========================================================================
    await t.test('MX-02: Validaciones de los documentos y máquina inactiva', async () => {
      const base = { titulo: 'Documento', tipo: 'OTRO', url: 'https://ejemplo.com' };
      const malos: Array<[string, Record<string, unknown>]> = [
        ['javascript:', { ...base, url: 'javascript:alert(1)' }],
        ['data:', { ...base, url: 'data:text/html,<b>hola</b>' }],
        ['sin esquema', { ...base, url: 'ejemplo.com/manual.pdf' }],
        ['ftp', { ...base, url: 'ftp://ejemplo.com/manual.pdf' }],
        ['url larga', { ...base, url: `https://ejemplo.com/${'a'.repeat(990)}` }],
        ['url no texto', { ...base, url: 123 }],
        ['sin url', { titulo: 'Documento', tipo: 'OTRO' }],
        ['título vacío', { ...base, titulo: '   ' }],
        ['título largo', { ...base, titulo: 'x'.repeat(151) }],
        ['sin título', { tipo: 'OTRO', url: 'https://ejemplo.com' }],
        ['tipo inválido', { ...base, tipo: 'PDF' }],
        ['tipo en minúsculas', { ...base, tipo: 'manual' }],
        ['notas largas', { ...base, notas: 'n'.repeat(501) }],
      ];
      for (const [caso, cuerpo] of malos) {
        const r = await pedir('POST', `/api/maquinas/${m1}/documentos`, A.token, cuerpo);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], caso);
      }
      // En el borde: 150 de título, 1000 de url, 500 de notas
      const borde = await pedir('POST', `/api/maquinas/${m1}/documentos`, A.token, {
        titulo: 't'.repeat(150), tipo: 'PLANO', url: `https://e.com/${'a'.repeat(1000 - 14)}`, notas: 'n'.repeat(500),
      });
      assert.strictEqual(borde.status, 201, JSON.stringify(borde.cuerpo));
      createdDocumentoIds.push(borde.cuerpo.id);

      // La edición valida igual, y sin campos da 422
      const doc = borde.cuerpo.id;
      for (const cuerpo of [{ url: 'javascript:alert(1)' }, { titulo: '' }, { tipo: 'X' }, {}]) {
        const r = await pedir('PATCH', `/api/documentos/${doc}`, A.token, cuerpo);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], JSON.stringify(cuerpo));
      }
      const sinCambio = await client.query('SELECT url, tipo FROM maquina_documentos WHERE id = $1', [doc]);
      assert.strictEqual(sinCambio.rows[0].tipo, 'PLANO', 'Los rechazos no cambian nada');

      // Máquina inactiva: la lista se ve, agregar da 422
      const lista = await pedir('GET', `/api/maquinas/${mInactiva}/documentos`, OP.token);
      assert.strictEqual(lista.status, 200);
      const agregar = await pedir('POST', `/api/maquinas/${mInactiva}/documentos`, A.token, base);
      assert.deepStrictEqual([agregar.status, agregar.cuerpo.codigo], [422, 'MAQUINA_INACTIVA']);
    });

    // =========================================================================
    // Intervenciones para MX-03 a MX-05. El operario reporta: PROPIAS las ve.
    const reportar = async (maquinaId: number, descripcion: string, token = OP.token) => {
      const r = await pedir('POST', '/api/intervenciones', token, {
        maquina_id: maquinaId,
        descripcion,
        detiene_maquina: false,
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      createdIntervencionIds.push(Number(r.cuerpo.id));
      return Number(r.cuerpo.id);
    };
    const provA = Number((await client.query('INSERT INTO proveedores (nombre) VALUES ($1) RETURNING id', [`Proveedor MX A ${suf}`])).rows[0].id);
    const provB = Number((await client.query('INSERT INTO proveedores (nombre) VALUES ($1) RETURNING id', [`Proveedor MX B ${suf}`])).rows[0].id);
    createdProveedorIds.push(provA, provB);
    const manoObra = async (
      intervencionId: number,
      quien: { usuario?: number; proveedor?: number },
      anulado = false
    ) => {
      await client.query(
        `INSERT INTO intervencion_costos (
           intervencion_id, tipo, descripcion, importe, horas, usuario_id, proveedor_id, registrado_por_usuario_id,
           anulado_en, anulado_por_usuario_id, motivo_anulacion
         ) VALUES ($1, 'MANO_OBRA', 'Mano de obra de prueba MX', 1000, 2, $2, $3, $4,
                   CASE WHEN $5 THEN NOW() END, CASE WHEN $5 THEN $4::bigint END, CASE WHEN $5 THEN 'Prueba MX' END)`,
        [intervencionId, quien.usuario ?? null, quien.proveedor ?? null, A.id, anulado]
      );
    };

    const i1 = await reportar(m1, `Falla MX uno ${suf}`);
    const i2 = await reportar(m1, `=1+1 Falla MX dos ${suf}`);
    const i3 = await reportar(m2, `Falla MX tres ${suf}`, A.token);

    // =========================================================================
    await t.test('MX-03: Participantes: sin repetidos, sin el anulado, en orden y sin COSTOS_VER', async () => {
      await client.query('UPDATE intervenciones SET responsable_usuario_id = $1 WHERE id = $2', [R.id, i1]);
      await manoObra(i1, { usuario: U2.id });
      await manoObra(i1, { usuario: U1.id });
      await manoObra(i1, { usuario: U1.id }); // repetido
      await manoObra(i1, { usuario: R.id }); // el responsable, repetido
      await manoObra(i1, { usuario: U3.id }, true); // anulado
      await manoObra(i1, { proveedor: provB });
      await manoObra(i1, { proveedor: provA });
      await manoObra(i1, { proveedor: provB }); // repetido

      const det = await pedir('GET', `/api/intervenciones/${i1}`, OP.token);
      assert.strictEqual(det.status, 200, JSON.stringify(det.cuerpo));
      const p = det.cuerpo.participantes;
      assert.deepStrictEqual(
        p.internos,
        [
          { id: U1.id, legajo: U1.legajo, nombre: 'Uno', apellido: 'Alfa' },
          { id: U2.id, legajo: U2.legajo, nombre: 'Dos', apellido: 'Beta' },
          { id: R.id, legajo: R.legajo, nombre: 'Resp', apellido: 'Zeta' },
        ],
        'Por apellido y nombre, sin repetidos y sin el anulado'
      );
      assert.deepStrictEqual(p.externos, [
        { id: provA, nombre: `Proveedor MX A ${suf}` },
        { id: provB, nombre: `Proveedor MX B ${suf}` },
      ]);
      assert.deepStrictEqual(Object.keys(p).sort(), ['externos', 'internos']);

      // Sin responsable ni renglones: listas vacías
      const vacia = await pedir('GET', `/api/intervenciones/${i2}`, OP.token);
      assert.deepStrictEqual(vacia.cuerpo.participantes, { internos: [], externos: [] });

      // Solo con el responsable
      await client.query('UPDATE intervenciones SET responsable_usuario_id = $1 WHERE id = $2', [U2.id, i3]);
      const soloResp = await pedir('GET', `/api/intervenciones/${i3}`, A.token);
      assert.deepStrictEqual(soloResp.cuerpo.participantes, {
        internos: [{ id: U2.id, legajo: U2.legajo, nombre: 'Dos', apellido: 'Beta' }],
        externos: [],
      });
    });

    // =========================================================================
    await t.test('MX-04: Exportar: filtros, alcance, BOM, ";" y decimales con coma; costo solo con COSTOS_VER', async () => {
      await client.query('UPDATE intervenciones SET costo_total_estimado = 1234.5 WHERE id = $1', [i1]);
      const hoy = (await client.query(`SELECT to_char(hoy_instalacion(), 'YYYY-MM-DD') AS d`)).rows[0].d;

      const r = await exportar(A.token, `?maquina_id=${m1}`);
      assert.strictEqual(r.status, 200, r.texto);
      assert.deepStrictEqual([...r.bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 con BOM');
      assert.match(r.tipo ?? '', /^text\/csv; charset=utf-8/);
      assert.strictEqual(r.disposicion, `attachment; filename="intervenciones-${hoy}.csv"`);
      assert.ok(r.texto.includes('\r\n'));

      const [enc, ...datos] = filas(r.texto);
      assert.deepStrictEqual(enc, [
        'Número', 'Tipo', 'Estado', 'Código de máquina', 'Máquina', 'Sector', 'Planta', 'Creada', 'Inicio', 'Fin',
        'Responsable', 'Participantes', 'Descripción', 'Detención (h)', 'Costo total',
      ]);
      assert.deepStrictEqual(datos.map((x) => Number(x[0])).sort(), [i1, i2].sort(), 'Solo las de la máquina');
      const f1 = datos.find((x) => Number(x[0]) === i1)!;
      assert.deepStrictEqual(f1.slice(1, 7), ['Correctivo', 'Pendiente', `MX_M01_${suf}`, 'Maquina MX 01', `MX_S1_${suf}`, `MX_PL_${suf}`]);
      assert.match(f1[7], /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/, 'Fecha dd/mm/aaaa hh:mm');
      assert.deepStrictEqual([f1[8], f1[9]], ['', ''], 'Sin inicio ni fin');
      assert.strictEqual(f1[10], 'Resp Zeta');
      assert.strictEqual(f1[11], `Uno Alfa, Dos Beta, Resp Zeta · Proveedor MX A ${suf}, Proveedor MX B ${suf}`);
      assert.strictEqual(f1[12], `Falla MX uno ${suf}`);
      assert.strictEqual(f1[13], '0,00', 'Horas con coma');
      assert.strictEqual(f1[14], '1234,50', 'Costo con coma');

      // Los filtros del listado: sector, planta, estado, tipo y fechas
      const ids = async (q: string, token = A.token) =>
        filas((await exportar(token, q)).texto).slice(1).map((x) => Number(x[0])).sort((a, b) => a - b);
      assert.deepStrictEqual(await ids(`?sector_id=${s2}`), [i3]);
      assert.deepStrictEqual(await ids(`?planta_id=${pl}`), [i1, i2, i3].sort((a, b) => a - b));
      assert.deepStrictEqual(await ids(`?maquina_id=${m1}&estado=FINALIZADA`), []);
      assert.deepStrictEqual(await ids(`?maquina_id=${m1}&tipo=PREVENTIVO`), []);
      assert.deepStrictEqual(await ids(`?maquina_id=${m1}&desde=2000-01-01&hasta=2000-12-31`), []);
      const malo = await exportar(A.token, '?estado=CUALQUIERA');
      assert.strictEqual(malo.status, 422);

      // El mismo alcance que el listado: el operario (PROPIAS) ve solo las que reportó
      const op = await exportar(OP.token, `?planta_id=${pl}`);
      assert.strictEqual(op.status, 200);
      const [encOp, ...datosOp] = filas(op.texto);
      assert.deepStrictEqual(datosOp.map((x) => Number(x[0])).sort((a, b) => a - b), [i1, i2].sort((a, b) => a - b));
      assert.ok(!encOp.includes('Costo total'), 'Sin COSTOS_VER, sin la columna');
      assert.strictEqual(encOp.length, 14);
      assert.ok(datosOp.every((x) => x.length === 14));
      const listado = await pedir('GET', `/api/intervenciones?planta_id=${pl}`, OP.token);
      assert.deepStrictEqual(
        listado.cuerpo.map((x: any) => x.id).sort((a: number, b: number) => a - b),
        datosOp.map((x) => Number(x[0])).sort((a, b) => a - b),
        'Lo mismo que el listado'
      );

      // Sin INTERVENCIONES_VER: 403
      const sinVer = await crearUsuario('SinVer', 'OPERARIO', 'SinVer');
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
         SELECT $1, id, 'DENEGAR', 'TODAS', 'Prueba MX', $2 FROM permisos WHERE codigo = 'INTERVENCIONES_VER'`,
        [sinVer.id, A.id]
      );
      assert.strictEqual((await exportar(sinVer.token, '')).status, 403);
    });

    // =========================================================================
    await t.test('MX-05: Exportar: fórmulas con comilla adelante, y el máximo de filas', async () => {
      const r = await exportar(A.token, `?maquina_id=${m1}`);
      const f2 = filas(r.texto).find((x) => Number(x[0]) === i2)!;
      assert.strictEqual(f2[12], `'=1+1 Falla MX dos ${suf}`);
      for (const [entrada, salida] of [
        ['=SUMA(A1)', "'=SUMA(A1)"], ['+54 11', "'+54 11"], ['-3', "'-3"], ['@nombre', "'@nombre"], ['Normal', 'Normal'], ['', ''],
      ]) {
        assert.strictEqual(textoSeguro(entrada), salida, entrada);
      }

      // Con ; o comillas, la celda va entre comillas
      await client.query(`UPDATE intervenciones SET descripcion = $1 WHERE id = $2`, [`Dice "hola"; y sigue ${suf}`, i3]);
      const r3 = await exportar(A.token, `?maquina_id=${m2}`);
      assert.ok(r3.texto.includes(`;"Dice ""hola""; y sigue ${suf}";`), r3.texto);

      fijarMaximoExportacion(1);
      try {
        const demasiadas = await pedir('GET', `/api/intervenciones/exportar?maquina_id=${m1}`, A.token);
        assert.deepStrictEqual(
          [demasiadas.status, demasiadas.cuerpo.codigo, demasiadas.cuerpo.total, demasiadas.cuerpo.maximo],
          [422, 'DEMASIADOS_RESULTADOS', 2, 1]
        );
        const justo = await exportar(A.token, `?maquina_id=${m2}`);
        assert.strictEqual(justo.status, 200, 'Una fila, con máximo 1');
      } finally {
        fijarMaximoExportacion();
      }
      assert.strictEqual((await exportar(A.token, `?maquina_id=${m1}`)).status, 200, 'De nuevo con 5.000');
    });

    // =========================================================================
    await t.test('MX-06: Proveedores: código SAE único y la ficha', async () => {
      const codigo = `SAE-MX-${suf}`;
      const alta = await pedir('POST', '/api/proveedores', A.token, {
        nombre: `Proveedor MX C ${suf}`, codigo_externo: `  ${codigo}  `, telefono: '011 4444-5555', email: 'ventas@ejemplo.com',
      });
      assert.strictEqual(alta.status, 201, JSON.stringify(alta.cuerpo));
      createdProveedorIds.push(alta.cuerpo.id);
      assert.strictEqual(alta.cuerpo.codigo_externo, codigo);

      const dup = await pedir('POST', '/api/proveedores', A.token, { nombre: `Proveedor MX D ${suf}`, codigo_externo: ` ${codigo.toLowerCase()} ` });
      assert.deepStrictEqual([dup.status, dup.cuerpo.codigo], [409, 'CODIGO_DUPLICADO']);

      const otro = await pedir('POST', '/api/proveedores', A.token, { nombre: `Proveedor MX D ${suf}` });
      assert.strictEqual(otro.status, 201);
      createdProveedorIds.push(otro.cuerpo.id);
      assert.strictEqual(otro.cuerpo.codigo_externo, null);

      const dupPut = await pedir('PUT', `/api/proveedores/${otro.cuerpo.id}`, A.token, { codigo_externo: codigo.toLowerCase() });
      assert.deepStrictEqual([dupPut.status, dupPut.cuerpo.codigo], [409, 'CODIGO_DUPLICADO']);
      const mismo = await pedir('PUT', `/api/proveedores/${alta.cuerpo.id}`, A.token, { codigo_externo: codigo.toLowerCase() });
      assert.strictEqual(mismo.status, 200, 'Su propio código, en otra forma');
      assert.strictEqual(mismo.cuerpo.codigo_externo, codigo.toLowerCase());
      const largo = await pedir('PUT', `/api/proveedores/${otro.cuerpo.id}`, A.token, { codigo_externo: 'x'.repeat(41) });
      assert.deepStrictEqual([largo.status, largo.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);
      const nombreDup = await pedir('POST', '/api/proveedores', A.token, { nombre: `Proveedor MX D ${suf}`, codigo_externo: `OTRO-${suf}` });
      assert.deepStrictEqual([nombreDup.status, nombreDup.cuerpo.codigo], [409, 'NOMBRE_DUPLICADO'], 'Un nombre repetido sigue siendo NOMBRE_DUPLICADO');

      const lista = await pedir('GET', '/api/proveedores', A.token);
      assert.strictEqual(lista.cuerpo.find((x: any) => x.id === alta.cuerpo.id).codigo_externo, codigo.toLowerCase());

      // La ficha
      const ficha = await pedir('GET', `/api/proveedores/${alta.cuerpo.id}/ficha`, R.token);
      assert.strictEqual(ficha.status, 200);
      assert.deepStrictEqual(ficha.cuerpo, {
        id: alta.cuerpo.id,
        nombre: `Proveedor MX C ${suf}`,
        codigo_externo: codigo.toLowerCase(),
        contacto: null,
        telefono: '011 4444-5555',
        email: 'ventas@ejemplo.com',
        notas: null,
        activo: true,
      });
      const sinPermiso = await pedir('GET', `/api/proveedores/${alta.cuerpo.id}/ficha`, OP.token);
      assert.deepStrictEqual([sinPermiso.status, sinPermiso.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);
      const maximo = Number((await client.query('SELECT COALESCE(max(id), 0) AS m FROM proveedores')).rows[0].m);
      for (const id of [maximo + 100000, 'abc']) {
        const r = await pedir('GET', `/api/proveedores/${id}/ficha`, A.token);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [404, 'PROVEEDOR_NO_ENCONTRADO'], String(id));
      }
    });
  } finally {
    client = await clienteSano(client);
    try {
      fijarMaximoExportacion();
      if (createdDocumentoIds.length > 0 || createdMaquinaIds.length > 0) {
        await client.query('DELETE FROM maquina_documentos WHERE id = ANY($1) OR maquina_id = ANY($2)', [createdDocumentoIds, createdMaquinaIds]);
      }
      const ids = createdIntervencionIds;
      if (ids.length > 0) {
        await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE intervencion_id = ANY($1))', [ids]);
        await client.query('DELETE FROM notificaciones WHERE intervencion_id = ANY($1)', [ids]);
        await client.query('DELETE FROM intervencion_costos WHERE intervencion_id = ANY($1)', [ids]);
        await client.query('DELETE FROM intervencion_auditoria WHERE intervencion_id = ANY($1)', [ids]);
        await client.query('DELETE FROM intervencion_periodos_detencion WHERE intervencion_id = ANY($1)', [ids]);
        await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id = ANY($1)', [ids]);
        await client.query('DELETE FROM historial_estados_maquina WHERE intervencion_id = ANY($1)', [ids]);
        await client.query('DELETE FROM intervenciones WHERE id = ANY($1)', [ids]);
      }
      if (createdMaquinaIds.length > 0) {
        await client.query('DELETE FROM historial_estados_maquina WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
        await client.query('DELETE FROM maquinas WHERE id = ANY($1)', [createdMaquinaIds]);
      }
      if (createdProveedorIds.length > 0) await client.query('DELETE FROM proveedores WHERE id = ANY($1)', [createdProveedorIds]);
      if (createdUsuarioIds.length > 0) {
        await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE usuario_id = ANY($1))', [createdUsuarioIds]);
        await client.query('DELETE FROM notificaciones WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM auditoria_permisos WHERE sobre_usuario_id = ANY($1) OR realizado_por_usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM usuario_permiso WHERE usuario_id = ANY($1) OR otorgado_por_usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM usuario_sector WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [createdUsuarioIds]);
      }
      if (createdSectorIds.length > 0) await client.query('DELETE FROM sectores WHERE id = ANY($1)', [createdSectorIds]);
      if (createdPlantaIds.length > 0) await client.query('DELETE FROM plantas WHERE id = ANY($1)', [createdPlantaIds]);
    } finally {
      client.release();
    }
  }
});

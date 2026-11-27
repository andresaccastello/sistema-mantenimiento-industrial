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

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (AVISOS CRITICOS TESTS)');
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

test('Etapa AV1 — Avisos de parada crítica y de stock bajo (AC-01 a AC-13)', async (t) => {
  let client = await pool.connect();

  const createdPlantaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdCriticidadIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdUsuarioIds: number[] = [];
  const createdIntervencionIds: number[] = [];
  const createdRepuestoIds: number[] = [];
  const createdProveedorIds: number[] = [];
  const suf = Date.now();
  const marcaFalla = `AC10_${suf}`;

  // Lo que la prueba cambia de la configuración, para dejarlo como estaba
  const inicio = {
    sw: (await client.query('SELECT critico_por_detencion_posterior AS v FROM configuracion_sistema WHERE id = 1')).rows[0].v as boolean,
    canal: (await client.query(
      `SELECT activo, actualizado_en, actualizado_por_usuario_id FROM notificacion_canales WHERE canal = 'EMAIL'`
    )).rows[0],
    regla: (await client.query(
      `SELECT modo, actualizado_en, actualizado_por_usuario_id FROM notificacion_reglas
       WHERE tipo_evento = 'PARADA_CRITICA' AND canal = 'EMAIL'`
    )).rows[0],
  };

  try {
    const passHash = await bcrypt.hash('pass123', 10);
    const perfilMap: Record<string, number> = {};
    for (const r of (await client.query('SELECT id, nombre FROM perfiles')).rows) {
      perfilMap[r.nombre] = Number(r.id);
    }
    const permisoId = async (codigo: string) =>
      Number((await client.query('SELECT id FROM permisos WHERE codigo = $1', [codigo])).rows[0].id);
    const sistemaId = Number((await client.query('SELECT id FROM usuarios WHERE es_sistema')).rows[0].id);

    const pl = Number((await client.query('INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`AC_PL_${suf}`])).rows[0].id);
    createdPlantaIds.push(pl);
    async function crearSector(nombre: string) {
      const id = Number((await client.query(
        'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`${nombre}_${suf}`, pl]
      )).rows[0].id);
      createdSectorIds.push(id);
      return id;
    }
    const s1 = await crearSector('AC_S1');
    const s2 = await crearSector('AC_S2');

    const orden = 30000 + (suf % 2000);
    async function crearCriticidad(clave: string, prioridadAlta: boolean, n: number) {
      const id = Number((await client.query(
        `INSERT INTO criticidades (codigo, nombre, orden, prioridad_alta, por_omision, activo)
         VALUES ($1, $2, $3, $4, FALSE, TRUE) RETURNING id`,
        [`AC_${clave}_${suf}`, `Criticidad AC ${clave} ${suf}`, orden + n, prioridadAlta]
      )).rows[0].id);
      createdCriticidadIds.push(id);
      return id;
    }
    const critAlta = await crearCriticidad('ALTA', true, 0);
    const critBaja = await crearCriticidad('BAJA', false, 1);

    let numeroMaquina = 0;
    async function crearMaquina(criticidadId = critAlta, sectorId = s1) {
      numeroMaquina++;
      const n = String(numeroMaquina).padStart(2, '0');
      const r = await client.query(
        `INSERT INTO maquinas (codigo, nombre, sector_id, criticidad_id, activo)
         VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
        [`AC_M${n}_${suf}`, `Maquina AC ${n}`, sectorId, criticidadId]
      );
      const id = Number(r.rows[0].id);
      createdMaquinaIds.push(id);
      return id;
    }

    async function crearUsuario(clave: string, perfil: string, sectores: number[]) {
      const res = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
         VALUES ($1, $2, 'AC', $3, $4, TRUE, 1) RETURNING id, legajo, sesion_version`,
        [`AC_${clave}_${suf}`, clave, passHash, perfilMap[perfil]]
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
    const excepcion = (usuarioId: number, permiso: number, efecto: 'CONCEDER' | 'DENEGAR', alcance: string | null) =>
      client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
         VALUES ($1, $2, $3, COALESCE($4, 'TODAS'), 'Prueba de avisos AV1', $5)`,
        [usuarioId, permiso, efecto, alcance, A.id]
      );
    const permCriticas = await permisoId('NOTIFICACIONES_CRITICAS_RECIBIR');
    const permStock = await permisoId('NOTIFICACIONES_STOCK_RECIBIR');

    // R1 reporta las fallas (responsable de mantenimiento: tiene el permiso de paradas con TODAS)
    const R1 = await crearUsuario('Resp1', 'RESPONSABLE_MANTENIMIENTO', [s1]);
    // Jefes de planta: Consulta con CONCEDER y SECTORES
    const J1 = await crearUsuario('Jefe1', 'CONSULTA', [s1]);
    const J2 = await crearUsuario('Jefe2', 'CONSULTA', [s2]);
    await excepcion(J1.id, permCriticas, 'CONCEDER', 'SECTORES');
    await excepcion(J2.id, permCriticas, 'CONCEDER', 'SECTORES');
    // Consulta sin excepción: el permiso de su perfil, con TODAS
    const C = await crearUsuario('Consulta', 'CONSULTA', []);
    // Sin el permiso
    const OP = await crearUsuario('Oper', 'OPERARIO', [s1]);
    // Responsable con DENEGAR
    const R2 = await crearUsuario('Resp2', 'RESPONSABLE_MANTENIMIENTO', [s1]);
    await excepcion(R2.id, permCriticas, 'DENEGAR', null);
    // Compras: operario con CONCEDER del aviso de stock
    const Compras = await crearUsuario('Compras', 'OPERARIO', []);
    await excepcion(Compras.id, permStock, 'CONCEDER', null);

    const reportar = async (maquinaId: number, detiene: boolean, token = R1.token) => {
      const r = await pedir('POST', '/api/intervenciones', token, {
        maquina_id: maquinaId,
        descripcion: `Falla de prueba AV1 en la máquina ${maquinaId}`,
        detiene_maquina: detiene,
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      createdIntervencionIds.push(Number(r.cuerpo.id));
      return Number(r.cuerpo.id);
    };
    const paradas = async (intervencionId: number) =>
      (await client.query(
        `SELECT usuario_id, prioridad, titulo, mensaje, intervencion_id, maquina_id, generada_por_usuario_id
         FROM notificaciones WHERE tipo_evento = 'PARADA_CRITICA' AND intervencion_id = $1 ORDER BY usuario_id`,
        [intervencionId]
      )).rows.map((x) => ({ ...x, usuario_id: Number(x.usuario_id) }));
    const destinatarios = async (intervencionId: number) => new Set((await paradas(intervencionId)).map((x) => x.usuario_id));
    const ponerSwitch = async (valor: boolean) => {
      const r = await pedir('PUT', '/api/configuracion/avisos', A.token, { critico_por_detencion_posterior: valor });
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
    };

    // =========================================================================
    await t.test('AC-01: Falla con la máquina detenida en una máquina crítica', async () => {
      const m = await crearMaquina();
      const id = await reportar(m, true);
      const filas = await paradas(id);
      const ids = new Set(filas.map((x) => x.usuario_id));
      assert.ok(ids.has(A.id), 'TODAS (administrador)');
      assert.ok(ids.has(C.id), 'TODAS (Consulta, por su perfil)');
      assert.ok(ids.has(J1.id), 'SECTORES del mismo sector');
      assert.ok(!ids.has(J2.id), 'SECTORES de otro sector');
      assert.ok(!ids.has(OP.id), 'Sin el permiso');
      for (const f of filas) {
        assert.strictEqual(f.prioridad, 'ALTA');
        assert.strictEqual(Number(f.intervencion_id), id);
        assert.strictEqual(Number(f.maquina_id), m);
        assert.strictEqual(Number(f.generada_por_usuario_id), sistemaId);
      }
      const nuestra = filas.find((x) => x.usuario_id === A.id);
      assert.strictEqual(nuestra.titulo, `Parada crítica: AC_M${String(numeroMaquina).padStart(2, '0')}_${suf} · Maquina AC ${String(numeroMaquina).padStart(2, '0')}`);
      assert.strictEqual(nuestra.mensaje, `Sector: AC_S1_${suf}. Falla de prueba AV1 en la máquina ${m}`);

      // FALLA_REGISTRADA sigue saliendo, como un evento aparte
      const fallas = await client.query(
        `SELECT count(*)::int AS n FROM notificaciones WHERE tipo_evento = 'FALLA_REGISTRADA' AND intervencion_id = $1`, [id]
      );
      assert.ok(fallas.rows[0].n > 0);
    });

    // =========================================================================
    await t.test('AC-02: Máquina funcionando, o sin prioridad alta: no avisa', async () => {
      const funcionando = await reportar(await crearMaquina(), false);
      assert.deepStrictEqual(await paradas(funcionando), []);
      const noCritica = await reportar(await crearMaquina(critBaja), true);
      assert.deepStrictEqual(await paradas(noCritica), []);
    });

    // =========================================================================
    await t.test('AC-03: Detención registrada después (y al reabrir), según el switch', async () => {
      const registrar = async (id: number) => {
        const r = await pedir('POST', `/api/intervenciones/${id}/registrar-detencion`, R1.token, {
          estado_esperado: 'PENDIENTE',
          observacion: 'La máquina se detuvo después',
        });
        assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      };

      await ponerSwitch(true);
      const conSwitch = await reportar(await crearMaquina(), false);
      assert.deepStrictEqual(await paradas(conSwitch), [], 'Antes de la detención');
      await registrar(conSwitch);
      assert.ok((await destinatarios(conSwitch)).has(A.id), 'Con el switch en TRUE, avisa');

      await ponerSwitch(false);
      const sinSwitch = await reportar(await crearMaquina(), false);
      await registrar(sinSwitch);
      assert.deepStrictEqual(await paradas(sinSwitch), [], 'Con el switch en FALSE, no avisa');

      // Reabrir con la máquina detenida: como una detención registrada después
      const reabrir = async (switchValor: boolean) => {
        await ponerSwitch(switchValor);
        const id = await reportar(await crearMaquina(), false);
        const res = await pedir('POST', `/api/intervenciones/${id}/resolver-ahora`, R1.token, {
          estado_esperado: 'PENDIENTE',
          fecha_inicio: new Date().toISOString(),
          trabajo_realizado: 'Trabajo de prueba AV1',
          ejecucion: 'INTERNA',
        });
        assert.strictEqual(res.status, 200, JSON.stringify(res.cuerpo));
        const re = await pedir('POST', `/api/intervenciones/${id}/reabrir`, R1.token, {
          estado_esperado: 'FINALIZADA',
          motivo: 'Volvió a fallar en la prueba',
          maquina_detenida: true,
        });
        assert.strictEqual(re.status, 200, JSON.stringify(re.cuerpo));
        return id;
      };
      assert.ok((await destinatarios(await reabrir(true))).has(A.id), 'Reabrir detenida con TRUE, avisa');
      assert.deepStrictEqual(await paradas(await reabrir(false)), [], 'Reabrir detenida con FALSE, no avisa');
      await ponerSwitch(true);
    });

    // =========================================================================
    await t.test('AC-04: Quien reportó y tiene el permiso, también recibe el aviso', async () => {
      const id = await reportar(await crearMaquina(), true, R1.token);
      assert.ok((await destinatarios(id)).has(R1.id), 'R1 reportó y lo recibe');
      const falla = await client.query(
        `SELECT count(*)::int AS n FROM notificaciones WHERE tipo_evento = 'FALLA_REGISTRADA' AND intervencion_id = $1 AND usuario_id = $2`,
        [id, R1.id]
      );
      assert.strictEqual(falla.rows[0].n, 0, 'FALLA_REGISTRADA sigue sin avisarle a quien reportó');
    });

    // =========================================================================
    await t.test('AC-05: Excepciones DENEGAR y CONCEDER con SECTORES', async () => {
      const enS1 = await destinatarios(await reportar(await crearMaquina(critAlta, s1), true));
      assert.ok(!enS1.has(R2.id), 'DENEGAR lo saca');
      assert.ok(enS1.has(J1.id), 'CONCEDER con SECTORES, su sector');
      assert.ok(!enS1.has(J2.id));
      const enS2 = await destinatarios(await reportar(await crearMaquina(critAlta, s2), true, A.token));
      assert.ok(enS2.has(J2.id), 'CONCEDER con SECTORES, su sector');
      assert.ok(!enS2.has(J1.id), 'No el sector de otro');
    });

    // =========================================================================
    await t.test('AC-06: El mail se encola según la regla del tipo', async () => {
      await client.query(`UPDATE notificacion_canales SET activo = TRUE WHERE canal = 'EMAIL'`);
      const envios = async (id: number) =>
        (await client.query(
          `SELECT count(*)::int AS envios,
                  (SELECT count(*)::int FROM notificaciones WHERE tipo_evento = 'PARADA_CRITICA' AND intervencion_id = $1) AS avisos
           FROM notificacion_envios e JOIN notificaciones n ON n.id = e.notificacion_id
           WHERE n.tipo_evento = 'PARADA_CRITICA' AND n.intervencion_id = $1 AND e.canal = 'EMAIL' AND e.estado = 'PENDIENTE'`,
          [id]
        )).rows[0];

      await client.query(`UPDATE notificacion_reglas SET modo = 'SIEMPRE' WHERE tipo_evento = 'PARADA_CRITICA' AND canal = 'EMAIL'`);
      const conMail = await envios(await reportar(await crearMaquina(), true));
      assert.ok(conMail.avisos > 0);
      assert.strictEqual(conMail.envios, conMail.avisos, 'Un envío por aviso');

      await client.query(`UPDATE notificacion_reglas SET modo = 'NUNCA' WHERE tipo_evento = 'PARADA_CRITICA' AND canal = 'EMAIL'`);
      const sinMail = await envios(await reportar(await crearMaquina(), true));
      assert.ok(sinMail.avisos > 0);
      assert.strictEqual(sinMail.envios, 0, 'Con NUNCA no se encola');
    });

    // =========================================================================
    // Stock
    // =========================================================================
    const prov = Number((await client.query('INSERT INTO proveedores (nombre) VALUES ($1) RETURNING id', [`Proveedor AC ${suf}`])).rows[0].id);
    createdProveedorIds.push(prov);
    let numeroRepuesto = 0;
    async function crearRepuesto(extra: Record<string, unknown>) {
      const r = await pedir('POST', '/api/repuestos', A.token, {
        nombre: `Repuesto AC ${++numeroRepuesto} ${suf}`,
        unidad: 'u',
        lleva_stock: true,
        ...extra,
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      createdRepuestoIds.push(Number(r.cuerpo.id));
      return { id: Number(r.cuerpo.id), nombre: r.cuerpo.nombre as string };
    }
    const mover = async (id: number, tipo: 'EGRESO' | 'INGRESO', cantidad: number) => {
      const body = tipo === 'EGRESO' ? { tipo, cantidad, observacion: 'Consumo de prueba AV1' } : { tipo, cantidad };
      return pedir('POST', `/api/repuestos/${id}/movimientos`, A.token, body);
    };
    const avisosStock = async (id: number) =>
      (await client.query(
        `SELECT usuario_id, prioridad, titulo, mensaje, repuesto_id, intervencion_id, maquina_id, generada_por_usuario_id
         FROM notificaciones WHERE tipo_evento = 'STOCK_BAJO' AND repuesto_id = $1 ORDER BY id`,
        [id]
      )).rows.map((x) => ({ ...x, usuario_id: Number(x.usuario_id) }));
    const paraA = async (id: number) => (await avisosStock(id)).filter((x) => x.usuario_id === A.id);
    const marca = async (id: number) =>
      (await client.query('SELECT stock_bajo_avisado_en FROM repuestos WHERE id = $1', [id])).rows[0].stock_bajo_avisado_en;

    // =========================================================================
    await t.test('AC-07: Un consumo deja el repuesto en el mínimo', async () => {
      const rep = await crearRepuesto({ stock_inicial: 10, stock_minimo: 3, proveedor_id: prov });
      const r1 = await mover(rep.id, 'EGRESO', 7);
      assert.ok(r1.status >= 200 && r1.status < 300, JSON.stringify(r1.cuerpo));

      const avisos = await avisosStock(rep.id);
      const ids = new Set(avisos.map((x) => x.usuario_id));
      assert.ok(ids.has(A.id), 'Administrador');
      assert.ok(ids.has(Compras.id), 'Operario con CONCEDER del aviso de stock');
      assert.ok(!ids.has(OP.id), 'Sin el permiso');
      assert.ok(!ids.has(J1.id), 'Consulta, sin el permiso de stock');
      const a = avisos.find((x) => x.usuario_id === A.id);
      assert.strictEqual(a.prioridad, 'NORMAL');
      assert.strictEqual(a.titulo, `Stock bajo: ${rep.nombre}`);
      assert.strictEqual(a.mensaje, `Quedan 3 u (mínimo: 3). Proveedor habitual: Proveedor AC ${suf}`);
      assert.strictEqual(Number(a.repuesto_id), rep.id);
      assert.deepStrictEqual([a.intervencion_id, a.maquina_id], [null, null]);
      assert.strictEqual(Number(a.generada_por_usuario_id), sistemaId);
      assert.ok(await marca(rep.id), 'Queda la marca');

      await mover(rep.id, 'EGRESO', 1);
      assert.strictEqual((await paraA(rep.id)).length, 1, 'Por debajo del mínimo no repite');

      await mover(rep.id, 'INGRESO', 5);
      assert.strictEqual(await marca(rep.id), null, 'Repuesto por encima del mínimo: limpia la marca');

      await mover(rep.id, 'EGRESO', 4);
      const despues = await paraA(rep.id);
      assert.strictEqual(despues.length, 2, 'Vuelve a avisar');
      assert.strictEqual(despues[1].mensaje, `Quedan 3 u (mínimo: 3). Proveedor habitual: Proveedor AC ${suf}`);
    });

    // =========================================================================
    await t.test('AC-08: Sin mínimo, o sin control de stock, nunca avisa', async () => {
      const sinMinimo = await crearRepuesto({ stock_inicial: 2 });
      await mover(sinMinimo.id, 'EGRESO', 2);
      assert.deepStrictEqual(await avisosStock(sinMinimo.id), []);

      // Sin control de stock no lleva mínimo, y la edición tampoco lo deja poner
      const sinControl = await crearRepuesto({ lleva_stock: false });
      const mov = await mover(sinControl.id, 'EGRESO', 1);
      assert.strictEqual(mov.status, 409);
      await pedir('PUT', `/api/repuestos/${sinControl.id}`, A.token, { stock_minimo: 3 });
      assert.deepStrictEqual(await avisosStock(sinControl.id), []);
      assert.strictEqual(await marca(sinControl.id), null);
    });

    // =========================================================================
    await t.test('AC-09: Cambiar el mínimo limpia la marca y, si ya está por debajo, avisa', async () => {
      const rep = await crearRepuesto({ stock_inicial: 5, stock_minimo: 2 });
      assert.deepStrictEqual(await paraA(rep.id), [], 'Por encima del mínimo');

      const subir = await pedir('PUT', `/api/repuestos/${rep.id}`, A.token, { stock_minimo: 6 });
      assert.strictEqual(subir.status, 200, JSON.stringify(subir.cuerpo));
      const primero = await paraA(rep.id);
      assert.strictEqual(primero.length, 1, 'El stock ya está por debajo del mínimo nuevo: avisa');
      assert.strictEqual(primero[0].mensaje, 'Quedan 5 u (mínimo: 6).');
      assert.ok(await marca(rep.id));

      await pedir('PUT', `/api/repuestos/${rep.id}`, A.token, { stock_minimo: 8 });
      assert.strictEqual((await paraA(rep.id)).length, 2, 'Otro mínimo: la marca se limpia y vuelve a avisar');

      await pedir('PUT', `/api/repuestos/${rep.id}`, A.token, { stock_minimo: 4 });
      assert.strictEqual((await paraA(rep.id)).length, 2, 'Por encima del mínimo nuevo: no avisa');
      assert.strictEqual(await marca(rep.id), null, 'Y la marca queda limpia');

      await pedir('PUT', `/api/repuestos/${rep.id}`, A.token, { descripcion: 'Sin cambiar el mínimo' });
      assert.strictEqual((await paraA(rep.id)).length, 2);
    });

    // =========================================================================
    await t.test('AC-10: Si falla el aviso, el movimiento se guarda igual', async () => {
      const rep = await crearRepuesto({ nombre: `Repuesto ${marcaFalla}`, stock_inicial: 4, stock_minimo: 2 });
      await client.query(
        `CREATE OR REPLACE FUNCTION trg_fn_test_fail_stock_bajo() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN
           IF NEW.tipo_evento = 'STOCK_BAJO' AND NEW.titulo LIKE '%${marcaFalla}%' THEN
             RAISE EXCEPTION 'Fallo forzado de prueba stock bajo';
           END IF;
           RETURN NEW;
         END;
         $$`
      );
      await client.query(
        `CREATE TRIGGER trg_test_fail_stock_bajo BEFORE INSERT ON notificaciones
         FOR EACH ROW EXECUTE FUNCTION trg_fn_test_fail_stock_bajo()`
      );
      try {
        const r = await mover(rep.id, 'EGRESO', 3);
        assert.ok(r.status >= 200 && r.status < 300, `No da 500: ${r.status} ${JSON.stringify(r.cuerpo)}`);
        const st = await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [rep.id]);
        assert.strictEqual(Number(st.rows[0].cantidad_disponible), 1, 'El movimiento se guardó');
        const movs = await client.query(`SELECT count(*)::int AS n FROM movimientos_stock WHERE repuesto_id = $1 AND tipo = 'EGRESO'`, [rep.id]);
        assert.strictEqual(movs.rows[0].n, 1);
        assert.deepStrictEqual(await avisosStock(rep.id), []);
        assert.strictEqual(await marca(rep.id), null, 'Sin aviso, sin marca: el próximo movimiento lo vuelve a intentar');
      } finally {
        await client.query('DROP TRIGGER IF EXISTS trg_test_fail_stock_bajo ON notificaciones');
        await client.query('DROP FUNCTION IF EXISTS trg_fn_test_fail_stock_bajo()');
      }
    });

    // =========================================================================
    await t.test('AC-11: PUT del switch', async () => {
      const ok = await pedir('PUT', '/api/configuracion/avisos', A.token, { critico_por_detencion_posterior: false });
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.cuerpo));
      assert.strictEqual(ok.cuerpo.critico_por_detencion_posterior, false);
      assert.strictEqual((await pedir('GET', '/api/configuracion/avisos', A.token)).cuerpo.critico_por_detencion_posterior, false);

      const malos: Array<[string, unknown]> = [
        ['"true"', { critico_por_detencion_posterior: 'true' }],
        ['1', { critico_por_detencion_posterior: 1 }],
        ['sin el campo', {}],
        ['otro campo', { critico_por_detencion_posterior: true, otro: 1 }],
      ];
      for (const [caso, cuerpo] of malos) {
        const r = await pedir('PUT', '/api/configuracion/avisos', A.token, cuerpo);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], caso);
      }
      const sinPermiso = await pedir('PUT', '/api/configuracion/avisos', R1.token, { critico_por_detencion_posterior: true });
      assert.deepStrictEqual([sinPermiso.status, sinPermiso.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);
      assert.strictEqual(
        (await client.query('SELECT critico_por_detencion_posterior AS v FROM configuracion_sistema WHERE id = 1')).rows[0].v,
        false,
        'Los rechazos no cambian nada'
      );

      const vuelta = await pedir('PUT', '/api/configuracion/avisos', A.token, { critico_por_detencion_posterior: true });
      assert.strictEqual(vuelta.cuerpo.critico_por_detencion_posterior, true);
    });

    // =========================================================================
    await t.test('AC-12: Dos consumos a la vez que cruzan el mínimo dan un solo aviso', async () => {
      for (let ronda = 0; ronda < 3; ronda++) {
        const rep = await crearRepuesto({ stock_inicial: 4, stock_minimo: 3 });
        const [a, b] = await Promise.all([mover(rep.id, 'EGRESO', 1), mover(rep.id, 'EGRESO', 1)]);
        assert.ok(a.status < 300 && b.status < 300, `${a.status} ${b.status}`);
        assert.strictEqual(Number((await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [rep.id])).rows[0].cantidad_disponible), 2);
        assert.strictEqual((await paraA(rep.id)).length, 1, `Ronda ${ronda}: un solo aviso`);
      }
    });

    // =========================================================================
    await t.test('AC-13: El alta con el stock inicial en el mínimo o por debajo avisa', async () => {
      const enElMinimo = await crearRepuesto({ stock_inicial: 3, stock_minimo: 3, proveedor_id: prov });
      const avisos = await avisosStock(enElMinimo.id);
      const ids = new Set(avisos.map((x) => x.usuario_id));
      assert.ok(ids.has(A.id), 'Administrador');
      assert.ok(ids.has(Compras.id), 'Operario con CONCEDER del aviso de stock');
      assert.ok(!ids.has(OP.id), 'Sin el permiso');
      const a = avisos.find((x) => x.usuario_id === A.id);
      assert.strictEqual(a.titulo, `Stock bajo: ${enElMinimo.nombre}`);
      assert.strictEqual(a.mensaje, `Quedan 3 u (mínimo: 3). Proveedor habitual: Proveedor AC ${suf}`);
      assert.strictEqual(Number(a.generada_por_usuario_id), sistemaId);
      assert.ok(await marca(enElMinimo.id), 'Queda la marca, en la misma transacción del alta');

      await mover(enElMinimo.id, 'EGRESO', 1);
      assert.strictEqual((await paraA(enElMinimo.id)).length, 1, 'Un consumo después no repite');

      const sinStock = await crearRepuesto({ stock_inicial: 0, stock_minimo: 2 });
      const avisosSinStock = await paraA(sinStock.id);
      assert.strictEqual(avisosSinStock.length, 1, 'Stock inicial 0, por debajo del mínimo');
      assert.strictEqual(avisosSinStock[0].mensaje, 'Quedan 0 u (mínimo: 2).');

      const sinStockInicial = await crearRepuesto({ stock_minimo: 1 });
      assert.strictEqual((await paraA(sinStockInicial.id)).length, 1, 'Sin stock_inicial también es 0');

      const porEncima = await crearRepuesto({ stock_inicial: 5, stock_minimo: 2 });
      assert.deepStrictEqual(await avisosStock(porEncima.id), [], 'Por encima del mínimo');
      assert.strictEqual(await marca(porEncima.id), null);

      const sinMinimo = await crearRepuesto({ stock_inicial: 0 });
      assert.deepStrictEqual(await avisosStock(sinMinimo.id), [], 'Sin mínimo');
    });
  } finally {
    client = await clienteSano(client);
    try {
      await client.query('DROP TRIGGER IF EXISTS trg_test_fail_stock_bajo ON notificaciones');
      await client.query('DROP FUNCTION IF EXISTS trg_fn_test_fail_stock_bajo()');

      // La configuración, como estaba al empezar
      await client.query('UPDATE configuracion_sistema SET critico_por_detencion_posterior = $1 WHERE id = 1', [inicio.sw]);
      await client.query(
        `UPDATE notificacion_canales SET activo = $1, actualizado_en = $2, actualizado_por_usuario_id = $3 WHERE canal = 'EMAIL'`,
        [inicio.canal.activo, inicio.canal.actualizado_en, inicio.canal.actualizado_por_usuario_id]
      );
      await client.query(
        `UPDATE notificacion_reglas SET modo = $1, actualizado_en = $2, actualizado_por_usuario_id = $3
         WHERE tipo_evento = 'PARADA_CRITICA' AND canal = 'EMAIL'`,
        [inicio.regla.modo, inicio.regla.actualizado_en, inicio.regla.actualizado_por_usuario_id]
      );

      const ids = createdIntervencionIds;
      if (ids.length > 0) {
        await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE intervencion_id = ANY($1))', [ids]);
        await client.query('DELETE FROM notificaciones WHERE intervencion_id = ANY($1)', [ids]);
        await client.query('DELETE FROM intervencion_auditoria WHERE intervencion_id = ANY($1)', [ids]);
        await client.query('DELETE FROM intervencion_periodos_detencion WHERE intervencion_id = ANY($1)', [ids]);
        await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id = ANY($1)', [ids]);
        await client.query('DELETE FROM historial_estados_maquina WHERE intervencion_id = ANY($1)', [ids]);
        await client.query('DELETE FROM intervenciones WHERE id = ANY($1)', [ids]);
      }
      if (createdMaquinaIds.length > 0) {
        await client.query('DELETE FROM intervencion_periodos_detencion WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
        await client.query('DELETE FROM historial_estados_maquina WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
        await client.query('DELETE FROM maquinas WHERE id = ANY($1)', [createdMaquinaIds]);
      }
      if (createdRepuestoIds.length > 0) {
        await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE repuesto_id = ANY($1))', [createdRepuestoIds]);
        await client.query('DELETE FROM notificaciones WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM movimientos_stock WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM repuesto_costos WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM repuestos WHERE id = ANY($1)', [createdRepuestoIds]);
      }
      if (createdProveedorIds.length > 0) await client.query('DELETE FROM proveedores WHERE id = ANY($1)', [createdProveedorIds]);
      if (createdCriticidadIds.length > 0) await client.query('DELETE FROM criticidades WHERE id = ANY($1)', [createdCriticidadIds]);
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

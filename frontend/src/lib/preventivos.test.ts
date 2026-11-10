import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  textoFrecuencia,
  textoVencimiento,
  formatFechaDia,
  validarTareaBorrador,
  borradorTareaVacio,
  borradorDeTarea,
  cuerpoPlan,
  cuerpoTarea,
  tareasParaGenerar,
  avisoTareasSinMarcar,
  leerFiltrosPreventivos,
  escribirFiltrosPreventivos,
  paramsVencimientos,
  paramsPlanes,
  alternarEstado,
  textoPendientes,
  errorTareaDeApi,
  erroresDeApi,
  sinErrorDeFila,
  textoPrevistos,
  previstosDeBorrador,
  BorradorTarea,
} from './preventivos';
import { obtenerInfoEstado, ESTADOS_TAREA_PREVENTIVA } from './estados';
import type { TareaPlan } from '../api/tipos';

const tareaBase: TareaPlan = {
  id: 41,
  orden: 1,
  accion: 'Cambiar el aceite del reductor',
  detalle: null,
  frecuencia_valor: 6,
  frecuencia_unidad: 'MESES',
  primera_fecha: '2026-11-01',
  repuestos: [],
  proveedor: null,
  activo: true,
  ultima_ejecucion: null,
  proxima_fecha: '2026-11-01',
  dias: -8,
  estado: 'VENCIDA',
  intervencion_en_curso: null,
};

const borrador = (cambios: Partial<BorradorTarea> = {}): BorradorTarea => ({
  ...borradorTareaVacio(),
  accion: 'Cambiar el aceite',
  primeraFecha: '2026-12-01',
  ...cambios,
});

describe('FE-67: textoFrecuencia', () => {
  it('singular con 1 y plural con más', () => {
    assert.equal(textoFrecuencia(1, 'DIAS'), 'Cada día');
    assert.equal(textoFrecuencia(3, 'DIAS'), 'Cada 3 días');
    assert.equal(textoFrecuencia(1, 'SEMANAS'), 'Cada semana');
    assert.equal(textoFrecuencia(2, 'SEMANAS'), 'Cada 2 semanas');
    assert.equal(textoFrecuencia(1, 'MESES'), 'Cada mes');
    assert.equal(textoFrecuencia(6, 'MESES'), 'Cada 6 meses');
    assert.equal(textoFrecuencia(1, 'ANIOS'), 'Cada año');
    assert.equal(textoFrecuencia(2, 'ANIOS'), 'Cada 2 años');
  });
});

describe('FE-68: textoVencimiento', () => {
  it('vencida, hoy y por vencer', () => {
    assert.equal(textoVencimiento(-3), 'Venció hace 3 días');
    assert.equal(textoVencimiento(-1), 'Venció ayer');
    assert.equal(textoVencimiento(0), 'Vence hoy');
    assert.equal(textoVencimiento(1), 'Vence mañana');
    assert.equal(textoVencimiento(5), 'Vence en 5 días');
  });
});

describe('FE-69: formatFechaDia', () => {
  it('DD/MM/YYYY sin pasar por Date', () => {
    assert.equal(formatFechaDia('2026-11-09'), '09/11/2026');
    assert.equal(formatFechaDia('2026-01-01'), '01/01/2026');
    assert.equal(formatFechaDia('2026-12-31'), '31/12/2026');
  });

  it('null, vacío o un texto que no es fecha: "—"', () => {
    assert.equal(formatFechaDia(null), '—');
    assert.equal(formatFechaDia(undefined), '—');
    assert.equal(formatFechaDia(''), '—');
    assert.equal(formatFechaDia('9/11/2026'), '—');
  });
});

describe('FE-70: validarTareaBorrador', () => {
  it('una tarea completa no tiene errores', () => {
    assert.deepEqual(validarTareaBorrador(borrador()), {});
    assert.deepEqual(validarTareaBorrador(borrador({ repuestos: [{ repuestoId: '2', cantidad: 2.5 }], proveedorId: '3' })), {});
  });

  it('acción de 3 a 200 caracteres, recortada', () => {
    const msg = 'Escribí qué hay que hacer (de 3 a 200 caracteres).';
    assert.equal(validarTareaBorrador(borrador({ accion: '  ab  ' })).accion, msg);
    assert.equal(validarTareaBorrador(borrador({ accion: 'x'.repeat(201) })).accion, msg);
    assert.equal(validarTareaBorrador(borrador({ accion: 'abc' })).accion, undefined);
  });

  it('cada: un entero de 1 al máximo de la unidad', () => {
    assert.equal(validarTareaBorrador(borrador({ frecuenciaValor: 0 })).frecuencia, 'Ingresá un número entero de 1 a 120.');
    assert.equal(validarTareaBorrador(borrador({ frecuenciaValor: '' })).frecuencia, 'Ingresá un número entero de 1 a 120.');
    assert.equal(validarTareaBorrador(borrador({ frecuenciaValor: 1.5 })).frecuencia, 'Ingresá un número entero de 1 a 120.');
    assert.equal(validarTareaBorrador(borrador({ frecuenciaValor: 121 })).frecuencia, 'Ingresá un número entero de 1 a 120.');
    assert.equal(validarTareaBorrador(borrador({ frecuenciaValor: 120 })).frecuencia, undefined);
    assert.equal(
      validarTareaBorrador(borrador({ frecuenciaValor: 3651, frecuenciaUnidad: 'DIAS' })).frecuencia,
      'Ingresá un número entero de 1 a 3650.'
    );
    assert.equal(
      validarTareaBorrador(borrador({ frecuenciaValor: 521, frecuenciaUnidad: 'SEMANAS' })).frecuencia,
      'Ingresá un número entero de 1 a 520.'
    );
    assert.equal(
      validarTareaBorrador(borrador({ frecuenciaValor: 11, frecuenciaUnidad: 'ANIOS' })).frecuencia,
      'Ingresá un número entero de 1 a 10.'
    );
  });

  it('la primera fecha es obligatoria', () => {
    assert.equal(validarTareaBorrador(borrador({ primeraFecha: null })).primeraFecha, 'Elegí la fecha.');
  });

  it('repuesto y cantidad van juntos', () => {
    const fila = (repuestoId: string | null, cantidad: number | string) => borrador({ repuestos: [{ repuestoId, cantidad }] });
    assert.deepEqual(validarTareaBorrador(fila('2', '')), { filas: { 0: { cantidad: 'Ingresá la cantidad.' } } });
    assert.deepEqual(validarTareaBorrador(fila(null, 2)), { filas: { 0: { repuesto: 'Elegí el repuesto.' } } });
    assert.ok(validarTareaBorrador(fila('2', 0)).filas?.[0]?.cantidad);
    assert.ok(validarTareaBorrador(fila('2', '1,2345')).filas?.[0]?.cantidad);
  });
});

describe('FE-71: cuerpoPlan y cuerpoTarea', () => {
  it('el alta de una tarea: sin los campos vacíos, con números', () => {
    assert.deepEqual(cuerpoTarea(borrador({ frecuenciaValor: '6', detalle: '  ' })), {
      accion: 'Cambiar el aceite',
      frecuencia_valor: 6,
      frecuencia_unidad: 'MESES',
      primera_fecha: '2026-12-01',
    });
    assert.deepEqual(
      cuerpoTarea(borrador({ detalle: ' Con el equipo frío ', repuestos: [{ repuestoId: '2', cantidad: '2,5' }], proveedorId: '3' })),
      {
        accion: 'Cambiar el aceite',
        detalle: 'Con el equipo frío',
        frecuencia_valor: 1,
        frecuencia_unidad: 'MESES',
        primera_fecha: '2026-12-01',
        repuestos: [{ repuesto_id: 2, cantidad: 2.5 }],
        proveedor_id: 3,
      }
    );
  });

  it('al editar, solo lo que cambió; lo vaciado va en null; repuesto y cantidad juntos', () => {
    const original = borradorDeTarea({
      ...tareaBase,
      detalle: 'Con el equipo frío',
      repuestos: [{ repuesto: { id: 2, codigo: 'AC-68', nombre: 'Aceite', unidad: 'litro' }, cantidad: 2.5 }],
    });
    assert.deepEqual(cuerpoTarea(original, original), {});
    assert.deepEqual(cuerpoTarea({ ...original, frecuenciaValor: 3 }, original), { frecuencia_valor: 3 });
    assert.deepEqual(cuerpoTarea({ ...original, detalle: '' }, original), { detalle: null });
    assert.deepEqual(cuerpoTarea({ ...original, repuestos: [{ repuestoId: '2', cantidad: 4 }] }, original), {
      repuestos: [{ repuesto_id: 2, cantidad: 4 }],
    });
    assert.deepEqual(cuerpoTarea({ ...original, repuestos: [] }, original), { repuestos: [] });
    assert.deepEqual(cuerpoTarea({ ...original, proveedorId: '7' }, original), { proveedor_id: 7 });
  });

  it('el alta del plan: los vacíos no van, los números como números', () => {
    assert.deepEqual(
      cuerpoPlan({
        maquinaId: '760',
        nombre: '  Mecánico ',
        descripcion: '',
        responsableId: null,
        anticipacionDias: 7,
        tareas: [borrador()],
      }),
      {
        maquina_id: 760,
        nombre: 'Mecánico',
        anticipacion_dias: 7,
        tareas: [{ accion: 'Cambiar el aceite', frecuencia_valor: 1, frecuencia_unidad: 'MESES', primera_fecha: '2026-12-01' }],
      }
    );
    assert.deepEqual(
      cuerpoPlan({
        maquinaId: '760',
        nombre: 'Mecánico',
        descripcion: ' Semestral ',
        responsableId: '552',
        anticipacionDias: '',
        tareas: [],
      }),
      { maquina_id: 760, nombre: 'Mecánico', descripcion: 'Semestral', responsable_usuario_id: 552, tareas: [] }
    );
  });
});

describe('FE-72: tareasParaGenerar', () => {
  it('tildadas, destildadas y deshabilitadas con su motivo', () => {
    const tareas: TareaPlan[] = [
      { ...tareaBase, id: 1, estado: 'VENCIDA' },
      { ...tareaBase, id: 2, estado: 'PROXIMA' },
      { ...tareaBase, id: 3, estado: 'AL_DIA' },
      { ...tareaBase, id: 4, estado: 'EN_CURSO', intervencion_en_curso: { id: 9001, estado: 'PENDIENTE' } },
      { ...tareaBase, id: 5, estado: 'INACTIVA', activo: false },
    ];
    assert.deepEqual(
      tareasParaGenerar(tareas).map((x) => [x.tarea.id, x.tildada, x.habilitada, x.motivo]),
      [
        [1, true, true, null],
        [2, true, true, null],
        [3, false, true, null],
        [4, false, false, 'Ya está en la intervención N.º 9001'],
        [5, false, false, 'Inactiva'],
      ]
    );
  });
});

describe('FE-73: avisoTareasSinMarcar', () => {
  it('null con todas marcadas; singular y plural', () => {
    assert.equal(avisoTareasSinMarcar({ total: 3, hechas: 3 }), null);
    assert.equal(avisoTareasSinMarcar({ total: 0, hechas: 0 }), null);
    assert.equal(
      avisoTareasSinMarcar({ total: 3, hechas: 2 }),
      'Queda 1 tarea sin marcar. Si finalizás así, vuelve a quedar pendiente en el plan.'
    );
    assert.equal(
      avisoTareasSinMarcar({ total: 3, hechas: 0 }),
      'Quedan 3 tareas sin marcar. Si finalizás así, vuelven a quedar pendientes en el plan.'
    );
  });
});

describe('FE-74: estados de una tarea preventiva', () => {
  it('los cinco, con texto, color e ícono', () => {
    assert.deepEqual(
      ESTADOS_TAREA_PREVENTIVA.map((e) => [e.estado, e.texto, e.color, e.icono]),
      [
        ['VENCIDA', 'Vencida', 'red', 'IconAlertTriangle'],
        ['PROXIMA', 'Próxima', 'orange', 'IconClock'],
        ['EN_CURSO', 'En curso', 'blue', 'IconTool'],
        ['AL_DIA', 'Al día', 'green', 'IconCircleCheck'],
        ['INACTIVA', 'Inactiva', 'gray', 'IconBan'],
      ]
    );
    assert.equal(obtenerInfoEstado('tarea_preventiva', 'PROXIMA').texto, 'Próxima');
    // EN_CURSO es de la tarea, no de la intervención
    assert.equal(obtenerInfoEstado('intervencion', 'EN_CURSO').color, 'gray');
  });
});

describe('FE-75: filtros de Preventivos en la dirección', () => {
  it('leer y escribir ida y vuelta', () => {
    const f = leerFiltrosPreventivos(new URLSearchParams('vista=planes&estado=AL_DIA&planta=3&sector=4&maquina=5&inactivos=1&pagina=2'));
    assert.deepEqual(f, {
      vista: 'planes', estado: 'AL_DIA', plantaId: 3, sectorId: 4, maquinaId: 5, inactivos: true, pagina: 2,
    });
    assert.equal(escribirFiltrosPreventivos(f).toString(), 'vista=planes&estado=AL_DIA&planta=3&sector=4&maquina=5&inactivos=1&pagina=2');
  });

  it('valores raros: por omisión', () => {
    const f = leerFiltrosPreventivos(new URLSearchParams('vista=x&estado=INACTIVA&planta=abc&pagina=-1'));
    assert.deepEqual(f, {
      vista: 'vencimientos', estado: null, plantaId: null, sectorId: null, maquinaId: null, inactivos: false, pagina: 1,
    });
    assert.equal(escribirFiltrosPreventivos(f).toString(), '');
  });

  it('los parámetros de la API', () => {
    const f = leerFiltrosPreventivos(new URLSearchParams('planta=3&pagina=3'));
    assert.deepEqual(paramsVencimientos(f), { estado: 'VENCIDA,PROXIMA,EN_CURSO', limit: 100, offset: 200, planta_id: 3 });
    assert.deepEqual(paramsVencimientos({ ...f, estado: 'AL_DIA', pagina: 1 }), {
      estado: 'AL_DIA', limit: 100, offset: 0, planta_id: 3,
    });
    assert.deepEqual(paramsPlanes({ ...f, inactivos: true, maquinaId: 5 }), { all: 'true', planta_id: 3, maquina_id: 5 });
  });

  it('las tarjetas alternan el estado, y los pendientes del plan', () => {
    assert.equal(alternarEstado(null, 'VENCIDA'), 'VENCIDA');
    assert.equal(alternarEstado('VENCIDA', 'VENCIDA'), null);
    assert.equal(alternarEstado('VENCIDA', 'PROXIMA'), 'PROXIMA');
    assert.equal(textoPendientes({ vencidas: 2, proximas: 1 }), '2 vencidas · 1 próxima');
    assert.equal(textoPendientes({ vencidas: 1, proximas: 0 }), '1 vencida');
    assert.equal(textoPendientes({ vencidas: 0, proximas: 3 }), '3 próximas');
    assert.equal(textoPendientes({ vencidas: 0, proximas: 0 }), '—');
  });
});

describe('FE-77: errorTareaDeApi', () => {
  it('cada error de la API va a su campo', () => {
    assert.deepEqual(errorTareaDeApi('REPUESTO_INVALIDO', 'El repuesto no existe o está inactivo'), {
      campo: 'repuesto', mensaje: 'El repuesto no existe o está inactivo.',
    });
    assert.equal(errorTareaDeApi('PROVEEDOR_INVALIDO', 'x')?.campo, 'proveedor');
    assert.equal(errorTareaDeApi('DATOS_INVALIDOS', 'El campo accion debe tener entre 3 y 200 caracteres')?.campo, 'accion');
    assert.deepEqual(
      errorTareaDeApi('DATOS_INVALIDOS', 'El campo frecuencia_valor debe ser un entero de 1 a 520 para SEMANAS'),
      { campo: 'frecuencia', mensaje: 'Ingresá un número entero de 1 a 520.' }
    );
    assert.equal(
      errorTareaDeApi('DATOS_INVALIDOS', 'El campo primera_fecha debe estar entre hoy − 10 años y hoy + 10 años')?.campo,
      'primeraFecha'
    );
    assert.equal(errorTareaDeApi('DATOS_INVALIDOS', 'El repuesto sugerido y su cantidad van juntos')?.campo, 'cantidad');
  });

  it('sin campo reconocible: null', () => {
    assert.equal(errorTareaDeApi('DATOS_INVALIDOS', 'El plan lleva de 1 a 50 tareas'), null);
    assert.equal(errorTareaDeApi('PLAN_NO_ENCONTRADO', 'Plan no encontrado'), null);
  });
});

const aceite = { repuesto: { id: 2, codigo: 'AC-68', nombre: 'Aceite ISO 68', unidad: 'litro' }, cantidad: 2.5 };
const filtro = { repuesto: { id: 3, codigo: null, nombre: 'Filtro de aceite', unidad: 'unidad' }, cantidad: 1 };
const correa = { repuesto: { id: 4, codigo: null, nombre: 'Correa', unidad: 'unidad' }, cantidad: 2 };

describe('FE-80: validarTareaBorrador con la lista de repuestos', () => {
  it('un repuesto repetido da el error en la segunda fila', () => {
    const b = borrador({ repuestos: [{ repuestoId: '2', cantidad: 1 }, { repuestoId: '2', cantidad: 2 }] });
    assert.deepEqual(validarTareaBorrador(b), { filas: { 1: { repuesto: 'Ese repuesto ya está en la lista.' } } });
  });

  it('una fila vacía no es un error, y cada fila tiene el suyo', () => {
    assert.deepEqual(validarTareaBorrador(borrador({ repuestos: [{ repuestoId: null, cantidad: '' }] })), {});
    const b = borrador({ repuestos: [{ repuestoId: '2', cantidad: 1 }, { repuestoId: '3', cantidad: '' }, { repuestoId: null, cantidad: 2 }] });
    assert.deepEqual(validarTareaBorrador(b), {
      filas: { 1: { cantidad: 'Ingresá la cantidad.' }, 2: { repuesto: 'Elegí el repuesto.' } },
    });
  });
});

describe('FE-81: cuerpoTarea con la lista de repuestos', () => {
  it('el alta manda las filas completas, y sin filas no manda repuestos', () => {
    const conFilas = cuerpoTarea(borrador({ repuestos: [{ repuestoId: '2', cantidad: '2,5' }, { repuestoId: null, cantidad: '' }, { repuestoId: '3', cantidad: 1 }] }));
    assert.deepEqual(conFilas.repuestos, [{ repuesto_id: 2, cantidad: 2.5 }, { repuesto_id: 3, cantidad: 1 }]);
    assert.equal('repuestos' in cuerpoTarea(borrador()), false);
  });

  it('el PATCH manda la lista entera solo si cambió', () => {
    const original = borrador({ repuestos: [{ repuestoId: '2', cantidad: 2.5, nombre: 'Aceite', unidad: 'litro' }] });
    assert.deepEqual(cuerpoTarea({ ...original, repuestos: [{ repuestoId: '2', cantidad: '2,5' }] }, original), {});
    assert.deepEqual(
      cuerpoTarea({ ...original, repuestos: [...original.repuestos, { repuestoId: '3', cantidad: 1 }] }, original),
      { repuestos: [{ repuesto_id: 2, cantidad: 2.5 }, { repuesto_id: 3, cantidad: 1 }] }
    );
  });
});

describe('FE-82: borradorDeTarea con varios repuestos', () => {
  it('una fila por repuesto, con su nombre y unidad', () => {
    assert.deepEqual(borradorDeTarea({ ...tareaBase, repuestos: [aceite, filtro] }).repuestos, [
      { repuestoId: '2', cantidad: 2.5, nombre: 'Aceite ISO 68', unidad: 'litro' },
      { repuestoId: '3', cantidad: 1, nombre: 'Filtro de aceite', unidad: 'unidad' },
    ]);
  });
});

describe('FE-83: errorTareaDeApi con indice_repuesto', () => {
  it('el error va a su fila', () => {
    assert.deepEqual(errorTareaDeApi('REPUESTO_INVALIDO', 'x', 2), {
      campo: 'repuesto', mensaje: 'El repuesto no existe o está inactivo.', indiceRepuesto: 2,
    });
    assert.deepEqual(errorTareaDeApi('DATOS_INVALIDOS', 'El campo cantidad debe ser mayor que cero', 1), {
      campo: 'cantidad', mensaje: 'Revisá la cantidad.', indiceRepuesto: 1,
    });
    assert.deepEqual(errorTareaDeApi('DATOS_INVALIDOS', 'El repuesto está repetido en la lista', 1), {
      campo: 'repuesto', mensaje: 'Ese repuesto ya está en la lista.', indiceRepuesto: 1,
    });
  });
});

describe('FE-84: textoPrevistos', () => {
  it('sin repuestos, uno y dos', () => {
    assert.deepEqual(textoPrevistos([]), { texto: '', detalle: null });
    assert.deepEqual(textoPrevistos([aceite]), { texto: 'Aceite ISO 68 × 2,5 litro', detalle: null });
    assert.deepEqual(textoPrevistos([aceite, filtro]), {
      texto: 'Aceite ISO 68 × 2,5 litro · Filtro de aceite × 1 unidad', detalle: null,
    });
  });

  it('con más de dos: el primero, cuántos más, y la lista en el detalle', () => {
    assert.deepEqual(textoPrevistos([aceite, filtro, correa]), {
      texto: 'Aceite ISO 68 × 2,5 litro y 2 más',
      detalle: 'Aceite ISO 68 × 2,5 litro · Filtro de aceite × 1 unidad · Correa × 2 unidad',
    });
  });
});

describe('FE-85: previstosDeBorrador', () => {
  it('solo las filas completas, con la cantidad como número', () => {
    assert.deepEqual(
      previstosDeBorrador([
        { repuestoId: '2', cantidad: '2,5', nombre: 'Aceite', unidad: 'litro' },
        { repuestoId: null, cantidad: '' },
        { repuestoId: '3', cantidad: '', nombre: 'Filtro', unidad: 'unidad' },
      ]),
      [{ repuesto: { nombre: 'Aceite', unidad: 'litro' }, cantidad: 2.5 }]
    );
  });
});

describe('FE-86: erroresDeApi', () => {
  it('con indiceRepuesto va a la fila; sin él, al campo', () => {
    assert.deepEqual(erroresDeApi({ campo: 'cantidad', mensaje: 'x', indiceRepuesto: 3 }), { filas: { 3: { cantidad: 'x' } } });
    assert.deepEqual(erroresDeApi({ campo: 'accion', mensaje: 'x' }), { accion: 'x' });
  });
});

describe('FE-87: sinErrorDeFila', () => {
  const errores = { accion: 'a', filas: { 0: { repuesto: 'r0' }, 1: { repuesto: 'r1', cantidad: 'c1' }, 2: { cantidad: 'c2' } } };

  it('al cambiar la cantidad, solo esa fila', () => {
    assert.deepEqual(sinErrorDeFila(errores, 2, 'cantidad'), {
      accion: 'a', filas: { 0: { repuesto: 'r0' }, 1: { repuesto: 'r1', cantidad: 'c1' } },
    });
  });

  it('al cambiar el repuesto, también los repetidos de las otras', () => {
    assert.deepEqual(sinErrorDeFila(errores, 0, 'repuesto'), { accion: 'a', filas: { 1: { cantidad: 'c1' }, 2: { cantidad: 'c2' } } });
  });

  it('sin errores de filas, no queda la clave', () => {
    assert.deepEqual(sinErrorDeFila({ filas: { 0: { cantidad: 'c' } } }, 0, 'cantidad'), {});
  });
});

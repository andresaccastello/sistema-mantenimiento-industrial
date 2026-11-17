import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MedidorRonda, ResultadoLecturaRonda, TareaRonda } from '../api/tipos';
import {
  camposCompletos,
  camposConError,
  consecuenciasLectura,
  errorLeerCada,
  errorValorRonda,
  leerCadaDias,
  lecturasAMandar,
  leerFiltrosLecturas,
  parametrosFiltrosLecturas,
  resumenRonda,
  tareaMasCercana,
  textoBotonGuardar,
  textoDiasSinLectura,
  textoSalirSinGuardar,
  textoTareaRonda,
  textoUltimaRonda,
} from './lecturas';

const tarea = (extra: Partial<TareaRonda> = {}): TareaRonda => ({
  tarea_id: 52,
  accion: 'Cambiar aceite',
  plan: { id: 9, nombre: 'Compresor' },
  estado: 'AL_DIA',
  proximo_uso: 12500,
  faltan_uso: 160,
  ...extra,
});

const medidor = (extra: Partial<MedidorRonda> = {}): MedidorRonda => ({
  id: 7,
  nombre: 'Horómetro',
  unidad: 'horas',
  lectura_cada_dias: 7,
  maquina: { id: 3, codigo: 'COM-01', nombre: 'Compresor' },
  sector: { id: 2, nombre: 'Servicios' },
  ultima: { valor: 12340, registrada_en: '2026-11-08T14:10:00Z' },
  dias_sin_lectura: 8,
  atrasado: true,
  tareas: [tarea()],
  ...extra,
});

describe('FE-149: qué lecturas se mandan (4.1)', () => {
  const m7 = medidor();
  const m8 = medidor({ id: 8, nombre: 'Contador', unidad: 'ciclos', ultima: { valor: 500, registrada_en: '2026-11-08T14:10:00Z' } });
  const m9 = medidor({ id: 9, ultima: null, tareas: [] });

  it('solo los campos completos, sin los que tienen un valor menor que la última', () => {
    const valores = { 7: '12395', 8: '499', 9: '0' };
    assert.deepEqual(lecturasAMandar([m7, m8, m9], valores), [
      { medidor_id: 7, valor: 12395, observacion: null },
      { medidor_id: 9, valor: 0, observacion: null },
    ]);
    // Vacíos o en blanco no se mandan; la coma decimal se acepta; igual a la última, sí
    assert.deepEqual(lecturasAMandar([m7, m8, m9], { 7: '', 8: '500', 9: '  ' }), [{ medidor_id: 8, valor: 500, observacion: null }]);
    assert.deepEqual(lecturasAMandar([m7], { 7: '12340,5' }), [{ medidor_id: 7, valor: 12340.5, observacion: null }]);
    assert.deepEqual(lecturasAMandar([m7, m8], {}), []);
  });

  it('el campo marca el valor menor que la última, y el inválido', () => {
    assert.equal(errorValorRonda('12339', m7), 'Menor que la última (12.340 horas)');
    assert.equal(errorValorRonda('499', m8), 'Menor que la última (500 ciclos)');
    assert.equal(errorValorRonda('12340', m7), null);
    assert.equal(errorValorRonda('', m7), null);
    assert.equal(errorValorRonda(null, m7), null);
    assert.equal(errorValorRonda('5', m9), null, 'Sin lecturas, cualquier valor');
    assert.equal(errorValorRonda('abc', m7), 'Ingresá un número desde 0, con hasta 2 decimales.');
    assert.equal(errorValorRonda('12400.123', m7), 'Ingresá un número desde 0, con hasta 2 decimales.');
    assert.equal(errorValorRonda('-1', m9), 'Ingresá un número desde 0, con hasta 2 decimales.');
  });

  it('el botón: con la cantidad de campos completos, y sin habilitar si hay errores', () => {
    assert.equal(camposConError([m7, m8, m9], { 7: '12395', 8: '499', 9: 'x' }), 2);
    assert.equal(camposConError([m7, m8], { 7: '12395', 8: '' }), 0);
    assert.equal(camposCompletos({ 7: '12395', 8: '', 9: ' ', 10: 0 }), 2);
    assert.equal(textoBotonGuardar(5, false), 'Guardar 5 lecturas');
    assert.equal(textoBotonGuardar(1, false), 'Guardar 1 lectura');
    assert.equal(textoBotonGuardar(0, false), 'Guardar 0 lecturas');
    assert.equal(textoBotonGuardar(5, true), 'Guardar (5)');
    assert.equal(textoSalirSinGuardar(3), 'Tenés 3 lecturas sin guardar. ¿Salir igual?');
    assert.equal(textoSalirSinGuardar(1), 'Tenés 1 lectura sin guardar. ¿Salir igual?');
  });
});

describe('FE-150: el texto de cada consecuencia (4.2)', () => {
  const generadas = [{ plan_id: 9, intervencion_id: 85 }];

  it('pasó a próxima, está próxima y está vencida', () => {
    const antes = [tarea()];
    assert.deepEqual(consecuenciasLectura(antes, [tarea({ estado: 'PROXIMA', faltan_uso: 105 })], 'horas', []), [
      { texto: 'Cambiar aceite pasó a Próxima: faltan 105 horas' },
    ]);
    assert.deepEqual(
      consecuenciasLectura([tarea({ estado: 'PROXIMA' })], [tarea({ estado: 'PROXIMA', faltan_uso: 50 })], 'horas', []),
      [{ texto: 'Cambiar aceite está Próxima: faltan 50 horas' }]
    );
    assert.deepEqual(consecuenciasLectura(antes, [tarea({ estado: 'VENCIDA', faltan_uso: -20 })], 'horas', []), [
      { texto: 'Cambiar aceite está Vencida: se pasó por 20 horas' },
    ]);
  });

  it('se generó la intervención, con su número para el enlace', () => {
    assert.deepEqual(consecuenciasLectura([tarea()], [tarea({ estado: 'EN_CURSO', faltan_uso: -20 })], 'horas', generadas), [
      { texto: 'Se generó la intervención N.º 85', intervencionId: 85 },
    ]);
    // La de otro plan no es de este medidor
    assert.deepEqual(consecuenciasLectura([tarea()], [tarea()], 'horas', [{ plan_id: 10, intervencion_id: 86 }]), []);
  });

  it('al día, sin lectura o en curso, nada', () => {
    for (const estado of ['AL_DIA', 'SIN_LECTURA', 'EN_CURSO'] as const) {
      assert.deepEqual(consecuenciasLectura([tarea()], [tarea({ estado })], 'horas', []), [], estado);
    }
    assert.deepEqual(consecuenciasLectura([], [], 'horas', generadas), []);
  });
});

describe('FE-151: el resumen de arriba (4.2)', () => {
  const m7 = medidor();
  const m8 = medidor({ id: 8, tareas: [tarea({ tarea_id: 60, accion: 'Engrasar' })] });
  const m9 = medidor({ id: 9, tareas: [tarea({ tarea_id: 61, accion: 'Revisar correas', estado: 'PROXIMA' })] });
  const ok = (medidor_id: number, tareas: TareaRonda[]): ResultadoLecturaRonda => ({ medidor_id, ok: true, lectura_id: 500 + medidor_id, tareas });
  const mal: ResultadoLecturaRonda = { medidor_id: 10, ok: false, codigo: 'LECTURA_MENOR', error: 'La lectura es menor que la última registrada' };

  it('guardadas, fallidas y tareas que cambiaron de estado', () => {
    const resultados = [
      ok(7, [tarea({ estado: 'PROXIMA' })]),
      ok(8, [tarea({ tarea_id: 60, accion: 'Engrasar', estado: 'PROXIMA' })]),
      ok(9, [tarea({ tarea_id: 61, accion: 'Revisar correas', estado: 'PROXIMA' })]),
      ok(11, []),
      mal,
    ];
    assert.equal(
      resumenRonda([m7, m8, m9], resultados),
      'Se guardaron 4 lecturas. 1 no se pudo guardar. 2 tareas pasaron a próxima.'
    );
  });

  it('singulares, plurales y vencidas', () => {
    assert.equal(resumenRonda([m7], [ok(7, [tarea()])]), 'Se guardó 1 lectura.');
    assert.equal(resumenRonda([m7], [mal, { ...mal, medidor_id: 11 }]), '2 no se pudieron guardar.');
    assert.equal(
      resumenRonda([m7, m9], [ok(7, [tarea({ estado: 'VENCIDA' })]), ok(9, [tarea({ tarea_id: 61, estado: 'VENCIDA' })])]),
      'Se guardaron 2 lecturas. 2 tareas pasaron a vencida.'
    );
    assert.equal(resumenRonda([m7], [ok(7, [tarea({ estado: 'PROXIMA' })])]), 'Se guardó 1 lectura. 1 tarea pasó a próxima.');
  });
});

describe('FE-152: los días sin lectura y lo que se ve de cada medidor (4.1 y 4.3)', () => {
  it('diasSinLectura en texto', () => {
    assert.equal(textoDiasSinLectura(0), 'hoy');
    assert.equal(textoDiasSinLectura(1), 'ayer');
    assert.equal(textoDiasSinLectura(8), 'hace 8 días');
    assert.equal(textoDiasSinLectura(2), 'hace 2 días');
  });

  it('la última lectura, la tarea y la más cercana', () => {
    assert.equal(textoUltimaRonda(medidor()), 'Última: 12.340 horas · hace 8 días');
    assert.equal(textoUltimaRonda(medidor({ dias_sin_lectura: 0 })), 'Última: 12.340 horas · hoy');
    assert.equal(textoUltimaRonda(medidor({ ultima: null })), 'Sin lecturas');
    assert.equal(textoTareaRonda(tarea(), 'horas'), 'Cambiar aceite · faltan 160 horas');
    assert.equal(textoTareaRonda(tarea({ faltan_uso: -20 }), 'horas'), 'Cambiar aceite · se pasó por 20 horas');
    assert.equal(textoTareaRonda(tarea({ faltan_uso: null, estado: 'SIN_LECTURA' }), 'horas'), 'Cambiar aceite');

    const lejos = tarea({ tarea_id: 1, accion: 'Lejos', faltan_uso: 900 });
    const cerca = tarea({ tarea_id: 2, accion: 'Cerca', faltan_uso: -5 });
    const sinLectura = tarea({ tarea_id: 3, accion: 'Sin lectura', faltan_uso: null });
    assert.equal(tareaMasCercana([lejos, cerca, sinLectura])?.accion, 'Cerca');
    assert.equal(tareaMasCercana([sinLectura, lejos])?.accion, 'Lejos');
    assert.equal(tareaMasCercana([sinLectura])?.accion, 'Sin lectura');
    assert.equal(tareaMasCercana([]), null);
  });
});

describe('FE-153: los filtros de /lecturas, en la URL (4.5)', () => {
  it('se leen y se escriben, sin lo que no es un id', () => {
    assert.deepEqual(leerFiltrosLecturas(new URLSearchParams('maquina_id=3&solo_atrasados=true')), {
      planta_id: null,
      sector_id: null,
      maquina_id: 3,
      solo_atrasados: true,
    });
    assert.deepEqual(leerFiltrosLecturas(new URLSearchParams('planta_id=abc&sector_id=0&maquina_id=1.5&solo_atrasados=si')), {
      planta_id: null,
      sector_id: null,
      maquina_id: null,
      solo_atrasados: false,
    });
    assert.deepEqual(parametrosFiltrosLecturas({ planta_id: 1, sector_id: null, maquina_id: 3, solo_atrasados: false }), {
      planta_id: '1',
      maquina_id: '3',
    });
    assert.deepEqual(parametrosFiltrosLecturas({ planta_id: null, sector_id: 2, maquina_id: null, solo_atrasados: true }), {
      sector_id: '2',
      solo_atrasados: 'true',
    });
  });
});

describe('FE-154: "Leer cada" en el formulario del medidor (4.5)', () => {
  it('vacío es sin aviso de atraso; si no, un entero de 1 a 365', () => {
    assert.equal(leerCadaDias(''), null);
    assert.equal(leerCadaDias('  '), null);
    assert.equal(leerCadaDias(null), null);
    assert.equal(leerCadaDias('7'), 7);
    assert.equal(leerCadaDias(14), 14);
    assert.equal(leerCadaDias(' 365 '), 365);
    assert.equal(leerCadaDias('1'), 1);
    for (const mal of ['0', '366', '7,5', '7.5', 'x', '-1', 0, 366]) {
      assert.equal(leerCadaDias(mal), undefined, String(mal));
      assert.equal(errorLeerCada(mal), 'Ingresá un número entero de días, de 1 a 365, o dejalo vacío.', String(mal));
    }
    assert.equal(errorLeerCada(''), null);
    assert.equal(errorLeerCada('30'), null);
  });
});

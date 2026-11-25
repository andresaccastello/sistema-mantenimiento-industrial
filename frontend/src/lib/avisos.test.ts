import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIPOS_AVISO,
  nombreTipoAviso,
  etiquetaModo,
  estadoEnvio,
  detalleEnvio,
  destinoAviso,
  AYUDA_PARADAS_CRITICAS,
  AYUDA_STOCK_MINIMO,
  ETIQUETA_DETENCION_POSTERIOR,
} from './avisos';

describe('FE-39: lib/avisos.ts', () => {
  it('orden de TIPOS_AVISO: los 12 códigos coinciden exactamente con REGLAS_EVENTOS_NOTIFICACION del backend', () => {
    // Debe coincidir estrictamente con REGLAS_EVENTOS_NOTIFICACION de backend/functions/intervenciones/notificaciones.ts
    const codigosEsperados = [
      'FALLA_REGISTRADA',
      'PARADA_CRITICA',
      'INTERVENCION_ASIGNADA',
      'INTERVENCION_REASIGNADA',
      'INTERVENCION_DESASIGNADA',
      'INTERVENCION_FINALIZADA',
      'INTERVENCION_CANCELADA',
      'INTERVENCION_REABIERTA',
      'DETENCION_PENDIENTE_CONFIRMACION',
      'PREVENTIVO_VENCIMIENTO',
      'STOCK_BAJO',
      'LECTURA_ATRASADA',
    ];

    const codigosActuales = TIPOS_AVISO.map((t) => t.tipo_evento);
    assert.deepEqual(codigosActuales, codigosEsperados);
  });

  it('etiquetas de nombreTipoAviso: conocido y desconocido', () => {
    assert.equal(nombreTipoAviso('FALLA_REGISTRADA'), 'Falla reportada');
    assert.equal(nombreTipoAviso('INTERVENCION_ASIGNADA'), 'Trabajo asignado');
    assert.equal(nombreTipoAviso('EVENTO_INVENTADO'), 'EVENTO_INVENTADO');
  });

  it('etiquetas de etiquetaModo: las tres opciones', () => {
    assert.equal(etiquetaModo('NUNCA'), 'Nunca');
    assert.equal(etiquetaModo('SOLO_ALTA'), 'Solo prioridad alta');
    assert.equal(etiquetaModo('SIEMPRE'), 'Siempre');
  });

  it('etiquetas y colores de estadoEnvio: los cuatro estados', () => {
    assert.deepEqual(estadoEnvio('PENDIENTE'), { etiqueta: 'Pendiente', color: 'amarillo' });
    assert.deepEqual(estadoEnvio('ENVIADO'), { etiqueta: 'Enviado', color: 'marca' });
    assert.deepEqual(estadoEnvio('ERROR'), { etiqueta: 'Con error', color: 'rojo' });
    assert.deepEqual(estadoEnvio('DESCARTADO'), { etiqueta: 'Descartado', color: 'gris' });
  });

  it('detalleEnvio: los cuatro casos con un ahora fijo', () => {
    const ahora = new Date('2026-11-05T12:00:00Z');

    // 1. PENDIENTE con reintento futuro (ej. en 4 min)
    const pendienteReintento = {
      estado: 'PENDIENTE',
      intentos: 1,
      proximo_intento_en: '2026-11-05T12:04:00Z',
    };
    assert.equal(
      detalleEnvio(pendienteReintento, ahora),
      'Intento 1 de 5 falló. Reintenta en 4 min.'
    );

    // 2. PENDIENTE sin intentos (intento 0) -> sale en el próximo minuto
    const pendientePrimerIntento = {
      estado: 'PENDIENTE',
      intentos: 0,
      proximo_intento_en: null,
    };
    assert.equal(detalleEnvio(pendientePrimerIntento, ahora), 'Sale en el próximo minuto.');

    // 3. ERROR o DESCARTADO -> muestra el último error
    const conError = {
      estado: 'ERROR',
      ultimo_error: 'Connection timeout with SMTP server',
    };
    assert.equal(detalleEnvio(conError, ahora), 'Connection timeout with SMTP server');

    const descartado = {
      estado: 'DESCARTADO',
      ultimo_error: 'Usuario inactivo',
    };
    assert.equal(detalleEnvio(descartado, ahora), 'Usuario inactivo');

    // 4. ENVIADO -> Enviado a {destino}
    const enviado = {
      estado: 'ENVIADO',
      destino: 'guardia@planta.com',
    };
    assert.equal(detalleEnvio(enviado, ahora), 'Enviado a guardia@planta.com');
  });
});

describe('FE-125: el tipo de aviso de vencimientos (PV5, 5)', () => {
  it('con su nombre en la configuración de avisos', () => {
    assert.equal(nombreTipoAviso('PREVENTIVO_VENCIMIENTO'), 'Vencimiento de un preventivo');
    assert.ok(TIPOS_AVISO.some((t) => t.tipo_evento === 'PREVENTIVO_VENCIMIENTO'));
  });
});

describe('FE-155: el aviso de lecturas atrasadas (LE1, 4.5)', () => {
  it('con su nombre, último en la configuración de avisos', () => {
    assert.equal(nombreTipoAviso('LECTURA_ATRASADA'), 'Lecturas atrasadas');
    assert.equal(TIPOS_AVISO[TIPOS_AVISO.length - 1].tipo_evento, 'LECTURA_ATRASADA');
    assert.ok(TIPOS_AVISO[TIPOS_AVISO.length - 1].destinatarios.length > 0);
  });

  it('al tocarlo, lleva a la ronda con solo los atrasados', () => {
    assert.equal(
      destinoAviso({ tipo_evento: 'LECTURA_ATRASADA', intervencion_id: null, maquina_id: 3 }),
      '/lecturas?solo_atrasados=true'
    );
    assert.equal(destinoAviso({ tipo_evento: 'LECTURA_ATRASADA', intervencion_id: null, maquina_id: null }), '/lecturas?solo_atrasados=true');
    // Los demás, como antes: la intervención y, si no, la máquina
    assert.equal(destinoAviso({ tipo_evento: 'FALLA_REGISTRADA', intervencion_id: 85, maquina_id: 3 }), '/intervenciones/85');
    assert.equal(destinoAviso({ tipo_evento: 'PREVENTIVO_VENCIMIENTO', intervencion_id: null, maquina_id: 3 }), '/maquinas/3');
    assert.equal(destinoAviso({ intervencion_id: null }), null);
  });
});

describe('FE-179: los rótulos de parada crítica y stock bajo (AV1, 5)', () => {
  it('con sus nombres en castellano en la tabla de reglas', () => {
    assert.equal(nombreTipoAviso('PARADA_CRITICA'), 'Parada crítica');
    assert.equal(nombreTipoAviso('STOCK_BAJO'), 'Stock bajo');
    for (const tipo of ['PARADA_CRITICA', 'STOCK_BAJO']) {
      const info = TIPOS_AVISO.find((t) => t.tipo_evento === tipo);
      assert.ok(info && info.destinatarios.length > 0, tipo);
    }
  });
  it('los textos de Configuración y del repuesto', () => {
    assert.equal(ETIQUETA_DETENCION_POSTERIOR, 'Avisar también cuando la detención se registra después de reportar la falla');
    assert.equal(
      AYUDA_PARADAS_CRITICAS,
      "Qué máquinas son críticas: la criticidad con prioridad alta, en Sectores y catálogos. Quién recibe el aviso: el permiso 'Recibir avisos de paradas críticas', en Perfiles o en cada usuario"
    );
    assert.equal(AYUDA_STOCK_MINIMO, 'Avisa cuando el stock llega a este número. Sin mínimo, no avisa');
  });
});

describe('FE-180: adónde llevan los avisos de AV1 (AV1, 5)', () => {
  it('la parada crítica, a su intervención', () => {
    assert.equal(destinoAviso({ tipo_evento: 'PARADA_CRITICA', intervencion_id: 91, maquina_id: 4 }), '/intervenciones/91');
  });
  it('el stock bajo, al repuesto solo con REPUESTOS_GESTIONAR; si no, sin enlace', () => {
    const aviso = { tipo_evento: 'STOCK_BAJO', intervencion_id: null, maquina_id: null, repuesto_id: 12 };
    assert.equal(destinoAviso(aviso, { gestionaRepuestos: true }), '/repuestos/12');
    assert.equal(destinoAviso(aviso, { gestionaRepuestos: false }), null);
    assert.equal(destinoAviso(aviso), null, 'Sin opciones, sin enlace');
    assert.equal(destinoAviso({ ...aviso, repuesto_id: null }, { gestionaRepuestos: true }), null, 'Sin repuesto, sin enlace');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIPOS_AVISO,
  nombreTipoAviso,
  etiquetaModo,
  estadoEnvio,
  detalleEnvio,
} from './avisos';

describe('FE-39: lib/avisos.ts', () => {
  it('orden de TIPOS_AVISO: los 9 códigos coinciden exactamente con REGLAS_EVENTOS_NOTIFICACION del backend', () => {
    // Debe coincidir estrictamente con REGLAS_EVENTOS_NOTIFICACION de backend/functions/intervenciones/notificaciones.ts
    const codigosEsperados = [
      'FALLA_REGISTRADA',
      'INTERVENCION_ASIGNADA',
      'INTERVENCION_REASIGNADA',
      'INTERVENCION_DESASIGNADA',
      'INTERVENCION_FINALIZADA',
      'INTERVENCION_CANCELADA',
      'INTERVENCION_REABIERTA',
      'DETENCION_PENDIENTE_CONFIRMACION',
      'PREVENTIVO_VENCIMIENTO',
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
    assert.equal(TIPOS_AVISO[TIPOS_AVISO.length - 1].tipo_evento, 'PREVENTIVO_VENCIMIENTO');
  });
});

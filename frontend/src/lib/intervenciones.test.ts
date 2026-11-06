import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  vistaDetalle,
  itemHistorial,
  hayCambiosReporte,
  tiempoLista,
  minimoNuevaDetencion,
  eventosHistorial,
} from './intervenciones.js';

describe('FE-11: vistaDetalle', () => {
  // Permisos copiados de migraciones (igual que en FE-04 / menu.test.ts)
  const permisosOperario = {
    INTERVENCIONES_CREAR: 'TODAS',
    INTERVENCIONES_VER: 'PROPIAS',
  };

  const permisosResponsable = {
    INTERVENCIONES_VER: 'TODAS',
    INTERVENCIONES_CREAR: 'TODAS',
    INTERVENCIONES_ASIGNARSE: 'TODAS',
    INTERVENCIONES_ASIGNAR: 'TODAS',
    INTERVENCIONES_RECIBIR_ASIGNACION: 'TODAS',
    INTERVENCIONES_CAMBIAR_ESTADO: 'TODAS',
    INTERVENCIONES_EDITAR: 'TODAS',
    INTERVENCIONES_FINALIZAR: 'TODAS',
    INTERVENCIONES_CANCELAR: 'TODAS',
    INTERVENCIONES_ELIMINAR: 'TODAS',
    INTERVENCIONES_REABRIR: 'TODAS',
    INTERVENCIONES_CONFIRMAR_RECUPERACION: 'TODAS',
  };

  const permisosConsulta = {
    INTERVENCIONES_VER: 'TODAS',
    COSTOS_VER: 'TODAS',
    REPORTES_CONSULTAR: 'TODAS',
  };

  const permisosAdmin = {
    ...permisosResponsable,
    PERMISOS_GESTIONAR: 'TODAS',
    USUARIOS_GESTIONAR: 'TODAS',
    MAQUINAS_GESTIONAR: 'TODAS',
  };

  it('determina vista simple para OPERARIO y completa para otros perfiles', () => {
    assert.equal(vistaDetalle(permisosOperario), 'simple');
    assert.equal(vistaDetalle(permisosResponsable), 'completa');
    assert.equal(vistaDetalle(permisosConsulta), 'completa');
    assert.equal(vistaDetalle(permisosAdmin), 'completa');
  });

  it('determina completa si tiene permiso de recibir asignación aunque vea propias', () => {
    assert.equal(
      vistaDetalle({
        INTERVENCIONES_VER: 'PROPIAS',
        INTERVENCIONES_RECIBIR_ASIGNACION: 'TODAS',
      }),
      'completa'
    );
  });

  it('determina simple si solo tiene editar propias y ver propias', () => {
    assert.equal(
      vistaDetalle({
        INTERVENCIONES_VER: 'PROPIAS',
        INTERVENCIONES_EDITAR: 'PROPIAS',
      }),
      'simple'
    );
  });
});

describe('FE-15: itemHistorial', () => {
  it('con estado_anterior null devuelve Reporte registrado', () => {
    const item = itemHistorial({
      estado_anterior: null,
      estado_nuevo: 'PENDIENTE',
      cambiado_en: '2026-10-31T10:00:00Z',
    });
    assert.equal(item.titulo, 'Reporte registrado');
    assert.equal(item.fecha, '2026-10-31T10:00:00Z');
    assert.equal(item.estado, 'PENDIENTE');
  });

  it('con estado nuevo EN_PROCESO devuelve En proceso', () => {
    const item = itemHistorial({
      estado_anterior: 'PENDIENTE',
      estado_nuevo: 'EN_PROCESO',
      cambiado_en: '2026-10-31T11:00:00Z',
    });
    assert.equal(item.titulo, 'En proceso');
    assert.equal(item.fecha, '2026-10-31T11:00:00Z');
    assert.equal(item.estado, 'EN_PROCESO');
  });

  it('con fecha_efectiva devuelve fecha_efectiva; sin ella, cambiado_en', () => {
    const conEfectiva = itemHistorial({
      estado_anterior: 'PENDIENTE',
      estado_nuevo: 'EN_PROCESO',
      cambiado_en: '2026-10-31T11:00:00Z',
      fecha_efectiva: '2026-10-31T10:45:00Z',
    });
    assert.equal(conEfectiva.fecha, '2026-10-31T10:45:00Z');

    const sinEfectiva = itemHistorial({
      estado_anterior: 'PENDIENTE',
      estado_nuevo: 'EN_PROCESO',
      cambiado_en: '2026-10-31T11:00:00Z',
      fecha_efectiva: null,
    });
    assert.equal(sinEfectiva.fecha, '2026-10-31T11:00:00Z');
  });
});

describe('FE-16: hayCambiosReporte', () => {
  it('mismos textos devuelve false', () => {
    assert.equal(
      hayCambiosReporte(
        { descripcion: 'Falla motor', observaciones: 'Revisar cable' },
        { descripcion: 'Falla motor', observaciones: 'Revisar cable' }
      ),
      false
    );
  });

  it('solo cambian los espacios de los extremos devuelve false', () => {
    assert.equal(
      hayCambiosReporte(
        { descripcion: 'Falla motor', observaciones: 'Revisar cable' },
        { descripcion: '  Falla motor  ', observaciones: ' Revisar cable\n' }
      ),
      false
    );
  });

  it('observaciones null contra "" devuelve false', () => {
    assert.equal(
      hayCambiosReporte(
        { descripcion: 'Falla motor', observaciones: null },
        { descripcion: 'Falla motor', observaciones: '' }
      ),
      false
    );
    assert.equal(
      hayCambiosReporte(
        { descripcion: 'Falla motor', observaciones: '' },
        { descripcion: 'Falla motor', observaciones: null }
      ),
      false
    );
  });

  it('descripción distinta devuelve true', () => {
    assert.equal(
      hayCambiosReporte(
        { descripcion: 'Falla motor', observaciones: 'Revisar cable' },
        { descripcion: 'Falla bomba', observaciones: 'Revisar cable' }
      ),
      true
    );
  });

  it('observaciones "algo" contra "" devuelve true', () => {
    assert.equal(
      hayCambiosReporte(
        { descripcion: 'Falla motor', observaciones: 'algo' },
        { descripcion: 'Falla motor', observaciones: '' }
      ),
      true
    );
    assert.equal(
      hayCambiosReporte(
        { descripcion: 'Falla motor', observaciones: '' },
        { descripcion: 'Falla motor', observaciones: 'algo' }
      ),
      true
    );
  });
});

describe('FE-24: tiempoLista y minimoNuevaDetencion', () => {
  it('tiempoLista devuelve formato y etiqueta según estado', () => {
    // Pendiente con 75 minutos de espera en curso
    const pend = tiempoLista({
      estado: 'PENDIENTE',
      tiempos: { espera_minutos: 75, espera_en_curso: true },
    });
    assert.deepEqual(pend, { etiqueta: 'Espera', texto: '1 h 15 min', enCurso: true });

    // Esperando repuestos -> "Trabajo"
    const rep = tiempoLista({
      estado: 'EN_ESPERA_REPUESTOS',
      tiempos: { duracion_bruta_minutos: 40, trabajo_en_curso: true },
    });
    assert.equal(rep.etiqueta, 'Trabajo');

    // Finalizada -> "Total", sin "en curso"
    const fin = tiempoLista({
      estado: 'FINALIZADA',
      tiempos: { tiempo_total_minutos: 120, trabajo_en_curso: false },
    });
    assert.deepEqual(fin, { etiqueta: 'Total', texto: '2 h', enCurso: false });

    // Cancelada -> etiqueta null y "—"
    const canc = tiempoLista({
      estado: 'CANCELADA',
      tiempos: null,
    });
    assert.deepEqual(canc, { etiqueta: null, texto: '—', enCurso: false });
  });

  it('minimoNuevaDetencion maneja períodos cerrados y abiertos', () => {
    const creacion = '2026-11-02T10:00:00.000Z';

    // sin períodos -> fecha_creacion
    assert.equal(minimoNuevaDetencion({ fecha_creacion: creacion }), creacion);

    // con un período cerrado posterior a la creación -> su hasta
    const hastaCerrado = '2026-11-02T12:00:00.000Z';
    const conPeriodoCerrado = minimoNuevaDetencion({
      fecha_creacion: creacion,
      periodos_detencion: [
        { hasta: hastaCerrado },
      ],
    });
    assert.equal(conPeriodoCerrado, hastaCerrado);

    // un período abierto no cuenta
    const conAbierto = minimoNuevaDetencion({
      fecha_creacion: creacion,
      periodos_detencion: [
        { hasta: null },
      ],
    });
    assert.equal(conAbierto, creacion);
  });
});

describe('FE-25: eventosHistorial', () => {
  it('combina historial de estados y auditoría con formato y orden correctos', () => {
    const personaOp = { id: 1, legajo: 'OP1', nombre: 'Carlos', apellido: 'Gómez' };
    const personaR1 = { id: 2, legajo: 'R1', nombre: 'Juan', apellido: 'Pérez' };
    const personaR2 = { id: 3, legajo: 'R2', nombre: 'Ana', apellido: 'Gómez' };

    const detalle = {
      historial_estados: [
        {
          id: 1,
          estado_anterior: null,
          estado_nuevo: 'PENDIENTE',
          observacion: null,
          cambiado_en: '2026-11-02T10:00:00Z',
          fecha_efectiva: '2026-11-02T10:00:00Z',
          cambiado_por: personaOp,
        },
        {
          id: 2,
          estado_anterior: 'PENDIENTE',
          estado_nuevo: 'EN_PROCESO',
          observacion: null,
          cambiado_en: '2026-11-02T11:00:00Z',
          fecha_efectiva: '2026-11-02T10:30:00Z', // 30 min antes -> mostrarRegistrado = true
          cambiado_por: personaR1,
        },
      ],
      auditoria: [
        {
          id: 10,
          tipo_evento: 'ASIGNACION',
          campo_modificado: 'responsable_usuario_id',
          valor_anterior: null,
          valor_nuevo: '2',
          motivo: 'Intervención tomada por el responsable', // texto automático -> detalle null
          creado_en: '2026-11-02T11:00:00Z', // mismo instante que estado 2 -> auditoría va antes
          realizado_por: personaR1,
          responsable_anterior: null,
          responsable_nuevo: personaR1,
        },
        {
          id: 11,
          tipo_evento: 'ASIGNACION',
          campo_modificado: 'responsable_usuario_id',
          valor_anterior: '2',
          valor_nuevo: '3',
          motivo: 'Turno tarde',
          creado_en: '2026-11-02T12:00:00Z',
          realizado_por: personaR1,
          responsable_anterior: personaR1,
          responsable_nuevo: personaR2,
        },
        {
          id: 12,
          tipo_evento: 'EDICION',
          campo_modificado: 'observaciones',
          valor_anterior: 'Ruido en rodamiento',
          valor_nuevo: 'Ruido y vibración',
          motivo: null,
          creado_en: '2026-11-02T13:00:00Z',
          realizado_por: personaR2,
          responsable_anterior: null,
          responsable_nuevo: null,
        },
        {
          id: 13,
          tipo_evento: 'REAPERTURA',
          campo_modificado: null,
          valor_anterior: null,
          valor_nuevo: null,
          motivo: 'Volvió a fallar',
          creado_en: '2026-11-02T14:00:00Z',
          realizado_por: personaR2,
          responsable_anterior: null,
          responsable_nuevo: null,
        },
      ],
    };

    const eventos = eventosHistorial(detalle);

    // Títulos esperados
    const titulos = eventos.map((e) => e.titulo);
    assert.deepEqual(titulos, [
      'Reporte registrado',
      'Tomada por Juan Pérez',
      'En proceso',
      'Reasignada de Juan Pérez a Ana Gómez',
      'Se editaron las observaciones',
    ]);

    // La reapertura no se incluye
    assert.equal(eventos.some((e) => e.titulo.toLowerCase().includes('reapertura')), false);

    // La toma no muestra el texto automático como detalle
    assert.equal(eventos[1].detalle, null);

    // La reasignación muestra el motivo como detalle
    assert.equal(eventos[3].detalle, 'Turno tarde');

    // La edición de observaciones muestra "Antes: ..."
    assert.equal(eventos[4].detalle, 'Antes: Ruido en rodamiento');

    // mostrarRegistrado
    assert.equal(eventos[0].mostrarRegistrado, false);
    assert.equal(eventos[2].mostrarRegistrado, true);
  });

  it('FE-54: eventosHistorial con auditoría CORRECCION_COSTO de repuestos', () => {
    const persona = { id: 1, nombre: 'Admin', apellido: 'Sistema', legajo: 'ADM' };
    const detalle = {
      id: 99,
      descripcion: 'Falla test',
      estado: 'FINALIZADA',
      fecha_creacion: '2026-11-06T10:00:00Z',
      creado_por: persona,
      responsable: persona,
      historial_estados: [],
      auditoria: [
        {
          id: 50,
          tipo_evento: 'CORRECCION_COSTO',
          campo_modificado: 'repuestos',
          valor_anterior: null,
          valor_nuevo: 'Se agregó: Rodamiento 6204 × 2 unidad',
          motivo: 'Ajuste de pañol',
          creado_en: '2026-11-06T15:00:00Z',
          realizado_por: persona,
          responsable_anterior: null,
          responsable_nuevo: null,
        },
      ],
    };

    const eventos = eventosHistorial(detalle);
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].titulo, 'Corrección de repuestos');
    assert.equal(
      eventos[0].detalle,
      'Se agregó: Rodamiento 6204 × 2 unidad. Motivo: Ajuste de pañol'
    );
  });
});

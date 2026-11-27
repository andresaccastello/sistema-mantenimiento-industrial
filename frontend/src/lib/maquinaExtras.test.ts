import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from './errores';
import { FILTROS_POR_DEFECTO } from './listado';
import {
  AYUDA_ENLACE_DOCUMENTO,
  TIPOS_DOCUMENTO,
  agruparDocumentos,
  infoTipoDocumento,
  validarEnlaceDocumento,
} from './documentos';
import { hayParticipantes, nombreCorto, textoInternos, textoParticiparon } from './participantes';
import {
  mensajeDemasiadas,
  mensajeErrorExportacion,
  nombreArchivoExportacion,
  paramsExportacion,
  urlExportacion,
} from './exportacion';
import { ENLACE_ALTA_RAPIDA, cuerpoAltaRapida } from './altaRapida';
import type { DocumentoMaquina } from '../api/tipos';

function doc(id: number, tipo: DocumentoMaquina['tipo'], titulo: string): DocumentoMaquina {
  return {
    id,
    maquina_id: 1,
    titulo,
    tipo,
    url: `https://ejemplo.com/${id}`,
    notas: null,
    creado_por: { id: 1, nombre: 'Ana', apellido: 'Pérez' },
    creado_en: '2026-11-20T10:00:00Z',
    actualizado_en: '2026-11-20T10:00:00Z',
  };
}

describe('FE-181: la etiqueta y el ícono de cada tipo de documento (MQ1, 4.1)', () => {
  it('los seis tipos de la API, en su orden, cada uno con etiqueta, grupo e ícono propio', () => {
    assert.deepEqual(
      TIPOS_DOCUMENTO.map((t) => [t.codigo, t.etiqueta, t.grupo, t.icono]),
      [
        ['MANUAL', 'Manual', 'Manuales', 'book'],
        ['FOTO', 'Foto', 'Fotos', 'photo'],
        ['VIDEO', 'Video', 'Videos', 'video'],
        ['INSTRUCTIVO', 'Instructivo', 'Instructivos', 'list'],
        ['PLANO', 'Plano', 'Planos', 'ruler'],
        ['OTRO', 'Otro', 'Otros', 'file'],
      ]
    );
    assert.equal(new Set(TIPOS_DOCUMENTO.map((t) => t.icono)).size, 6);
    assert.equal(infoTipoDocumento('PLANO').etiqueta, 'Plano');
    assert.equal(infoTipoDocumento('DESCONOCIDO').codigo, 'OTRO', 'Un tipo que no se conoce va como Otro');
  });

  it('agrupa por tipo en el orden de la tabla, sin grupos vacíos, y respeta el orden de la API dentro del grupo', () => {
    const grupos = agruparDocumentos([doc(1, 'PLANO', 'Plano general'), doc(2, 'MANUAL', 'B'), doc(3, 'MANUAL', 'A')]);
    assert.deepEqual(
      grupos.map((g) => [g.tipo.grupo, g.documentos.map((d) => d.id)]),
      [['Manuales', [2, 3]], ['Planos', [1]]]
    );
    assert.deepEqual(agruparDocumentos([]), []);
  });

  it('el enlace: solo http o https, como la API; y la ayuda del formulario', () => {
    assert.equal(validarEnlaceDocumento(' https://ejemplo.com/a.pdf '), null);
    assert.equal(validarEnlaceDocumento('HTTP://ejemplo.com'), null);
    assert.equal(validarEnlaceDocumento(''), 'Pegá el enlace');
    for (const malo of ['javascript:alert(1)', 'data:text/html,hola', 'ejemplo.com', 'ftp://ejemplo.com']) {
      assert.equal(validarEnlaceDocumento(malo), 'El enlace tiene que empezar con http:// o https://', malo);
    }
    assert.equal(validarEnlaceDocumento(`https://e.com/${'a'.repeat(990)}`), 'El enlace no puede superar los 1000 caracteres');
    assert.equal(AYUDA_ENLACE_DOCUMENTO, 'Pegá el enlace al archivo (en SAE, una carpeta compartida o la web del fabricante)');
  });
});

describe('FE-182: el texto de "Participaron" (MQ1, 4.2)', () => {
  const internos = [
    { id: 1, legajo: '10', nombre: 'Luis', apellido: 'Pérez' },
    { id: 2, legajo: '11', nombre: 'María', apellido: 'Gómez' },
  ];
  const externos = [{ id: 7, nombre: 'Servicios Eléctricos Ramírez' }];

  it('internos con la inicial y el apellido, y los externos después de " · "', () => {
    assert.equal(
      textoParticiparon({ internos, externos }),
      'Participaron: L. Pérez, M. Gómez · Servicios Eléctricos Ramírez'
    );
    assert.equal(textoInternos({ internos, externos }), 'L. Pérez, M. Gómez');
  });

  it('solo internos, solo externos, y sin apellido', () => {
    assert.equal(textoParticiparon({ internos, externos: [] }), 'Participaron: L. Pérez, M. Gómez');
    assert.equal(textoParticiparon({ internos: [], externos }), 'Participaron: Servicios Eléctricos Ramírez');
    assert.equal(nombreCorto({ nombre: 'Andrea', apellido: null }), 'Andrea');
    assert.equal(nombreCorto({ nombre: 'ana', apellido: 'Ruiz' }), 'A. Ruiz');
  });

  it('sin participantes no se muestra la línea', () => {
    assert.equal(textoParticiparon({ internos: [], externos: [] }), null);
    assert.equal(textoParticiparon(undefined), null);
    assert.equal(hayParticipantes({ internos: [], externos: [] }), false);
    assert.equal(hayParticipantes({ internos, externos: [] }), true);
  });
});

describe('FE-183: la URL de exportación con los filtros (MQ1, 4.3)', () => {
  it('los mismos parámetros que el listado, sin limit ni offset', () => {
    const params = paramsExportacion({
      ...FILTROS_POR_DEFECTO,
      vista: 'cerradas',
      maquinaId: 23,
      plantaId: 2,
      texto: 'rodamiento',
      tipo: 'CORRECTIVO',
      pagina: 4,
    });
    assert.equal('limit' in params, false);
    assert.equal('offset' in params, false);
    assert.equal(
      urlExportacion(params),
      '/api/intervenciones/exportar?estado=FINALIZADA%2CCANCELADA&maquina_id=23&planta_id=2&q=rodamiento&tipo=CORRECTIVO'
    );
  });

  it('la vista abiertas sin filtros, y la ficha de la máquina (todas, abiertas y cerradas)', () => {
    assert.equal(
      urlExportacion(paramsExportacion(FILTROS_POR_DEFECTO)),
      '/api/intervenciones/exportar?estado=PENDIENTE%2CEN_PROCESO%2CEN_ESPERA_REPUESTOS'
    );
    assert.equal(urlExportacion({ maquina_id: 23 }), '/api/intervenciones/exportar?maquina_id=23');
    assert.equal(urlExportacion({}), '/api/intervenciones/exportar');
    assert.equal(urlExportacion({ maquina_id: 5, q: '', sector_id: null }), '/api/intervenciones/exportar?maquina_id=5');
  });

  it('con 422 DEMASIADOS_RESULTADOS, el mensaje con el total; el nombre del archivo', () => {
    assert.equal(mensajeDemasiadas(7320), 'Son 7.320 intervenciones; acotá el filtro (máximo 5.000)');
    const err = new ApiError(422, 'DEMASIADOS_RESULTADOS', 'x', undefined, { total: 12000, maximo: 5000 });
    assert.equal(mensajeErrorExportacion(err), 'Son 12.000 intervenciones; acotá el filtro (máximo 5.000)');
    assert.equal(mensajeErrorExportacion(new ApiError(403, 'PERMISO_INSUFICIENTE', 'x')), null);
    assert.equal(
      nombreArchivoExportacion('attachment; filename="intervenciones-2026-11-25.csv"', new Date(2020, 0, 1)),
      'intervenciones-2026-11-25.csv'
    );
    assert.equal(nombreArchivoExportacion(null, new Date(2026, 10, 5)), 'intervenciones-2026-11-05.csv');
  });
});

describe('FE-184: el cuerpo del alta rápida de un repuesto (MQ1, 4.5)', () => {
  it('nombre y unidad recortados, siempre sin control de stock; costo y proveedor si vienen', () => {
    assert.deepEqual(cuerpoAltaRapida({ nombre: '  Resorte del balancín ', unidad: ' unidad ', costo: '', proveedorId: null }), {
      ok: true,
      cuerpo: { nombre: 'Resorte del balancín', unidad: 'unidad', lleva_stock: false },
    });
    assert.deepEqual(cuerpoAltaRapida({ nombre: 'Resorte', unidad: 'u', costo: 1250.5, proveedorId: '7' }), {
      ok: true,
      cuerpo: { nombre: 'Resorte', unidad: 'u', lleva_stock: false, costo_unitario: 1250.5, proveedor_id: 7 },
    });
    assert.deepEqual(cuerpoAltaRapida({ nombre: 'Resorte', unidad: 'u', costo: 0, proveedorId: null }), {
      ok: true,
      cuerpo: { nombre: 'Resorte', unidad: 'u', lleva_stock: false, costo_unitario: 0 },
    });
  });

  it('los mismos límites que la API', () => {
    const malo = (b: Parameters<typeof cuerpoAltaRapida>[0]) => {
      const r = cuerpoAltaRapida(b);
      return r.ok ? null : r.campo;
    };
    const base = { nombre: 'Resorte', unidad: 'u', costo: '' as number | string, proveedorId: null };
    assert.equal(malo({ ...base, nombre: ' x ' }), 'nombre');
    assert.equal(malo({ ...base, nombre: 'x'.repeat(151) }), 'nombre');
    assert.equal(malo({ ...base, unidad: '  ' }), 'unidad');
    assert.equal(malo({ ...base, unidad: 'u'.repeat(21) }), 'unidad');
    assert.equal(malo({ ...base, costo: -1 }), 'costo');
    assert.equal(ENLACE_ALTA_RAPIDA, 'No está en la lista: crear repuesto');
  });
});

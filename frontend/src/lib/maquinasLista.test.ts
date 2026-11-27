import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  leerFiltrosMaquinas,
  escribirFiltrosMaquinas,
  filtrarMaquinas,
  hayFiltrosMaquinas,
  FILTROS_MAQUINAS_POR_DEFECTO,
  FiltrosMaquinas,
  MaquinaFiltrable,
} from './maquinasLista';

describe('FE-27: leerFiltrosMaquinas y escribirFiltrosMaquinas', () => {
  it('dirección vacía devuelve valores por omisión', () => {
    const f = leerFiltrosMaquinas(new URLSearchParams(), false);
    assert.deepEqual(f, FILTROS_MAQUINAS_POR_DEFECTO);
  });

  it('limpia valores inválidos y respeta permiso en inactivas', () => {
    const pRota = new URLSearchParams('estado=ROTA');
    assert.deepEqual(leerFiltrosMaquinas(pRota, true).estados, []);

    const pCrit = new URLSearchParams('criticidad=1,abc');
    assert.deepEqual(leerFiltrosMaquinas(pCrit, true).criticidades, [1]);

    const pInact = new URLSearchParams('inactivas=1');
    assert.equal(leerFiltrosMaquinas(pInact, false).inactivas, false);
    assert.equal(leerFiltrosMaquinas(pInact, true).inactivas, true);
  });

  it('ida y vuelta con todos los campos da lo mismo y los valores por omisión van sin claves', () => {
    const completos: FiltrosMaquinas = {
      texto: 'torno',
      estados: ['OPERATIVA', 'DETENIDA'],
      criticidades: [1, 2],
      tipoEquipoId: 4,
      sectorId: 3,
      plantaId: 2,
      inactivas: true,
    };

    const params = escribirFiltrosMaquinas(completos);
    const leidos = leerFiltrosMaquinas(params, true);
    assert.deepEqual(leidos, completos);

    const vacios = escribirFiltrosMaquinas(FILTROS_MAQUINAS_POR_DEFECTO);
    assert.equal(Array.from(vacios.keys()).length, 0);
  });
});

describe('FE-28: filtrarMaquinas y hayFiltrosMaquinas', () => {
  interface MaquinaTest extends MaquinaFiltrable {
    id: number;
  }

  const cincoMaquinas: MaquinaTest[] = [
    {
      id: 10,
      nombre: 'Fresadora Universal',
      codigo: 'M-101',
      modelo: 'Deckel FP1',
      estado: 'OPERATIVA',
      activo: true,
      criticidad: { id: 1 },
      tipo_equipo: { id: 10 },
      sector: { id: 1, planta: { id: 100 } },
    },
    {
      id: 20,
      nombre: 'Torno Paralelo',
      codigo: 'TR-205',
      modelo: 'Turri T-190',
      estado: 'DETENIDA',
      activo: true,
      criticidad: { id: 2 },
      tipo_equipo: { id: 11 },
      sector: { id: 2, planta: { id: 100 } },
    },
    {
      id: 30,
      nombre: 'Compresor Tornillo',
      codigo: 'CP-01',
      modelo: 'Atlas Copco GA37',
      estado: 'EN_MANTENIMIENTO',
      activo: true,
      criticidad: { id: 1 },
      tipo_equipo: { id: 12 },
      sector: { id: 3, planta: { id: 200 } },
    },
    {
      id: 40,
      nombre: 'Prensa Hidráulica',
      codigo: null,
      modelo: 'Enerpac 50T',
      estado: 'FUERA_DE_SERVICIO',
      activo: true,
      criticidad: { id: 3 },
      tipo_equipo: { id: 10 },
      sector: { id: 4, planta: null },
    },
    {
      id: 50,
      nombre: 'Agujereadora de Banco',
      codigo: 'AG-09',
      modelo: 'Barbero B-25',
      estado: 'OPERATIVA',
      activo: false,
      criticidad: { id: 3 },
      tipo_equipo: { id: 10 },
      sector: { id: 1, planta: { id: 100 } },
    },
  ];

  it('busca sin tildes en nombre, código y modelo', () => {
    const porNombre = filtrarMaquinas(cincoMaquinas, {
      ...FILTROS_MAQUINAS_POR_DEFECTO,
      texto: 'fresádora',
    });
    assert.deepEqual(
      porNombre.map((m) => m.id),
      [10]
    );

    const porCodigo = filtrarMaquinas(cincoMaquinas, {
      ...FILTROS_MAQUINAS_POR_DEFECTO,
      texto: 'tr-205',
    });
    assert.deepEqual(
      porCodigo.map((m) => m.id),
      [20]
    );

    const porModelo = filtrarMaquinas(cincoMaquinas, {
      ...FILTROS_MAQUINAS_POR_DEFECTO,
      texto: 'atlas copco',
    });
    assert.deepEqual(
      porModelo.map((m) => m.id),
      [30]
    );
  });

  it('filtra por planta a través de sector.planta, oculta desactivadas salvo inactivas y conserva el orden', () => {
    const planta100Activas = filtrarMaquinas(cincoMaquinas, {
      ...FILTROS_MAQUINAS_POR_DEFECTO,
      plantaId: 100,
    });
    assert.deepEqual(
      planta100Activas.map((m) => m.id),
      [10, 20]
    );

    const planta100ConInactivas = filtrarMaquinas(cincoMaquinas, {
      ...FILTROS_MAQUINAS_POR_DEFECTO,
      plantaId: 100,
      inactivas: true,
    });
    assert.deepEqual(
      planta100ConInactivas.map((m) => m.id),
      [10, 20, 50]
    );
  });

  it('hayFiltrosMaquinas es false con solo inactivas y true con algún filtro', () => {
    assert.equal(hayFiltrosMaquinas(FILTROS_MAQUINAS_POR_DEFECTO), false);
    assert.equal(
      hayFiltrosMaquinas({ ...FILTROS_MAQUINAS_POR_DEFECTO, inactivas: true }),
      false
    );
    assert.equal(
      hayFiltrosMaquinas({ ...FILTROS_MAQUINAS_POR_DEFECTO, plantaId: 100 }),
      true
    );
  });
});


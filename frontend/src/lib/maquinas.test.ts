import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarTexto,
  etiquetaMaquina,
  coincideMaquina,
  agruparMaquinas,
  textoFallasAbiertas,
} from './maquinas.js';

describe('FE-12: normalizarTexto, etiquetaMaquina y coincideMaquina', () => {
  it('normalizarTexto quita tildes, minúsculas y recorta espacios', () => {
    assert.equal(normalizarTexto('Cámara'), 'camara');
  });

  it('etiquetaMaquina formatea con y sin código', () => {
    assert.equal(etiquetaMaquina({ codigo: 'M-012', nombre: 'Torno CNC' }), 'M-012 · Torno CNC');
    assert.equal(etiquetaMaquina({ codigo: null, nombre: 'Torno CNC' }), 'Torno CNC');
  });

  it('coincideMaquina busca por nombre y código sin importar tildes ni mayúsculas', () => {
    const torno = { codigo: 'M-012', nombre: 'Torno CNC' };
    const camara = { codigo: null, nombre: 'Cámara de pintura' };

    assert.equal(coincideMaquina(torno, 'torno'), true);
    assert.equal(coincideMaquina(torno, 'TÓRNO'), true);
    assert.equal(coincideMaquina(torno, '012'), true);
    assert.equal(coincideMaquina(camara, 'camara'), true);
    assert.equal(coincideMaquina(torno, 'fresa'), false);
    assert.equal(coincideMaquina(torno, ''), true);
    assert.equal(coincideMaquina(camara, ''), true);
  });
});

describe('FE-13: agruparMaquinas', () => {
  it('agrupa por sector del usuario y ordena por nombre', () => {
    const maquinas = [
      { id: 1, nombre: 'Z-Torno', sector: { id: 1 } },
      { id: 2, nombre: 'A-Fresadora', sector: { id: 2 } },
      { id: 3, nombre: 'A-Prensa', sector: { id: 1 } },
      { id: 4, nombre: 'B-Cortadora', sector: { id: 3 } },
    ];

    const res = agruparMaquinas(maquinas, [1]);
    assert.equal(res.propias.length, 2);
    assert.equal(res.otras.length, 2);
    assert.deepEqual(
      res.propias.map((m) => m.nombre),
      ['A-Prensa', 'Z-Torno']
    );
    assert.deepEqual(
      res.otras.map((m) => m.nombre),
      ['A-Fresadora', 'B-Cortadora']
    );

    const sinSectores = agruparMaquinas(maquinas, []);
    assert.equal(sinSectores.propias.length, 0);
    assert.equal(sinSectores.otras.length, 4);
  });
});

describe('FE-14: textoFallasAbiertas', () => {
  it('devuelve null si es 0 o negativo, y el texto correspondiente para 1 o más', () => {
    assert.equal(textoFallasAbiertas(0), null);
    assert.equal(textoFallasAbiertas(-1), null);
    assert.equal(textoFallasAbiertas(1), 'Esta máquina ya tiene 1 falla abierta.');
    assert.equal(textoFallasAbiertas(3), 'Esta máquina ya tiene 3 fallas abiertas.');
  });
});

import React, { useState, useEffect } from 'react';
import { fetchApi } from './api';

interface Sector {
  id: number;
  nombre: string;
}

interface Maquina {
  id: number;
  nombre: string;
  codigo?: string;
  estado: string;
  sector: Sector;
}

interface HistorialItem {
  id: number;
  estado_anterior: string | null;
  estado_nuevo: string;
  observacion: string | null;
  cambiado_en: string;
  cambiado_por: {
    id: number;
    legajo: string;
    nombre: string;
  };
}

interface PeriodoDetencion {
  id: number;
  desde: string;
  hasta: string | null;
  esta_abierto: boolean;
  observacion: string | null;
  abierto_por: { id: number; nombre: string };
  confirmado_por: { id: number; nombre: string } | null;
}

interface Intervencion {
  id: number;
  descripcion: string;
  estado: string;
  ejecucion: string | null;
  fecha_creacion: string;
  detiene_maquina_actualmente: boolean;
  maquina: Maquina;
  creado_por: {
    id: number;
    legajo: string;
    nombre: string;
  };
  responsable: {
    id: number;
    legajo: string;
    nombre: string;
  } | null;
}

interface IntervencionDetalle extends Intervencion {
  observaciones: string | null;
  historial_estados: HistorialItem[];
  periodos_detencion: PeriodoDetencion[];
}

export function Intervenciones() {
  const [intervenciones, setIntervenciones] = useState<Intervencion[]>([]);
  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [soloSinAsignar, setSoloSinAsignar] = useState(false);

  // Formulario de nueva falla
  const [showModal, setShowModal] = useState(false);
  const [selectedMaquinaId, setSelectedMaquinaId] = useState<number | ''>('');
  const [descripcion, setDescripcion] = useState('');
  const [detieneMaquina, setDetieneMaquina] = useState(true);
  const [observaciones, setObservaciones] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Modal de detalle
  const [selectedIntervencion, setSelectedIntervencion] = useState<IntervencionDetalle | null>(null);
  const [loadingDetalle, setLoadingDetalle] = useState(false);

  const loadIntervenciones = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = soloSinAsignar ? '/api/intervenciones?sin_asignar=true' : '/api/intervenciones';
      const data = await fetchApi(url);
      setIntervenciones(data);
    } catch (err: any) {
      setError(err.message || 'Error al cargar intervenciones');
    } finally {
      setLoading(false);
    }
  };

  const loadMaquinas = async () => {
    try {
      const data = await fetchApi('/api/maquinas');
      setMaquinas(data);
    } catch (err: any) {
      console.error('Error cargando máquinas:', err);
    }
  };

  useEffect(() => {
    loadIntervenciones();
    loadMaquinas();
  }, [soloSinAsignar]);

  const handleCrearFalla = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMaquinaId) {
      alert('Seleccione una máquina');
      return;
    }
    if (descripcion.trim().length < 5) {
      alert('La descripción debe tener al menos 5 caracteres');
      return;
    }

    setSubmitting(true);
    try {
      await fetchApi('/api/intervenciones', {
        method: 'POST',
        body: JSON.stringify({
          maquina_id: Number(selectedMaquinaId),
          descripcion: descripcion.trim(),
          detiene_maquina: detieneMaquina,
          observaciones: observaciones.trim() || undefined,
        }),
      });

      // Limpiar y cerrar
      setShowModal(false);
      setSelectedMaquinaId('');
      setDescripcion('');
      setObservaciones('');
      setDetieneMaquina(true);
      await loadIntervenciones();
      await loadMaquinas();
    } catch (err: any) {
      alert('Error al registrar la falla: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerDetalle = async (id: number) => {
    setLoadingDetalle(true);
    try {
      const data = await fetchApi(`/api/intervenciones/${id}`);
      setSelectedIntervencion(data);
    } catch (err: any) {
      alert('Error cargando detalle: ' + err.message);
    } finally {
      setLoadingDetalle(false);
    }
  };

  return (
    <div className="dev-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2>Módulo de Intervenciones</h2>
          <p style={{ color: '#666', fontSize: '0.9rem' }}>
            Registro unificado de fallas correctivas y control de detenciones de máquinas.
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowModal(true)}
          style={{ padding: '0.6rem 1.2rem', fontWeight: 600 }}
        >
          + Reportar Falla / Intervención
        </button>
      </div>

      {/* Selector de Vistas / Filtros */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          className={`btn ${!soloSinAsignar ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSoloSinAsignar(false)}
        >
          Todas según mi alcance
        </button>
        <button
          className={`btn ${soloSinAsignar ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSoloSinAsignar(true)}
        >
          ⚠️ Vista "Sin asignar" (Priorizadas)
        </button>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* Tabla de Intervenciones */}
      {loading ? (
        <p>Cargando intervenciones...</p>
      ) : intervenciones.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', background: '#f9f9f9', borderRadius: '8px' }}>
          No hay intervenciones para mostrar en esta vista.
        </div>
      ) : (
        <table className="dev-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Estado</th>
              <th>Detención</th>
              <th>Máquina</th>
              <th>Descripción</th>
              <th>Reportado por</th>
              <th>Responsable</th>
              <th>Fecha</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {intervenciones.map((i) => (
              <tr key={i.id}>
                <td><strong>#{i.id}</strong></td>
                <td>
                  <span className={`badge badge-${i.estado.toLowerCase()}`}>
                    {i.estado}
                  </span>
                </td>
                <td>
                  {i.detiene_maquina_actualmente ? (
                    <span style={{
                      backgroundColor: '#ffebee',
                      color: '#c62828',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      fontWeight: 600,
                      fontSize: '0.8rem'
                    }}>
                      ⛔ Detenida
                    </span>
                  ) : (
                    <span style={{ color: '#888', fontSize: '0.85rem' }}>No</span>
                  )}
                </td>
                <td>
                  <strong>{i.maquina.nombre}</strong>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>{i.maquina.sector.nombre}</div>
                </td>
                <td style={{ maxWidth: '300px' }}>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {i.descripcion}
                  </div>
                </td>
                <td>
                  {i.creado_por.nombre}
                  <div style={{ fontSize: '0.75rem', color: '#777' }}>({i.creado_por.legajo})</div>
                </td>
                <td>
                  {i.responsable ? (
                    <span>{i.responsable.nombre}</span>
                  ) : (
                    <span style={{ color: '#d32f2f', fontStyle: 'italic', fontSize: '0.85rem' }}>Sin asignar</span>
                  )}
                </td>
                <td style={{ fontSize: '0.85rem', color: '#555' }}>
                  {new Date(i.fecha_creacion).toLocaleString()}
                </td>
                <td>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '3px 8px' }}
                    onClick={() => handleVerDetalle(i.id)}
                  >
                    Ver detalle
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Modal: Registrar Falla */}
      {showModal && (
        <div className="dev-modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', width: '500px', maxWidth: '90%' }}>
            <h3>Reportar Falla / Nueva Intervención</h3>
            <p style={{ fontSize: '0.85rem', color: '#666' }}>
              Se creará automáticamente una intervención en estado <strong>PENDIENTE</strong>.
            </p>

            <form onSubmit={handleCrearFalla}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Máquina con desperfecto *
                </label>
                <select
                  value={selectedMaquinaId}
                  onChange={(e) => setSelectedMaquinaId(e.target.value ? Number(e.target.value) : '')}
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                >
                  <option value="">-- Seleccionar máquina --</option>
                  {maquinas.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre} ({m.sector.nombre}) — Estado actual: {m.estado}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Descripción del problema o síntoma *
                </label>
                <textarea
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Describa qué sucedió o qué ruido/comportamiento anómalo presenta..."
                  rows={3}
                  required
                  minLength={5}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              <div style={{ marginBottom: '1rem', background: '#fff3e0', padding: '0.8rem', borderRadius: '4px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={detieneMaquina}
                    onChange={(e) => setDetieneMaquina(e.target.checked)}
                  />
                  ¿La falla detuvo o impide el funcionamiento de la máquina?
                </label>
                <div style={{ fontSize: '0.75rem', color: '#b78103', marginTop: '0.3rem' }}>
                  {detieneMaquina
                    ? '⚠️ Se cambiará el estado de la máquina a DETENIDA y se registrará el inicio del período de detención para cómputo de horas de parada.'
                    : 'ℹ️ La máquina permanecerá en su estado actual (la falla no paralizó el equipo).'}
                </div>
              </div>

              <div style={{ marginBottom: '1.2rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Observaciones adicionales (Opcional)
                </label>
                <textarea
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Detalles sobre si se intentó algo o condiciones del entorno..."
                  rows={2}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowModal(false)}
                  disabled={submitting}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting}
                >
                  {submitting ? 'Guardando...' : 'Registrar Falla'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Ver Detalle de Intervención */}
      {selectedIntervencion && (
        <div className="dev-modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', width: '650px', maxWidth: '95%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Detalle Intervención #{selectedIntervencion.id}</h3>
              <button
                className="btn btn-secondary"
                onClick={() => setSelectedIntervencion(null)}
                style={{ padding: '2px 8px' }}
              >
                ✕
              </button>
            </div>

            <div style={{ margin: '1rem 0', background: '#f5f5f5', padding: '1rem', borderRadius: '6px' }}>
              <p><strong>Máquina:</strong> {selectedIntervencion.maquina.nombre} ({selectedIntervencion.maquina.sector.nombre})</p>
              <p><strong>Estado Actual:</strong> <span className={`badge badge-${selectedIntervencion.estado.toLowerCase()}`}>{selectedIntervencion.estado}</span></p>
              <p><strong>Reportado por:</strong> {selectedIntervencion.creado_por.nombre} ({selectedIntervencion.creado_por.legajo})</p>
              <p><strong>Responsable:</strong> {selectedIntervencion.responsable ? selectedIntervencion.responsable.nombre : 'Sin asignar aún'}</p>
              <p><strong>Descripción:</strong> {selectedIntervencion.descripcion}</p>
              {selectedIntervencion.observaciones && <p><strong>Observaciones:</strong> {selectedIntervencion.observaciones}</p>}
            </div>

            <h4>Períodos de Detención</h4>
            {selectedIntervencion.periodos_detencion.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: '#666' }}>Esta intervención no generó detención de máquina.</p>
            ) : (
              <ul style={{ fontSize: '0.85rem', paddingLeft: '1.2rem' }}>
                {selectedIntervencion.periodos_detencion.map((p) => (
                  <li key={p.id} style={{ marginBottom: '0.4rem' }}>
                    Desde: <strong>{new Date(p.desde).toLocaleString()}</strong> —{' '}
                    Hasta: {p.hasta ? <strong>{new Date(p.hasta).toLocaleString()}</strong> : <span style={{ color: '#c62828', fontWeight: 600 }}>Abierto (Detención activa)</span>}
                    <div style={{ color: '#777' }}>Abierto por: {p.abierto_por.nombre} {p.confirmado_por ? ` | Confirmado por: ${p.confirmado_por.nombre}` : ''}</div>
                  </li>
                ))}
              </ul>
            )}

            <h4 style={{ marginTop: '1rem' }}>Trazabilidad de Estados</h4>
            <ul style={{ fontSize: '0.85rem', paddingLeft: '1.2rem' }}>
              {selectedIntervencion.historial_estados.map((h) => (
                <li key={h.id} style={{ marginBottom: '0.3rem' }}>
                  {h.estado_anterior || 'INICIO'} ➔ <strong>{h.estado_nuevo}</strong> por {h.cambiado_por.nombre} ({new Date(h.cambiado_en).toLocaleString()})
                  {h.observacion && <div style={{ color: '#555', fontStyle: 'italic' }}>"{h.observacion}"</div>}
                </li>
              ))}
            </ul>

            <div style={{ textAlign: 'right', marginTop: '1.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setSelectedIntervencion(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

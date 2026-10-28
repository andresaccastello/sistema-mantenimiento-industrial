import { useState, useEffect } from 'react';
import { fetchApi } from './api';

interface Maquina {
  id: string;
  nombre: string;
  sector_id: string;
  tipo: string;
  estado: string;
  descripcion: string | null;
  ubicacion: string | null;
  documentacion_url: string | null;
  activo: boolean;
  creado_en: string;
}

interface Sector {
  id: string;
  nombre: string;
}

export function Maquinas() {
  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [sectores, setSectores] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const isReadOnly = false; 

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<Maquina>>({});

  const loadData = async () => {
    setLoading(true);
    try {
      const [maquinasData, sectoresData] = await Promise.all([
        fetchApi('/api/maquinas?all=true'),
        fetchApi('/api/sectores')
      ]);
      setMaquinas(maquinasData);
      setSectores(sectoresData);
    } catch (err: any) {
      setError(err.message || 'Error al cargar máquinas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleEdit = (maquina: Maquina) => {
    if (isReadOnly) return;
    setFormData({ ...maquina });
    setIsModalOpen(true);
  };

  const handleCreate = () => {
    if (isReadOnly) return;
    setFormData({ 
      nombre: '', 
      sector_id: sectores.length > 0 ? sectores[0].id : '', 
      tipo: '', 
      estado: 'OPERATIVA',
      descripcion: '',
      ubicacion: '',
      activo: true 
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    
    try {
      const payload = {
        nombre: formData.nombre,
        sector_id: formData.sector_id,
        tipo: formData.tipo,
        descripcion: formData.descripcion,
        ubicacion: formData.ubicacion,
        activo: formData.activo
      };

      if (formData.id) {
        await fetchApi(`/api/maquinas/${formData.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await fetchApi('/api/maquinas', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      setIsModalOpen(false);
      loadData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const [selectedMaquina, setSelectedMaquina] = useState<Maquina | null>(null);
  const [showDetencionesModal, setShowDetencionesModal] = useState(false);
  const [detenciones, setDetenciones] = useState<any[]>([]);
  const [selectedPeriodos, setSelectedPeriodos] = useState<string[]>([]);
  const [fechaRecuperacion, setFechaRecuperacion] = useState('');
  const [loadingDetenciones, setLoadingDetenciones] = useState(false);

  const [showEstadoModal, setShowEstadoModal] = useState(false);
  const [estadoAccion, setEstadoAccion] = useState<'FUERA_DE_SERVICIO' | 'REACTIVAR'>('FUERA_DE_SERVICIO');
  const [estadoMotivo, setEstadoMotivo] = useState('');

  const [inactividadData, setInactividadData] = useState<any | null>(null);

  const handleOpenInactividad = async (maquina: Maquina) => {
    try {
      const data = await fetchApi(`/api/maquinas/${maquina.id}/inactividad`);
      setInactividadData(data);
    } catch (err: any) {
      alert(`Error al consultar inactividad: ${err.message}`);
    }
  };

  const handleOpenDetenciones = async (maquina: Maquina) => {
    setSelectedMaquina(maquina);
    setSelectedPeriodos([]);
    setFechaRecuperacion('');
    setShowDetencionesModal(true);
    setLoadingDetenciones(true);
    try {
      const data = await fetchApi(`/api/maquinas/${maquina.id}/detenciones-abiertas`);
      setDetenciones(data);
    } catch (err: any) {
      alert(`Error al cargar detenciones: ${err.message}`);
    } finally {
      setLoadingDetenciones(false);
    }
  };

  const handleConfirmarRecuperacion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMaquina) return;
    if (selectedPeriodos.length === 0) {
      alert('Seleccione al menos un período');
      return;
    }
    try {
      await fetchApi(`/api/maquinas/${selectedMaquina.id}/confirmar-recuperacion`, {
        method: 'POST',
        body: JSON.stringify({
          periodo_ids: selectedPeriodos,
          fecha_recuperacion: fechaRecuperacion ? new Date(fechaRecuperacion).toISOString() : undefined
        })
      });
      alert('Recuperación confirmada');
      setShowDetencionesModal(false);
      loadData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleOpenEstado = (maquina: Maquina, accion: 'FUERA_DE_SERVICIO' | 'REACTIVAR') => {
    setSelectedMaquina(maquina);
    setEstadoAccion(accion);
    setEstadoMotivo('');
    setShowEstadoModal(true);
  };

  const handleGuardarEstado = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMaquina) return;
    if (!estadoMotivo.trim()) {
      alert('El motivo es obligatorio');
      return;
    }
    try {
      await fetchApi(`/api/maquinas/${selectedMaquina.id}/estado`, {
        method: 'POST',
        body: JSON.stringify({
          accion: estadoAccion,
          motivo: estadoMotivo
        })
      });
      setShowEstadoModal(false);
      loadData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const getSectorNombre = (id: string) => {
    return sectores.find(s => s.id === id)?.nombre || 'Desconocido';
  };

  if (loading) return <div>Cargando máquinas...</div>;
  if (error) return <div className="dev-error">{error}</div>;

  return (
    <div>
      <div className="dev-header-actions">
        <h2>Gestión de Máquinas</h2>
        <button 
          className="dev-btn" 
          onClick={handleCreate}
          disabled={isReadOnly}
        >
          Nueva Máquina
        </button>
      </div>

      {isReadOnly && (
        <div className="dev-read-only-alert">
          <strong>Modo Solo Lectura:</strong> Las operaciones de escritura están deshabilitadas hasta configurar y verificar una conexión de desarrollo.
        </div>
      )}

      <div className="dev-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="dev-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Sector</th>
              <th>Tipo</th>
              <th>Est. Operativo</th>
              <th>Activo</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {maquinas.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center' }}>No hay máquinas registradas</td></tr>
            ) : maquinas.map(m => (
              <tr key={m.id}>
                <td style={{ fontWeight: 500 }}>{m.nombre}</td>
                <td>{getSectorNombre(m.sector_id)}</td>
                <td>{m.tipo}</td>
                <td>
                  <span style={{ 
                    padding: '2px 6px', 
                    borderRadius: '4px', 
                    fontSize: '0.8rem',
                    fontWeight: 'bold',
                    background: m.estado === 'OPERATIVA' ? '#d4edda' : m.estado === 'DETENIDA' ? '#f8d7da' : m.estado === 'EN_MANTENIMIENTO' ? '#fff3cd' : '#e2e3e5',
                    color: m.estado === 'OPERATIVA' ? '#155724' : m.estado === 'DETENIDA' ? '#721c24' : m.estado === 'EN_MANTENIMIENTO' ? '#856404' : '#383d41'
                  }}>
                    {m.estado}
                  </span>
                </td>
                <td>
                  <span className={`dev-badge ${m.activo ? 'dev-badge-active' : 'dev-badge-inactive'}`}>
                    {m.activo ? 'Activa' : 'Inactiva'}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <button 
                      className="dev-action-btn" 
                      onClick={() => handleEdit(m)}
                      disabled={isReadOnly}
                    >
                      Editar
                    </button>
                    <button
                      className="dev-action-btn"
                      style={{ background: '#17a2b8', color: 'white', borderColor: '#17a2b8' }}
                      onClick={() => handleOpenDetenciones(m)}
                    >
                      Detenciones
                    </button>
                    <button
                      className="dev-action-btn"
                      style={{ background: '#4f46e5', color: 'white', borderColor: '#4f46e5' }}
                      onClick={() => handleOpenInactividad(m)}
                    >
                      ⏱️ Inactividad
                    </button>
                    {m.estado === 'FUERA_DE_SERVICIO' || m.estado === 'DETENIDA' ? (
                      <button
                        className="dev-action-btn"
                        style={{ background: '#28a745', color: 'white', borderColor: '#28a745' }}
                        onClick={() => handleOpenEstado(m, 'REACTIVAR')}
                        disabled={isReadOnly}
                      >
                        Reactivar
                      </button>
                    ) : (
                      <button
                        className="dev-action-btn"
                        style={{ background: '#6c757d', color: 'white', borderColor: '#6c757d' }}
                        onClick={() => handleOpenEstado(m, 'FUERA_DE_SERVICIO')}
                        disabled={isReadOnly}
                      >
                        Fuera Serv.
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isModalOpen && !isReadOnly && (
        <div className="dev-modal">
          <div className="dev-modal-content">
            <h3>{formData.id ? 'Editar Máquina' : 'Nueva Máquina'}</h3>
            <form onSubmit={handleSave}>
              <div className="dev-form-group">
                <label>Nombre</label>
                <input 
                  type="text" 
                  value={formData.nombre || ''} 
                  onChange={e => setFormData({...formData, nombre: e.target.value})} 
                  required 
                />
              </div>
              <div className="dev-form-group">
                <label>Sector</label>
                <select 
                  value={formData.sector_id || ''} 
                  onChange={e => setFormData({...formData, sector_id: e.target.value})}
                  required
                >
                  <option value="">Seleccione un sector...</option>
                  {sectores.map(s => (
                    <option key={s.id} value={s.id}>{s.nombre}</option>
                  ))}
                </select>
              </div>
              <div className="dev-form-group">
                <label>Tipo</label>
                <input 
                  type="text" 
                  value={formData.tipo || ''} 
                  onChange={e => setFormData({...formData, tipo: e.target.value})} 
                  required 
                />
              </div>
              {formData.id && (
                <div className="dev-form-group">
                  <label>Estado Operativo</label>
                  <div style={{ padding: '0.4rem 0.6rem', background: '#e9ecef', borderRadius: '4px', fontWeight: 600, color: '#333' }}>
                    {formData.estado || 'OPERATIVA'} <span style={{ fontSize: '0.8rem', color: '#666', fontWeight: 'normal' }}>(Gestionado automáticamente por Intervenciones)</span>
                  </div>
                </div>
              )}
              <div className="dev-form-group">
                <label>Descripción / Observaciones</label>
                <input 
                  type="text" 
                  value={formData.descripcion || ''} 
                  onChange={e => setFormData({...formData, descripcion: e.target.value})} 
                />
              </div>
              <div className="dev-form-group">
                <label>Ubicación Específica</label>
                <input 
                  type="text" 
                  value={formData.ubicacion || ''} 
                  onChange={e => setFormData({...formData, ubicacion: e.target.value})} 
                />
              </div>
              
              {formData.id && (
                <div className="dev-form-group">
                  <label>
                    <input 
                      type="checkbox" 
                      checked={formData.activo !== false} 
                      onChange={e => setFormData({...formData, activo: e.target.checked})} 
                      style={{ width: 'auto', marginRight: '0.5rem' }}
                    />
                    Máquina Activa
                  </label>
                </div>
              )}
              
              <div className="dev-modal-actions">
                <button type="button" className="dev-btn dev-btn-secondary" onClick={() => setIsModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="dev-btn">
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDetencionesModal && selectedMaquina && (
        <div className="dev-modal">
          <div className="dev-modal-content" style={{ maxWidth: '650px' }}>
            <h3>Detenciones Abiertas - {selectedMaquina.nombre}</h3>
            {loadingDetenciones ? (
              <p>Cargando detenciones...</p>
            ) : detenciones.length === 0 ? (
              <p>No hay detenciones abiertas para esta máquina.</p>
            ) : (
              <form onSubmit={handleConfirmarRecuperacion}>
                <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
                  Seleccione las detenciones que desea marcar como recuperadas:
                </p>
                <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #dee2e6', borderRadius: '4px', padding: '0.5rem', marginBottom: '1rem' }}>
                  {detenciones.map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid #f1f3f5' }}>
                      <input 
                        type="checkbox"
                        checked={selectedPeriodos.includes(d.id)}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedPeriodos([...selectedPeriodos, d.id]);
                          } else {
                            setSelectedPeriodos(selectedPeriodos.filter(id => id !== d.id));
                          }
                        }}
                        style={{ marginTop: '0.2rem' }}
                      />
                      <div>
                        <strong>Intervención #{d.intervencion_numero}</strong> ({d.intervencion_estado})<br />
                        <span style={{ fontSize: '0.85rem', color: '#555' }}>
                          Desde: {new Date(d.desde).toLocaleString()}
                          {d.motivo_inicio && ` - Motivo: ${d.motivo_inicio}`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="dev-form-group">
                  <label>Fecha de Recuperación (opcional, por defecto ahora)</label>
                  <input 
                    type="datetime-local" 
                    value={fechaRecuperacion} 
                    onChange={e => setFechaRecuperacion(e.target.value)} 
                  />
                </div>

                <div className="dev-modal-actions">
                  <button type="button" className="dev-btn dev-btn-secondary" onClick={() => setShowDetencionesModal(false)}>
                    Cerrar
                  </button>
                  <button type="submit" className="dev-btn" disabled={selectedPeriodos.length === 0}>
                    Confirmar Recuperación
                  </button>
                </div>
              </form>
            )}
            {detenciones.length === 0 && (
              <div className="dev-modal-actions">
                <button type="button" className="dev-btn dev-btn-secondary" onClick={() => setShowDetencionesModal(false)}>
                  Cerrar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showEstadoModal && selectedMaquina && (
        <div className="dev-modal">
          <div className="dev-modal-content">
            <h3>Cambiar Estado: {selectedMaquina.nombre}</h3>
            <form onSubmit={handleGuardarEstado}>
              <div className="dev-form-group">
                <label>Acción</label>
                <select 
                  value={estadoAccion} 
                  onChange={e => setEstadoAccion(e.target.value as any)}
                >
                  <option value="FUERA_DE_SERVICIO">FUERA_DE_SERVICIO (Poner fuera de servicio)</option>
                  <option value="REACTIVAR">REACTIVAR (Volver a cálculo automático)</option>
                </select>
              </div>

              <div className="dev-form-group">
                <label>Motivo (obligatorio)</label>
                <textarea 
                  value={estadoMotivo} 
                  onChange={e => setEstadoMotivo(e.target.value)}
                  required
                  rows={3}
                  style={{ width: '100%', borderRadius: '4px', border: '1px solid #ccc', padding: '0.5rem' }}
                  placeholder="Explique el motivo del cambio..."
                />
              </div>

              <div className="dev-modal-actions">
                <button type="button" className="dev-btn dev-btn-secondary" onClick={() => setShowEstadoModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="dev-btn">
                  Guardar Estado
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {inactividadData && (
        <div className="dev-modal">
          <div className="dev-modal-content" style={{ maxWidth: '650px' }}>
            <h3>⏱️ Inactividad (Últimos 30 días) — {inactividadData.maquina.nombre}</h3>
            <p style={{ color: '#666', fontSize: '0.85rem' }}>
              Período: {new Date(inactividadData.intervalo.desde).toLocaleString()} — {new Date(inactividadData.intervalo.hasta).toLocaleString()}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', margin: '1rem 0' }}>
              <div style={{ background: '#fee2e2', padding: '0.75rem', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', color: '#991b1b', fontWeight: 600 }}>TOTAL</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#b91c1c' }}>
                  {Math.floor(inactividadData.inactividad_minutos / 60)} h {inactividadData.inactividad_minutos % 60} min
                </div>
              </div>
              <div style={{ background: '#fef3c7', padding: '0.75rem', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', color: '#92400e', fontWeight: 600 }}>CORRECTIVO</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#b45309' }}>
                  {Math.floor(inactividadData.por_tipo.CORRECTIVO / 60)} h {inactividadData.por_tipo.CORRECTIVO % 60} min
                </div>
              </div>
              <div style={{ background: '#e0e7ff', padding: '0.75rem', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', color: '#3730a3', fontWeight: 600 }}>PREVENTIVO</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#4338ca' }}>
                  {Math.floor(inactividadData.por_tipo.PREVENTIVO / 60)} h {inactividadData.por_tipo.PREVENTIVO % 60} min
                </div>
              </div>
              <div style={{ background: '#f3f4f6', padding: '0.75rem', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', color: '#4b5563', fontWeight: 600 }}>FDS DESCONTADO</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1f2937' }}>
                  {Math.floor(inactividadData.fuera_de_servicio_descontado_minutos / 60)} h {inactividadData.fuera_de_servicio_descontado_minutos % 60} min
                </div>
              </div>
            </div>

            <h4>Períodos de Detención</h4>
            {inactividadData.periodos.length === 0 ? (
              <p style={{ color: '#666', fontSize: '0.9rem' }}>No registra detenciones en el intervalo.</p>
            ) : (
              <ul style={{ fontSize: '0.85rem', paddingLeft: '1.2rem', maxHeight: '200px', overflowY: 'auto' }}>
                {inactividadData.periodos.map((p: any) => (
                  <li key={p.id} style={{ marginBottom: '0.4rem' }}>
                    <strong>[{p.tipo}]</strong> Intervención #{p.intervencion_id} |{' '}
                    {new Date(p.desde).toLocaleString()} —{' '}
                    {p.hasta ? new Date(p.hasta).toLocaleString() : <span style={{ color: '#b91c1c', fontWeight: 600 }}>Abierto</span>}
                  </li>
                ))}
              </ul>
            )}

            <div style={{ textAlign: 'right', marginTop: '1.5rem' }}>
              <button className="dev-btn dev-btn-secondary" onClick={() => setInactividadData(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

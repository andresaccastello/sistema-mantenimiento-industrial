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
                <td>{m.estado}</td>
                <td>
                  <span className={`dev-badge ${m.activo ? 'dev-badge-active' : 'dev-badge-inactive'}`}>
                    {m.activo ? 'Activa' : 'Inactiva'}
                  </span>
                </td>
                <td>
                  <button 
                    className="dev-action-btn" 
                    onClick={() => handleEdit(m)}
                    disabled={isReadOnly}
                  >
                    Editar
                  </button>
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
    </div>
  );
}

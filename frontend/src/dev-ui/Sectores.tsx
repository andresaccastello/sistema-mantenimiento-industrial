import { useState, useEffect } from 'react';
import { fetchApi } from './api';

interface Sector {
  id: string;
  nombre: string;
  descripcion: string;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
}

export function Sectores() {
  const [sectores, setSectores] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Modo solo lectura deshabilitado para pruebas
  const isReadOnly = false;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ id: '', nombre: '', descripcion: '', activo: true });

  const loadSectores = async () => {
    setLoading(true);
    try {
      // Se requiere permiso para ver inactivos (o param all=true)
      const data = await fetchApi('/api/sectores?all=true');
      setSectores(data);
    } catch (err: any) {
      setError(err.message || 'Error al cargar sectores');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSectores();
  }, []);

  const handleEdit = (sector: Sector) => {
    if (isReadOnly) return;
    setFormData({ ...sector });
    setIsModalOpen(true);
  };

  const handleCreate = () => {
    if (isReadOnly) return;
    setFormData({ id: '', nombre: '', descripcion: '', activo: true });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    
    try {
      if (formData.id) {
        await fetchApi(`/api/sectores/${formData.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            nombre: formData.nombre,
            descripcion: formData.descripcion,
            activo: formData.activo
          })
        });
      } else {
        await fetchApi('/api/sectores', {
          method: 'POST',
          body: JSON.stringify({
            nombre: formData.nombre,
            descripcion: formData.descripcion
          })
        });
      }
      setIsModalOpen(false);
      loadSectores();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  if (loading) return <div>Cargando sectores...</div>;
  if (error) return <div className="dev-error">{error}</div>;

  return (
    <div>
      <div className="dev-header-actions">
        <h2>Gestión de Sectores</h2>
        <button 
          className="dev-btn" 
          onClick={handleCreate}
          disabled={isReadOnly}
          title={isReadOnly ? "Operaciones de escritura deshabilitadas por precaución" : ""}
        >
          Nuevo Sector
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
              <th>Descripción</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {sectores.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: 'center' }}>No hay sectores registrados</td></tr>
            ) : sectores.map(s => (
              <tr key={s.id}>
                <td style={{ fontWeight: 500 }}>{s.nombre}</td>
                <td>{s.descripcion || '-'}</td>
                <td>
                  <span className={`dev-badge ${s.activo ? 'dev-badge-active' : 'dev-badge-inactive'}`}>
                    {s.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td>
                  <button 
                    className="dev-action-btn" 
                    onClick={() => handleEdit(s)}
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
            <h3>{formData.id ? 'Editar Sector' : 'Nuevo Sector'}</h3>
            <form onSubmit={handleSave}>
              <div className="dev-form-group">
                <label>Nombre</label>
                <input 
                  type="text" 
                  value={formData.nombre} 
                  onChange={e => setFormData({...formData, nombre: e.target.value})} 
                  required 
                />
              </div>
              <div className="dev-form-group">
                <label>Descripción</label>
                <input 
                  type="text" 
                  value={formData.descripcion} 
                  onChange={e => setFormData({...formData, descripcion: e.target.value})} 
                />
              </div>
              {formData.id && (
                <div className="dev-form-group">
                  <label>
                    <input 
                      type="checkbox" 
                      checked={formData.activo} 
                      onChange={e => setFormData({...formData, activo: e.target.checked})} 
                      style={{ width: 'auto', marginRight: '0.5rem' }}
                    />
                    Sector Activo
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

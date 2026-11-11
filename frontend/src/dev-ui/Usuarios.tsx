import { useState, useEffect } from 'react';
import { fetchApi } from './api';

interface Sector {
  id: number;
  nombre: string;
}

interface Perfil {
  id: number;
  nombre: string;
  descripcion: string;
}

interface UsuarioListItem {
  id: number;
  legajo: string;
  nombre: string;
  apellido: string | null;
  perfil: { id: number; nombre: string };
  sectores: Sector[];
  activo: boolean;
  ultimo_acceso_en: string | null;
  debe_cambiar_password: boolean;
}

export function Usuarios() {
  const [usuarios, setUsuarios] = useState<UsuarioListItem[]>([]);
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [sectoresDisponibles, setSectoresDisponibles] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Filtros
  const [filterTexto, setFilterTexto] = useState('');
  const [filterActivo, setFilterActivo] = useState<'todos' | 'true' | 'false'>('todos');
  const [filterPerfilId, setFilterPerfilId] = useState('');

  // Modales
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isMotivoModalOpen, setIsMotivoModalOpen] = useState(false);
  const [isResetPassModalOpen, setIsResetPassModalOpen] = useState(false);

  const [selectedUser, setSelectedUser] = useState<UsuarioListItem | null>(null);
  const [motivoAccion, setMotivoAccion] = useState<'desactivar' | 'reactivar'>('desactivar');
  const [motivoTexto, setMotivoTexto] = useState('');
  const [passwordTemporal, setPasswordTemporal] = useState('');

  // Formulario alta
  const [formDataCreate, setFormDataCreate] = useState({
    legajo: '',
    nombre: '',
    apellido: '',
    perfil_id: '',
    sectores: [] as number[],
    password_temporal: '',
  });

  // Formulario edición
  const [formDataEdit, setFormDataEdit] = useState({
    id: 0,
    legajo: '',
    nombre: '',
    apellido: '',
    perfil_id: '',
    sectores: [] as number[],
  });

  const loadCatalogos = async () => {
    try {
      const [perfilesData, sectoresData] = await Promise.all([
        fetchApi('/api/perfiles'),
        fetchApi('/api/sectores'),
      ]);
      setPerfiles(perfilesData || []);
      setSectoresDisponibles(sectoresData || []);
    } catch (err: any) {
      console.error('Error cargando catálogos:', err);
    }
  };

  const loadUsuarios = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filterTexto.trim()) params.set('texto', filterTexto.trim());
      if (filterActivo !== 'todos') params.set('activo', filterActivo);
      if (filterPerfilId) params.set('perfil_id', filterPerfilId);

      const queryStr = params.toString();
      const url = queryStr ? `/api/usuarios?${queryStr}` : '/api/usuarios';
      const data = await fetchApi(url);
      setUsuarios(data || []);
    } catch (err: any) {
      setError(err.message || 'Error al cargar usuarios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCatalogos();
  }, []);

  useEffect(() => {
    loadUsuarios();
  }, [filterActivo, filterPerfilId]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadUsuarios();
  };

  // Abrir modal de alta
  const handleOpenCreate = () => {
    setFormDataCreate({
      legajo: '',
      nombre: '',
      apellido: '',
      perfil_id: perfiles.length > 0 ? String(perfiles[0].id) : '',
      sectores: [],
      password_temporal: '',
    });
    setIsCreateModalOpen(true);
  };

  const handleSaveCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await fetchApi('/api/usuarios', {
        method: 'POST',
        body: JSON.stringify({
          legajo: formDataCreate.legajo,
          nombre: formDataCreate.nombre,
          apellido: formDataCreate.apellido ? formDataCreate.apellido : null,
          perfil_id: Number(formDataCreate.perfil_id),
          sectores: formDataCreate.sectores,
          password_temporal: formDataCreate.password_temporal,
        }),
      });
      setIsCreateModalOpen(false);
      setNotice('Usuario creado exitosamente');
      loadUsuarios();
    } catch (err: any) {
      setError(err.message || 'Error al crear usuario');
    }
  };

  // Abrir modal de edición
  const handleOpenEdit = (u: UsuarioListItem) => {
    setSelectedUser(u);
    setFormDataEdit({
      id: u.id,
      legajo: u.legajo,
      nombre: u.nombre,
      apellido: u.apellido || '',
      perfil_id: String(u.perfil.id),
      sectores: u.sectores.map((s) => s.id),
    });
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await fetchApi(`/api/usuarios/${formDataEdit.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nombre: formDataEdit.nombre,
          apellido: formDataEdit.apellido ? formDataEdit.apellido : null,
          perfil_id: Number(formDataEdit.perfil_id),
          sectores: formDataEdit.sectores,
        }),
      });
      setIsEditModalOpen(false);
      setNotice('Usuario actualizado exitosamente');
      loadUsuarios();
    } catch (err: any) {
      setError(err.message || 'Error al actualizar usuario');
    }
  };

  // Abrir modal desactivar / reactivar
  const handleOpenMotivo = (u: UsuarioListItem, accion: 'desactivar' | 'reactivar') => {
    setSelectedUser(u);
    setMotivoAccion(accion);
    setMotivoTexto('');
    setIsMotivoModalOpen(true);
  };

  const handleConfirmMotivo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setError('');
    try {
      const endpoint = `/api/usuarios/${selectedUser.id}/${motivoAccion}`;
      const res = await fetchApi(endpoint, {
        method: 'POST',
        body: JSON.stringify({ motivo: motivoTexto }),
      });

      setIsMotivoModalOpen(false);
      if (motivoAccion === 'desactivar' && res.intervenciones_abiertas_como_responsable > 0) {
        setNotice(
          `Usuario desactivado. Aviso: tiene ${res.intervenciones_abiertas_como_responsable} intervención(es) abierta(s) como responsable. Se sugiere reasignarlas.`
        );
      } else {
        setNotice(res.mensaje || `Usuario ${motivoAccion === 'desactivar' ? 'desactivado' : 'reactivado'} exitosamente`);
      }
      loadUsuarios();
    } catch (err: any) {
      setError(err.message || `Error al ${motivoAccion} usuario`);
    }
  };

  // Abrir modal restablecer contraseña
  const handleOpenResetPass = (u: UsuarioListItem) => {
    setSelectedUser(u);
    setPasswordTemporal('');
    setIsResetPassModalOpen(true);
  };

  const handleConfirmResetPass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setError('');
    try {
      await fetchApi(`/api/usuarios/${selectedUser.id}/restablecer-password`, {
        method: 'POST',
        body: JSON.stringify({ password_temporal: passwordTemporal }),
      });
      setIsResetPassModalOpen(false);
      setNotice('Contraseña restablecida exitosamente. El usuario deberá cambiarla en su próximo ingreso.');
      loadUsuarios();
    } catch (err: any) {
      setError(err.message || 'Error al restablecer contraseña');
    }
  };

  return (
    <div className="dev-container">
      <div className="dev-header-actions" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Gestión de Usuarios</h2>
        <button className="dev-btn" onClick={handleOpenCreate}>
          + Nuevo Usuario
        </button>
      </div>

      {notice && (
        <div style={{ background: '#dcfce7', color: '#166534', padding: '0.75rem 1rem', borderRadius: '0.375rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
          <span>{notice}</span>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold' }} onClick={() => setNotice('')}>×</button>
        </div>
      )}

      {error && (
        <div className="dev-error" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold' }} onClick={() => setError('')}>×</button>
        </div>
      )}

      {/* Barra de filtros */}
      <div className="dev-card" style={{ marginBottom: '1.5rem', padding: '1rem' }}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="dev-form-group" style={{ marginBottom: 0, flex: 1, minWidth: '200px' }}>
            <label style={{ fontSize: '0.8rem' }}>Buscar (legajo, nombre, apellido)</label>
            <input
              type="text"
              placeholder="Buscar..."
              value={filterTexto}
              onChange={(e) => setFilterTexto(e.target.value)}
            />
          </div>

          <div className="dev-form-group" style={{ marginBottom: 0, width: '150px' }}>
            <label style={{ fontSize: '0.8rem' }}>Estado</label>
            <select
              value={filterActivo}
              onChange={(e) => setFilterActivo(e.target.value as any)}
            >
              <option value="todos">Todos</option>
              <option value="true">Activos</option>
              <option value="false">Inactivos</option>
            </select>
          </div>

          <div className="dev-form-group" style={{ marginBottom: 0, width: '200px' }}>
            <label style={{ fontSize: '0.8rem' }}>Perfil</label>
            <select
              value={filterPerfilId}
              onChange={(e) => setFilterPerfilId(e.target.value)}
            >
              <option value="">Todos los perfiles</option>
              {perfiles.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </div>

          <button type="submit" className="dev-btn dev-btn-secondary" style={{ height: '38px' }}>
            Filtrar
          </button>
        </form>
      </div>

      {/* Listado */}
      <div className="dev-card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>Cargando usuarios...</div>
        ) : (
          <table className="dev-table">
            <thead>
              <tr>
                <th>Legajo</th>
                <th>Nombre Completo</th>
                <th>Perfil</th>
                <th>Sectores</th>
                <th>Estado</th>
                <th>Último Acceso</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                    No se encontraron usuarios
                  </td>
                </tr>
              ) : (
                usuarios.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{u.legajo}</td>
                    <td>{u.apellido ? `${u.apellido}, ${u.nombre}` : u.nombre}</td>
                    <td>
                      <span className="dev-badge" style={{ background: '#e0e7ff', color: '#3730a3' }}>
                        {u.perfil.nombre}
                      </span>
                    </td>
                    <td>
                      {u.sectores.length === 0 ? (
                        <span style={{ color: '#9ca3af', fontSize: '0.85rem' }}>-</span>
                      ) : (
                        u.sectores.map((s) => (
                          <span key={s.id} className="dev-badge" style={{ background: '#f3f4f6', marginRight: '0.25rem' }}>
                            {s.nombre}
                          </span>
                        ))
                      )}
                    </td>
                    <td>
                      <span className={`dev-badge ${u.activo ? 'dev-badge-active' : 'dev-badge-inactive'}`}>
                        {u.activo ? 'Activo' : 'Inactivo'}
                      </span>
                      {u.debe_cambiar_password && (
                        <span className="dev-badge" style={{ background: '#fef3c7', color: '#92400e', marginLeft: '0.25rem' }}>
                          Temporal
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                      {u.ultimo_acceso_en ? new Date(u.ultimo_acceso_en).toLocaleDateString() : 'Nunca'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                        <button className="dev-action-btn" onClick={() => handleOpenEdit(u)}>
                          Editar
                        </button>
                        <button className="dev-action-btn" onClick={() => handleOpenResetPass(u)}>
                          Clave
                        </button>
                        {u.activo ? (
                          <button
                            className="dev-action-btn"
                            style={{ color: '#dc2626' }}
                            onClick={() => handleOpenMotivo(u, 'desactivar')}
                          >
                            Desactivar
                          </button>
                        ) : (
                          <button
                            className="dev-action-btn"
                            style={{ color: '#16a34a' }}
                            onClick={() => handleOpenMotivo(u, 'reactivar')}
                          >
                            Reactivar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal Nuevo Usuario */}
      {isCreateModalOpen && (
        <div className="dev-modal">
          <div className="dev-modal-content" style={{ maxWidth: '520px', width: '100%' }}>
            <h3>Nuevo Usuario</h3>
            <form onSubmit={handleSaveCreate}>
              <div className="dev-form-group">
                <label>Legajo (único, 1-40 caracteres, sin espacios)</label>
                <input
                  type="text"
                  value={formDataCreate.legajo}
                  onChange={(e) => setFormDataCreate({ ...formDataCreate, legajo: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="dev-form-group" style={{ flex: 1 }}>
                  <label>Nombre</label>
                  <input
                    type="text"
                    value={formDataCreate.nombre}
                    onChange={(e) => setFormDataCreate({ ...formDataCreate, nombre: e.target.value })}
                    required
                  />
                </div>
                <div className="dev-form-group" style={{ flex: 1 }}>
                  <label>Apellido (opcional)</label>
                  <input
                    type="text"
                    value={formDataCreate.apellido}
                    onChange={(e) => setFormDataCreate({ ...formDataCreate, apellido: e.target.value })}
                  />
                </div>
              </div>

              <div className="dev-form-group">
                <label>Perfil</label>
                <select
                  value={formDataCreate.perfil_id}
                  onChange={(e) => setFormDataCreate({ ...formDataCreate, perfil_id: e.target.value })}
                  required
                >
                  {perfiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre} — {p.descripcion}</option>
                  ))}
                </select>
              </div>

              <div className="dev-form-group">
                <label>Sectores Autorizados</label>
                <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid #d1d5db', borderRadius: '0.375rem', padding: '0.5rem' }}>
                  {sectoresDisponibles.map((s) => (
                    <label key={s.id} style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={formDataCreate.sectores.includes(s.id)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setFormDataCreate({
                            ...formDataCreate,
                            sectores: checked
                              ? [...formDataCreate.sectores, s.id]
                              : formDataCreate.sectores.filter((id) => id !== s.id),
                          });
                        }}
                        style={{ marginRight: '0.5rem' }}
                      />
                      {s.nombre}
                    </label>
                  ))}
                </div>
              </div>

              <div className="dev-form-group">
                <label>Contraseña Temporal (mínimo 8 caracteres, distinta del legajo)</label>
                <input
                  type="password"
                  value={formDataCreate.password_temporal}
                  onChange={(e) => setFormDataCreate({ ...formDataCreate, password_temporal: e.target.value })}
                  required
                  minLength={8}
                />
              </div>

              <div className="dev-modal-actions">
                <button type="button" className="dev-btn dev-btn-secondary" onClick={() => setIsCreateModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="dev-btn">
                  Crear Usuario
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Editar Usuario */}
      {isEditModalOpen && selectedUser && (
        <div className="dev-modal">
          <div className="dev-modal-content" style={{ maxWidth: '520px', width: '100%' }}>
            <h3>Editar Usuario — Legajo: {formDataEdit.legajo}</h3>
            <form onSubmit={handleSaveEdit}>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="dev-form-group" style={{ flex: 1 }}>
                  <label>Nombre</label>
                  <input
                    type="text"
                    value={formDataEdit.nombre}
                    onChange={(e) => setFormDataEdit({ ...formDataEdit, nombre: e.target.value })}
                    required
                  />
                </div>
                <div className="dev-form-group" style={{ flex: 1 }}>
                  <label>Apellido</label>
                  <input
                    type="text"
                    value={formDataEdit.apellido}
                    onChange={(e) => setFormDataEdit({ ...formDataEdit, apellido: e.target.value })}
                  />
                </div>
              </div>

              <div className="dev-form-group">
                <label>Perfil</label>
                <select
                  value={formDataEdit.perfil_id}
                  onChange={(e) => setFormDataEdit({ ...formDataEdit, perfil_id: e.target.value })}
                  required
                >
                  {perfiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre} — {p.descripcion}</option>
                  ))}
                </select>
              </div>

              <div className="dev-form-group">
                <label>Sectores Autorizados</label>
                <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid #d1d5db', borderRadius: '0.375rem', padding: '0.5rem' }}>
                  {sectoresDisponibles.map((s) => (
                    <label key={s.id} style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={formDataEdit.sectores.includes(s.id)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setFormDataEdit({
                            ...formDataEdit,
                            sectores: checked
                              ? [...formDataEdit.sectores, s.id]
                              : formDataEdit.sectores.filter((id) => id !== s.id),
                          });
                        }}
                        style={{ marginRight: '0.5rem' }}
                      />
                      {s.nombre}
                    </label>
                  ))}
                </div>
              </div>

              <div className="dev-modal-actions">
                <button type="button" className="dev-btn dev-btn-secondary" onClick={() => setIsEditModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="dev-btn">
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Motivo (Desactivar / Reactivar) */}
      {isMotivoModalOpen && selectedUser && (
        <div className="dev-modal">
          <div className="dev-modal-content" style={{ maxWidth: '420px', width: '100%' }}>
            <h3>{motivoAccion === 'desactivar' ? 'Desactivar Usuario' : 'Reactivar Usuario'}</h3>
            <p style={{ fontSize: '0.875rem', color: '#4b5563' }}>
              Usuario: <strong>{selectedUser.nombre} ({selectedUser.legajo})</strong>
            </p>
            <form onSubmit={handleConfirmMotivo}>
              <div className="dev-form-group">
                <label>Motivo obligatorio (mínimo 5 caracteres)</label>
                <textarea
                  rows={3}
                  value={motivoTexto}
                  onChange={(e) => setMotivoTexto(e.target.value)}
                  required
                  minLength={5}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem' }}
                />
              </div>

              <div className="dev-modal-actions">
                <button type="button" className="dev-btn dev-btn-secondary" onClick={() => setIsMotivoModalOpen(false)}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="dev-btn"
                  style={{ background: motivoAccion === 'desactivar' ? '#dc2626' : undefined }}
                >
                  Confirmar {motivoAccion === 'desactivar' ? 'Desactivación' : 'Reactivación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Restablecer Contraseña */}
      {isResetPassModalOpen && selectedUser && (
        <div className="dev-modal">
          <div className="dev-modal-content" style={{ maxWidth: '420px', width: '100%' }}>
            <h3>Restablecer Contraseña</h3>
            <p style={{ fontSize: '0.875rem', color: '#4b5563' }}>
              Usuario: <strong>{selectedUser.nombre} ({selectedUser.legajo})</strong>
            </p>
            <form onSubmit={handleConfirmResetPass}>
              <div className="dev-form-group">
                <label>Contraseña Temporal (mínimo 8 caracteres, distinta del legajo)</label>
                <input
                  type="password"
                  value={passwordTemporal}
                  onChange={(e) => setPasswordTemporal(e.target.value)}
                  required
                  minLength={8}
                />
              </div>

              <div className="dev-modal-actions">
                <button type="button" className="dev-btn dev-btn-secondary" onClick={() => setIsResetPassModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="dev-btn">
                  Restablecer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

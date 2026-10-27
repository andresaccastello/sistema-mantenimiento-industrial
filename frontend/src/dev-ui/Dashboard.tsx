import { useState, useEffect } from 'react';
import { Sectores } from './Sectores';
import { Maquinas } from './Maquinas';
import { Intervenciones } from './Intervenciones';
import { Usuarios } from './Usuarios';
import { NotificacionesBell } from './NotificacionesBell';
import { CambiarPasswordModal } from './CambiarPasswordModal';
import { fetchApi } from './api';

interface DashboardProps {
  onLogout: () => void;
}

export function Dashboard({ onLogout }: DashboardProps) {
  const [currentView, setCurrentView] = useState<'intervenciones' | 'maquinas' | 'sectores' | 'usuarios'>('intervenciones');
  const [selectedIntervencionId, setSelectedIntervencionId] = useState<number | null>(null);
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [isChangePassOpen, setIsChangePassOpen] = useState(false);

  const loadMe = async () => {
    try {
      const data = await fetchApi('/api/auth/me');
      setCurrentUser(data);
    } catch (err) {
      console.error('Error al cargar /api/auth/me:', err);
    }
  };

  useEffect(() => {
    loadMe();
  }, []);

  const handleSelectIntervencion = (id: number) => {
    setSelectedIntervencionId(id);
    setCurrentView('intervenciones');
  };

  const puedeGestionarUsuarios = Boolean(currentUser?.permisos && 'USUARIOS_GESTIONAR' in currentUser.permisos);

  return (
    <div className="dev-layout">
      <aside className="dev-sidebar">
        <h2>SMI - Dev UI</h2>
        
        <nav className="dev-nav">
          <button 
            className={currentView === 'intervenciones' ? 'active' : ''} 
            onClick={() => {
              setSelectedIntervencionId(null);
              setCurrentView('intervenciones');
            }}
          >
            Intervenciones / Fallas
          </button>
          <button 
            className={currentView === 'maquinas' ? 'active' : ''} 
            onClick={() => setCurrentView('maquinas')}
          >
            Máquinas
          </button>
          <button 
            className={currentView === 'sectores' ? 'active' : ''} 
            onClick={() => setCurrentView('sectores')}
          >
            Sectores
          </button>
          
          {puedeGestionarUsuarios && (
            <button
              className={currentView === 'usuarios' ? 'active' : ''}
              onClick={() => setCurrentView('usuarios')}
            >
              Usuarios
            </button>
          )}

          <button className="dev-logout" onClick={onLogout}>
            Cerrar Sesión
          </button>
        </nav>
      </aside>
      
      <div className="dev-content-wrapper">
        <header className="dev-header">
          <div className="dev-header-title">
            <span>
              {currentView === 'intervenciones' && 'Intervenciones y Registro de Fallas'}
              {currentView === 'maquinas' && 'Catálogo de Máquinas y Estado'}
              {currentView === 'sectores' && 'Sectores de Planta'}
              {currentView === 'usuarios' && 'Administración de Usuarios y Perfiles'}
            </span>
          </div>
          <div className="dev-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {currentUser && (
              <span style={{ fontSize: '0.875rem', color: '#4b5563' }}>
                {currentUser.nombre} ({currentUser.perfil?.nombre})
              </span>
            )}
            <button
              className="dev-btn dev-btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
              onClick={() => setIsChangePassOpen(true)}
            >
              Cambiar mi contraseña
            </button>
            <NotificacionesBell onSelectIntervencion={handleSelectIntervencion} />
          </div>
        </header>

        <main className="dev-main">
          {currentView === 'intervenciones' && (
            <Intervenciones initialIntervencionId={selectedIntervencionId} />
          )}
          {currentView === 'sectores' && <Sectores />}
          {currentView === 'maquinas' && <Maquinas />}
          {currentView === 'usuarios' && <Usuarios />}
        </main>
      </div>

      {isChangePassOpen && (
        <CambiarPasswordModal
          onSuccess={() => {
            setIsChangePassOpen(false);
            loadMe();
          }}
          onCancel={() => setIsChangePassOpen(false)}
        />
      )}
    </div>
  );
}

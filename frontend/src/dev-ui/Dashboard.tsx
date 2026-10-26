import { useState } from 'react';
import { Sectores } from './Sectores';
import { Maquinas } from './Maquinas';
import { Intervenciones } from './Intervenciones';
import { NotificacionesBell } from './NotificacionesBell';

interface DashboardProps {
  onLogout: () => void;
}

export function Dashboard({ onLogout }: DashboardProps) {
  const [currentView, setCurrentView] = useState<'intervenciones' | 'maquinas' | 'sectores'>('intervenciones');
  const [selectedIntervencionId, setSelectedIntervencionId] = useState<number | null>(null);

  const handleSelectIntervencion = (id: number) => {
    setSelectedIntervencionId(id);
    setCurrentView('intervenciones');
  };

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
            </span>
          </div>
          <div className="dev-header-actions">
            <NotificacionesBell onSelectIntervencion={handleSelectIntervencion} />
          </div>
        </header>

        <main className="dev-main">
          {currentView === 'intervenciones' && (
            <Intervenciones initialIntervencionId={selectedIntervencionId} />
          )}
          {currentView === 'sectores' && <Sectores />}
          {currentView === 'maquinas' && <Maquinas />}
        </main>
      </div>
    </div>
  );
}


import { useState } from 'react';
import { Sectores } from './Sectores';
import { Maquinas } from './Maquinas';
import { Intervenciones } from './Intervenciones';

interface DashboardProps {
  onLogout: () => void;
}

export function Dashboard({ onLogout }: DashboardProps) {
  const [currentView, setCurrentView] = useState<'intervenciones' | 'maquinas' | 'sectores'>('intervenciones');

  return (
    <div className="dev-layout">
      <aside className="dev-sidebar">
        <h2>SMI - Dev UI</h2>
        
        <nav className="dev-nav">
          <button 
            className={currentView === 'intervenciones' ? 'active' : ''} 
            onClick={() => setCurrentView('intervenciones')}
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
      
      <main className="dev-main">
        {currentView === 'intervenciones' && <Intervenciones />}
        {currentView === 'sectores' && <Sectores />}
        {currentView === 'maquinas' && <Maquinas />}
      </main>
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import { fetchApi } from './api';

export interface NotificacionItem {
  id: number;
  tipo_evento: string;
  prioridad: 'ALTA' | 'NORMAL';
  titulo: string;
  mensaje: string;
  intervencion_id: number | null;
  maquina_id: number | null;
  creada_en: string;
  leida: boolean;
  leida_en: string | null;
}

interface NotificacionesBellProps {
  onSelectIntervencion: (intervencionId: number) => void;
}

export function NotificacionesBell({ onSelectIntervencion }: NotificacionesBellProps) {
  const [contador, setContador] = useState<{ no_leidas: number; no_leidas_alta: number }>({
    no_leidas: 0,
    no_leidas_alta: 0,
  });
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notificaciones, setNotificaciones] = useState<NotificacionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadContador = async () => {
    try {
      const data = await fetchApi('/api/notificaciones/contador');
      if (data && typeof data.no_leidas === 'number') {
        setContador(data);
      }
    } catch (err) {
      console.error('Error al cargar contador de notificaciones:', err);
    }
  };

  const loadNotificaciones = async () => {
    setLoading(true);
    try {
      const data = await fetchApi('/api/notificaciones?limite=50');
      if (Array.isArray(data)) {
        setNotificaciones(data);
      }
    } catch (err) {
      console.error('Error al cargar notificaciones:', err);
    } finally {
      setLoading(false);
    }
  };

  // Polling de 30s mientras la pestaña está visible
  useEffect(() => {
    loadContador();

    const interval = setInterval(() => {
      if (!document.hidden) {
        loadContador();
      }
    }, 30000);

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadContador();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Cerrar dropdown al hacer clic afuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [dropdownOpen]);

  const toggleDropdown = () => {
    if (!dropdownOpen) {
      loadNotificaciones();
      loadContador();
    }
    setDropdownOpen((prev) => !prev);
  };

  const handleMarcarTodasLeidas = async () => {
    try {
      await fetchApi('/api/notificaciones/leer-todas', { method: 'POST' });
      setNotificaciones((prev) =>
        prev.map((n) => ({ ...n, leida: true, leida_en: new Date().toISOString() }))
      );
      setContador({ no_leidas: 0, no_leidas_alta: 0 });
    } catch (err) {
      console.error('Error al marcar todas como leídas:', err);
    }
  };

  const handleItemClick = async (item: NotificacionItem) => {
    if (!item.leida) {
      try {
        await fetchApi(`/api/notificaciones/${item.id}/leer`, { method: 'POST' });
        setNotificaciones((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, leida: true, leida_en: new Date().toISOString() } : n))
        );
        setContador((prev) => ({
          no_leidas: Math.max(0, prev.no_leidas - 1),
          no_leidas_alta: item.prioridad === 'ALTA' ? Math.max(0, prev.no_leidas_alta - 1) : prev.no_leidas_alta,
        }));
      } catch (err) {
        console.error('Error al marcar notificación como leída:', err);
      }
    }

    setDropdownOpen(false);

    if (item.intervencion_id) {
      onSelectIntervencion(item.intervencion_id);
    }
  };

  return (
    <div className="notificaciones-container" ref={dropdownRef}>
      <button
        type="button"
        className={`notificaciones-bell-btn ${contador.no_leidas_alta > 0 ? 'bell-alta' : ''}`}
        onClick={toggleDropdown}
        title="Notificaciones"
        aria-label="Notificaciones"
      >
        <span className="bell-icon">🔔</span>
        {contador.no_leidas > 0 && (
          <span className={`notificaciones-badge ${contador.no_leidas_alta > 0 ? 'badge-alta' : ''}`}>
            {contador.no_leidas > 99 ? '99+' : contador.no_leidas}
          </span>
        )}
      </button>

      {dropdownOpen && (
        <div className="notificaciones-dropdown">
          <div className="notificaciones-dropdown-header">
            <h4>Notificaciones</h4>
            {contador.no_leidas > 0 && (
              <button
                type="button"
                className="btn-marcar-todas"
                onClick={handleMarcarTodasLeidas}
              >
                Marcar todas como leídas
              </button>
            )}
          </div>

          <div className="notificaciones-dropdown-body">
            {loading ? (
              <div className="notificaciones-empty">Cargando...</div>
            ) : notificaciones.length === 0 ? (
              <div className="notificaciones-empty">No hay notificaciones</div>
            ) : (
              notificaciones.map((item) => (
                <div
                  key={item.id}
                  className={`notificacion-item ${!item.leida ? 'notificacion-no-leida' : ''} ${
                    item.prioridad === 'ALTA' ? 'notificacion-prioridad-alta' : ''
                  }`}
                  onClick={() => handleItemClick(item)}
                >
                  <div className="notificacion-item-header">
                    <span className="notificacion-titulo">{item.titulo}</span>
                    {item.prioridad === 'ALTA' && (
                      <span className="notificacion-tag-alta">ALTA</span>
                    )}
                  </div>
                  <p className="notificacion-mensaje">{item.mensaje}</p>
                  <div className="notificacion-item-footer">
                    <span className="notificacion-fecha">
                      {new Date(item.creada_en).toLocaleString('es-AR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                    {!item.leida && <span className="notificacion-punto-no-leida">●</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

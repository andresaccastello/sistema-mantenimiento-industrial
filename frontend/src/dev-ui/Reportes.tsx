import React, { useState, useEffect } from 'react';
import { fetchApi } from './api';

export function Reportes() {
  // Selector de fechas: últimos 30 días por defecto
  const now = new Date();
  const past30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [desde, setDesde] = useState<string>(past30d.toISOString().slice(0, 16));
  const [hasta, setHasta] = useState<string>(now.toISOString().slice(0, 16));

  const [ranking, setRanking] = useState<any[]>([]);
  const [tiempos, setTiempos] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const cargarReportes = async () => {
    setLoading(true);
    setError(null);
    try {
      const desdeISO = new Date(desde).toISOString();
      const hastaISO = new Date(hasta).toISOString();

      const [dataRanking, dataTiempos] = await Promise.all([
        fetchApi(`/api/reportes/inactividad?desde=${encodeURIComponent(desdeISO)}&hasta=${encodeURIComponent(hastaISO)}`),
        fetchApi(`/api/reportes/tiempos?desde=${encodeURIComponent(desdeISO)}&hasta=${encodeURIComponent(hastaISO)}&agrupar=ejecucion`),
      ]);

      setRanking(dataRanking);
      setTiempos(dataTiempos);
    } catch (err: any) {
      setError(err.message || 'Error al cargar reportes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarReportes();
  }, []);

  const formatMin = (m: number | null | undefined) => {
    if (m === null || m === undefined) return '—';
    const h = Math.floor(m / 60);
    const min = m % 60;
    return h > 0 ? `${h} h ${min} min` : `${min} min`;
  };

  return (
    <div style={{ padding: '1rem' }}>
      <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem 0', color: '#1e293b' }}>Filtro de Período para Reportes</h3>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#475569', marginBottom: '0.25rem' }}>
              Desde
            </label>
            <input
              type="datetime-local"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              style={{ padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: '4px' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#475569', marginBottom: '0.25rem' }}>
              Hasta
            </label>
            <input
              type="datetime-local"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              style={{ padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: '4px' }}
            />
          </div>
          <button
            className="dev-btn"
            onClick={cargarReportes}
            disabled={loading}
            style={{ padding: '0.5rem 1rem' }}
          >
            {loading ? 'Consultando...' : '🔍 Actualizar Reportes'}
          </button>
        </div>
        {error && (
          <div style={{ marginTop: '0.75rem', color: '#b91c1c', fontSize: '0.9rem' }}>
            ⚠️ {error}
          </div>
        )}
      </div>

      {/* 1. Ranking de inactividad por máquina */}
      <div style={{ marginBottom: '2rem' }}>
        <h3 style={{ color: '#0f172a', marginBottom: '0.75rem' }}>
          📊 Ranking de Tiempo de Inactividad por Máquina (Tesis 4.8)
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="dev-table" style={{ width: '100%', background: 'white' }}>
            <thead>
              <tr>
                <th>Máquina</th>
                <th>Código</th>
                <th>Sector</th>
                <th style={{ textAlign: 'right' }}>Inactividad Total</th>
                <th style={{ textAlign: 'right' }}>Correctivo</th>
                <th style={{ textAlign: 'right' }}>Preventivo</th>
                <th style={{ textAlign: 'center' }}>Intervenciones con Detención</th>
              </tr>
            </thead>
            <tbody>
              {ranking.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '1rem', color: '#64748b' }}>
                    No se encontraron máquinas activas para el período seleccionado.
                  </td>
                </tr>
              ) : (
                ranking.map((r, idx) => (
                  <tr key={r.maquina.id}>
                    <td>
                      <strong>#{idx + 1}</strong> {r.maquina.nombre}
                    </td>
                    <td>{r.maquina.codigo || '—'}</td>
                    <td>{r.maquina.sector.nombre}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: r.inactividad_minutos > 0 ? '#b91c1c' : '#15803d' }}>
                      {formatMin(r.inactividad_minutos)}
                    </td>
                    <td style={{ textAlign: 'right', color: '#b45309' }}>
                      {formatMin(r.por_tipo.CORRECTIVO)}
                    </td>
                    <td style={{ textAlign: 'right', color: '#4338ca' }}>
                      {formatMin(r.por_tipo.PREVENTIVO)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {r.intervenciones_con_detencion}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. Tiempos agrupados por ejecución */}
      <div>
        <h3 style={{ color: '#0f172a', marginBottom: '0.75rem' }}>
          ⏱️ Tiempos de Intervenciones por Ejecución (Planilla Anexo A.1)
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="dev-table" style={{ width: '100%', background: 'white' }}>
            <thead>
              <tr>
                <th>Tipo de Ejecución</th>
                <th style={{ textAlign: 'center' }}>Cantidad Finalizadas</th>
                <th style={{ textAlign: 'right' }}>Espera Promedio</th>
                <th style={{ textAlign: 'right' }}>Duración Bruta Promedio</th>
                <th style={{ textAlign: 'right' }}>Duración Neta Promedio</th>
                <th style={{ textAlign: 'right' }}>Duración Bruta Total</th>
                <th style={{ textAlign: 'right' }}>Duración Neta Total</th>
              </tr>
            </thead>
            <tbody>
              {tiempos.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '1rem', color: '#64748b' }}>
                    No hay intervenciones finalizadas registradas en el período.
                  </td>
                </tr>
              ) : (
                tiempos.map((t) => (
                  <tr key={t.grupo}>
                    <td>
                      <span className={`badge badge-${t.grupo === 'INTERNA' ? 'info' : 'warning'}`}>
                        {t.grupo}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 600 }}>{t.cantidad}</td>
                    <td style={{ textAlign: 'right' }}>{formatMin(t.espera_promedio_minutos)}</td>
                    <td style={{ textAlign: 'right' }}>{formatMin(t.duracion_bruta_promedio_minutos)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: '#1e40af' }}>{formatMin(t.duracion_neta_promedio_minutos)}</td>
                    <td style={{ textAlign: 'right' }}>{formatMin(t.duracion_bruta_total_minutos)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMin(t.duracion_neta_total_minutos)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

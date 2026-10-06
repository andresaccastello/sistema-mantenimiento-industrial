import { useState } from 'react';

type HealthState = 'idle' | 'loading' | 'ok' | 'error';

export default function App() {
  const [health, setHealth] = useState<HealthState>('idle');

  const checkApi = async () => {
    const apiUrl = import.meta.env.VITE_API_URL;

    if (!apiUrl) {
      setHealth('error');
      return;
    }

    setHealth('loading');

    try {
      const response = await fetch(`${apiUrl}/health`);

      if (!response.ok) {
        throw new Error('API unavailable');
      }

      setHealth('ok');
    } catch {
      setHealth('error');
    }
  };

  return (
    <main className="page">
      <section className="card">
        <p className="eyebrow">GI-RE S.A.</p>
        <h1>Sistema de Mantenimiento Industrial</h1>
        <p>
          Base técnica inicial: React + Node.js + Neon Functions + PostgreSQL.
        </p>

        <button type="button" onClick={checkApi} disabled={health === 'loading'}>
          {health === 'loading' ? 'Comprobando...' : 'Probar conexión con API'}
        </button>

        {health === 'ok' && <p className="status">API conectada correctamente.</p>}
        {health === 'error' && (
          <p className="status">
            No se pudo conectar. Revisá VITE_API_URL y el despliegue de la API.
          </p>
        )}
      </section>
    </main>
  );
}

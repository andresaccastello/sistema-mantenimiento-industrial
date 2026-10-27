import { useState } from 'react';
import { fetchApi } from './api';

interface AuthProps {
  onLogin: (token: string, debeCambiarPassword: boolean) => void;
}

export function Auth({ onLogin }: AuthProps) {
  const [legajo, setLegajo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await fetchApi('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ legajo, password })
      });
      
      if (data.token) {
        onLogin(data.token, Boolean(data.debe_cambiar_password));
      } else {
        setError('Respuesta inválida del servidor');
      }
    } catch (err: any) {
      setError(err.message || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dev-auth-container">
      <div className="dev-card" style={{ width: '400px' }}>
        <h2>Dev UI - Login</h2>
        <p style={{ color: '#6b7280', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          Ingresá con tu legajo y contraseña (ej: admin/admin)
        </p>
        
        <form onSubmit={handleSubmit}>
          <div className="dev-form-group">
            <label>Legajo</label>
            <input 
              type="text" 
              value={legajo} 
              onChange={e => setLegajo(e.target.value)} 
              required 
            />
          </div>
          
          <div className="dev-form-group">
            <label>Contraseña</label>
            <input 
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              required 
            />
          </div>
          
          {error && <div className="dev-error">{error}</div>}
          
          <button type="submit" className="dev-btn" style={{ width: '100%', marginTop: '1rem' }} disabled={loading}>
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}

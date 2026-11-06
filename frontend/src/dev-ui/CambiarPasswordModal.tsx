import { useState } from 'react';
import { fetchApi } from './api';

interface CambiarPasswordModalProps {
  isMandatory?: boolean;
  onSuccess: (newToken: string) => void;
  onCancel?: () => void;
}

export function CambiarPasswordModal({ isMandatory, onSuccess, onCancel }: CambiarPasswordModalProps) {
  const [passwordActual, setPasswordActual] = useState('');
  const [passwordNueva, setPasswordNueva] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (passwordNueva !== passwordConfirm) {
      setError('La confirmación de la contraseña no coincide');
      return;
    }

    if (passwordNueva.length < 8) {
      setError('La nueva contraseña debe tener al menos 8 caracteres');
      return;
    }

    setLoading(true);
    try {
      const data = await fetchApi('/api/auth/cambiar-password', {
        method: 'POST',
        body: JSON.stringify({
          password_actual: passwordActual,
          password_nueva: passwordNueva,
        }),
      });

      if (data.token) {
        onSuccess(data.token);
      }
    } catch (err: any) {
      setError(err.message || 'Error al cambiar la contraseña');
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <div className="dev-modal-content" style={{ maxWidth: '420px', width: '100%' }}>
      <h3>{isMandatory ? 'Cambio Obligatorio de Contraseña' : 'Cambiar Mi Contraseña'}</h3>
      {isMandatory && (
        <p style={{ color: '#b45309', background: '#fef3c7', padding: '0.75rem', borderRadius: '0.375rem', fontSize: '0.875rem' }}>
          Debe actualizar su contraseña temporal para poder ingresar y utilizar el sistema.
        </p>
      )}

      {error && <div className="dev-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="dev-form-group">
          <label>Contraseña Actual</label>
          <input
            type="password"
            value={passwordActual}
            onChange={(e) => setPasswordActual(e.target.value)}
            required
          />
        </div>

        <div className="dev-form-group">
          <label>Nueva Contraseña (mínimo 8 caracteres, distinta del legajo)</label>
          <input
            type="password"
            value={passwordNueva}
            onChange={(e) => setPasswordNueva(e.target.value)}
            required
            minLength={8}
          />
        </div>

        <div className="dev-form-group">
          <label>Confirmar Nueva Contraseña</label>
          <input
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            required
            minLength={8}
          />
        </div>

        <div className="dev-modal-actions" style={{ marginTop: '1.5rem' }}>
          {!isMandatory && onCancel && (
            <button type="button" className="dev-btn dev-btn-secondary" onClick={onCancel} disabled={loading}>
              Cancelar
            </button>
          )}
          <button type="submit" className="dev-btn" disabled={loading}>
            {loading ? 'Cambiando...' : 'Guardar Contraseña'}
          </button>
        </div>
      </form>
    </div>
  );

  if (isMandatory) {
    return (
      <div className="dev-auth-container">
        <div className="dev-card" style={{ width: '420px' }}>
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="dev-modal">
      {content}
    </div>
  );
}

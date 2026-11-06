import { useState } from 'react';
import { Auth } from './Auth';
import { Dashboard } from './Dashboard';
import { CambiarPasswordModal } from './CambiarPasswordModal';
import { setAuthToken } from './api';
import './dev-ui.css';

export function DevApp() {
  const [token, setToken] = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const handleLogin = (newToken: string, debeCambiarPassword: boolean) => {
    setAuthToken(newToken);
    setToken(newToken);
    setMustChangePassword(debeCambiarPassword);
  };

  const handleLogout = () => {
    setAuthToken(null);
    setToken(null);
    setMustChangePassword(false);
  };

  const handlePasswordChanged = (newToken: string) => {
    setAuthToken(newToken);
    setToken(newToken);
    setMustChangePassword(false);
  };

  if (!token) {
    return <Auth onLogin={handleLogin} />;
  }

  if (mustChangePassword) {
    return <CambiarPasswordModal isMandatory onSuccess={handlePasswordChanged} />;
  }

  return <Dashboard onLogout={handleLogout} />;
}

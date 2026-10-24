import { useState } from 'react';
import { Auth } from './Auth';
import { Dashboard } from './Dashboard';
import { setAuthToken } from './api';
import './dev-ui.css';

export function DevApp() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const handleLogin = (token: string) => {
    setAuthToken(token);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    setAuthToken(null);
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return <Auth onLogin={handleLogin} />;
  }

  return <Dashboard onLogout={handleLogout} />;
}

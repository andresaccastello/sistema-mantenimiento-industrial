let memoryToken: string | null = null;

export function setAuthToken(token: string | null) {
  memoryToken = token;
}

export function getAuthToken() {
  return memoryToken;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export async function fetchApi(path: string, options: RequestInit = {}) {
  const token = getAuthToken();
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && (!options.body || typeof options.body === 'string')) {
     headers.set('Content-Type', 'application/json');
  }
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `Error HTTP ${response.status}: ${response.statusText}`);
  }

  // Si es 204 No Content, no intentamos parsear JSON
  if (response.status === 204) {
    return null;
  }

  return response.json();
}

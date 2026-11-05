import { ApiError, reaccionError } from '../lib/errores';
import { obtenerToken, eliminarToken } from '../auth/sesion';
import type { ListaResultado } from './tipos';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3000';

type ReaccionCallback = (reaccion: 'cerrar_sesion' | 'cambiar_password') => void;
let reaccionListener: ReaccionCallback | null = null;

export function registrarReaccionAuth(callback: ReaccionCallback | null) {
  reaccionListener = callback;
}

export interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined | null>;
}

interface ExecuteResponse<T> {
  data: T;
  response: Response;
}

async function executeRequest<T>(path: string, options: RequestOptions = {}): Promise<ExecuteResponse<T>> {
  const url = new URL(path.startsWith('http') ? path : `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`);

  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers = new Headers(options.headers || {});

  const token = obtenerToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const hasBody = options.body !== undefined && options.body !== null;
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (hasBody && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      ...options,
      headers,
    });
  } catch (_err) {
    throw new ApiError(0, 'SIN_CONEXION', 'No se pudo conectar con el servidor.');
  }

  if (!response.ok) {
    let errorData: any = null;
    try {
      errorData = await response.json();
    } catch {
      errorData = { error: response.statusText };
    }

    const codigo = errorData?.codigo || (response.status === 401 ? 'NO_AUTENTICADO' : 'ERROR_INTERNO');
    const mensaje = errorData?.error || errorData?.mensaje || response.statusText;
    const motivos = errorData?.motivos;

    const apiError = new ApiError(response.status, codigo, mensaje, motivos, errorData);

    const reaccion = reaccionError(apiError);
    if (reaccion === 'cerrar_sesion') {
      eliminarToken();
      if (reaccionListener) {
        reaccionListener('cerrar_sesion');
      } else if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:cerrar_sesion'));
      }
    } else if (reaccion === 'cambiar_password') {
      if (reaccionListener) {
        reaccionListener('cambiar_password');
      } else if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:cambiar_password'));
      }
    }

    throw apiError;
  }

  let data: T;
  if (response.status === 204) {
    data = {} as T;
  } else {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = (await response.json()) as T;
    } else {
      data = (await response.text()) as unknown as T;
    }
  }

  return { data, response };
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { data } = await executeRequest<T>(path, options);
  return data;
}

export const clienteApi = {
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>(path, { ...options, method: 'GET' });
  },

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>(path, {
      ...options,
      method: 'POST',
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
  },

  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>(path, {
      ...options,
      method: 'PATCH',
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
  },

  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>(path, {
      ...options,
      method: 'PUT',
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
  },

  delete<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>(path, {
      ...options,
      method: 'DELETE',
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
  },

  async listar<T>(path: string, options?: RequestOptions): Promise<ListaResultado<T>> {
    const { data, response } = await executeRequest<any>(path, { ...options, method: 'GET' });
    const totalHeader = response.headers.get('X-Total-Count') || response.headers.get('x-total-count');
    const items: T[] = Array.isArray(data) ? data : data?.items || [];
    const total = totalHeader ? Number(totalHeader) : (data?.total ?? items.length);
    return { items, total };
  },
};

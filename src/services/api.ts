import type { LoginResponse } from '../types/auth';
import type { Formular, OffenesFormular } from '../types/sharepoint';

/**
 * Base URL for the backend API.
 * In dev this points to the local Azure Functions host;
 * in production it's a relative "/api" path on the same origin
 * (rewrite/proxy handled by host).
 */
const API_BASE =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '/api';

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {}
): Promise<T> {
  const { token, headers, ...rest } = options;

  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status);
  }

  return (await res.json()) as T;
}

/** POST /api/login — authenticate driver with username + PIN */
export async function login(benutzername: string, pin: string): Promise<LoginResponse> {
  return request<LoginResponse>('/login', {
    method: 'POST',
    body: JSON.stringify({ benutzername, pin }),
  });
}

/** GET /api/formulare — fetch forms assigned to the current driver */
export async function fetchFormulare(token: string): Promise<Formular[]> {
  return request<Formular[]>('/formulare', { token });
}

/** GET /api/offene — fetch open forms for the current driver */
export async function fetchOffeneFormulare(token: string): Promise<OffenesFormular[]> {
  return request<OffenesFormular[]>('/offene', { token });
}

export { ApiError };

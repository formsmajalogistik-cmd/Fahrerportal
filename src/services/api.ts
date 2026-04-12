import type { LoginResponse } from '../types/auth';
import type { Formular, OffenesFormular } from '../types/sharepoint';

/**
 * Base URL for the backend API.
 * On Vercel the functions live under /api on the same origin,
 * so the default relative base is fine. Override with VITE_API_BASE_URL
 * during local development if needed.
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

/** GET /api/offene — fetch open form instances of the current driver */
export async function fetchOffeneFormulare(
  token: string,
  status: 'Offen' | 'Abgeschlossen' = 'Offen'
): Promise<OffenesFormular[]> {
  return request<OffenesFormular[]>(
    `/offene?status=${encodeURIComponent(status)}`,
    { token }
  );
}

/** POST /api/offene — create a new open form entry when a driver starts filling one out */
export async function createOffenesFormular(
  token: string,
  payload: { formularname: string; fahrzeug: string; filloutSubmissionId: string }
): Promise<OffenesFormular> {
  return request<OffenesFormular>('/offene', {
    token,
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** PATCH /api/offene?id=<id> — update status of an open form entry */
export async function updateOffenesFormularStatus(
  token: string,
  id: number,
  status: 'Offen' | 'Abgeschlossen'
): Promise<OffenesFormular> {
  return request<OffenesFormular>(`/offene?id=${encodeURIComponent(id)}`, {
    token,
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export { ApiError };

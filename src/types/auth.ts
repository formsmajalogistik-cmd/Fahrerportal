/** Authenticated driver info returned from /api/login */
export interface AuthUser {
  id: number;
  benutzername: string;
  name: string;
  vorname: string;
}

/** Login response from /api/login */
export interface LoginResponse {
  token: string;
  user: AuthUser;
}

/** Stored auth state (persisted in sessionStorage) */
export interface StoredAuth {
  token: string;
  user: AuthUser;
}

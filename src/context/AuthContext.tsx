import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { AuthUser, StoredAuth } from '../types/auth';

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const STORAGE_KEY = 'fahrerportal.auth';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function loadStoredAuth(): StoredAuth | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [stored, setStored] = useState<StoredAuth | null>(() => loadStoredAuth());

  const login = useCallback((token: string, user: AuthUser) => {
    const next: StoredAuth = { token, user };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setStored(next);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setStored(null);
  }, []);

  const value: AuthContextValue = {
    user: stored?.user ?? null,
    token: stored?.token ?? null,
    isAuthenticated: Boolean(stored?.token),
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

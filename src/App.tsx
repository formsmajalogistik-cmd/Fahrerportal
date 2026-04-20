import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Spinner } from './components/Spinner';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { PasswordResetPage } from './pages/PasswordResetPage';
import { PasswordNewPage } from './pages/PasswordNewPage';
import { FahrerDashboard } from './pages/FahrerDashboard';
import { OffeneFormularePage } from './pages/OffeneFormularePage';

export default function App() {
  const { status, profile } = useAuth();

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-maja-light">
        <Spinner label="Sitzung wird geprüft …" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/passwort-reset" element={<PasswordResetPage />} />
        <Route path="/passwort-neu" element={<PasswordNewPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Admin-Nutzer werden im Fahrerportal abgewiesen — sie arbeiten im Dashboard.
  if (profile?.role === 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-maja-light px-6">
        <div className="card max-w-md p-6 text-center">
          <h2 className="mb-2 text-lg font-semibold text-maja-navy">Admin-Konto erkannt</h2>
          <p className="text-sm text-maja-muted">
            Dieses Portal ist für Fahrer gedacht. Nutze bitte das Maja-Logistik-Dashboard.
          </p>
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<FahrerDashboard />} />
        <Route path="/offen" element={<OffeneFormularePage />} />
        <Route path="/passwort-neu" element={<PasswordNewPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

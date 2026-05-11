import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Spinner } from './components/Spinner';
import { AppShell } from './components/AppShell';
import { AdminShell } from './components/AdminShell';
import { LoginPage } from './pages/LoginPage';
import { PasswordResetPage } from './pages/PasswordResetPage';
import { PasswordNewPage } from './pages/PasswordNewPage';
import { FahrerDashboard } from './pages/FahrerDashboard';
import { FormularPage } from './pages/FormularPage';
import { ProfilPage } from './pages/ProfilPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { FahrerListPage } from './pages/admin/FahrerListPage';
import { AuftraggeberListPage } from './pages/admin/AuftraggeberListPage';
import { PreislistePage } from './pages/admin/PreislistePage';
import { TemplatesListPage } from './pages/admin/TemplatesListPage';
import { TemplateEditorPage } from './pages/admin/TemplateEditorPage';
import { ZuweisungenPage } from './pages/admin/ZuweisungenPage';
import { EingaengePage } from './pages/admin/EingaengePage'; // wird auch in Fahrer-Routen genutzt
import { TourenlistePage } from './pages/TourenlistePage';
import { GreimelZugaengePage } from './pages/GreimelZugaengePage';

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

  if (profile?.role === 'admin') {
    return (
      <AdminShell>
        <Routes>
          <Route path="/" element={<AdminDashboard />} />
          <Route path="/meine-formulare" element={<FahrerDashboard />} />
          {/* Alias auf /meine-formulare — alte Bookmark-URLs umleiten. */}
          <Route path="/meine-drafts" element={<Navigate to="/meine-formulare" replace />} />
          <Route path="/fahrer" element={<FahrerListPage />} />
          <Route path="/auftraggeber" element={<AuftraggeberListPage />} />
          <Route path="/preisliste" element={<PreislistePage />} />
          <Route path="/templates" element={<TemplatesListPage />} />
          <Route path="/templates/:id" element={<TemplateEditorPage />} />
          <Route path="/zuweisungen" element={<ZuweisungenPage />} />
          <Route path="/eingaenge" element={<EingaengePage />} />
          <Route path="/touren" element={<TourenlistePage />} />
          <Route path="/greimel-zugaenge" element={<GreimelZugaengePage />} />
          <Route path="/formular/:id" element={<FormularPage />} />
          <Route path="/profil" element={<ProfilPage />} />
          <Route path="/passwort-neu" element={<PasswordNewPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AdminShell>
    );
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<FahrerDashboard />} />
        {/* Alias auf / — alte Bookmark-URLs umleiten. */}
        <Route path="/offen" element={<Navigate to="/" replace />} />
        <Route path="/eingaenge" element={<EingaengePage />} />
        <Route path="/touren" element={<TourenlistePage />} />
        <Route path="/greimel-zugaenge" element={<GreimelZugaengePage />} />
        <Route path="/formular/:id" element={<FormularPage />} />
        <Route path="/profil" element={<ProfilPage />} />
        <Route path="/passwort-neu" element={<PasswordNewPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

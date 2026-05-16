import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { useFahrerContext } from './auth/FahrerContext';
import { Spinner } from './components/Spinner';
import { AppShell } from './components/AppShell';
import { AdminShell } from './components/AdminShell';
import { LoginPage } from './pages/LoginPage';
import { PasswordResetPage } from './pages/PasswordResetPage';
import { PasswordNewPage } from './pages/PasswordNewPage';
import { FahrerDashboard } from './pages/FahrerDashboard';
import { FormularPage } from './pages/FormularPage';
import { ProfilPage } from './pages/ProfilPage';
import { KontoAuswahlPage } from './pages/KontoAuswahlPage';
import { MeineUnterkontenPage } from './pages/MeineUnterkontenPage';
import { FahrerListPage } from './pages/admin/FahrerListPage';
import { AuftraggeberListPage } from './pages/admin/AuftraggeberListPage';
import { PreislistePage } from './pages/admin/PreislistePage';
import { EinstellungenPage } from './pages/admin/EinstellungenPage';
import { TemplatesListPage } from './pages/admin/TemplatesListPage';
import { TemplateEditorPage } from './pages/admin/TemplateEditorPage';
import { EingaengePage } from './pages/admin/EingaengePage';
import { BelegePage } from './pages/admin/BelegePage';
import { AufstellungPage } from './pages/admin/AufstellungPage';
import { TourenlistePage } from './pages/TourenlistePage';
import { GreimelZugaengePage } from './pages/GreimelZugaengePage';

export default function App() {
  const { status, profile } = useAuth();
  const fahrerCtx = useFahrerContext();

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

  // Bevor der User in die App geht: erst Konto wählen, wenn er mehrere hat.
  if (fahrerCtx.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-maja-light">
        <Spinner label="Konten werden geladen …" />
      </div>
    );
  }
  if (fahrerCtx.needsPicker) {
    return <KontoAuswahlPage />;
  }

  if (profile?.role === 'admin') {
    return (
      <AdminShell>
        <Routes>
          {/* Default-Reiter nach Login = Tourenliste */}
          <Route path="/" element={<Navigate to="/touren" replace />} />
          <Route path="/touren" element={<TourenlistePage />} />
          <Route path="/meine-formulare" element={<FahrerDashboard />} />
          {/* Alias auf /meine-formulare — alte Bookmark-URLs umleiten. */}
          <Route path="/meine-drafts" element={<Navigate to="/meine-formulare" replace />} />
          <Route path="/greimel-zugaenge" element={<GreimelZugaengePage />} />
          <Route path="/eingaenge" element={<EingaengePage />} />
          <Route path="/belege" element={<BelegePage />} />
          <Route path="/aufstellung" element={<AufstellungPage />} />
          <Route path="/templates" element={<TemplatesListPage />} />
          <Route path="/templates/:id" element={<TemplateEditorPage />} />
          <Route path="/einstellungen" element={<EinstellungenPage />}>
            <Route index element={<Navigate to="auftraggeber" replace />} />
            <Route path="auftraggeber" element={<AuftraggeberListPage />} />
            <Route path="preislisten" element={<PreislistePage />} />
            <Route path="fahrer" element={<FahrerListPage />} />
          </Route>
          {/* Legacy-URL-Aliasse — alte Bookmarks weiterleiten. */}
          <Route path="/fahrer" element={<Navigate to="/einstellungen/fahrer" replace />} />
          <Route path="/auftraggeber" element={<Navigate to="/einstellungen/auftraggeber" replace />} />
          <Route path="/preisliste" element={<Navigate to="/einstellungen/preislisten" replace />} />
          <Route path="/zuweisungen" element={<Navigate to="/templates" replace />} />
          <Route path="/formular/:id" element={<FormularPage />} />
          <Route path="/profil" element={<ProfilPage />} />
          <Route path="/meine-unterkonten" element={<MeineUnterkontenPage />} />
          <Route path="/passwort-neu" element={<PasswordNewPage />} />
          <Route path="*" element={<Navigate to="/touren" replace />} />
        </Routes>
      </AdminShell>
    );
  }

  return (
    <AppShell>
      <Routes>
        {/* Default-Reiter nach Login = Tourenliste */}
        <Route path="/" element={<Navigate to="/touren" replace />} />
        <Route path="/touren" element={<TourenlistePage />} />
        <Route path="/meine-formulare" element={<FahrerDashboard />} />
        <Route path="/offen" element={<Navigate to="/meine-formulare" replace />} />
        <Route path="/greimel-zugaenge" element={<GreimelZugaengePage />} />
        <Route path="/eingaenge" element={<EingaengePage />} />
        <Route path="/formular/:id" element={<FormularPage />} />
        <Route path="/profil" element={<ProfilPage />} />
        <Route path="/meine-unterkonten" element={<MeineUnterkontenPage />} />
        <Route path="/passwort-neu" element={<PasswordNewPage />} />
        <Route path="*" element={<Navigate to="/touren" replace />} />
      </Routes>
    </AppShell>
  );
}

import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { useFahrerContext } from './auth/FahrerContext';
import { useTestMode } from './auth/TestModeContext';
import { Spinner } from './components/Spinner';
import { ProfileErrorScreen } from './components/ProfileErrorScreen';
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
import { PosteingangPage } from './pages/admin/PosteingangPage';
import { PostfaecherSettingsPage } from './pages/admin/PostfaecherSettingsPage';
import { BelegePage } from './pages/admin/BelegePage';
import { AufstellungPage } from './pages/admin/AufstellungPage';
import { RechnungenListPage } from './pages/admin/rechnungen/RechnungenListPage';
import { RechnungNewPage } from './pages/admin/rechnungen/RechnungNewPage';
import { RechnungDetailPage } from './pages/admin/rechnungen/RechnungDetailPage';
import { TourenlistePage } from './pages/TourenlistePage';
import { GreimelZugaengePage } from './pages/GreimelZugaengePage';
import { RecoveryPage } from './pages/admin/RecoveryPage';
import { FuehrerscheinPage } from './pages/admin/FuehrerscheinPage';
import { AuftraggeberShell } from './components/AuftraggeberShell';
import { AuftraggeberTourenPage } from './pages/auftraggeber/AuftraggeberTourenPage';
import { AuftraggeberFormularePage } from './pages/auftraggeber/AuftraggeberFormularePage';

export default function App() {
  const { status, profile, profileLoading, profileError, refreshProfile, signOut } = useAuth();
  const fahrerCtx = useFahrerContext();
  const { effectiveRole } = useTestMode();

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

  // Angemeldet, aber Profil (inkl. Rolle) noch nicht final geladen →
  // Ladebildschirm. NIEMALS hier schon eine (Default-)Ansicht rendern,
  // sonst erscheint die „leere Fahrer-Ansicht" ohne Profil-Menü.
  if (profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-maja-light">
        <Spinner label="Profil wird geladen …" />
      </div>
    );
  }

  // Angemeldet, aber Profil konnte nicht geladen werden / existiert nicht
  // → Fehlerseite mit Logout. KEIN Fallback auf die Fahrer-Ansicht.
  if (profileError || !profile) {
    return (
      <ProfileErrorScreen
        onRetry={() => void refreshProfile()}
        onLogout={() => void signOut()}
      />
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

  // Test-Profile: rendern wie die simulierte Rolle (Fahrer oder
  // Auftraggeber). Banner + Switcher sitzen in der jeweiligen Shell.
  // RLS lässt Test-User alles lesen; Writes werden auf DB-Ebene
  // blockiert (Migration 059) und vom guard zusätzlich abgefangen.
  if (profile?.role === 'test' && effectiveRole === 'auftraggeber') {
    return (
      <AuftraggeberShell>
        <Routes>
          <Route path="/" element={<Navigate to="/touren" replace />} />
          <Route path="/touren" element={<AuftraggeberTourenPage />} />
          <Route path="/formulare" element={<AuftraggeberFormularePage />} />
          <Route path="/profil" element={<ProfilPage />} />
          <Route path="*" element={<Navigate to="/touren" replace />} />
        </Routes>
      </AuftraggeberShell>
    );
  }

  // Auftraggeber-Profile: nur Tourenliste + Formulare. Alle anderen
  // Routen (Eingänge, Belege, Rechnungen, Einstellungen, …) sind nicht
  // registriert und landen im Redirect auf /touren. Die eigentliche
  // Datensicherheit liegt in den RLS-Policies (Migration 056) — das
  // Routing ist nur die UI-Schicht.
  if (profile?.role === 'auftraggeber') {
    return (
      <AuftraggeberShell>
        <Routes>
          <Route path="/" element={<Navigate to="/touren" replace />} />
          <Route path="/touren" element={<AuftraggeberTourenPage />} />
          <Route path="/formulare" element={<AuftraggeberFormularePage />} />
          <Route path="/profil" element={<ProfilPage />} />
          <Route path="/passwort-neu" element={<PasswordNewPage />} />
          <Route path="*" element={<Navigate to="/touren" replace />} />
        </Routes>
      </AuftraggeberShell>
    );
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
          <Route path="/posteingang" element={<PosteingangPage />} />
          <Route path="/belege" element={<BelegePage />} />
          <Route path="/aufstellung" element={<AufstellungPage />} />
          <Route path="/rechnungen" element={<RechnungenListPage />} />
          <Route path="/rechnungen/neu" element={<RechnungNewPage />} />
          <Route path="/rechnungen/:id" element={<RechnungDetailPage />} />
          <Route path="/templates" element={<TemplatesListPage />} />
          <Route path="/templates/:id" element={<TemplateEditorPage />} />
          <Route path="/einstellungen" element={<EinstellungenPage />}>
            <Route index element={<Navigate to="auftraggeber" replace />} />
            <Route path="auftraggeber" element={<AuftraggeberListPage />} />
            <Route path="preislisten" element={<PreislistePage />} />
            <Route path="fahrer" element={<FahrerListPage />} />
            <Route path="postfaecher" element={<PostfaecherSettingsPage />} />
          </Route>
          {/* Legacy-URL-Aliasse — alte Bookmarks weiterleiten. */}
          <Route path="/fahrer" element={<Navigate to="/einstellungen/fahrer" replace />} />
          <Route path="/auftraggeber" element={<Navigate to="/einstellungen/auftraggeber" replace />} />
          <Route path="/preisliste" element={<Navigate to="/einstellungen/preislisten" replace />} />
          <Route path="/zuweisungen" element={<Navigate to="/templates" replace />} />
          <Route path="/formular/:id" element={<FormularPage />} />
          <Route path="/profil" element={<ProfilPage />} />
          <Route path="/recovery" element={<RecoveryPage />} />
          <Route path="/fuehrerschein" element={<FuehrerscheinPage />} />
          <Route path="/meine-unterkonten" element={<MeineUnterkontenPage />} />
          <Route path="/passwort-neu" element={<PasswordNewPage />} />
          <Route path="*" element={<Navigate to="/touren" replace />} />
        </Routes>
      </AdminShell>
    );
  }

  if (profile.role === 'fahrer') {
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

  // Unbekannte/leere Rolle → niemals stillschweigend die Fahrer-Ansicht
  // zeigen. Fehlerseite mit Logout (deckt z.B. einen kaputten Rollenwert
  // ab).
  return (
    <ProfileErrorScreen
      onRetry={() => void refreshProfile()}
      onLogout={() => void signOut()}
    />
  );
}

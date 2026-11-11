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
import { EingaengePage } from './pages/admin/EingaengePage';
import { FahrerBriefePage } from './pages/FahrerBriefePage';
import { TourenlistePage } from './pages/TourenlistePage';
import { GreimelZugaengePage } from './pages/GreimelZugaengePage';
import { AuftraggeberShell } from './components/AuftraggeberShell';
import { SeitenRahmen } from './components/SeitenRahmen';
import { lazySeite } from './lib/lazySeite';

// Admin- und Auftraggeber-Seiten werden erst bei Bedarf geladen: Fahrer
// laden sie (und ihre großen Bibliotheken) beim Öffnen der App nicht mit.
// Fahrer- und gemeinsam genutzte Seiten (Tourenliste, Formular, Entwürfe,
// Eingänge …) bleiben im Haupt-Bundle — das Formular muss offline gehen.
const FahrerListPage = lazySeite(() => import('./pages/admin/FahrerListPage'), 'FahrerListPage');
const AuftraggeberListPage = lazySeite(() => import('./pages/admin/AuftraggeberListPage'), 'AuftraggeberListPage');
const PreislistePage = lazySeite(() => import('./pages/admin/PreislistePage'), 'PreislistePage');
const EinstellungenPage = lazySeite(() => import('./pages/admin/EinstellungenPage'), 'EinstellungenPage');
const TemplatesListPage = lazySeite(() => import('./pages/admin/TemplatesListPage'), 'TemplatesListPage');
const TemplateEditorPage = lazySeite(() => import('./pages/admin/TemplateEditorPage'), 'TemplateEditorPage');
const PosteingangPage = lazySeite(() => import('./pages/admin/PosteingangPage'), 'PosteingangPage');
const PostfaecherSettingsPage = lazySeite(() => import('./pages/admin/PostfaecherSettingsPage'), 'PostfaecherSettingsPage');
const FeldVorschlaegePage = lazySeite(() => import('./pages/admin/FeldVorschlaegePage'), 'FeldVorschlaegePage');
const DiagnoseLogPage = lazySeite(() => import('./pages/admin/DiagnoseLogPage'), 'DiagnoseLogPage');
const ManuelleEmpfaengerPage = lazySeite(() => import('./pages/admin/ManuelleEmpfaengerPage'), 'ManuelleEmpfaengerPage');
const ERechnungTestPage = lazySeite(() => import('./pages/admin/ERechnungTestPage'), 'ERechnungTestPage');
const FirmendatenPage = lazySeite(() => import('./pages/admin/FirmendatenPage'), 'FirmendatenPage');
const ERechnungExportPage = lazySeite(() => import('./pages/admin/ERechnungExportPage'), 'ERechnungExportPage');
const BriefeListPage = lazySeite(() => import('./pages/admin/briefe/BriefeListPage'), 'BriefeListPage');
const BriefDetailPage = lazySeite(() => import('./pages/admin/briefe/BriefDetailPage'), 'BriefDetailPage');
const TankkartenPage = lazySeite(() => import('./pages/admin/briefe/TankkartenPage'), 'TankkartenPage');
const BriefVorlagenPage = lazySeite(() => import('./pages/admin/BriefVorlagenPage'), 'BriefVorlagenPage');
const GutschriftSettingsPage = lazySeite(() => import('./pages/admin/GutschriftSettingsPage'), 'GutschriftSettingsPage');
const AuftragsEmailSettingsPage = lazySeite(() => import('./pages/admin/AuftragsEmailSettingsPage'), 'AuftragsEmailSettingsPage');
const GutschriftenListPage = lazySeite(() => import('./pages/admin/gutschriften/GutschriftenListPage'), 'GutschriftenListPage');
const GutschriftNewPage = lazySeite(() => import('./pages/admin/gutschriften/GutschriftNewPage'), 'GutschriftNewPage');
const GutschriftDetailPage = lazySeite(() => import('./pages/admin/gutschriften/GutschriftDetailPage'), 'GutschriftDetailPage');
const BelegePage = lazySeite(() => import('./pages/admin/BelegePage'), 'BelegePage');
const AufstellungPage = lazySeite(() => import('./pages/admin/AufstellungPage'), 'AufstellungPage');
const RechnungenListPage = lazySeite(() => import('./pages/admin/rechnungen/RechnungenListPage'), 'RechnungenListPage');
const RechnungNewPage = lazySeite(() => import('./pages/admin/rechnungen/RechnungNewPage'), 'RechnungNewPage');
const RechnungDetailPage = lazySeite(() => import('./pages/admin/rechnungen/RechnungDetailPage'), 'RechnungDetailPage');
const RecoveryPage = lazySeite(() => import('./pages/admin/RecoveryPage'), 'RecoveryPage');
const FuehrerscheinPage = lazySeite(() => import('./pages/admin/FuehrerscheinPage'), 'FuehrerscheinPage');
const AuftraggeberTourenPage = lazySeite(() => import('./pages/auftraggeber/AuftraggeberTourenPage'), 'AuftraggeberTourenPage');
const AuftraggeberFormularePage = lazySeite(() => import('./pages/auftraggeber/AuftraggeberFormularePage'), 'AuftraggeberFormularePage');

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
      <SeitenRahmen>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/passwort-reset" element={<PasswordResetPage />} />
          <Route path="/passwort-neu" element={<PasswordNewPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </SeitenRahmen>
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
        <SeitenRahmen>
          <Routes>
            <Route path="/" element={<Navigate to="/touren" replace />} />
            <Route path="/touren" element={<AuftraggeberTourenPage />} />
            <Route path="/formulare" element={<AuftraggeberFormularePage />} />
            <Route path="/profil" element={<ProfilPage />} />
            <Route path="*" element={<Navigate to="/touren" replace />} />
          </Routes>
        </SeitenRahmen>
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
        <SeitenRahmen>
          <Routes>
            <Route path="/" element={<Navigate to="/touren" replace />} />
            <Route path="/touren" element={<AuftraggeberTourenPage />} />
            <Route path="/formulare" element={<AuftraggeberFormularePage />} />
            <Route path="/profil" element={<ProfilPage />} />
            <Route path="/passwort-neu" element={<PasswordNewPage />} />
            <Route path="*" element={<Navigate to="/touren" replace />} />
          </Routes>
        </SeitenRahmen>
      </AuftraggeberShell>
    );
  }

  if (profile?.role === 'admin') {
    return (
      <AdminShell>
        <SeitenRahmen>
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
            <Route path="/gutschriften" element={<GutschriftenListPage />} />
            <Route path="/gutschriften/neu" element={<GutschriftNewPage />} />
            <Route path="/gutschriften/:id" element={<GutschriftDetailPage />} />
            <Route path="/briefe" element={<BriefeListPage />} />
            <Route path="/briefe/neu" element={<BriefDetailPage />} />
            <Route path="/briefe/:id" element={<BriefDetailPage />} />
            <Route path="/tankkarten" element={<TankkartenPage />} />
            <Route path="/templates" element={<TemplatesListPage />} />
            <Route path="/templates/:id" element={<TemplateEditorPage />} />
            <Route path="/einstellungen" element={<EinstellungenPage />}>
              <Route index element={<Navigate to="auftraggeber" replace />} />
              <Route path="auftraggeber" element={<AuftraggeberListPage />} />
              <Route path="preislisten" element={<PreislistePage />} />
              <Route path="fahrer" element={<FahrerListPage />} />
              <Route path="postfaecher" element={<PostfaecherSettingsPage />} />
              <Route path="vorschlaege" element={<FeldVorschlaegePage />} />
              <Route path="gutschriften" element={<GutschriftSettingsPage />} />
              <Route path="manuelle-empfaenger" element={<ManuelleEmpfaengerPage />} />
              <Route path="brief-vorlagen" element={<BriefVorlagenPage />} />
              <Route path="auftrags-email" element={<AuftragsEmailSettingsPage />} />
              <Route path="firmendaten" element={<FirmendatenPage />} />
              <Route path="erechnung-export" element={<ERechnungExportPage />} />
              <Route path="erechnung-test" element={<ERechnungTestPage />} />
              <Route path="diagnose" element={<DiagnoseLogPage />} />
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
        </SeitenRahmen>
      </AdminShell>
    );
  }

  if (profile.role === 'fahrer' || (profile.role === 'test' && effectiveRole === 'fahrer')) {
    return (
      <AppShell>
        <SeitenRahmen>
          <Routes>
            {/* Default-Reiter nach Login = Tourenliste */}
            <Route path="/" element={<Navigate to="/touren" replace />} />
            <Route path="/touren" element={<TourenlistePage />} />
            <Route path="/meine-formulare" element={<FahrerDashboard />} />
            <Route path="/offen" element={<Navigate to="/meine-formulare" replace />} />
            <Route path="/briefe" element={<FahrerBriefePage />} />
            <Route path="/greimel-zugaenge" element={<GreimelZugaengePage />} />
            <Route path="/eingaenge" element={<EingaengePage />} />
            <Route path="/formular/:id" element={<FormularPage />} />
            <Route path="/profil" element={<ProfilPage />} />
            <Route path="/meine-unterkonten" element={<MeineUnterkontenPage />} />
            <Route path="/passwort-neu" element={<PasswordNewPage />} />
            <Route path="*" element={<Navigate to="/touren" replace />} />
          </Routes>
        </SeitenRahmen>
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

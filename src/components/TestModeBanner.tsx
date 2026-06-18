import { useTestMode } from '../auth/TestModeContext';

// Eigenständig gestylte Dropdowns: weißer Hintergrund + dunkler Text,
// klare Border — unabhängig vom gelben Banner und in beiden Themes
// lesbar. `[color-scheme:light]` zwingt das native Control (inkl. der
// aufklappenden Optionsliste) in die helle Darstellung, sonst rendert
// der Browser im Dark Mode dunkle Optionen mit kaum lesbarem Text.
const BANNER_SELECT_CLS =
  '[color-scheme:light] rounded-md border border-amber-700/50 bg-white px-2 py-1 '
  + 'text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-800';

/**
 * Banner für Test-Profile: oben fixiert, gelb, mit Ansicht-Umschalter.
 * Für Nicht-Test-User rendert die Komponente nichts.
 */
export function TestModeBanner() {
  const {
    isTestUser, effectiveRole, effectiveAuftraggeberId,
    auftraggeberOptions, setEffectiveRole, setEffectiveAuftraggeberId,
  } = useTestMode();
  if (!isTestUser) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-30 border-b border-amber-700/40 bg-amber-400 text-amber-950 shadow-sm"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm lg:px-8 xl:max-w-7xl">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-900" />
          <strong>Testmodus</strong>
          <span className="hidden sm:inline">— Änderungen werden nicht gespeichert</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs font-medium">
            Ansicht
            <select
              className={BANNER_SELECT_CLS}
              value={effectiveRole}
              onChange={(e) => setEffectiveRole(e.target.value as 'fahrer' | 'auftraggeber')}
            >
              <option value="fahrer">Fahrer</option>
              <option value="auftraggeber">Auftraggeber</option>
            </select>
          </label>
          {effectiveRole === 'auftraggeber' && (
            <label className="inline-flex items-center gap-1.5 text-xs font-medium">
              Als Auftraggeber
              <select
                className={BANNER_SELECT_CLS}
                value={effectiveAuftraggeberId ?? ''}
                onChange={(e) => setEffectiveAuftraggeberId(e.target.value || null)}
              >
                {auftraggeberOptions.length === 0 && <option value="">— keine vorhanden —</option>}
                {auftraggeberOptions.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

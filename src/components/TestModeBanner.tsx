import { useTestMode } from '../auth/TestModeContext';

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
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-900" />
          <strong>Testmodus</strong>
          <span className="hidden sm:inline">— Änderungen werden nicht gespeichert</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs font-medium">
            Ansicht
            <select
              className="rounded-md border-0 bg-white px-2 py-1 text-sm text-amber-950 focus:ring-2 focus:ring-amber-800"
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
                className="rounded-md border-0 bg-white px-2 py-1 text-sm text-amber-950 focus:ring-2 focus:ring-amber-800"
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

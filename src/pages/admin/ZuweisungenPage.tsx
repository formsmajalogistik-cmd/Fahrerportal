export function ZuweisungenPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">Zuweisungen</h1>
        <p className="text-sm text-maja-muted">
          Ordne Fahrern die Templates zu, die sie ausfüllen dürfen.
        </p>
      </div>
      <div className="card p-6 text-sm text-maja-muted">
        Verwaltung folgt in Phase 2. Daten liegen in der Tabelle
        <code className="mx-1 rounded bg-maja-light px-1 py-0.5">formular_zuweisungen</code>.
      </div>
    </div>
  );
}

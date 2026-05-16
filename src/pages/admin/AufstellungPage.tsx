import { AufstellungTab } from './belege/AufstellungTab';

export function AufstellungPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">Aufstellung</h1>
        <p className="text-sm text-maja-muted">
          Touren-Aufstellung pro Fahrer und Zeitraum erstellen, Honorare ergänzen und als PDF exportieren.
        </p>
      </div>
      <AufstellungTab />
    </div>
  );
}

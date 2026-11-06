// Teilgutschrift: Positionen einer erstellten Rechnung auswählen und je
// Position Menge/Einzelpreis der Gutschrift festlegen (positiv, höchstens
// der Rechnungsbetrag der Position). Legt einen Entwurf im Gutschriften-
// Modul an — Prüfen, Finalisieren und ggf. E-Rechnung dort.

import { useState } from 'react';
import type { Database } from '../../types/supabase';
import { pruefeTeilgutschrift, teilgutschriftAnlegen, type TeilgutschriftAuswahl } from '../../lib/erechnung/korrektur';

type RechnungRow = Database['public']['Tables']['rechnungen']['Row'];
type PositionRow = Database['public']['Tables']['rechnungspositionen']['Row'];

const eur = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const zahl = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

export function TeilgutschriftDialog({ rechnung, positionen, onClose, onAngelegt }: {
  rechnung: RechnungRow;
  positionen: PositionRow[];
  onClose: () => void;
  onAngelegt: (gutschriftId: string) => void;
}) {
  const [wahl, setWahl] = useState<Record<string, { an: boolean; menge: string; preis: string }>>(() => Object.fromEntries(
    positionen.map((p) => [p.id, { an: false, menge: String(Number(p.menge)).replace('.', ','), preis: Number(p.einzelpreis).toFixed(2).replace('.', ',') }]),
  ));
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string[]>([]);

  const auswahl: TeilgutschriftAuswahl[] = positionen.filter((p) => wahl[p.id]?.an)
    .map((p) => ({ positionId: p.id, menge: zahl(wahl[p.id].menge), einzelpreis: zahl(wahl[p.id].preis) }));
  const summeNetto = auswahl.reduce((s, a) => s + Math.round(a.menge * a.einzelpreis * 100) / 100, 0);

  async function anlegen() {
    const f = pruefeTeilgutschrift(positionen, auswahl);
    setFehler(f);
    if (f.length) return;
    setBusy(true);
    try {
      onAngelegt(await teilgutschriftAnlegen(rechnung, positionen, auswahl));
    } catch (e) {
      setFehler([e instanceof Error ? e.message : 'Anlegen fehlgeschlagen']);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-6" role="dialog" aria-modal="true" aria-labelledby="tg-titel">
      <div className="card w-full max-w-3xl space-y-4 p-5">
        <div>
          <h2 id="tg-titel" className="text-lg font-semibold text-maja-navy">Teilgutschrift zu {rechnung.rechnungsnummer}</h2>
          <p className="text-sm text-maja-muted">
            Positionen auswählen und den gutzuschreibenden Betrag (netto, positiv) festlegen. Es entsteht ein Entwurf,
            den Sie im Gutschriften-Modul prüfen und finalisieren.
          </p>
        </div>
        <ul className="divide-y divide-maja-navy/10 rounded-md border border-maja-navy/10">
          {positionen.map((p) => {
            const w = wahl[p.id];
            return (
              <li key={p.id} className="grid gap-2 p-3 sm:grid-cols-[auto_1fr_6rem_8rem] sm:items-center">
                <input type="checkbox" className="h-4 w-4" aria-label={`Position ${p.position_nr} auswählen`} checked={w.an}
                       onChange={(e) => setWahl({ ...wahl, [p.id]: { ...w, an: e.target.checked } })} />
                <span className="text-sm">
                  <span className="font-medium text-maja-ink">{p.bezeichnung}</span>
                  <span className="block text-xs text-maja-muted">Rechnung: {Number(p.menge).toLocaleString('de-DE')} × {eur(Number(p.einzelpreis))} = {eur(Number(p.gesamtpreis))}</span>
                </span>
                <label className="text-xs text-maja-muted">Menge
                  <input className="input mt-0.5" inputMode="decimal" disabled={!w.an} value={w.menge}
                         onChange={(e) => setWahl({ ...wahl, [p.id]: { ...w, menge: e.target.value } })} />
                </label>
                <label className="text-xs text-maja-muted">Einzelpreis (€)
                  <input className="input mt-0.5" inputMode="decimal" disabled={!w.an} value={w.preis}
                         onChange={(e) => setWahl({ ...wahl, [p.id]: { ...w, preis: e.target.value } })} />
                </label>
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-maja-ink">Summe netto: <strong>{eur(summeNetto)}</strong></p>
        {fehler.length > 0 && (
          <ul role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{fehler.map((f) => <li key={f}>{f}</li>)}</ul>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={() => void anlegen()} disabled={busy || auswahl.length === 0}>
            {busy ? 'Lege an …' : 'Teilgutschrift als Entwurf anlegen'}
          </button>
        </div>
      </div>
    </div>
  );
}

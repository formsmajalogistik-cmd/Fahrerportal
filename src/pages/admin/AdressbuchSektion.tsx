// Pflege des Adressbuchs (Migration 090).
//
// Manuell gepflegte Adressen — Straße, PLZ und Ort als EIN Eintrag,
// damit die Auswahl im Formular und in der Tour-Erfassung alle drei
// Felder gemeinsam füllt.
//
// Datenschutz: eine Adresse kann optional einem Auftraggeber zugeordnet
// werden. Ohne Zuordnung sehen sie Admin und Fahrer; mit Zuordnung
// zusätzlich genau dieser Auftraggeber — und kein anderer. Durchgesetzt
// wird das von der RLS, nicht hier.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Spinner } from '../../components/Spinner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useTestGuard } from '../../auth/TestModeContext';
import {
  adressZeile, aktualisiereAdresse, entwurfAus, ladeAdressbuch,
  legeAdresseAn, leererAdressEntwurf, loescheAdresse,
  type AdressEntwurf, type Adressbucheintrag,
} from '../../lib/adressbuch';

export function AdressbuchSektion() {
  const guard = useTestGuard();
  const [liste, setListe] = useState<Adressbucheintrag[]>([]);
  const [auftraggeber, setAuftraggeber] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  /** null = Formular zu, '' = neuer Eintrag, sonst die bearbeitete Id. */
  const [bearbeiteId, setBearbeiteId] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState<AdressEntwurf>(leererAdressEntwurf());
  const [busy, setBusy] = useState(false);
  const [loeschId, setLoeschId] = useState<string | null>(null);
  const [filterAg, setFilterAg] = useState<string>('');

  const laden = useCallback(async () => {
    setLoading(true);
    const [adr, agRes] = await Promise.all([
      ladeAdressbuch(),
      supabase.from('auftraggeber').select('id, name').order('name'),
    ]);
    setListe(adr);
    setAuftraggeber(agRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void laden(); }, 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  const gefiltert = useMemo(() => {
    if (!filterAg) return liste;
    if (filterAg === '__allgemein') return liste.filter((a) => !a.auftraggeber_id);
    return liste.filter((a) => a.auftraggeber_id === filterAg);
  }, [liste, filterAg]);

  const agName = (id: string | null) =>
    auftraggeber.find((a) => a.id === id)?.name ?? null;

  async function speichern() {
    if (!entwurf.strasse.trim() && !entwurf.ort.trim() && !entwurf.bezeichnung.trim()) {
      setFehler('Bitte mindestens Bezeichnung, Straße oder Ort angeben.');
      return;
    }
    if (guard()) return;
    setBusy(true);
    const res = bearbeiteId
      ? await aktualisiereAdresse(bearbeiteId, entwurf)
      : await legeAdresseAn(entwurf);
    setBusy(false);
    if (!res.ok) { setFehler(res.fehler ?? 'Speichern fehlgeschlagen.'); return; }
    setFehler(null);
    setBearbeiteId(null);
    await laden();
  }

  async function loeschen(id: string) {
    if (guard()) return;
    setBusy(true);
    const res = await loescheAdresse(id);
    setBusy(false);
    setLoeschId(null);
    if (!res.ok) { setFehler(res.fehler ?? 'Löschen fehlgeschlagen.'); return; }
    await laden();
  }

  const feld = (key: keyof AdressEntwurf, label: string, hinweis?: string) => (
    <div>
      <label htmlFor={`ab-${key}`} className="label">{label}</label>
      <input
        id={`ab-${key}`} className="input"
        value={entwurf[key]}
        onChange={(e) => setEntwurf({ ...entwurf, [key]: e.target.value })}
      />
      {hinweis && <p className="mt-1 text-xs text-maja-muted">{hinweis}</p>}
    </div>
  );

  if (loading) return <Spinner />;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-maja-navy">Adressen</h2>
          <p className="text-sm text-maja-muted">
            Manuell gepflegte Adressen. Bei der Auswahl werden Straße, PLZ und
            Ort gemeinsam gesetzt — in den Formularen und in der Tour-Erfassung.
          </p>
        </div>
        <button
          type="button" className="btn-primary"
          onClick={() => { setEntwurf(leererAdressEntwurf()); setBearbeiteId(''); setFehler(null); }}
        >
          + Neue Adresse
        </button>
      </div>

      {fehler && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {fehler}
        </div>
      )}

      {bearbeiteId !== null && (
        <div className="card space-y-3 p-5">
          <h3 className="text-base font-semibold text-maja-navy">
            {bearbeiteId ? 'Adresse bearbeiten' : 'Neue Adresse'}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              {feld('bezeichnung', 'Bezeichnung', 'z.B. „Zentrallager" — erscheint vor der Adresse.')}
            </div>
            <div className="sm:col-span-2">{feld('strasse', 'Straße (inkl. Hausnummer)')}</div>
            {feld('plz', 'PLZ')}
            {feld('ort', 'Ort')}
            <div className="sm:col-span-2">
              <label htmlFor="ab-ag" className="label">Sichtbar für</label>
              <select
                id="ab-ag" className="input"
                value={entwurf.auftraggeberId}
                onChange={(e) => setEntwurf({ ...entwurf, auftraggeberId: e.target.value })}
              >
                <option value="">Allgemein — Maja-Logistik und Fahrer</option>
                {auftraggeber.map((a) => (
                  <option key={a.id} value={a.id}>Zusätzlich für {a.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-maja-muted">
                Mit Zuordnung sieht diese Adresse zusätzlich der gewählte
                Auftraggeber in seiner Tour-Erfassung — kein anderer.
              </p>
            </div>
            <div className="sm:col-span-2">{feld('notiz', 'Notiz (optional)')}</div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary" disabled={busy}
                    onClick={() => { setBearbeiteId(null); setFehler(null); }}>
              Abbrechen
            </button>
            <button type="button" className="btn-primary" disabled={busy}
                    onClick={() => void speichern()}>
              {busy ? 'Speichern …' : 'Speichern'}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="ab-filter" className="label">Sichtbarkeit</label>
          <select id="ab-filter" className="input" value={filterAg}
                  onChange={(e) => setFilterAg(e.target.value)}>
            <option value="">Alle</option>
            <option value="__allgemein">Nur allgemeine</option>
            {auftraggeber.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <span className="pb-2 text-xs text-maja-muted">
          {gefiltert.length} {gefiltert.length === 1 ? 'Adresse' : 'Adressen'}
        </span>
      </div>

      {gefiltert.length === 0 ? (
        <div className="card p-6 text-center text-sm text-maja-muted">
          Noch keine Adressen gepflegt.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-maja-navy/10">
            {gefiltert.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-maja-ink">{adressZeile(a)}</div>
                  <div className="text-xs text-maja-muted">
                    {a.auftraggeber_id
                      ? `Nur für ${agName(a.auftraggeber_id) ?? 'einen Auftraggeber'}`
                      : 'Allgemein'}
                    {a.notiz ? ` · ${a.notiz}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button" className="btn-secondary px-3 py-1.5 text-sm"
                    onClick={() => { setEntwurf(entwurfAus(a)); setBearbeiteId(a.id); setFehler(null); }}
                  >
                    Bearbeiten
                  </button>
                  <button
                    type="button"
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                    onClick={() => setLoeschId(a.id)}
                  >
                    Löschen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loeschId && (
        <ConfirmDialog
          title="Adresse löschen?"
          message="Der Eintrag verschwindet aus der Auswahl. Bereits erfasste Touren und Formulare bleiben unverändert."
          confirmLabel="Löschen"
          onConfirm={async () => { await loeschen(loeschId); }}
          onClose={() => setLoeschId(null)}
        />
      )}
    </section>
  );
}

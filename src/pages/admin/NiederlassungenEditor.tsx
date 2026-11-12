// Abschnitt „Niederlassungen" im Auftraggeber-Dialog (Migration 118).
//
// Der Auftraggeber selbst ist der Hauptsitz (oben, mit seiner Adresse aus
// dem Formular und einer änderbaren Bezeichnung). Weitere Standorte werden
// hier direkt gespeichert (eigener Lebenszyklus wie die Rechnungsadressen).
// Löschen nur, solange keine Touren/Rechnungen daran hängen — sonst
// deaktivieren (nicht mehr auswählbar, Anzeige bleibt).
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { LAENDER, normLandCode } from '../../lib/erechnung/stammdaten';
import { niederlassungenVorhanden, standorteNeuLaden, type NiederlassungRow } from '../../lib/niederlassungen';

interface Entwurf {
  id: string | null;
  key: string;
  bezeichnung: string;
  strasse: string;
  plz: string;
  ort: string;
  land_code: string;
  rechnungs_email: string;
  erechnung_email: string;
  kaeufer_referenz: string;
  kundennummer: string;
  ansprechpartner: string;
  aktiv: boolean;
  offen: boolean;
}

const ausServer = (n: NiederlassungRow): Entwurf => ({
  id: n.id, key: n.id, bezeichnung: n.bezeichnung, strasse: n.strasse ?? '', plz: n.plz ?? '', ort: n.ort ?? '',
  land_code: n.land_code ?? '', rechnungs_email: n.rechnungs_email ?? '', erechnung_email: n.erechnung_email ?? '',
  kaeufer_referenz: n.kaeufer_referenz ?? '', kundennummer: n.kundennummer ?? '', ansprechpartner: n.ansprechpartner ?? '',
  aktiv: n.aktiv, offen: false,
});
const neu = (): Entwurf => ({
  id: null, key: `neu-${Math.random().toString(36).slice(2, 9)}`, bezeichnung: '', strasse: '', plz: '', ort: '', land_code: 'DE',
  rechnungs_email: '', erechnung_email: '', kaeufer_referenz: '', kundennummer: '', ansprechpartner: '', aktiv: true, offen: true,
});
const leerZuNull = (v: string) => (v.trim() ? v.trim() : null);

interface Props {
  auftraggeberId: string | null;
  /** Hauptsitz: Bezeichnung (leer = Ort) und Adresse aus dem Formular. */
  hauptsitzBezeichnung: string;
  onHauptsitzBezeichnung: (v: string) => void;
  hauptsitzAdresse: { strasse: string; plz: string; ort: string };
}

export function NiederlassungenEditor({ auftraggeberId, hauptsitzBezeichnung, onHauptsitzBezeichnung, hauptsitzAdresse }: Props) {
  const [schema, setSchema] = useState<boolean | null>(null);
  const [liste, setListe] = useState<Entwurf[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);

  useEffect(() => { void niederlassungenVorhanden().then(setSchema); }, []);
  useEffect(() => {
    if (!schema || !auftraggeberId) { setListe([]); return; }
    let aktiv = true;
    void supabase.from('auftraggeber_niederlassungen').select('*').eq('auftraggeber_id', auftraggeberId).order('bezeichnung')
      .then(({ data, error }) => {
        if (!aktiv) return;
        if (error) setFehler(error.message);
        else setListe(((data ?? []) as NiederlassungRow[]).map(ausServer));
      });
    return () => { aktiv = false; };
  }, [schema, auftraggeberId]);

  if (schema === false) return null;

  const patch = (key: string, p: Partial<Entwurf>) => setListe((l) => l.map((e) => (e.key === key ? { ...e, ...p } : e)));
  const hsName = hauptsitzBezeichnung.trim() || hauptsitzAdresse.ort.trim() || 'Hauptsitz';

  async function speichern(e: Entwurf) {
    if (!auftraggeberId) return;
    setFehler(null); setHinweis(null);
    const bez = e.bezeichnung.trim() || e.ort.trim();
    if (!bez) { setFehler('Bitte eine Bezeichnung oder einen Ort angeben.'); return; }
    if (bez.toLowerCase() === hsName.toLowerCase()) { setFehler(`„${bez}" ist schon die Bezeichnung des Hauptsitzes — bitte eindeutig benennen (z.B. „${bez}-Nord").`); return; }
    const land = e.land_code.trim() ? normLandCode(e.land_code) : null;
    if (e.land_code.trim() && !land) { setFehler('Ländercode: zwei Buchstaben, z.B. DE.'); return; }
    const daten = {
      auftraggeber_id: auftraggeberId, bezeichnung: bez, strasse: leerZuNull(e.strasse), plz: leerZuNull(e.plz), ort: leerZuNull(e.ort),
      land_code: land, rechnungs_email: leerZuNull(e.rechnungs_email), erechnung_email: leerZuNull(e.erechnung_email),
      kaeufer_referenz: leerZuNull(e.kaeufer_referenz), kundennummer: leerZuNull(e.kundennummer), ansprechpartner: leerZuNull(e.ansprechpartner),
    };
    setBusy(e.key);
    const res = e.id
      ? await supabase.from('auftraggeber_niederlassungen').update(daten).eq('id', e.id).select('*').single()
      : await supabase.from('auftraggeber_niederlassungen').insert(daten).select('*').single();
    setBusy(null);
    if (res.error) {
      setFehler(/duplicate key|eindeutig/i.test(res.error.message) ? `Es gibt bereits eine Niederlassung „${bez}".` : res.error.message);
      return;
    }
    const gespeichert = ausServer(res.data as NiederlassungRow);
    setListe((l) => l.map((x) => (x.key === e.key ? gespeichert : x)));
    standorteNeuLaden();
    setHinweis(`Niederlassung „${bez}" gespeichert.`);
  }

  async function aktivSetzen(e: Entwurf, aktiv: boolean) {
    if (!e.id) return;
    setBusy(e.key); setFehler(null);
    const { error } = await supabase.from('auftraggeber_niederlassungen').update({ aktiv }).eq('id', e.id);
    setBusy(null);
    if (error) { setFehler(error.message); return; }
    patch(e.key, { aktiv });
    standorteNeuLaden();
    setHinweis(aktiv ? `„${e.bezeichnung}" ist wieder auswählbar.` : `„${e.bezeichnung}" ist deaktiviert — nicht mehr auswählbar, bestehende Touren/Rechnungen bleiben unverändert.`);
  }

  async function loeschen(e: Entwurf) {
    if (!e.id) { setListe((l) => l.filter((x) => x.key !== e.key)); return; }
    if (!window.confirm(`Niederlassung „${e.bezeichnung}" löschen?`)) return;
    setBusy(e.key); setFehler(null);
    const { error } = await supabase.from('auftraggeber_niederlassungen').delete().eq('id', e.id);
    setBusy(null);
    if (error) {
      setFehler(/foreign key|violates/i.test(error.message)
        ? `„${e.bezeichnung}" kann nicht gelöscht werden, weil Touren oder Rechnungen daran hängen. Stattdessen „Deaktivieren" — dann ist sie nicht mehr auswählbar, die Anzeige bleibt.`
        : error.message);
      return;
    }
    setListe((l) => l.filter((x) => x.key !== e.key));
    standorteNeuLaden();
  }

  const feld = (e: Entwurf, k: keyof Entwurf, label: string, opts: { typ?: string; ph?: string; breit?: boolean } = {}) => (
    <div className={opts.breit ? 'sm:col-span-2' : ''}>
      <label htmlFor={`nl-${e.key}-${String(k)}`} className="label">{label}</label>
      <input id={`nl-${e.key}-${String(k)}`} type={opts.typ ?? 'text'} className="input" placeholder={opts.ph}
             value={String(e[k] ?? '')} onChange={(ev) => patch(e.key, { [k]: ev.target.value } as Partial<Entwurf>)} />
    </div>
  );

  return (
    <div className="space-y-3 rounded-lg border border-maja-navy/10 p-4" data-testid="niederlassungen">
      <div>
        <h3 className="text-sm font-semibold text-maja-navy">Niederlassungen</h3>
        <p className="text-xs text-maja-muted">
          Weitere Standorte dieses Auftraggebers (gleicher Name, andere Adresse). Sobald es eine gibt, erscheint der
          Auftraggeber überall als „Name · Standort". Preise, Zahlungsziel, Rechnungs- und E-Rechnungs-Format gelten für
          alle Standorte; leere Felder übernehmen die Werte des Auftraggebers.
        </p>
      </div>
      {!auftraggeberId ? (
        <p className="text-sm text-maja-muted">Bitte den Auftraggeber zuerst speichern.</p>
      ) : (
        <>
          <div className="rounded-md bg-maja-light/60 p-3 text-sm dark:!bg-slate-800/60" data-testid="hauptsitz">
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr] sm:items-end">
              <div>
                <label htmlFor="ag-hauptsitz" className="label">Hauptsitz — Bezeichnung</label>
                <input id="ag-hauptsitz" className="input" placeholder={hauptsitzAdresse.ort || 'z.B. Stuhr'}
                       value={hauptsitzBezeichnung} onChange={(e) => onHauptsitzBezeichnung(e.target.value)} />
              </div>
              <p className="text-xs text-maja-muted">
                Adresse: {[hauptsitzAdresse.strasse, [hauptsitzAdresse.plz, hauptsitzAdresse.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'}
                <br />Leer = Ort. Wird mit dem Auftraggeber gespeichert.
              </p>
            </div>
          </div>

          {liste.length === 0 && <p className="text-sm text-maja-muted">Noch keine weiteren Niederlassungen.</p>}
          <ul className="space-y-2">
            {liste.map((e) => (
              <li key={e.key} className={`rounded-md border border-maja-navy/10 p-3 ${e.aktiv ? '' : 'opacity-70'}`} data-niederlassung={e.bezeichnung || 'neu'}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-maja-ink">
                    {e.bezeichnung || e.ort || 'Neue Niederlassung'}
                    {e.id && !e.aktiv && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-700 dark:!bg-slate-700 dark:!text-slate-200">inaktiv</span>}
                    {(e.strasse || e.ort) && !e.offen && <span className="ml-2 text-xs text-maja-muted">{[e.strasse, [e.plz, e.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</span>}
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {e.id && <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => patch(e.key, { offen: !e.offen })}>{e.offen ? 'Zuklappen' : 'Bearbeiten'}</button>}
                    {e.id && <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy === e.key} onClick={() => void aktivSetzen(e, !e.aktiv)}>{e.aktiv ? 'Deaktivieren' : 'Aktivieren'}</button>}
                    <button type="button" className="btn-secondary px-2 py-1 text-xs text-red-700 dark:!text-red-300" disabled={busy === e.key} onClick={() => void loeschen(e)}>{e.id ? 'Löschen' : 'Verwerfen'}</button>
                  </span>
                </div>
                {e.offen && (
                  <div className="mt-3 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {feld(e, 'bezeichnung', 'Bezeichnung *', { ph: e.ort || 'z.B. Bremen oder Bremen-Hemelingen' })}
                      {feld(e, 'strasse', 'Straße + Hausnr.')}
                      {feld(e, 'plz', 'PLZ')}
                      {feld(e, 'ort', 'Ort')}
                      <div>
                        <label htmlFor={`nl-${e.key}-land`} className="label">Ländercode (ISO)</label>
                        <input id={`nl-${e.key}-land`} className="input uppercase" maxLength={2} list={`nl-${e.key}-laender`} placeholder="DE"
                               value={e.land_code} onChange={(ev) => patch(e.key, { land_code: ev.target.value.toUpperCase() })} />
                        <datalist id={`nl-${e.key}-laender`}>{LAENDER.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</datalist>
                      </div>
                    </div>
                    <p className="text-xs text-maja-muted">Abweichend vom Auftraggeber (leer = übernehmen):</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {feld(e, 'rechnungs_email', 'Rechnungs-E-Mail', { typ: 'email' })}
                      {feld(e, 'erechnung_email', 'E-Rechnungs-Adresse', { typ: 'email' })}
                      {feld(e, 'kaeufer_referenz', 'Käuferreferenz / Leitweg-ID')}
                      {feld(e, 'kundennummer', 'Kundennummer')}
                      {feld(e, 'ansprechpartner', 'Ansprechpartner', { breit: true })}
                    </div>
                    <div className="flex justify-end">
                      <button type="button" className="btn-primary px-3 py-1 text-sm" disabled={busy === e.key} onClick={() => void speichern(e)}>
                        {busy === e.key ? 'Speichert …' : 'Niederlassung speichern'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <button type="button" className="btn-secondary px-3 py-1 text-sm" onClick={() => setListe((l) => [...l, neu()])}>+ Niederlassung hinzufügen</button>
        </>
      )}
      {fehler && <p role="alert" className="text-sm text-red-700 dark:!text-red-300">{fehler}</p>}
      {hinweis && <p role="status" className="text-sm text-emerald-700 dark:!text-emerald-300">{hinweis}</p>}
    </div>
  );
}

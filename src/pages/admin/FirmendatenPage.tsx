// Einstellungen → „Firmendaten (Rechnungen)" (nur Admin; Test-Rolle lesend).
//
// Pflichtangaben des Rechnungsausstellers für PDF und E-Rechnung. Beim
// Erstellen einer Rechnung/Gutschrift werden die Werte als Snapshot am
// Beleg gespeichert — Änderungen hier wirken nur auf künftig erstellte
// Belege, nie auf bereits erstellte.

import { useEffect, useState } from 'react';
import { Spinner } from '../../components/Spinner';
import { useTestGuard } from '../../auth/TestModeContext';
import {
  FIRMENDATEN, ladeFirmendaten, pruefeFirmendaten, speichereFirmendaten, type Firmendaten,
} from '../../lib/firmendaten';
import {
  ladeRechnungEinstellungen, speichereRechnungEinstellungen,
} from '../../lib/rechnungEinstellungen';
import { generateRechnungPdf } from './rechnungen/rechnungPdf';

type Feld = { key: keyof Firmendaten; label: string; hinweis?: string; typ?: string; breit?: boolean };

const GRUPPEN: Array<{ titel: string; felder: Feld[] }> = [
  { titel: 'Unternehmen', felder: [
    { key: 'name', label: 'Firmenname (wie im Handelsregister) *', breit: true },
    { key: 'kurzname', label: 'Kurzbezeichnung (Fußzeile)' },
    { key: 'inhaber', label: 'Inhaber' },
    { key: 'rechtsform', label: 'Rechtsform (optional)', hinweis: 'Leer = erscheint nicht auf der Rechnung.' },
    { key: 'registergericht', label: 'Registergericht (optional)', hinweis: 'Nur bei Eintragung im Handelsregister.' },
    { key: 'registernummer', label: 'Registernummer (optional)', hinweis: 'Nur bei Eintragung im Handelsregister.' },
  ] },
  { titel: 'Anschrift', felder: [
    { key: 'strasse', label: 'Straße *', breit: true },
    { key: 'plz', label: 'PLZ *' },
    { key: 'ort', label: 'Ort *', hinweis: 'Gilt für Briefkopf und Fußzeile.' },
    { key: 'landCode', label: 'Ländercode *' },
    { key: 'telefon', label: 'Telefon (Briefkopf)', typ: 'tel' },
    { key: 'email', label: 'E-Mail (Briefkopf)', typ: 'email' },
  ] },
  { titel: 'Steuer', felder: [
    { key: 'ustId', label: 'USt-IdNr.' },
    { key: 'steuernummer', label: 'Steuernummer (optional)', hinweis: 'Optional, wenn die USt-IdNr. eingetragen ist.' },
  ] },
  { titel: 'Kontakt für Rechnungen (E-Rechnung)', felder: [
    { key: 'kontaktName', label: 'Name', hinweis: 'Pflicht bei XRechnung (BR-DE-5).' },
    { key: 'kontaktTelefon', label: 'Telefon', typ: 'tel' },
    { key: 'kontaktEmail', label: 'E-Mail', typ: 'email', hinweis: 'Empfängt auch den Probeversand.' },
    { key: 'elektronischeAdresse', label: 'Elektronische Adresse des Absenders *', typ: 'email', hinweis: 'BT-34' },
  ] },
  { titel: 'Bankverbindung', felder: [
    { key: 'bank', label: 'Bank' },
    { key: 'iban', label: 'IBAN *' },
    { key: 'bic', label: 'BIC' },
  ] },
];

export function FirmendatenPage() {
  const guard = useTestGuard();
  const [wert, setWert] = useState<Firmendaten | null>(null);
  const [gespeichert, setGespeichert] = useState<Firmendaten | null>(null);
  const [ziel, setZiel] = useState('');
  const [zielGespeichert, setZielGespeichert] = useState('');
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let aktiv = true;
    void Promise.all([ladeFirmendaten(), ladeRechnungEinstellungen()]).then(([f, e]) => {
      if (!aktiv) return;
      setWert(f); setGespeichert(f);
      setZiel(String(e.standard_zahlungsziel_tage)); setZielGespeichert(String(e.standard_zahlungsziel_tage));
    });
    return () => { aktiv = false; };
  }, []);

  if (!wert) return <Spinner />;
  const fehler = pruefeFirmendaten(wert);
  const geaendert = JSON.stringify(wert) !== JSON.stringify(gespeichert) || ziel.trim() !== zielGespeichert;
  const zielOk = /^\d{1,3}$/.test(ziel.trim()) && Number(ziel) <= 365;

  async function speichern() {
    if (!wert || fehler.length || !zielOk) return;
    if (guard()) return;
    setBusy(true); setMeldung(null);
    try {
      await speichereFirmendaten(wert);
      if (ziel.trim() !== zielGespeichert) {
        await speichereRechnungEinstellungen({ standard_zahlungsziel_tage: Number(ziel) });
        setZielGespeichert(ziel.trim());
      }
      setGespeichert(wert);
      setMeldung({ ok: true, text: 'Gespeichert. Gilt für künftig erstellte Rechnungen und Gutschriften.' });
    } catch (e) {
      setMeldung({ ok: false, text: e instanceof Error ? e.message : 'Speichern fehlgeschlagen' });
    } finally {
      setBusy(false);
    }
  }

  async function vorschau() {
    if (!wert) return;
    const blob = await generateRechnungPdf({
      rechnungsnummer: 'VORSCHAU', datum: new Date().toISOString().slice(0, 10), anrede: 'Sehr geehrte Damen und Herren,',
      kundennummer: 'K-0000', sachbearbeiter: 'Frau Beispiel', faelligAm: null,
      empfaenger: { firma: 'Beispiel GmbH', ansprechpartner: null, strasse: 'Musterstraße 1', plz_ort: '28195 Bremen', land: null },
      kundenUid: 'DE123456789', zahlungszielTage: Number(ziel) || 14, ustSatzDefault: 19,
      positionen: [{ position_nr: 1, bezeichnung: 'Überführung Bremen nach Hamburg', unterzeilen: ['HB-XY 1'], menge: 1, einzelpreis: 192, gesamtpreis: 192, ust_satz: null }],
      absender: wert, pflichtangaben: true,
    });
    window.open(URL.createObjectURL(blob), '_blank', 'noopener');
  }

  const set = (k: keyof Firmendaten, v: string) => setWert({ ...wert, [k]: k === 'landCode' ? v.toUpperCase() : v });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-maja-navy">Firmendaten (Rechnungen)</h2>
        <p className="text-sm text-maja-muted">
          Angaben des Rechnungsausstellers für PDF und E-Rechnung. Beim Erstellen wird der aktuelle Stand
          an der Rechnung gespeichert — spätere Änderungen hier verändern keine bereits erstellte Rechnung.
        </p>
      </div>

      {GRUPPEN.map((g) => (
        <section key={g.titel} className="card space-y-3 p-4">
          <h3 className="text-sm font-semibold text-maja-navy">{g.titel}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {g.felder.map((f) => (
              <div key={f.key} className={f.breit ? 'sm:col-span-2' : ''}>
                <label htmlFor={`fd-${f.key}`} className="label">{f.label}</label>
                <input id={`fd-${f.key}`} className="input" type={f.typ ?? 'text'}
                       maxLength={f.key === 'landCode' ? 2 : undefined}
                       placeholder={f.key === 'elektronischeAdresse' ? FIRMENDATEN.elektronischeAdresse : undefined}
                       value={(wert[f.key] as string | null) ?? ''}
                       onChange={(e) => set(f.key, e.target.value)} />
                {f.hinweis && <p className="mt-1 text-xs text-maja-muted">{f.hinweis}</p>}
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="card space-y-2 p-4" data-testid="standard-zahlungsziel">
        <h3 className="text-sm font-semibold text-maja-navy">Zahlungsziel</h3>
        <label htmlFor="standard-zahlungsziel" className="label">Standard-Zahlungsziel für manuelle Rechnungen (Tage)</label>
        <input id="standard-zahlungsziel" className="input w-32" inputMode="numeric"
               aria-invalid={!zielOk || undefined}
               value={ziel} onChange={(e) => setZiel(e.target.value)} />
        <p className={`text-xs ${zielOk ? 'text-maja-muted' : 'text-red-700'}`}>
          {zielOk ? 'Gilt für manuelle Rechnungen ohne eigenes Zahlungsziel.' : 'Bitte ganze Tage zwischen 0 und 365 angeben.'}
        </p>
      </section>

      {fehler.length > 0 && (
        <ul role="alert" className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:!bg-red-900/40 dark:!text-red-200">
          {fehler.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}
      {meldung && (
        <p role={meldung.ok ? 'status' : 'alert'} className={`text-sm ${meldung.ok ? 'text-emerald-700 dark:!text-emerald-300' : 'text-red-700'}`}>{meldung.text}</p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => void vorschau()}>Vorschau-PDF</button>
        <button type="button" className="btn-primary" disabled={busy || !geaendert || fehler.length > 0 || !zielOk}
                onClick={() => void speichern()}>
          {busy ? 'Speichern …' : 'Speichern'}
        </button>
      </div>
    </div>
  );
}

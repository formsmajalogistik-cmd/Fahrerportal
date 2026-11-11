// Einstellungen → „E-Rechnung (Test)" (nur Admin).
//
// Erzeugt für eine ausgewählte Rechnung die E-Rechnung (CII-XML oder
// ZUGFeRD-PDF) als Download und zeigt das Ergebnis der Pflichtfeld-Prüfung. Reiner
// Lesezugriff: kein Speichern in OneDrive, kein Versand, keine
// Statusänderung an der Rechnung.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatDate } from '../../lib/touren';
import {
  bildeERechnung, erzeugeCii, ladeERechnungQuelle, pruefeERechnung, testDateiname,
  ERechnungAbbruch, type Abbildung, type ERechnungProfil, type ERechnungQuelle, type Mangel,
} from '../../lib/erechnung';
import { useERechnungSchema } from '../../lib/erechnung/useERechnungSchema';
import { rechnungPdfInputAus } from '../../lib/erechnung/belegPdf';
import { zugferdOption } from '../../lib/erechnung/erstellen';
import { firmendatenFuerBeleg, type Firmendaten } from '../../lib/firmendaten';
import { ladeAbsenderBilder } from '../../lib/absenderSignatur';
import { generateRechnungPdf } from './rechnungen/rechnungPdf';

/** Auswahl im Test-Export; ZUGFeRD nutzt das Profil EN 16931. */
type TestFormat = ERechnungProfil | 'zugferd';
const FORMAT_NAME: Record<TestFormat, string> = { xrechnung: 'XRechnung', en16931: 'EN 16931', zugferd: 'ZUGFeRD (EN 16931)' };

function speichern(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface Zeile {
  id: string;
  rechnungsnummer: string;
  datum: string;
  status: string;
  brutto_summe: number;
  rechnungsadresse_firma: string | null;
  ansprechpartner: string | null;
  ist_auslagen_rechnung: boolean;
}

const eur = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

const STUFE: Record<Mangel['schwere'], { label: string; cls: string }> = {
  fehler: { label: 'Fehlt / ungültig', cls: 'text-red-700 dark:!text-red-300' },
  warnung: { label: 'Bitte prüfen', cls: 'text-amber-700 dark:!text-amber-300' },
  hinweis: { label: 'Hinweis', cls: 'text-maja-muted' },
};

export function ERechnungTestPage() {
  const schemaOk = useERechnungSchema();
  const [suche, setSuche] = useState('');
  const [liste, setListe] = useState<Zeile[]>([]);
  const [laedt, setLaedt] = useState(false);
  const [gewaehlt, setGewaehlt] = useState<Zeile | null>(null);
  const [format, setFormat] = useState<TestFormat>('xrechnung');
  const profil: ERechnungProfil = format === 'zugferd' ? 'en16931' : format;
  const [ableiten, setAbleiten] = useState(true);
  const [ergebnis, setErgebnis] = useState<{
    abbildung: Abbildung; maengel: Mangel[]; quelle: ERechnungQuelle; firma: Firmendaten; ausSnapshot: boolean;
  } | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [erzeugt, setErzeugt] = useState(false);

  const ladeListe = useCallback(async (q: string) => {
    setLaedt(true);
    let anfrage = supabase.from('rechnungen')
      .select('id, rechnungsnummer, datum, status, brutto_summe, rechnungsadresse_firma, ansprechpartner, ist_auslagen_rechnung')
      .order('datum', { ascending: false })
      .limit(50);
    const s = q.trim().replace(/[,()*%\\]/g, ' ').trim();
    if (s) anfrage = anfrage.or(`rechnungsnummer.ilike.*${s}*,rechnungsadresse_firma.ilike.*${s}*`);
    const { data, error } = await anfrage;
    setLaedt(false);
    if (error) { setFehler(error.message); return; }
    setListe((data ?? []) as Zeile[]);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void ladeListe(suche); }, 250);
    return () => window.clearTimeout(t);
  }, [suche, ladeListe]);

  const pruefen = useCallback(async (z: Zeile, p: ERechnungProfil, abl: boolean) => {
    setFehler(null);
    setErgebnis(null);
    try {
      const quelle = await ladeERechnungQuelle(z.id);
      const { firma, ausSnapshot } = await firmendatenFuerBeleg(quelle.rechnung.absender_snapshot);
      const abbildung = bildeERechnung(quelle, { testAbleitung: abl, firma });
      const maengel = [...abbildung.hinweise, ...pruefeERechnung(abbildung.daten, p)];
      setErgebnis({ abbildung, maengel, quelle, firma, ausSnapshot });
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Laden fehlgeschlagen');
    }
  }, []);

  useEffect(() => {
    if (!gewaehlt) return;
    void Promise.resolve().then(() => pruefen(gewaehlt, profil, ableiten));
  }, [gewaehlt, profil, ableiten, pruefen]);

  async function herunterladen() {
    if (!ergebnis || !gewaehlt) return;
    setFehler(null);
    setErzeugt(true);
    try {
      const xml = erzeugeCii(ergebnis.abbildung.daten, profil);
      if (format === 'zugferd') {
        // Derselbe Weg wie beim Erstellen: ein PDF/A-3 mit eingebettetem XML.
        const r = ergebnis.quelle.rechnung;
        const [bilder, zugferd] = await Promise.all([
          ladeAbsenderBilder({ mitUnterschrift: r.mit_unterschrift ?? true, mitStempel: r.mit_stempel ?? true }),
          zugferdOption('zugferd', xml),
        ]);
        const pdf = await generateRechnungPdf(rechnungPdfInputAus({
          rechnung: r, positionen: ergebnis.quelle.positionen, auftraggeber: ergebnis.quelle.auftraggeber,
          firma: ergebnis.firma, ausSnapshot: ergebnis.ausSnapshot, erechnung: ergebnis.abbildung.daten, bilder, zugferd,
        }));
        speichern(pdf, testDateiname(gewaehlt.rechnungsnummer, 'pdf'));
        return;
      }
      const kommentar = `<!-- TESTDATEI — nur zur Prüfung, NICHT an Kunden senden. Erzeugt ${new Date().toLocaleString('de-DE')} (Profil ${profil}). -->\n`;
      const mitKommentar = xml.replace(/^(<\?xml[^>]*\?>\n)/, `$1${kommentar}`);
      speichern(new Blob([mitKommentar], { type: 'application/xml' }), testDateiname(gewaehlt.rechnungsnummer));
    } catch (e) {
      setFehler(e instanceof ERechnungAbbruch ? e.message : (e instanceof Error ? e.message : 'Erzeugung fehlgeschlagen'));
    } finally {
      setErzeugt(false);
    }
  }

  if (schemaOk === false) {
    return (
      <div role="status" className="card p-6 text-sm text-maja-muted">
        Die E-Rechnung ist noch nicht eingerichtet: Migration 115 fehlt in der Datenbank.
      </div>
    );
  }

  const fehlerAnzahl = ergebnis?.maengel.filter((m) => m.schwere === 'fehler').length ?? 0;
  const abbruch = ergebnis?.abbildung.abbruch ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-maja-navy">E-Rechnung (Test)</h2>
        <p className="text-sm text-maja-muted">
          Erzeugt die E-Rechnung (XML in CII-Syntax oder ZUGFeRD-PDF) einer bestehenden Rechnung zur Prüfung.
          Es wird nichts gespeichert, nichts versendet und an der Rechnung nichts geändert.
        </p>
      </div>

      <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:!border-amber-500/60 dark:!bg-amber-900/30 dark:!text-amber-100">
        Nur zur Prüfung — nicht an Kunden senden. Die Testdatei wird weder archiviert noch versendet.
      </div>

      <section className="card space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <div>
            <label htmlFor="ert-suche" className="label">Rechnung suchen (Nummer oder Empfänger)</label>
            <input id="ert-suche" className="input" value={suche} placeholder="z.B. Re_26/12 oder Firmenname"
                   onChange={(e) => setSuche(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ert-profil" className="label">Format</label>
            <select id="ert-profil" className="input" value={format}
                    onChange={(e) => setFormat(e.target.value as TestFormat)}>
              <option value="xrechnung">XRechnung (XML)</option>
              <option value="en16931">E-Rechnung EN 16931 (XML)</option>
              <option value="zugferd">ZUGFeRD (PDF mit eingebettetem XML)</option>
            </select>
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm text-maja-ink">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-maja-navy/30" checked={ableiten}
                 onChange={(e) => setAbleiten(e.target.checked)} />
          <span>
            Bei älteren Rechnungen fehlende Angaben für den Test ableiten
            <span className="block text-xs text-maja-muted">
              PLZ/Ort aus dem bisherigen Adressfeld, Ländercode aus dem Land, E-Rechnungs-Adresse und Käuferreferenz
              aus den aktuellen Auftraggeber-Daten — jeweils mit Hinweis. Nur für diesen Test.
            </span>
          </span>
        </label>

        <div className="max-h-72 overflow-auto rounded-md border border-maja-navy/10">
          {laedt && liste.length === 0 ? (
            <p className="p-3 text-sm text-maja-muted">Lädt …</p>
          ) : liste.length === 0 ? (
            <p className="p-3 text-sm text-maja-muted">Keine Rechnungen gefunden.</p>
          ) : (
            <ul className="divide-y divide-maja-navy/10" aria-label="Rechnungen">
              {liste.map((z) => (
                <li key={z.id}>
                  <button type="button"
                          aria-pressed={gewaehlt?.id === z.id}
                          className={`flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-maja-light ${gewaehlt?.id === z.id ? 'bg-maja-light font-medium' : ''}`}
                          onClick={() => setGewaehlt(z)}>
                    <span className="min-w-0">
                      <span className="text-maja-ink">{z.rechnungsnummer}</span>
                      <span className="ml-2 text-maja-muted">{formatDate(z.datum)} · {z.rechnungsadresse_firma || z.ansprechpartner || '—'}</span>
                      {z.ist_auslagen_rechnung && <span className="ml-2 text-xs text-maja-muted">(Auslagenrechnung)</span>}
                    </span>
                    <span className="text-maja-muted">{eur(Number(z.brutto_summe))} · {z.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {fehler && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>}

      {gewaehlt && ergebnis && (
        <section className="card space-y-3 p-4" data-testid="ert-ergebnis">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-maja-navy">
              {gewaehlt.rechnungsnummer} — Pflichtfeld-Prüfung ({FORMAT_NAME[format]})
            </h3>
            <button type="button" className="btn-primary" disabled={!!abbruch || erzeugt} onClick={() => void herunterladen()}>
              {erzeugt ? 'Erzeuge …' : format === 'zugferd' ? 'ZUGFeRD-PDF herunterladen (_TEST)' : 'XML herunterladen (_TEST)'}
            </button>
          </div>

          {abbruch ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{abbruch}</p>
          ) : fehlerAnzahl > 0 ? (
            <p className="text-sm text-red-700 dark:!text-red-300">
              {fehlerAnzahl} {fehlerAnzahl === 1 ? 'Angabe fehlt' : 'Angaben fehlen'} oder {fehlerAnzahl === 1 ? 'ist' : 'sind'} ungültig — die Datei
              würde den Validator so nicht bestehen. Download zur Ansicht trotzdem möglich.
            </p>
          ) : (
            <p className="text-sm text-emerald-700 dark:!text-emerald-300">Keine fehlenden Pflichtangaben gefunden. Verbindlich ist erst der Validator-Bericht.</p>
          )}

          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <dt className="text-maja-muted">Netto</dt><dd>{eur(ergebnis.abbildung.daten.summen.netto)}</dd>
            <dt className="text-maja-muted">USt</dt><dd>{eur(ergebnis.abbildung.daten.summen.ust)}</dd>
            <dt className="text-maja-muted">Brutto</dt><dd>{eur(ergebnis.abbildung.daten.summen.brutto)}</dd>
            <dt className="text-maja-muted">Fällig</dt><dd>{ergebnis.abbildung.daten.faelligAm ? formatDate(ergebnis.abbildung.daten.faelligAm) : '—'}</dd>
          </dl>

          {ergebnis.maengel.length > 0 && (
            <ul className="space-y-1 text-sm" aria-label="Prüfergebnis">
              {(['fehler', 'warnung', 'hinweis'] as const).flatMap((st) => ergebnis.maengel
                .filter((m) => m.schwere === st)
                .map((m, i) => (
                  <li key={`${st}-${i}`} className={STUFE[st].cls}>
                    <span className="font-medium">{STUFE[st].label}:</span> {m.text}
                    <span className="ml-1 text-xs text-maja-muted">({m.bt})</span>
                  </li>
                )))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

// Versandstatus für bestehende Rechnungen/Gutschriften übernehmen.
//
// 1) Probelauf (schreibt nichts): gespeichertes Versanddatum der App
//    (email_versendet_am) → „Versendet (App)"; sonst Mail in „Gesendete
//    Elemente" mit EXAKT passender Nummer im Betreff/Anhang → „Versendet
//    (App)" mit dem Datum der Mail; Rest → „Nicht versendet". Ergebnis
//    als Zahlen + Liste, kopierbar. Erst „Übernehmen" schreibt.
// 2) Altfälle: „Alle bis Datum X als versendet markieren" (Weg
//    „rückwirkend") mit Vorschau der betroffenen Belege und Bestätigung.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { loadMailboxes } from '../../lib/mailboxSettings';
import { listGesendeteMails } from '../../lib/emails';
import {
  probelauf, probelaufUebernehmen, versandRelevant, versandStatus,
  type BelegTyp, type ProbelaufBeleg, type ProbelaufErgebnis, type VersandEintrag,
} from '../../lib/belegVersand';
import { formatDate, formatDateTime } from '../../lib/touren';
import { XIcon } from '../icons';

export function VersandAltbestandDialog({
  typ, belege, versand, onClose, onDone,
}: {
  typ: BelegTyp;
  belege: ProbelaufBeleg[];
  versand: Map<string, VersandEintrag[]>;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const wort = typ === 'rechnung' ? 'Rechnungen' : 'Gutschriften';
  const [postfaecher, setPostfaecher] = useState<Array<{ address: string; label: string; an: boolean }>>([]);
  const [laeuft, setLaeuft] = useState(false);
  const [erg, setErg] = useState<ProbelaufErgebnis | null>(null);
  const [mailInfo, setMailInfo] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [frage, setFrage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kopiert, setKopiert] = useState(false);
  // Altfälle bis Datum X
  const [bis, setBis] = useState('');
  const [vorschau, setVorschau] = useState<Array<{ beleg_id: string; nummer: string; datum: string; status: string }> | null>(null);
  const [bisFrage, setBisFrage] = useState(false);

  useEffect(() => {
    void loadMailboxes().then((m) => setPostfaecher(
      m.filter((x) => x.address).map((x) => ({ address: x.address, label: x.label || x.address, an: x.key === 'mail_inbox_1' })),
    ));
  }, []);

  const offen = useMemo(
    () => belege.filter((b) => versandRelevant(typ, b.status) && !versandStatus(typ, b.status, versand.get(b.id) ?? []).letzter),
    [belege, versand, typ],
  );

  async function starten() {
    setLaeuft(true); setFehler(null); setErg(null); setMailInfo(null);
    try {
      const seit = offen.reduce((m, b) => (b.datum < m ? b.datum : m), offen[0]?.datum ?? new Date().toISOString().slice(0, 10));
      const mails: Array<{ subject: string; sentDateTime: string; to: string[]; attachments: string[] }> = [];
      const infos: string[] = [];
      for (const p of postfaecher.filter((x) => x.an)) {
        const r = await listGesendeteMails(p.address, seit);
        mails.push(...r.value);
        infos.push(`${p.address}: ${r.value.length} gesendete Mails seit ${formatDate(seit)}${r.abgeschnitten ? ' (gekürzt — ältere nicht geprüft)' : ''}`);
      }
      setMailInfo(infos.length ? infos.join(' · ') : 'Kein Postfach einbezogen.');
      setErg(probelauf(typ, belege, versand, mails));
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Probelauf fehlgeschlagen');
    } finally {
      setLaeuft(false);
    }
  }

  function berichtText(e: ProbelaufErgebnis): string {
    const zeilen = [
      `Probelauf Versandstatus ${wort} (${formatDateTime(new Date().toISOString())})`,
      `Versendet (App) – aus gespeichertem Versanddatum: ${e.ausDatenbank.length}`,
      `Versendet (App) – aus „Gesendete Elemente": ${e.ausPostfach.length}`,
      `Bereits mit Versandstatus: ${e.schonMitStatus.length}`,
      `Entwürfe/storniert (kein Hinweis): ${e.ohneHinweis.length}`,
      `Nicht versendet: ${e.nichtVersendet.length}`,
      '',
      'Nicht versendet:',
      ...e.nichtVersendet.map((b) => `${b.nummer}\t${formatDate(b.datum)}\t${b.status}`),
    ];
    return zeilen.join('\n');
  }

  async function uebernehmen() {
    if (!erg) return;
    setBusy(true);
    try {
      const r = await probelaufUebernehmen(typ, erg);
      onDone(`Versandstatus übernommen: ${r.uebernommen} ${wort} als „Versendet (App)" eingetragen${r.uebersprungen ? `, ${r.uebersprungen} übersprungen (inzwischen mit Status)` : ''}.`);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Übernehmen fehlgeschlagen');
      setBusy(false); setFrage(false);
    }
  }

  async function bisVorschau() {
    setFehler(null); setVorschau(null);
    const { data, error } = await supabase.rpc('beleg_versand_rueckwirkend', { p_typ: typ, p_bis: bis, p_ausfuehren: false });
    if (error) { setFehler(error.message); return; }
    setVorschau((data ?? []) as Array<{ beleg_id: string; nummer: string; datum: string; status: string }>);
  }

  async function bisAusfuehren() {
    setBusy(true);
    const { data, error } = await supabase.rpc('beleg_versand_rueckwirkend', { p_typ: typ, p_bis: bis, p_ausfuehren: true });
    if (error) { setFehler(error.message); setBusy(false); setBisFrage(false); return; }
    onDone(`${(data ?? []).length} ${wort} bis ${formatDate(bis)} als „rückwirkend versendet" markiert.`);
  }

  const zahl = (n: number, text: string, cls = '') => (
    <div className={`rounded-lg border border-maja-navy/10 px-3 py-2 ${cls}`}>
      <div className="text-xl font-semibold tabular-nums">{n}</div>
      <div className="text-xs">{text}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8 dark:bg-black/60">
      <div role="dialog" aria-modal="true" aria-labelledby="altbestand-titel" className="card w-full max-w-3xl space-y-5 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="altbestand-titel" className="text-lg font-semibold text-maja-navy">Versandstatus für bestehende {wort}</h2>
            <p className="text-xs text-maja-muted">{offen.length} {wort} ohne Versandstatus (ohne Entwürfe/stornierte).</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Schließen" className="rounded-md p-1 text-maja-muted hover:bg-maja-light">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        {fehler && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>}

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-maja-navy">1. Probelauf — ändert nichts</h3>
          <p className="text-xs text-maja-muted">
            Geprüft wird das gespeicherte Versanddatum der App und — für den Rest — „Gesendete Elemente" der gewählten
            Postfächer (nur lesen). Die Nummer muss exakt im Betreff oder Anhangsnamen stehen („…/100" trifft nicht „…/1000").
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            {postfaecher.map((p, i) => (
              <label key={p.address} className="flex items-center gap-2">
                <input type="checkbox" checked={p.an}
                       onChange={(e) => setPostfaecher((l) => l.map((x, j) => (j === i ? { ...x, an: e.target.checked } : x)))} />
                {p.label}{p.label !== p.address ? ` (${p.address})` : ''}
              </label>
            ))}
            {postfaecher.length === 0 && <span className="text-xs text-maja-muted">Keine Postfächer eingerichtet — nur gespeicherte Versanddaten.</span>}
          </div>
          <button type="button" className="btn-primary text-sm" disabled={laeuft || offen.length === 0} onClick={() => void starten()}>
            {laeuft ? 'Prüft … (kann eine Minute dauern)' : 'Probelauf starten'}
          </button>
          {mailInfo && <p className="text-xs text-maja-muted">{mailInfo}</p>}
          {erg && (
            <div className="space-y-3" data-testid="probelauf-ergebnis">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {zahl(erg.ausDatenbank.length, 'Versendet (App) – gespeichertes Datum', 'bg-emerald-50 text-emerald-800')}
                {zahl(erg.ausPostfach.length, 'Versendet (App) – Gesendete Elemente', 'bg-emerald-50 text-emerald-800')}
                {zahl(erg.nichtVersendet.length, 'Nicht versendet', 'bg-amber-50 text-amber-900')}
                {zahl(erg.schonMitStatus.length, 'bereits mit Status', 'text-maja-ink')}
                {zahl(erg.ohneHinweis.length, 'Entwürfe/storniert', 'text-maja-muted')}
              </div>
              {erg.ausPostfach.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer font-medium text-maja-navy">In „Gesendete Elemente" gefunden ({erg.ausPostfach.length})</summary>
                  <ul className="mt-1 max-h-48 overflow-auto text-xs">
                    {erg.ausPostfach.map((b) => (
                      <li key={b.id}>{b.nummer} — {formatDateTime(b.zeitpunkt)} an {b.empfaenger.join(', ') || '—'} · „{b.betreff}"</li>
                    ))}
                  </ul>
                </details>
              )}
              <details className="text-sm" open={erg.nichtVersendet.length <= 30}>
                <summary className="cursor-pointer font-medium text-maja-navy">Nicht versendet ({erg.nichtVersendet.length})</summary>
                <ul className="mt-1 max-h-60 overflow-auto text-xs">
                  {erg.nichtVersendet.map((b) => <li key={b.id}>{b.nummer} — {formatDate(b.datum)} · {b.status}</li>)}
                </ul>
              </details>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary text-sm" onClick={() => {
                  void navigator.clipboard?.writeText(berichtText(erg)).then(() => setKopiert(true));
                }}>{kopiert ? 'Kopiert ✓' : 'Ergebnis als Text kopieren'}</button>
                <button type="button" className="btn-primary text-sm"
                        disabled={erg.ausDatenbank.length + erg.ausPostfach.length === 0}
                        onClick={() => setFrage(true)}>
                  {erg.ausDatenbank.length + erg.ausPostfach.length} als „Versendet (App)" übernehmen …
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3 border-t border-maja-navy/10 pt-4">
          <h3 className="text-sm font-semibold text-maja-navy">2. Altfälle: alle bis Datum als versendet markieren</h3>
          <p className="text-xs text-maja-muted">
            Für längst erledigte {wort}: alle ohne Versandstatus bis einschließlich Datum werden als „rückwirkend markiert"
            eingetragen. Erst Vorschau, dann Bestätigung. Rücknahme einzeln über „Markierung entfernen".
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="altbestand-bis" className="label">Bis Rechnungsdatum</label>
              <input id="altbestand-bis" type="date" className="input" value={bis} onChange={(e) => { setBis(e.target.value); setVorschau(null); }} />
            </div>
            <button type="button" className="btn-secondary text-sm" disabled={!bis} onClick={() => void bisVorschau()}>Vorschau</button>
          </div>
          {vorschau && (
            <div className="space-y-2 text-sm" data-testid="rueckwirkend-vorschau">
              <p><strong>{vorschau.length}</strong> {wort} würden markiert.</p>
              {vorschau.length > 0 && (
                <ul className="max-h-48 overflow-auto text-xs">
                  {vorschau.map((v) => <li key={v.beleg_id}>{v.nummer} — {formatDate(v.datum)} · {v.status}</li>)}
                </ul>
              )}
              <button type="button" className="btn-primary text-sm" disabled={vorschau.length === 0} onClick={() => setBisFrage(true)}>
                {vorschau.length} als versendet markieren …
              </button>
            </div>
          )}
        </section>

        {frage && erg && (
          <Bestaetigung
            text={`${erg.ausDatenbank.length + erg.ausPostfach.length} ${wort} als „Versendet (App)" eintragen? Die ${erg.nichtVersendet.length} ohne Nachweis bleiben „Nicht versendet".`}
            label="Übernehmen" busy={busy} onJa={() => void uebernehmen()} onNein={() => setFrage(false)}
          />
        )}
        {bisFrage && vorschau && (
          <Bestaetigung
            text={`${vorschau.length} ${wort} bis ${formatDate(bis)} als „rückwirkend versendet" markieren?`}
            label="Markieren" busy={busy} onJa={() => void bisAusfuehren()} onNein={() => setBisFrage(false)}
          />
        )}
      </div>
    </div>
  );
}

function Bestaetigung({ text, label, busy, onJa, onNein }: {
  text: string; label: string; busy: boolean; onJa: () => void; onNein: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-maja-ink/40 px-4 dark:bg-black/60">
      <div role="alertdialog" aria-modal="true" className="card w-full max-w-sm p-5">
        <p className="text-sm text-maja-ink">{text}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onNein} disabled={busy}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={onJa} disabled={busy}>{busy ? '…' : label}</button>
        </div>
      </div>
    </div>
  );
}

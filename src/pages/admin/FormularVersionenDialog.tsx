// Eingänge (Admin): „Versionen / Wiederherstellen".
//
//   * Liste der serverseitigen Snapshots (Migration 107): Zeitpunkt,
//     Vorgang, Gerät/Modus, Anzahl ausgefüllter Felder — mit Vorschau
//   * „Diesen Stand wiederherstellen": setzt die Formularwerte zurück; der
//     aktuelle Stand wird vorher selbst als Version gesichert
//   * Notfall „Fotos aus OneDrive zuordnen": Werte verloren, Fotos aber
//     hochgeladen → Dateien des Formularordners den Bildfeldern zuordnen
//     (lib/fotoZuordnung). Textfelder müssen dann neu ausgefüllt werden.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { XIcon } from '../../components/icons';
import { felderAnzahl } from '../../lib/entwurfStand';
import { wertAnzeige } from '../../lib/formularUebertragung';
import { listeOneDriveOrdner } from '../../lib/onedrive';
import { buildFormularFolder, kennzeichenAusDaten } from '../../lib/onedrivePaths';
import { datenMitFotos, fotosZuordnen, ordnerKandidaten } from '../../lib/fotoZuordnung';
import { formatDateTime } from '../../lib/touren';
import type { FormSchema } from '../../types/db';
import type { Json } from '../../types/supabase';

interface Version {
  id: string;
  erstellt_am: string;
  aktualisiert_am: string;
  vorgang: string | null;
  app_modus: string | null;
  felder_anzahl: number;
  daten: Record<string, unknown>;
}

interface Props {
  formular: {
    id: string;
    status: string;
    created_at: string;
    daten: Record<string, unknown>;
    templateName: string;
    schema: FormSchema;
  };
  onClose: () => void;
  onDone: (text: string) => void;
}

const VORGANG: Record<string, string> = {
  autosave: 'automatisch', hintergrund: 'App in den Hintergrund', seitenwechsel: 'Seitenwechsel',
  entwurf: '„Entwurf speichern"', nachgeholt: 'nachgeholt (war offline)', konflikt_aufgeloest: 'nach Konflikt übernommen',
  verworfen_geraet: 'Gerätestand (verworfen)', verworfen_server: 'Serverstand (verworfen)', bestand: 'Stand vor Einführung',
  admin_wiederherstellung: 'Admin: wiederhergestellt', vor_wiederherstellung: 'vor Wiederherstellung',
  admin_fotos_zugeordnet: 'Admin: Fotos zugeordnet', vor_fotos_zugeordnet: 'vor Foto-Zuordnung',
  vor_zuweisung: 'vor Zuweisung an anderen Fahrer', nach_zuweisung_geraet: 'nach Zuweisung vom Gerät des früheren Fahrers eingegangen',
};
const vorgangText = (v: string | null) => (v ? (VORGANG[v] ?? v) : 'unbekannt');

function fotoAnzahl(d: Record<string, unknown>): number {
  return (JSON.stringify(d).match(/"storage_path"/g) ?? []).length;
}

export function FormularVersionenDialog({ formular, onClose, onDone }: Props) {
  const [versionen, setVersionen] = useState<Version[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [offen, setOffen] = useState<string | null>(null);
  const [frage, setFrage] = useState<Version | null>(null);
  const [alsEntwurf, setAlsEntwurf] = useState(formular.status !== 'draft');
  const [busy, setBusy] = useState(false);
  const [zuweisungen, setZuweisungen] = useState<Array<{ id: string; zugewiesen_am: string; von_name: string | null; an_name: string | null; notiz: string | null; tour_mitgenommen: boolean }>>([]);
  const felder = useMemo(() => (formular.schema.sections ?? []).flatMap((s) => s.fields ?? []), [formular.schema]);

  useEffect(() => {
    let weg = false;
    void supabase.from('formular_entwurf_versionen')
      .select('id, erstellt_am, aktualisiert_am, vorgang, app_modus, felder_anzahl, daten')
      .eq('formular_id', formular.id)
      .order('erstellt_am', { ascending: false })
      .then(({ data, error }) => {
        if (weg) return;
        if (error) setFehler(error.message);
        setVersionen((data as unknown as Version[]) ?? []);
      });
    void supabase.from('formular_zuweisungen')
      .select('id, zugewiesen_am, von_name, an_name, notiz, tour_mitgenommen')
      .eq('formular_id', formular.id).order('zugewiesen_am', { ascending: false })
      .then(({ data }) => { if (!weg) setZuweisungen((data as never) ?? []); });
    return () => { weg = true; };
  }, [formular.id]);

  async function wiederherstellen(v: Version) {
    setBusy(true); setFehler(null);
    const { error } = await supabase.rpc('formular_daten_admin_setzen', {
      p_formular_id: formular.id, p_daten: v.daten as Json, p_vorgang: 'wiederherstellung', p_als_entwurf: alsEntwurf,
    });
    setBusy(false);
    if (error) { setFehler(error.message); return; }
    onDone(`Stand vom ${formatDateTime(v.aktualisiert_am)} wiederhergestellt (${v.felder_anzahl} Felder). Der vorherige Stand ist als Version gesichert.`);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8 dark:bg-black/60">
      <div role="dialog" aria-modal="true" aria-labelledby="versionen-titel" className="card w-full max-w-3xl p-6">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="versionen-titel" className="text-lg font-semibold text-maja-navy">Versionen / Wiederherstellen</h2>
            <p className="text-xs text-maja-muted">
              {formular.templateName} · angelegt {formatDateTime(formular.created_at)} · aktuell {felderAnzahl(formular.daten)} ausgefüllte Felder, {fotoAnzahl(formular.daten)} Fotos
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Schließen" className="rounded-md p-1 text-maja-muted hover:bg-maja-light">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {fehler && <div role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>}

        {zuweisungen.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-maja-navy">Zuweisungen</h3>
            <ul className="mt-1 space-y-0.5 text-xs text-maja-ink">
              {zuweisungen.map((z) => (
                <li key={z.id}>
                  {formatDateTime(z.zugewiesen_am)}: von {z.von_name ?? '—'} an {z.an_name ?? '—'}
                  {z.tour_mitgenommen ? ' (Tour mitgenommen)' : ''}{z.notiz ? ` — „${z.notiz}"` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        <h3 className="text-sm font-semibold text-maja-navy">Gespeicherte Stände</h3>
        {versionen == null ? (
          <p className="mt-1 text-sm text-maja-muted">Lade …</p>
        ) : versionen.length === 0 ? (
          <p className="mt-1 text-sm text-maja-muted">Keine Versionen vorhanden (Versionen gibt es ab Migration 107).</p>
        ) : (
          <ul className="mt-1 divide-y divide-maja-navy/10">
            {versionen.map((v) => (
              <li key={v.id} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 text-sm">
                    <span className="font-medium text-maja-ink">{formatDateTime(v.aktualisiert_am)}</span>
                    <span className="text-maja-muted"> · {vorgangText(v.vorgang)}{v.app_modus ? ` · ${v.app_modus === 'app' ? 'installierte App' : v.app_modus === 'browser' ? 'Browser' : v.app_modus}` : ''}</span>
                    <div className="text-xs text-maja-muted">{v.felder_anzahl} ausgefüllte Felder · {fotoAnzahl(v.daten)} Fotos</div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => setOffen(offen === v.id ? null : v.id)}>
                      {offen === v.id ? 'Vorschau schließen' : 'Vorschau'}
                    </button>
                    <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={busy} onClick={() => setFrage(v)}>
                      Diesen Stand wiederherstellen
                    </button>
                  </div>
                </div>
                {offen === v.id && (
                  <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 rounded-lg bg-maja-light/60 p-3 text-xs sm:grid-cols-[auto_1fr] dark:!bg-slate-800">
                    {felder.filter((f) => wertAnzeige(f.type, v.daten[f.id])).map((f) => (
                      <div key={f.id} className="contents">
                        <dt className="font-medium text-maja-muted">{f.label}</dt>
                        <dd className="break-words text-maja-ink">{wertAnzeige(f.type, v.daten[f.id])}</dd>
                      </div>
                    ))}
                    {felder.every((f) => !wertAnzeige(f.type, v.daten[f.id])) && <dd className="text-maja-muted">Keine ausgefüllten Felder.</dd>}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}

        <FotosAusOneDrive formular={formular} onDone={onDone} />

        {frage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-maja-ink/40 px-4 dark:bg-black/60">
            <div role="dialog" aria-modal="true" aria-labelledby="wh-titel" className="card w-full max-w-md p-5">
              <h3 id="wh-titel" className="text-base font-semibold text-maja-navy">Stand wiederherstellen?</h3>
              <p className="mt-1 text-sm text-maja-ink">
                Die Formularwerte werden auf den Stand vom {formatDateTime(frage.aktualisiert_am)} ({frage.felder_anzahl} Felder) gesetzt.
                Der aktuelle Stand ({felderAnzahl(formular.daten)} Felder) wird vorher als Version gesichert.
              </p>
              {formular.status !== 'draft' && (
                <label className="mt-2 flex items-start gap-2 text-sm text-maja-ink">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={alsEntwurf} onChange={(e) => setAlsEntwurf(e.target.checked)} />
                  Formular wieder als Entwurf freigeben, damit der Fahrer weitermachen kann
                </label>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setFrage(null)} disabled={busy}>Abbrechen</button>
                <button type="button" className="btn-primary" disabled={busy} onClick={() => void wiederherstellen(frage)}>
                  {busy ? 'Stellt wieder her …' : 'Wiederherstellen'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Notfall: Fotos des Formularordners wieder den Bildfeldern zuordnen. */
function FotosAusOneDrive({ formular, onDone }: Pick<Props, 'formular' | 'onDone'>) {
  const [aktiv, setAktiv] = useState(false);
  const [kandidaten, setKandidaten] = useState<string[] | null>(null);
  const [ordner, setOrdner] = useState<string | null>(null);
  const [dateien, setDateien] = useState<string[] | null>(null);
  const [manuell, setManuell] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  // Schon (leer) eingereicht? Dann wieder freigeben, damit der Fahrer die
  // Textfelder neu ausfüllen kann.
  const [alsEntwurf, setAlsEntwurf] = useState(formular.status !== 'draft');
  const datum = formular.created_at.slice(0, 10);
  const monat = `Maja-Logistik/Formulare/${datum.slice(0, 7)}`;
  const bildfelder = (formular.schema.sections ?? []).flatMap((s) => s.fields ?? [])
    .filter((f) => f.type === 'photo' || f.type === 'stamp' || f.type === 'dynamic_photos');

  async function suchen() {
    setAktiv(true); setFehler(null);
    try {
      const namen = (await listeOneDriveOrdner(monat)).filter((i) => i.isFolder).map((i) => i.name);
      const k = ordnerKandidaten(namen, datum, formular.templateName);
      // Ordner nach aktuellem Kennzeichen zuerst (falls noch bekannt).
      const erwartet = buildFormularFolder({
        date: datum, kennzeichen: kennzeichenAusDaten(formular.daten), templateName: formular.templateName, formularId: formular.id,
      }).split('/').pop()!;
      k.sort((a, b) => (a === erwartet ? -1 : b === erwartet ? 1 : 0));
      setKandidaten(k);
      if (k.length === 1) void ordnerWaehlen(k[0]);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
      setKandidaten([]);
    }
  }
  async function ordnerWaehlen(name: string) {
    setOrdner(name); setDateien(null); setManuell({});
    try {
      const items = await listeOneDriveOrdner(`${monat}/${name}/Fotos`);
      setDateien(items.filter((i) => !i.isFolder).map((i) => i.name));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
      setDateien([]);
    }
  }
  const plan = useMemo(() => (dateien ? fotosZuordnen(formular.schema, dateien) : null), [dateien, formular.schema]);
  // Dateien im Ordner, auf die das Formular nicht verweist — z.B. Fotos,
  // die nach einer Zuweisung noch vom Gerät des früheren Fahrers kamen.
  const nichtImFormular = useMemo(() => {
    if (!dateien || !ordner) return [] as string[];
    const json = JSON.stringify(formular.daten);
    return dateien.filter((n) => /\.(jpe?g|png|webp|heic)$/i.test(n) && !json.includes(`/${ordner}/Fotos/${n}`));
  }, [dateien, ordner, formular.daten]);

  async function uebernehmen() {
    if (!plan || !ordner) return;
    const zuordnung: Record<string, string[]> = Object.fromEntries(Object.entries(plan.zuordnung).map(([k, v]) => [k, [...v]]));
    for (const [datei, feld] of Object.entries(manuell)) {
      if (!feld) continue;
      (zuordnung[feld] ??= []).push(datei);
    }
    const r = datenMitFotos(formular.daten, formular.schema, zuordnung, `${monat}/${ordner}/Fotos`);
    if (r.gesetzt === 0) { setFehler('Nichts zu übernehmen — die Felder sind schon belegt.'); return; }
    setBusy(true); setFehler(null);
    const { error } = await supabase.rpc('formular_daten_admin_setzen', {
      p_formular_id: formular.id, p_daten: r.daten as Json, p_vorgang: 'fotos_zugeordnet', p_als_entwurf: alsEntwurf,
    });
    setBusy(false);
    if (error) { setFehler(error.message); return; }
    onDone(`${r.gesetzt} ${r.gesetzt === 1 ? 'Foto' : 'Fotos'} aus OneDrive zugeordnet. Textfelder müssen ggf. neu ausgefüllt werden.`);
  }

  return (
    <div className="mt-5 border-t border-maja-navy/10 pt-4">
      <h3 className="text-sm font-semibold text-maja-navy">Notfall: Fotos aus OneDrive zuordnen</h3>
      <p className="mt-0.5 text-xs text-maja-muted">
        Für den Fall, dass Werte verloren sind, die Fotos aber hochgeladen wurden. Übernommen wird nur in leere Bildfelder.
      </p>
      {!aktiv ? (
        <button type="button" className="btn-secondary mt-2 px-3 py-1 text-xs" onClick={() => void suchen()}>Fotos im OneDrive suchen</button>
      ) : (
        <div className="mt-2 space-y-2 text-sm">
          {fehler && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{fehler}</div>}
          {kandidaten == null && <p className="text-xs text-maja-muted">Suche Ordner vom {datum} …</p>}
          {kandidaten && kandidaten.length === 0 && <p className="text-xs text-maja-muted">Kein Ordner mit Datum {datum} und diesem Template gefunden.</p>}
          {kandidaten && kandidaten.length > 1 && (
            <div>
              <p className="text-xs text-maja-muted">Mehrere passende Ordner — bitte wählen:</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {kandidaten.map((k) => (
                  <button key={k} type="button" onClick={() => void ordnerWaehlen(k)}
                          className={`rounded-full border px-3 py-1 text-xs ${ordner === k ? 'border-maja-navy bg-maja-navy text-white dark:!bg-sky-600' : 'border-maja-navy/15'}`}>
                    {k}
                  </button>
                ))}
              </div>
            </div>
          )}
          {ordner && dateien == null && <p className="text-xs text-maja-muted">Lade Fotos aus {ordner} …</p>}
          {plan && (
            <>
              {nichtImFormular.length > 0 && (
                <p className="text-xs text-amber-800 dark:!text-amber-300">
                  {nichtImFormular.length} {nichtImFormular.length === 1 ? 'Datei liegt' : 'Dateien liegen'} im Ordner, {nichtImFormular.length === 1 ? 'ist' : 'sind'} aber nicht im Formular
                  (z.B. nachträglich eingegangen). Übernommen wird nur in leere Felder — belegte Felder bleiben.
                </p>
              )}
              <ul className="space-y-0.5 text-xs">
                {bildfelder.map((f) => (
                  <li key={f.id}><span className="font-medium text-maja-ink">{f.label}</span>: <span className="text-maja-muted">
                    {plan.zuordnung[f.id]?.length ? `${plan.zuordnung[f.id].length} ${plan.zuordnung[f.id].length === 1 ? 'Datei' : 'Dateien'}` : '—'}
                  </span></li>
                ))}
              </ul>
              {plan.unklar.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-maja-ink">Nicht eindeutig zuordenbar:</p>
                  <ul className="mt-1 space-y-1">
                    {plan.unklar.map((d) => (
                      <li key={d} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="break-all text-maja-muted">{d}</span>
                        <select className="tf-input max-w-[14rem] py-1 text-xs" value={manuell[d] ?? ''}
                                onChange={(e) => setManuell((m) => ({ ...m, [d]: e.target.value }))}>
                          <option value="">nicht übernehmen</option>
                          {bildfelder.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                        </select>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {formular.status !== 'draft' && (
                <label className="flex items-start gap-2 text-xs text-maja-ink">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={alsEntwurf} onChange={(e) => setAlsEntwurf(e.target.checked)} />
                  Formular wieder als Entwurf freigeben, damit der Fahrer die übrigen Felder neu ausfüllen kann
                </label>
              )}
              <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={busy} onClick={() => void uebernehmen()}>
                {busy ? 'Übernehme …' : 'Zuordnung übernehmen'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

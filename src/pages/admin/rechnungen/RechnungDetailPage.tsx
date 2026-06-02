import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { Spinner } from '../../../components/Spinner';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { formatDate } from '../../../lib/touren';
import { berechneSummenProUst } from '../../../lib/rechnungsformat';
import { SummenBlock } from './SummenBlock';
import { PositionsTable } from './PositionsTable';
import { generateRechnungPdf, rechnungPdfFilename, type RechnungPdfPosition } from './rechnungPdf';
import {
  previewOneDrivePdf, triggerOneDriveDownload, uploadToOneDrive,
} from '../../../lib/onedrive';
import { RechnungStatusBadge } from './RechnungStatusBadge';
import type { EditorPosition } from './positionUtils';
import { emptyManuellePosition } from './positionUtils';
import type {
  Auftraggeber, Rechnung, Rechnungsadresse, Rechnungsposition, RechnungStatus,
} from '../../../types/db';

interface RechnungFull extends Rechnung {
  auftraggeber: Pick<
    Auftraggeber,
    'id' | 'name' | 'kontakt' | 'kunden_uid' | 'zahlungsziel_tage'
  > | null;
  /** Legacy: Touren-Rechnungen, die noch über FK zur rechnungsadressen-
   *  Tabelle verknüpft sind. Neue Rechnungen speichern die Adresse als
   *  Snapshot direkt in den rechnungsadresse_*-Spalten. */
  rechnungsadresse: Rechnungsadresse | null;
}

function todayIso(): string { return new Date().toISOString().slice(0, 10); }

/**
 * Editierbare Stammdaten-Snapshot-Felder. Werden initial aus rechnung
 * gefüllt und beim "Stammdaten speichern" als Update auf die Rechnung
 * geschrieben. Snapshot-Spalten sind absichtlich frei wählbar — dem
 * Buchhalter müssen nachträgliche Korrekturen offenstehen.
 */
interface KopfDraft {
  rechnungsnummer: string;
  datum: string;
  anrede: string;
  kundennummer: string;
  sachbearbeiter: string;
  ustSatz: string;
  firma: string;
  ansprechpartner: string;
  strasse: string;
  plz_ort: string;
  land: string;
}

function draftFromRechnung(r: RechnungFull): KopfDraft {
  const fallback = r.rechnungsadresse;
  return {
    rechnungsnummer: r.rechnungsnummer,
    datum: r.datum,
    anrede: r.anrede ?? '',
    kundennummer: r.kundennummer ?? '',
    sachbearbeiter: r.sachbearbeiter ?? '',
    ustSatz: String(Number(r.ust_satz)),
    firma:           r.rechnungsadresse_firma   ?? fallback?.firma           ?? '',
    ansprechpartner: r.ansprechpartner          ?? fallback?.ansprechpartner ?? '',
    strasse:         r.rechnungsadresse_strasse ?? fallback?.strasse         ?? '',
    plz_ort:         r.rechnungsadresse_plz_ort ?? fallback?.plz_ort         ?? '',
    land:            r.rechnungsadresse_land    ?? fallback?.land            ?? '',
  };
}

export function RechnungDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [rechnung, setRechnung] = useState<RechnungFull | null>(null);
  const [positionen, setPositionen] = useState<EditorPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingPos, setEditingPos] = useState(false);
  const [posEditConfirmOpen, setPosEditConfirmOpen] = useState(false);
  const [savingPositions, setSavingPositions] = useState(false);

  // Notizen: Auto-Save bei Blur.
  const [notizen, setNotizen] = useState('');
  const [savingNotizen, setSavingNotizen] = useState(false);

  // Status-Aktionen
  const [statusBusy, setStatusBusy] = useState(false);
  const [bezahltPicker, setBezahltPicker] = useState(false);
  const [bezahltAm, setBezahltAm] = useState<string>(todayIso());

  // Stammdaten-Editor
  const [editingKopf, setEditingKopf] = useState(false);
  const [kopfDraft, setKopfDraft] = useState<KopfDraft | null>(null);
  const [savingKopf, setSavingKopf] = useState(false);

  // Löschen
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // PDF-Generierung
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [rRes, pRes] = await Promise.all([
      supabase
        .from('rechnungen')
        .select(`
          *,
          auftraggeber:auftraggeber_id (id, name, kontakt, kunden_uid, zahlungsziel_tage),
          rechnungsadresse:rechnungsadresse_id (
            id, firma, ansprechpartner, strasse, plz_ort, land, ist_standard, auftraggeber_id, created_at
          )
        `)
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('rechnungspositionen')
        .select('*')
        .eq('rechnung_id', id)
        .order('position_nr', { ascending: true }),
    ]);
    if (rRes.error) { setError(rRes.error.message); setLoading(false); return; }
    if (!rRes.data) { setError('Rechnung nicht gefunden.'); setLoading(false); return; }
    if (pRes.error) { setError(pRes.error.message); setLoading(false); return; }
    const r = rRes.data as unknown as RechnungFull;
    setRechnung(r);
    setNotizen(r.notizen ?? '');
    setKopfDraft(draftFromRechnung(r));
    const rows = (pRes.data ?? []) as Rechnungsposition[];
    setPositionen(rows.map((p) => ({
      key: p.id,
      bezeichnung: p.bezeichnung,
      unterzeilen: p.unterzeilen ?? [],
      menge: Number(p.menge),
      einzelpreis: Number(p.einzelpreis),
      gesamtpreis: Number(p.gesamtpreis),
      tour_id: p.tour_id,
      zusatz_id: p.zusatz_id,
      ist_manuell: p.ist_manuell,
      ust_satz: p.ust_satz == null ? null : Number(p.ust_satz),
    })));
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Summen werden vom SummenBlock direkt aus positionen + Standard-Satz
  // berechnet — kein eigener Memo nötig.

  async function patchStatus(patch: Partial<Rechnung>) {
    if (!rechnung) return;
    setStatusBusy(true);
    const { error: err } = await supabase
      .from('rechnungen')
      .update(patch)
      .eq('id', rechnung.id);
    setStatusBusy(false);
    if (err) { setError(err.message); return; }
    await load();
  }

  async function speichereNotizen() {
    if (!rechnung) return;
    if (notizen === (rechnung.notizen ?? '')) return;
    setSavingNotizen(true);
    const { error: err } = await supabase
      .from('rechnungen')
      .update({ notizen: notizen || null })
      .eq('id', rechnung.id);
    setSavingNotizen(false);
    if (err) setError(err.message);
  }

  async function speichereKopf() {
    if (!rechnung || !kopfDraft) return;
    const draft = kopfDraft;
    if (!draft.rechnungsnummer.trim()) {
      setError('Rechnungsnummer darf nicht leer sein.');
      return;
    }
    if (!draft.datum) {
      setError('Rechnungsdatum ist Pflicht.');
      return;
    }
    const ustNum = Number(draft.ustSatz.replace(',', '.'));
    if (!Number.isFinite(ustNum) || ustNum < 0) {
      setError('USt-Satz ist ungültig.');
      return;
    }
    setSavingKopf(true);
    setError(null);
    try {
      // Bei USt-Änderung neue Summen mitschreiben (Netto bleibt gleich,
      // USt-Betrag und Brutto werden neu berechnet).
      const sum = berechneSummenProUst(positionen, ustNum);
      const { error: err } = await supabase
        .from('rechnungen')
        .update({
          rechnungsnummer: draft.rechnungsnummer.trim(),
          datum: draft.datum,
          anrede: draft.anrede || null,
          kundennummer: draft.kundennummer || null,
          sachbearbeiter: draft.sachbearbeiter || null,
          ust_satz: ustNum,
          ust_betrag: sum.ust,
          brutto_summe: sum.brutto,
          netto_summe: sum.netto,
          rechnungsadresse_firma:   draft.firma           || null,
          ansprechpartner:          draft.ansprechpartner || null,
          rechnungsadresse_strasse: draft.strasse         || null,
          rechnungsadresse_plz_ort: draft.plz_ort         || null,
          rechnungsadresse_land:    draft.land            || null,
        })
        .eq('id', rechnung.id);
      if (err) {
        const msg = err.message ?? String(err);
        const isDup = /duplicate key|unique|23505/i.test(msg)
          && /rechnungsnummer/i.test(msg);
        throw new Error(isDup
          ? `Rechnungsnummer „${draft.rechnungsnummer.trim()}" existiert bereits.`
          : msg);
      }
      setEditingKopf(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSavingKopf(false);
    }
  }

  async function speicherePositionen() {
    if (!rechnung) return;
    setSavingPositions(true);
    setError(null);
    try {
      // Lösche alle bestehenden Positionen und schreibe neu (mit position_nr
      // aus dem Index). Bei einer einzelnen Rechnung ist das stabil genug und
      // einfacher als ein Diff (neue/aktualisierte/gelöschte UUIDs zu tracken).
      const { error: delErr } = await supabase
        .from('rechnungspositionen').delete().eq('rechnung_id', rechnung.id);
      if (delErr) throw delErr;
      const rows = positionen.map((p, idx) => ({
        rechnung_id: rechnung.id,
        position_nr: idx + 1,
        bezeichnung: p.bezeichnung,
        unterzeilen: p.unterzeilen,
        menge: p.menge,
        einzelpreis: p.einzelpreis,
        gesamtpreis: p.gesamtpreis,
        tour_id: p.tour_id,
        zusatz_id: p.zusatz_id,
        ist_manuell: p.ist_manuell,
        ust_satz: p.ust_satz,
      }));
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from('rechnungspositionen').insert(rows);
        if (insErr) throw insErr;
      }
      const sum = berechneSummenProUst(positionen, Number(rechnung.ust_satz) || 0);
      const { error: uErr } = await supabase
        .from('rechnungen')
        .update({
          netto_summe: sum.netto,
          ust_betrag: sum.ust,
          brutto_summe: sum.brutto,
        })
        .eq('id', rechnung.id);
      if (uErr) throw uErr;
      setEditingPos(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSavingPositions(false);
    }
  }

  function startEditingPositions() {
    if (!rechnung) return;
    if (rechnung.status === 'bezahlt') {
      setPosEditConfirmOpen(true);
      return;
    }
    setEditingPos(true);
  }

  /**
   * Löscht die Rechnung endgültig. Positions-CASCADE räumt die
   * Positionen mit.
   *
   * PDF-Cleanup in OneDrive: Der bestehende /api/delete-pdf-Endpoint
   * arbeitet mit einer formular_id-basierten Auth (Pro-Resource-Check
   * für Formular-PDFs). Für Rechnungs-PDFs gibt es noch keine passende
   * Auth-Route — diese wird zusammen mit der PDF-Generierung im
   * nächsten Schritt nachgereicht. Bis dahin loggen wir die karteileiche-
   * Warnung, damit der Admin bei Bedarf manuell aufräumen kann.
   */
  async function loescheRechnung() {
    if (!rechnung) return;
    setDeleting(true);
    setError(null);
    try {
      if (rechnung.pdf_url) {
        console.warn(
          '[Rechnung löschen] OneDrive-PDF bleibt als Karteileiche, bis '
          + 'der dedizierte Delete-Endpoint mit PDF-Generierung kommt:',
          rechnung.pdf_url,
        );
      }
      const { error: err } = await supabase
        .from('rechnungen').delete().eq('id', rechnung.id);
      if (err) throw err;
      navigate('/rechnungen');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }

  /**
   * Generiert die Rechnungs-PDF im Browser (pdf-lib) und lädt sie nach
   * OneDrive hoch. Speichert den Pfad in rechnungen.pdf_url. Pfadstruktur:
   *   Maja-Logistik/Rechnungen/{Jahr}/Re-{Jahr}_N.pdf
   * "/" in der Rechnungsnummer wird durch "_" ersetzt, damit der
   * Dateiname keine Pfad-Trenner enthält.
   */
  async function generierePdf() {
    if (!rechnung) return;
    setGeneratingPdf(true);
    setError(null);
    try {
      const defaultSatz = Number(rechnung.ust_satz) || 0;
      const pdfPositionen: RechnungPdfPosition[] = positionen.map((p, idx) => ({
        position_nr: idx + 1,
        bezeichnung: p.bezeichnung,
        unterzeilen: p.unterzeilen,
        menge: Number(p.menge),
        einzelpreis: Number(p.einzelpreis),
        gesamtpreis: Number(p.gesamtpreis),
        ust_satz: p.ust_satz == null ? null : Number(p.ust_satz),
      }));
      // Fällig-Datum aus Auftraggeber-Zahlungsziel + Rechnungsdatum.
      const zahlungsziel = rechnung.auftraggeber?.zahlungsziel_tage ?? null;
      let faelligAm: string | null = null;
      if (zahlungsziel != null && Number.isFinite(zahlungsziel) && rechnung.datum) {
        const d = new Date(`${rechnung.datum}T12:00:00`);
        d.setDate(d.getDate() + Number(zahlungsziel));
        faelligAm = d.toISOString().slice(0, 10);
      }
      const blob = await generateRechnungPdf({
        rechnungsnummer: rechnung.rechnungsnummer,
        datum: rechnung.datum,
        anrede: rechnung.anrede,
        kundennummer: rechnung.kundennummer,
        sachbearbeiter: rechnung.sachbearbeiter,
        faelligAm,
        empfaenger: {
          firma:           rechnung.rechnungsadresse_firma   ?? rechnung.rechnungsadresse?.firma           ?? null,
          ansprechpartner: rechnung.ansprechpartner          ?? rechnung.rechnungsadresse?.ansprechpartner ?? null,
          strasse:         rechnung.rechnungsadresse_strasse ?? rechnung.rechnungsadresse?.strasse         ?? null,
          plz_ort:         rechnung.rechnungsadresse_plz_ort ?? rechnung.rechnungsadresse?.plz_ort         ?? null,
          land:            rechnung.rechnungsadresse_land    ?? rechnung.rechnungsadresse?.land            ?? null,
        },
        kundenUid: rechnung.auftraggeber?.kunden_uid ?? null,
        zahlungszielTage: zahlungsziel,
        ustSatzDefault: defaultSatz,
        positionen: pdfPositionen,
      });

      const jahr = (rechnung.datum ?? '').slice(0, 4) || String(new Date().getFullYear());
      const filename = rechnungPdfFilename(rechnung.rechnungsnummer);
      const path = `Maja-Logistik/Rechnungen/${jahr}/${filename}`;
      await uploadToOneDrive(path, blob);
      const { error: uErr } = await supabase
        .from('rechnungen').update({ pdf_url: path }).eq('id', rechnung.id);
      if (uErr) throw uErr;
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF-Generierung fehlgeschlagen');
    } finally {
      setGeneratingPdf(false);
    }
  }

  if (loading) return <Spinner label="Rechnung wird geladen …" />;
  if (error && !rechnung) {
    return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }
  if (!rechnung) return null;

  // Snapshot-Adresse hat Vorrang (so wie sie auf der Rechnung steht);
  // Legacy-FK ist Fallback für vor-Migration-041 angelegte Rechnungen.
  const adr = {
    firma: rechnung.rechnungsadresse_firma ?? rechnung.rechnungsadresse?.firma ?? null,
    ansprechpartner: rechnung.ansprechpartner ?? rechnung.rechnungsadresse?.ansprechpartner ?? null,
    strasse: rechnung.rechnungsadresse_strasse ?? rechnung.rechnungsadresse?.strasse ?? null,
    plz_ort: rechnung.rechnungsadresse_plz_ort ?? rechnung.rechnungsadresse?.plz_ort ?? null,
    land:    rechnung.rechnungsadresse_land    ?? rechnung.rechnungsadresse?.land    ?? null,
  };
  const hasAdresse = !!(adr.firma || adr.strasse || adr.plz_ort);
  const status: RechnungStatus = rechnung.status;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-maja-navy">{rechnung.rechnungsnummer}</h1>
            <RechnungStatusBadge status={status} />
            {rechnung.ist_auslagen_rechnung && (
              <span className="inline-flex rounded-full bg-maja-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-maja-accent">
                Auslagen
              </span>
            )}
          </div>
          <p className="text-sm text-maja-muted">
            {rechnung.auftraggeber?.name ?? '—'} · Zeitraum {formatDate(rechnung.leistungszeitraum_von)} – {formatDate(rechnung.leistungszeitraum_bis)}
            {' · '}Rechnungsdatum {formatDate(rechnung.datum)}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => navigate('/rechnungen')}>
          Zurück
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Status-Aktionen — Flow: Entwurf → Offen → Bezahlt. */}
      <section className="card flex flex-wrap items-center gap-2 p-4">
        {status === 'entwurf' && (
          <button
            type="button" className="btn-primary"
            disabled={statusBusy}
            onClick={() => void patchStatus({ status: 'offen' })}
          >Rechnung erstellen</button>
        )}
        {status === 'offen' && (
          <button
            type="button" className="btn-primary"
            disabled={statusBusy}
            onClick={() => setBezahltPicker(true)}
          >Als bezahlt markieren</button>
        )}
        {status === 'bezahlt' && (
          <>
            {rechnung.bezahlt_am && (
              <span className="text-sm text-emerald-700">
                Bezahlt am {formatDate(rechnung.bezahlt_am)}.
              </span>
            )}
            <button
              type="button" className="btn-secondary text-sm"
              disabled={statusBusy}
              onClick={() => void patchStatus({ status: 'offen', bezahlt_am: null })}
            >Zurück auf offen setzen</button>
          </>
        )}
        <span className="flex-1" />
      </section>

      {/* Stammdaten — editierbar */}
      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-maja-navy">Stammdaten</h2>
          {!editingKopf ? (
            <button
              type="button" className="btn-secondary text-sm"
              onClick={() => { setKopfDraft(draftFromRechnung(rechnung)); setEditingKopf(true); }}
            >Stammdaten bearbeiten</button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button" className="btn-primary text-sm"
                onClick={() => void speichereKopf()}
                disabled={savingKopf}
              >{savingKopf ? 'Speichert …' : 'Speichern'}</button>
              <button
                type="button" className="btn-secondary text-sm"
                onClick={() => { setEditingKopf(false); setKopfDraft(draftFromRechnung(rechnung)); }}
                disabled={savingKopf}
              >Abbrechen</button>
            </div>
          )}
        </div>

        {!editingKopf ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-maja-navy">Rechnungsadresse</h3>
              {hasAdresse ? (
                <address className="mt-1 not-italic text-sm text-maja-ink">
                  {adr.firma && <div className="font-medium">{adr.firma}</div>}
                  {adr.ansprechpartner && <div>{adr.ansprechpartner}</div>}
                  {adr.strasse && <div>{adr.strasse}</div>}
                  {adr.plz_ort && <div>{adr.plz_ort}</div>}
                  {adr.land && <div className="text-maja-muted">{adr.land}</div>}
                </address>
              ) : (
                <p className="mt-1 text-xs text-maja-muted">Keine Rechnungsadresse hinterlegt.</p>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-maja-navy">Anrede</h3>
                <p className="mt-1 text-sm text-maja-ink">{rechnung.anrede || '—'}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-maja-muted">Kundennummer</h4>
                  <p className="text-sm text-maja-ink">{rechnung.kundennummer || '—'}</p>
                </div>
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-maja-muted">Sachbearbeiter</h4>
                  <p className="text-sm text-maja-ink">{rechnung.sachbearbeiter || '—'}</p>
                </div>
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-maja-muted">USt-Satz</h4>
                  <p className="text-sm text-maja-ink">{Number(rechnung.ust_satz).toFixed(2)} %</p>
                </div>
              </div>
            </div>
          </div>
        ) : kopfDraft && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Rechnungsnummer" value={kopfDraft.rechnungsnummer}
                   onChange={(v) => setKopfDraft({ ...kopfDraft, rechnungsnummer: v })} />
            <Field label="Rechnungsdatum" type="date" value={kopfDraft.datum}
                   onChange={(v) => setKopfDraft({ ...kopfDraft, datum: v })} />
            <Field label="Anrede" value={kopfDraft.anrede}
                   onChange={(v) => setKopfDraft({ ...kopfDraft, anrede: v })} />
            <Field label="USt-Satz (%)" value={kopfDraft.ustSatz}
                   onChange={(v) => setKopfDraft({ ...kopfDraft, ustSatz: v })} />
            <Field label="Kundennummer" value={kopfDraft.kundennummer}
                   onChange={(v) => setKopfDraft({ ...kopfDraft, kundennummer: v })} />
            <Field label="Sachbearbeiter" value={kopfDraft.sachbearbeiter}
                   onChange={(v) => setKopfDraft({ ...kopfDraft, sachbearbeiter: v })} />
            <div className="sm:col-span-2 grid gap-3 rounded-lg bg-maja-light/40 p-3 sm:grid-cols-2">
              <h3 className="sm:col-span-2 text-sm font-semibold text-maja-navy">Rechnungsadresse</h3>
              <Field label="Firma" value={kopfDraft.firma}
                     onChange={(v) => setKopfDraft({ ...kopfDraft, firma: v })} />
              <Field label="Ansprechpartner" value={kopfDraft.ansprechpartner}
                     onChange={(v) => setKopfDraft({ ...kopfDraft, ansprechpartner: v })} />
              <Field label="Straße" value={kopfDraft.strasse}
                     onChange={(v) => setKopfDraft({ ...kopfDraft, strasse: v })} />
              <Field label="PLZ / Ort" value={kopfDraft.plz_ort}
                     onChange={(v) => setKopfDraft({ ...kopfDraft, plz_ort: v })} />
              <Field label="Land" value={kopfDraft.land}
                     onChange={(v) => setKopfDraft({ ...kopfDraft, land: v })} />
            </div>
          </div>
        )}
      </section>

      {/* Positionen */}
      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-maja-navy">Positionen</h2>
          <div className="flex items-center gap-2">
            {editingPos ? (
              <>
                <button
                  type="button" className="btn-secondary text-sm"
                  onClick={() => setPositionen((rows) => [...rows, emptyManuellePosition()])}
                >+ Position hinzufügen</button>
                <button
                  type="button" className="btn-primary text-sm"
                  onClick={() => void speicherePositionen()}
                  disabled={savingPositions}
                >{savingPositions ? 'Speichert …' : 'Speichern'}</button>
                <button
                  type="button" className="btn-secondary text-sm"
                  onClick={() => { setEditingPos(false); void load(); }}
                  disabled={savingPositions}
                >Abbrechen</button>
              </>
            ) : (
              <button
                type="button" className="btn-secondary text-sm"
                onClick={startEditingPositions}
              >Bearbeiten</button>
            )}
          </div>
        </div>
        <PositionsTable
          positionen={positionen}
          readOnly={!editingPos}
          defaultUstSatz={Number(rechnung.ust_satz) || 0}
          onChange={setPositionen}
        />
        <SummenBlock
          positionen={positionen}
          defaultSatz={Number(rechnung.ust_satz) || 0}
          prominent
        />
      </section>

      {/* Notizen */}
      <section className="card space-y-2 p-5">
        <h2 className="text-base font-semibold text-maja-navy">
          Interne Notizen
          {savingNotizen && <span className="ml-2 text-xs text-maja-muted">speichere …</span>}
        </h2>
        <textarea
          className="input min-h-[5rem]"
          value={notizen}
          onChange={(e) => setNotizen(e.target.value)}
          onBlur={() => void speichereNotizen()}
        />
      </section>

      {/* PDF-Bereich */}
      <section className="card space-y-2 p-5">
        <h2 className="text-base font-semibold text-maja-navy">PDF</h2>
        {rechnung.pdf_url ? (
          <RechnungPdfButtons
            pdfUrl={rechnung.pdf_url}
            filename={rechnungPdfFilename(rechnung.rechnungsnummer)}
            onRegenerate={() => void generierePdf()}
            regenerating={generatingPdf}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-maja-muted">Noch keine PDF generiert.</p>
            <button
              type="button" className="btn-primary text-sm"
              onClick={() => void generierePdf()}
              disabled={generatingPdf}
            >{generatingPdf ? 'Generiert …' : 'PDF generieren'}</button>
          </div>
        )}
      </section>

      {/* Löschen — bei jedem Status verfügbar */}
      <section className="flex justify-start pt-2">
        <button
          type="button"
          onClick={() => setDeleteConfirm(true)}
          disabled={deleting}
          className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          {deleting ? 'Lösche …' : 'Rechnung löschen'}
        </button>
      </section>

      {/* Confirm-Dialoge */}
      {posEditConfirmOpen && (
        <ConfirmDialog
          title="Rechnung ist bereits bezahlt"
          message={
            <>Diese Rechnung wurde bereits als bezahlt markiert —
              trotzdem bearbeiten? Änderungen an bezahlten Rechnungen
              sollten in der Buchhaltung nachvollziehbar bleiben.</>
          }
          confirmLabel="Trotzdem bearbeiten"
          onConfirm={async () => { setEditingPos(true); }}
          onClose={() => setPosEditConfirmOpen(false)}
        />
      )}
      {bezahltPicker && (
        <BezahltDialog
          initial={bezahltAm}
          onCancel={() => setBezahltPicker(false)}
          onConfirm={async (d) => {
            setBezahltAm(d);
            await patchStatus({ status: 'bezahlt', bezahlt_am: d });
            setBezahltPicker(false);
          }}
        />
      )}
      {deleteConfirm && (
        <ConfirmDialog
          title="Rechnung löschen?"
          message={
            <>Rechnung <strong>{rechnung.rechnungsnummer}</strong> unwiderruflich löschen?
              Alle Positionen werden ebenfalls gelöscht.</>
          }
          confirmLabel="Löschen"
          destructive
          onConfirm={async () => { await loescheRechnung(); }}
          onClose={() => setDeleteConfirm(false)}
        />
      )}
    </div>
  );
}

/**
 * PDF-Aktionsleiste mit Vorschau, Download und Neu-Generieren — gleiche
 * Mechanik wie die Eingang-PDF-Buttons (busy-State, Alert bei
 * Fehlschlag). Wichtig: kein "geheimes" silent-fail, sonst sieht der
 * Admin nicht warum nichts passiert.
 *
 * Vorschau-Hinweis: previewOneDrivePdf öffnet das PDF via window.open()
 * nach einem fetch() — manche Browser blocken das aus dem Klick-Handler
 * heraus als "delayed popup". Wenn das passiert, fängt das Helper den
 * Fall ab und triggert stattdessen einen Tab über <a>.click(), und wir
 * zeigen zusätzlich einen Alert wenn auch das fehlschlägt.
 */
function RechnungPdfButtons({
  pdfUrl, filename, onRegenerate, regenerating,
}: {
  pdfUrl: string;
  filename: string;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const [busy, setBusy] = useState<null | 'preview' | 'download'>(null);

  async function preview() {
    console.info('[Rechnung PDF] Vorschau geklickt:', { pdfUrl });
    setBusy('preview');
    try {
      const ok = await previewOneDrivePdf(pdfUrl);
      console.info('[Rechnung PDF] Vorschau-Result:', { ok });
      if (!ok) alert('PDF konnte nicht geöffnet werden. Prüfe Popup-Blocker oder lade die Datei stattdessen herunter.');
    } catch (err) {
      console.error('[Rechnung PDF] Vorschau-Error:', err);
      alert(`Vorschau fehlgeschlagen: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`);
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    console.info('[Rechnung PDF] Download geklickt:', { pdfUrl, filename });
    setBusy('download');
    try {
      const ok = await triggerOneDriveDownload(pdfUrl, filename);
      console.info('[Rechnung PDF] Download-Result:', { ok });
      if (!ok) alert('Download fehlgeschlagen. Sieh in die Browser-Konsole für Details (Network-Tab).');
    } catch (err) {
      console.error('[Rechnung PDF] Download-Error:', err);
      alert(`Download fehlgeschlagen: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-secondary text-sm"
        onClick={() => void preview()}
        disabled={busy !== null}
      >{busy === 'preview' ? 'Lädt …' : 'PDF anzeigen'}</button>
      <button
        type="button"
        className="btn-secondary text-sm"
        onClick={() => void download()}
        disabled={busy !== null}
      >{busy === 'download' ? 'Lädt …' : 'PDF herunterladen'}</button>
      <button
        type="button"
        className="btn-primary text-sm"
        onClick={onRegenerate}
        disabled={regenerating || busy !== null}
      >{regenerating ? 'Generiert …' : 'PDF neu generieren'}</button>
    </div>
  );
}

function Field({
  label, value, type = 'text', onChange,
}: {
  label: string;
  value: string;
  type?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}


function BezahltDialog({
  initial, onCancel, onConfirm,
}: {
  initial: string;
  onCancel: () => void;
  onConfirm: (datum: string) => Promise<void>;
}) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-maja-ink/40 px-4">
      <div className="card w-full max-w-sm p-5">
        <h3 className="text-base font-semibold text-maja-navy">Bezahlt am</h3>
        <p className="mt-1 text-xs text-maja-muted">
          Wann wurde die Rechnung beglichen?
        </p>
        <input
          type="date" className="input mt-3" value={d}
          onChange={(e) => setD(e.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Abbrechen
          </button>
          <button
            type="button" className="btn-primary"
            disabled={busy || !d}
            onClick={async () => { setBusy(true); await onConfirm(d); setBusy(false); }}
          >
            {busy ? 'Speichert …' : 'Bestätigen'}
          </button>
        </div>
      </div>
    </div>
  );
}

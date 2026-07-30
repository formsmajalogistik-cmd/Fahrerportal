// Detail-Ansicht einer Gutschrift / Rechnungskorrektur.
//
// Status-Modell bewusst zweistufig: 'entwurf' ist frei bearbeitbar,
// 'final' sperrt Stammdaten und Positionen. Das schützt ein bereits
// versendetes Dokument vor versehentlichen Änderungen — bearbeiten geht
// erst nach dem Zurücksetzen auf Entwurf. Kein „bezahlt", keine
// Zahlungsverfolgung.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { Spinner } from '../../../components/Spinner';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { DownloadIcon, EyeIcon } from '../../../components/icons';
import { formatDate } from '../../../lib/touren';
import { berechneSummenProUst } from '../../../lib/rechnungsformat';
import {
  previewOneDrivePdf, triggerOneDriveDownload, uploadToOneDrive,
} from '../../../lib/onedrive';
import { PositionsTable } from '../rechnungen/PositionsTable';
import { SummenBlock } from '../rechnungen/SummenBlock';
import { emptyManuellePosition, type EditorPosition } from '../rechnungen/positionUtils';
import {
  generateRechnungPdf, type RechnungPdfPosition,
} from '../rechnungen/rechnungPdf';
import { GutschriftStatusBadge } from './GutschriftStatusBadge';
import { GutschriftEmailDialog } from './GutschriftEmailDialog';
import {
  gutschriftPdfFilename, gutschriftPdfPath, hatAdresse, ladeGutschriftPositionen,
  parseAdressSnapshot, speichereGutschriftPositionen,
  type AdressSnapshot, type Gutschrift,
} from '../../../lib/gutschriften';
import {
  DEFAULT_GUTSCHRIFT_SETTINGS, loadGutschriftSettings,
  type GutschriftSettings,
} from '../../../lib/gutschriftSettings';
import type { Json } from '../../../types/supabase';
import type { Auftraggeber } from '../../../types/db';

interface GutschriftFull extends Gutschrift {
  auftraggeber: Pick<Auftraggeber, 'id' | 'name' | 'kunden_uid' | 'zahlungsziel_tage'> | null;
  rechnung: { id: string; rechnungsnummer: string; datum: string } | null;
}

/** Editierbare Kopfdaten — Snapshot-Felder bleiben bewusst frei änderbar. */
interface KopfDraft {
  gutschrift_nr: string;
  datum: string;
  zeitraum_von: string;
  zeitraum_bis: string;
  anrede: string;
  kundennummer: string;
  sachbearbeiter: string;
  ustSatz: string;
  einleitungstext: string;
  schlusstext: string;
  adresse: AdressSnapshot;
}

function draftVon(g: GutschriftFull): KopfDraft {
  return {
    gutschrift_nr: g.gutschrift_nr,
    datum: g.datum,
    zeitraum_von: g.leistungszeitraum_von ?? '',
    zeitraum_bis: g.leistungszeitraum_bis ?? '',
    anrede: g.anrede ?? '',
    kundennummer: g.kundennummer ?? '',
    sachbearbeiter: g.sachbearbeiter ?? '',
    ustSatz: String(Number(g.ust_satz)),
    einleitungstext: g.einleitungstext ?? '',
    schlusstext: g.schlusstext ?? '',
    adresse: parseAdressSnapshot(g.adress_snapshot),
  };
}

export function GutschriftDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [gutschrift, setGutschrift] = useState<GutschriftFull | null>(null);
  const [positionen, setPositionen] = useState<EditorPosition[]>([]);
  const [settings, setSettings] = useState<GutschriftSettings>(DEFAULT_GUTSCHRIFT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingKopf, setEditingKopf] = useState(false);
  const [kopfDraft, setKopfDraft] = useState<KopfDraft | null>(null);
  const [savingKopf, setSavingKopf] = useState(false);

  const [editingPos, setEditingPos] = useState(false);
  const [savingPos, setSavingPos] = useState(false);

  const [notizen, setNotizen] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    const [gRes, cfg] = await Promise.all([
      supabase
        .from('gutschriften')
        .select(`
          *,
          auftraggeber:auftraggeber_id (id, name, kunden_uid, zahlungsziel_tage),
          rechnung:rechnung_id (id, rechnungsnummer, datum)
        `)
        .eq('id', id)
        .maybeSingle(),
      loadGutschriftSettings(),
    ]);
    if (gRes.error) { setError(gRes.error.message); setLoading(false); return; }
    if (!gRes.data) { setError('Dokument nicht gefunden.'); setLoading(false); return; }
    const g = gRes.data as unknown as GutschriftFull;
    setGutschrift(g);
    setKopfDraft(draftVon(g));
    setNotizen(g.interne_notizen ?? '');
    setSettings(cfg);
    try {
      setPositionen(await ladeGutschriftPositionen(g.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Positionen konnten nicht geladen werden.');
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const bezeichnung = settings.dokumentbezeichnung;

  async function speichereKopf() {
    if (!gutschrift || !kopfDraft) return;
    const d = kopfDraft;
    if (!d.gutschrift_nr.trim()) { setError('Die Nummer darf nicht leer sein.'); return; }
    if (!d.datum) { setError('Das Datum ist Pflicht.'); return; }
    const ustNum = Number(d.ustSatz.replace(',', '.'));
    if (!Number.isFinite(ustNum) || ustNum < 0) { setError('USt-Satz ist ungültig.'); return; }
    setSavingKopf(true);
    setError(null);
    try {
      // USt-Änderung schlägt auf die Summen durch (Netto bleibt gleich).
      const sum = berechneSummenProUst(positionen, ustNum);
      const { error: err } = await supabase
        .from('gutschriften')
        .update({
          gutschrift_nr: d.gutschrift_nr.trim(),
          datum: d.datum,
          leistungszeitraum_von: d.zeitraum_von || null,
          leistungszeitraum_bis: d.zeitraum_bis || null,
          anrede: d.anrede || null,
          kundennummer: d.kundennummer || null,
          sachbearbeiter: d.sachbearbeiter || null,
          einleitungstext: d.einleitungstext || null,
          schlusstext: d.schlusstext || null,
          adress_snapshot: d.adresse as unknown as Json,
          ust_satz: ustNum,
          netto_summe: sum.netto,
          ust_summe: sum.ust,
          brutto_summe: sum.brutto,
        })
        .eq('id', gutschrift.id);
      if (err) {
        const isDup = /duplicate key|unique|23505/i.test(err.message);
        throw new Error(isDup
          ? `Die Nummer „${d.gutschrift_nr.trim()}" existiert bereits.`
          : err.message);
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
    if (!gutschrift) return;
    setSavingPos(true);
    setError(null);
    try {
      await speichereGutschriftPositionen(
        gutschrift.id, positionen, Number(gutschrift.ust_satz) || 0,
      );
      setEditingPos(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSavingPos(false);
    }
  }

  async function speichereNotizen() {
    if (!gutschrift) return;
    if (notizen === (gutschrift.interne_notizen ?? '')) return;
    const { error: err } = await supabase
      .from('gutschriften')
      .update({ interne_notizen: notizen || null })
      .eq('id', gutschrift.id);
    if (err) setError(err.message);
  }

  async function setzeStatus(status: 'entwurf' | 'final') {
    if (!gutschrift) return;
    setStatusBusy(true);
    const { error: err } = await supabase
      .from('gutschriften').update({ status }).eq('id', gutschrift.id);
    setStatusBusy(false);
    if (err) { setError(err.message); return; }
    await load();
  }

  /**
   * Erzeugt die PDF im Design der Rechnungs-PDF (gleiche Vorlage, nur
   * Überschrift, Bezugszeile, Texte und Summen-Label unterscheiden sich)
   * und legt sie in OneDrive ab.
   *
   * Wie bei den Rechnungen wird IMMER frisch aus der DB gelesen — der
   * UI-State kann veraltet sein und würde sonst eine alte Version
   * erzeugen.
   */
  async function generierePdf() {
    if (!gutschrift) return;
    if (editingKopf || editingPos) {
      setError('Bitte zuerst die offene Bearbeitung speichern — die PDF wird aus dem gespeicherten Stand erzeugt.');
      return;
    }
    setGeneratingPdf(true);
    setError(null);
    try {
      const [gRes, pRes, cfg] = await Promise.all([
        supabase
          .from('gutschriften')
          .select(`
            *,
            auftraggeber:auftraggeber_id (id, name, kunden_uid, zahlungsziel_tage),
            rechnung:rechnung_id (id, rechnungsnummer, datum)
          `)
          .eq('id', gutschrift.id)
          .single(),
        supabase
          .from('gutschriftspositionen')
          .select('*')
          .eq('gutschrift_id', gutschrift.id)
          .order('position_nr', { ascending: true }),
        loadGutschriftSettings(),
      ]);
      if (gRes.error) throw gRes.error;
      if (pRes.error) throw pRes.error;
      const fresh = gRes.data as unknown as GutschriftFull;
      const adresse = parseAdressSnapshot(fresh.adress_snapshot);
      const defaultSatz = Number(fresh.ust_satz) || 0;

      const pdfPositionen: RechnungPdfPosition[] = (pRes.data ?? []).map((p, idx) => ({
        position_nr: idx + 1,
        bezeichnung: p.bezeichnung,
        unterzeilen: Array.isArray(p.unterzeilen)
          ? (p.unterzeilen as unknown[]).filter((x): x is string => typeof x === 'string')
          : [],
        menge: Number(p.menge),
        einzelpreis: Number(p.einzelpreis),
        gesamtpreis: Number(p.gesamtpreis),
        ust_satz: p.ust_satz == null ? null : Number(p.ust_satz),
      }));

      const bezug = fresh.rechnung
        ? `Bezug: Rechnung ${fresh.rechnung.rechnungsnummer} vom ${formatDate(fresh.rechnung.datum)}`
        : null;
      // Leistungszeitraum ist eine formale Pflichtangabe — wenn gepflegt,
      // wandert er als zusätzliche Bezugszeile mit auf das Dokument.
      const zeitraum = (fresh.leistungszeitraum_von || fresh.leistungszeitraum_bis)
        ? `Leistungszeitraum: ${formatDate(fresh.leistungszeitraum_von ?? fresh.leistungszeitraum_bis!)}`
          + (fresh.leistungszeitraum_von && fresh.leistungszeitraum_bis
            && fresh.leistungszeitraum_von !== fresh.leistungszeitraum_bis
              ? ` – ${formatDate(fresh.leistungszeitraum_bis)}`
              : '')
        : null;

      const blob = await generateRechnungPdf({
        dokumentTitel: cfg.dokumentbezeichnung,
        rechnungsnummer: fresh.gutschrift_nr,
        datum: fresh.datum,
        anrede: fresh.anrede,
        kundennummer: fresh.kundennummer,
        sachbearbeiter: fresh.sachbearbeiter,
        // Gutschriften haben kein Zahlungsziel.
        faelligAm: null,
        zahlungszielTage: null,
        bezugszeile: [bezug, zeitraum].filter(Boolean).join('   ·   ') || null,
        einleitungstext: fresh.einleitungstext,
        schlusstext: fresh.schlusstext,
        summenLabel: cfg.summen_label,
        empfaenger: adresse,
        kundenUid: fresh.auftraggeber?.kunden_uid ?? null,
        ustSatzDefault: defaultSatz,
        positionen: pdfPositionen,
      });

      const filename = gutschriftPdfFilename(cfg.dokumentbezeichnung, fresh.gutschrift_nr);
      const path = gutschriftPdfPath(fresh.datum, filename);
      await uploadToOneDrive(path, blob);
      const { error: uErr } = await supabase
        .from('gutschriften').update({ pdf_url: path }).eq('id', gutschrift.id);
      if (uErr) throw uErr;
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF-Generierung fehlgeschlagen');
    } finally {
      setGeneratingPdf(false);
    }
  }

  async function loeschen() {
    if (!gutschrift) return;
    setDeleting(true);
    const { error: err } = await supabase
      .from('gutschriften').delete().eq('id', gutschrift.id);
    if (err) {
      setError(err.message);
      setDeleting(false);
      setDeleteConfirm(false);
      return;
    }
    navigate('/gutschriften');
  }

  if (loading) return <Spinner label="Wird geladen …" />;
  if (error && !gutschrift) {
    return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }
  if (!gutschrift) return null;

  const adresse = parseAdressSnapshot(gutschrift.adress_snapshot);
  const istFinal = gutschrift.status === 'final';
  const filename = gutschriftPdfFilename(bezeichnung, gutschrift.gutschrift_nr);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-maja-navy">{gutschrift.gutschrift_nr}</h1>
            <GutschriftStatusBadge status={gutschrift.status} />
            <span className="inline-flex rounded-full bg-maja-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-maja-accent">
              {bezeichnung}
            </span>
          </div>
          <p className="text-sm text-maja-muted">
            {gutschrift.auftraggeber?.name ?? '—'} · Datum {formatDate(gutschrift.datum)}
          </p>
          {gutschrift.rechnung && (
            <p className="mt-1 text-sm">
              <button
                type="button"
                className="text-maja-accent hover:underline"
                onClick={() => navigate(`/rechnungen/${gutschrift.rechnung!.id}`)}
              >
                Bezug: Rechnung {gutschrift.rechnung.rechnungsnummer} vom{' '}
                {formatDate(gutschrift.rechnung.datum)}
              </button>
            </p>
          )}
        </div>
        <button type="button" className="btn-secondary" onClick={() => navigate('/gutschriften')}>
          Zurück
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Status */}
      <section className="card flex flex-wrap items-center gap-2 p-4">
        {istFinal ? (
          <>
            <span className="text-sm text-maja-ink">
              Final — Stammdaten und Positionen sind gesperrt.
            </span>
            <button type="button" className="btn-secondary text-sm" disabled={statusBusy}
                    onClick={() => void setzeStatus('entwurf')}>
              Zurück auf Entwurf setzen
            </button>
          </>
        ) : (
          <>
            <span className="text-sm text-maja-muted">
              Entwurf — frei bearbeitbar.
            </span>
            <button type="button" className="btn-primary text-sm" disabled={statusBusy}
                    onClick={() => void setzeStatus('final')}>
              Als final markieren
            </button>
          </>
        )}
      </section>

      {/* Stammdaten */}
      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-maja-navy">Stammdaten</h2>
          {!editingKopf ? (
            <button
              type="button" className="btn-secondary text-sm"
              disabled={istFinal}
              title={istFinal ? 'Erst auf Entwurf zurücksetzen' : undefined}
              onClick={() => { setKopfDraft(draftVon(gutschrift)); setEditingKopf(true); }}
            >Bearbeiten</button>
          ) : (
            <div className="flex items-center gap-2">
              <button type="button" className="btn-primary text-sm" disabled={savingKopf}
                      onClick={() => void speichereKopf()}>
                {savingKopf ? 'Speichert …' : 'Speichern'}
              </button>
              <button type="button" className="btn-secondary text-sm" disabled={savingKopf}
                      onClick={() => { setEditingKopf(false); setKopfDraft(draftVon(gutschrift)); }}>
                Abbrechen
              </button>
            </div>
          )}
        </div>

        {!editingKopf ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-maja-navy">Empfänger</h3>
              {hatAdresse(adresse) ? (
                <address className="mt-1 not-italic text-sm text-maja-ink">
                  {adresse.firma && <div className="font-medium">{adresse.firma}</div>}
                  {adresse.ansprechpartner && <div>{adresse.ansprechpartner}</div>}
                  {adresse.strasse && <div>{adresse.strasse}</div>}
                  {adresse.plz_ort && <div>{adresse.plz_ort}</div>}
                  {adresse.land && <div className="text-maja-muted">{adresse.land}</div>}
                </address>
              ) : (
                <p className="mt-1 text-xs text-maja-muted">Keine Adresse hinterlegt.</p>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-maja-navy">Anrede</h3>
                <p className="mt-1 text-sm text-maja-ink">{gutschrift.anrede || '—'}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Read label="Kundennummer" value={gutschrift.kundennummer} />
                <Read label="Sachbearbeiter" value={gutschrift.sachbearbeiter} />
                <Read label="USt-Satz" value={`${Number(gutschrift.ust_satz).toFixed(2)} %`} />
                <Read
                  label="Leistungszeitraum"
                  value={gutschrift.leistungszeitraum_von || gutschrift.leistungszeitraum_bis
                    ? `${formatDate(gutschrift.leistungszeitraum_von ?? gutschrift.leistungszeitraum_bis!)}`
                      + (gutschrift.leistungszeitraum_bis
                          && gutschrift.leistungszeitraum_bis !== gutschrift.leistungszeitraum_von
                        ? ` – ${formatDate(gutschrift.leistungszeitraum_bis)}` : '')
                    : null}
                />
              </div>
            </div>
          </div>
        ) : kopfDraft && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`${bezeichnung}-Nummer`} value={kopfDraft.gutschrift_nr}
                   onChange={(v) => setKopfDraft({ ...kopfDraft, gutschrift_nr: v })} />
            <Field label="Datum" type="date" value={kopfDraft.datum}
                   onChange={(v) => setKopfDraft({ ...kopfDraft, datum: v })} />
            <Field label="Leistungszeitraum von" type="date" value={kopfDraft.zeitraum_von}
                   onChange={(v) => setKopfDraft({ ...kopfDraft, zeitraum_von: v })} />
            <Field label="Leistungszeitraum bis" type="date" value={kopfDraft.zeitraum_bis}
                   onChange={(v) => setKopfDraft({ ...kopfDraft, zeitraum_bis: v })} />
            <Field label="Anrede" value={kopfDraft.anrede}
                   onChange={(v) => setKopfDraft({ ...kopfDraft, anrede: v })} />
            <Field label="USt-Satz (%)" value={kopfDraft.ustSatz}
                   onChange={(v) => setKopfDraft({ ...kopfDraft, ustSatz: v })} />
            <Field label="Kundennummer" value={kopfDraft.kundennummer}
                   onChange={(v) => setKopfDraft({ ...kopfDraft, kundennummer: v })} />
            <Field label="Sachbearbeiter" value={kopfDraft.sachbearbeiter}
                   onChange={(v) => setKopfDraft({ ...kopfDraft, sachbearbeiter: v })} />
            <div className="grid gap-3 rounded-lg bg-maja-light/40 p-3 sm:col-span-2 sm:grid-cols-2">
              <h3 className="text-sm font-semibold text-maja-navy sm:col-span-2">Empfänger-Adresse</h3>
              <Field label="Firma" value={kopfDraft.adresse.firma ?? ''}
                     onChange={(v) => setKopfDraft({ ...kopfDraft, adresse: { ...kopfDraft.adresse, firma: v || null } })} />
              <Field label="Ansprechpartner" value={kopfDraft.adresse.ansprechpartner ?? ''}
                     onChange={(v) => setKopfDraft({ ...kopfDraft, adresse: { ...kopfDraft.adresse, ansprechpartner: v || null } })} />
              <Field label="Straße" value={kopfDraft.adresse.strasse ?? ''}
                     onChange={(v) => setKopfDraft({ ...kopfDraft, adresse: { ...kopfDraft.adresse, strasse: v || null } })} />
              <Field label="PLZ / Ort" value={kopfDraft.adresse.plz_ort ?? ''}
                     onChange={(v) => setKopfDraft({ ...kopfDraft, adresse: { ...kopfDraft.adresse, plz_ort: v || null } })} />
              <Field label="Land" value={kopfDraft.adresse.land ?? ''}
                     onChange={(v) => setKopfDraft({ ...kopfDraft, adresse: { ...kopfDraft.adresse, land: v || null } })} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="gsd-einleitung" className="label">Einleitungstext</label>
              <textarea id="gsd-einleitung" className="input min-h-[4rem]"
                        value={kopfDraft.einleitungstext}
                        onChange={(e) => setKopfDraft({ ...kopfDraft, einleitungstext: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="gsd-schluss" className="label">Schlusstext</label>
              <textarea id="gsd-schluss" className="input min-h-[4rem]"
                        value={kopfDraft.schlusstext}
                        onChange={(e) => setKopfDraft({ ...kopfDraft, schlusstext: e.target.value })} />
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
                <button type="button" className="btn-secondary text-sm"
                        onClick={() => setPositionen((rows) => [...rows, emptyManuellePosition()])}>
                  + Leere Position
                </button>
                <button type="button" className="btn-primary text-sm" disabled={savingPos}
                        onClick={() => void speicherePositionen()}>
                  {savingPos ? 'Speichert …' : 'Speichern'}
                </button>
                <button type="button" className="btn-secondary text-sm" disabled={savingPos}
                        onClick={() => { setEditingPos(false); void load(); }}>
                  Abbrechen
                </button>
              </>
            ) : (
              <button
                type="button" className="btn-secondary text-sm"
                disabled={istFinal}
                title={istFinal ? 'Erst auf Entwurf zurücksetzen' : undefined}
                onClick={() => setEditingPos(true)}
              >Bearbeiten</button>
            )}
          </div>
        </div>
        <PositionsTable
          positionen={positionen}
          readOnly={!editingPos}
          defaultUstSatz={Number(gutschrift.ust_satz) || 0}
          onChange={setPositionen}
        />
        <SummenBlock
          positionen={positionen}
          defaultSatz={Number(gutschrift.ust_satz) || 0}
          prominent
        />
      </section>

      {/* Notizen */}
      <section className="card space-y-2 p-5">
        <h2 className="text-base font-semibold text-maja-navy">Interne Notizen</h2>
        <textarea
          className="input min-h-[5rem]"
          value={notizen}
          onChange={(e) => setNotizen(e.target.value)}
          onBlur={() => void speichereNotizen()}
        />
      </section>

      {/* PDF + Versand */}
      <section className="card space-y-2 p-5">
        <h2 className="text-base font-semibold text-maja-navy">PDF</h2>
        {gutschrift.pdf_url ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1"
                      onClick={() => void previewOneDrivePdf(gutschrift.pdf_url!, { filename })}>
                <EyeIcon className="h-4 w-4" /> Vorschau
              </button>
              <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1"
                      onClick={() => void triggerOneDriveDownload(gutschrift.pdf_url!, filename)}>
                <DownloadIcon className="h-4 w-4" /> Download
              </button>
              <button type="button" className="btn-secondary text-sm" disabled={generatingPdf}
                      onClick={() => void generierePdf()}>
                {generatingPdf ? 'Generiert …' : 'PDF neu generieren'}
              </button>
            </div>
            <button type="button" className="btn-secondary text-sm"
                    onClick={() => setEmailOpen(true)}>
              {bezeichnung} per E-Mail versenden
            </button>
            {gutschrift.email_versendet_am && (
              <p className="text-xs text-maja-muted">
                Zuletzt per E-Mail versendet am {formatDate(gutschrift.email_versendet_am)}.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-maja-muted">Noch keine PDF generiert.</p>
            <button type="button" className="btn-primary text-sm" disabled={generatingPdf}
                    onClick={() => void generierePdf()}>
              {generatingPdf ? 'Generiert …' : 'PDF generieren'}
            </button>
          </div>
        )}
      </section>

      <section className="flex justify-start pt-2">
        <button
          type="button"
          onClick={() => setDeleteConfirm(true)}
          disabled={deleting}
          className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          {deleting ? 'Lösche …' : `${bezeichnung} löschen`}
        </button>
      </section>

      {emailOpen && (
        <GutschriftEmailDialog
          gutschrift={{
            id: gutschrift.id,
            gutschrift_nr: gutschrift.gutschrift_nr,
            datum: gutschrift.datum,
            brutto_summe: Number(gutschrift.brutto_summe),
            auftraggeber_id: gutschrift.auftraggeber_id,
            pdf_url: gutschrift.pdf_url,
          }}
          bezeichnung={bezeichnung}
          onClose={() => setEmailOpen(false)}
          onSent={() => {
            setEmailOpen(false);
            setGutschrift((g) => (g ? { ...g, email_versendet_am: new Date().toISOString() } : g));
          }}
        />
      )}

      {deleteConfirm && (
        <ConfirmDialog
          title={`${bezeichnung} löschen?`}
          message={
            <>
              <strong>{gutschrift.gutschrift_nr}</strong> unwiderruflich löschen?
              Alle Positionen werden ebenfalls gelöscht.
            </>
          }
          confirmLabel="Löschen"
          destructive
          onConfirm={async () => { await loeschen(); }}
          onClose={() => setDeleteConfirm(false)}
        />
      )}
    </div>
  );
}

function Read({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-maja-muted">{label}</h4>
      <p className="text-sm text-maja-ink">{value || '—'}</p>
    </div>
  );
}

function Field({
  label, value, onChange, type = 'text',
}: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  const id = `gsd-${label.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input id={id} type={type} className="input" value={value}
             onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

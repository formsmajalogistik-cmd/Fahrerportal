import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { Spinner } from '../../../components/Spinner';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { formatDate, formatEuro } from '../../../lib/touren';
import {
  DEFAULT_GUTSCHRIFT_SETTINGS, loadGutschriftSettings,
} from '../../../lib/gutschriftSettings';
import {
  berechneSummenProUst, generatePositionenFromTouren, parseRechnungsformat,
} from '../../../lib/rechnungsformat';
import { AuslagenPruefDialog } from '../../../components/auslagen/AuslagenPruefDialog';
import { ladeZusatzArten } from '../../../lib/zusatzArten';
import {
  formatAusRechnungsformat, ladeAbrechnungsStand, ladeAuslagenTouren, ladeTourenZuRechnungstagen,
  pruefeRechnung, rechnungstageDerTouren, type AuslagenTour, type AuslagenZusatz, type PruefErgebnis,
} from '../../../lib/auslagenStatus';
import { SummenBlock } from './SummenBlock';
import { PositionsTable } from './PositionsTable';
import { AddTourPositionDialog } from './AddTourPositionDialog';
import { RechnungEmailDialog } from './RechnungEmailDialog';
import { generateRechnungPdf, rechnungPdfFilename, type RechnungPdfPosition } from './rechnungPdf';
import { AbsenderSignaturSchalter } from '../../../components/AbsenderSignaturSchalter';
import {
  ladeAbsenderBilder, ladeAbsenderSignatur, type AbsenderSignatur,
} from '../../../lib/absenderSignatur';
import {
  previewOneDrivePdf, triggerOneDriveDownload, uploadToOneDrive,
} from '../../../lib/onedrive';
import { RechnungStatusBadge } from './RechnungStatusBadge';
import { VersandAbschnitt } from '../../../components/versand/VersandAbschnitt';
import { useZurueckZurListe } from '../../../lib/useListenZustand';
import { eintragZeit, type VersandStatus } from '../../../lib/belegVersand';
import { empfaengerAusSnapshot } from '../../../lib/manuelleEmpfaenger';
import type { EditorPosition } from './positionUtils';
import { emptyManuellePosition, newKey } from './positionUtils';
import {
  bilanzText, ladeTourenPerId, modusFuerRechnung, neuLadenBilanz, positionenNeuAufbauen, sucheNeueTouren, suchZeitraum,
} from '../../../lib/rechnungNeuLaden';
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

/** Gutschrift, die sich auf diese Rechnung bezieht. */
interface GutschriftBezug {
  id: string;
  gutschrift_nr: string;
  datum: string;
  brutto_summe: number;
}

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
  const location = useLocation();
  /** Zurück auf genau den Stand der Übersicht (Seite, Filter, Suche). */
  const zurueck = useZurueckZurListe('rechnungen', '/rechnungen');
  /** Hinweis aus dem Anlegen (z.B. „Vorschlag war inzwischen vergeben"). */
  const [hinweis, setHinweis] = useState<string | null>(
    () => (location.state as { hinweis?: string } | null)?.hinweis ?? null,
  );
  const [rechnung, setRechnung] = useState<RechnungFull | null>(null);
  const [positionen, setPositionen] = useState<EditorPosition[]>([]);
  /** tour_id → info-Freitext. Für die Anzeige im Edit-Modus. */
  const [tourInfoById, setTourInfoById] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingPos, setEditingPos] = useState(false);
  const [posEditConfirmOpen, setPosEditConfirmOpen] = useState(false);
  const [savingPositions, setSavingPositions] = useState(false);
  const [tourPickerOpen, setTourPickerOpen] = useState(false);
  /** "Touren erneut laden" (Aufgabe 5) — Bestätigungs-Dialog + Busy. */
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [keepManual, setKeepManual] = useState(true);
  const [reloadingTouren, setReloadingTouren] = useState(false);
  /** Versandstatus (für die Warnung vor dem Neuladen nach Versand). */
  const [versand, setVersand] = useState<VersandStatus | null>(null);
  const [versandStand, setVersandStand] = useState(0);
  /** Nach „Touren erneut laden" mit neuen Touren: Leistungszeitraum beim Speichern. */
  const [neuerLeistungszeitraum, setNeuerLeistungszeitraum] = useState<{ von: string; bis: string } | null>(null);
  /** Ergebnis des Neuladens („2 Positionen aktualisiert: Kennzeichen, Preis"). */
  const [reloadInfo, setReloadInfo] = useState<string | null>(null);

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

  // Unterschrift/Firmenstempel des Absenders (Migration 092). Die
  // Schalter greifen direkt auf die Rechnung durch — sie gehören nicht
  // zum Kopf-Entwurf, damit sie auch ohne Bearbeiten-Modus wirken.
  const [absenderSig, setAbsenderSig] = useState<AbsenderSignatur | null>(null);

  // E-Mail-Versand (Aufgabe 3)
  const [emailOpen, setEmailOpen] = useState(false);

  // Gutschriften mit Bezug auf diese Rechnung (Migration 078) + die
  // konfigurierte Dokumentbezeichnung für Button und Hinweis.
  const [gutschriften, setGutschriften] = useState<GutschriftBezug[]>([]);
  const [gsBezeichnung, setGsBezeichnung] = useState(
    DEFAULT_GUTSCHRIFT_SETTINGS.dokumentbezeichnung,
  );

  // Beleg-Zuordnung lösen (Aufgabe 2)
  const handleRemoveBelege = useCallback(async () => {
    if (!rechnung) return;
    if (!confirm('Zuordnung der Beleg-PDF wirklich entfernen? Die Datei bleibt gespeichert.')) return;
    const { error: err } = await supabase
      .from('rechnungen')
      .update({ belege_pdf_url: null })
      .eq('id', rechnung.id);
    if (err) { setError(err.message); return; }
    setRechnung({ ...rechnung, belege_pdf_url: null });
  // rechnung wird verwendet, aber als Dep deklariert führt zu Loop —
  // wir fangen das via if (!rechnung) ab.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rechnung?.id]);

  /** `still`: ohne Ladeanzeige nachladen (offene Dialoge bleiben stehen). */
  const load = useCallback(async (still = false) => {
    if (!id) return;
    if (!still) setLoading(true);
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
    setAbsenderSig(await ladeAbsenderSignatur());
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

    // Tour-Infos für die referenzierten Touren nachladen — werden im
    // Edit-Modus unter der Position angezeigt (NICHT auf der PDF).
    const tourIds = Array.from(new Set(rows.map((p) => p.tour_id).filter(Boolean) as string[]));
    if (tourIds.length > 0) {
      const { data: tourRows } = await supabase
        .from('touren').select('id, info').in('id', tourIds);
      const m = new Map<string, string>();
      for (const t of (tourRows ?? []) as Array<{ id: string; info: string | null }>) {
        if (t.info && t.info.trim()) m.set(t.id, t.info.trim());
      }
      setTourInfoById(m);
    } else {
      setTourInfoById(new Map());
    }

    // Verknüpfte Gutschriften — der Bezug wird auf BEIDEN Dokumenten
    // angezeigt.
    const [gsRes, gsCfg] = await Promise.all([
      supabase
        .from('gutschriften')
        .select('id, gutschrift_nr, datum, brutto_summe')
        .eq('rechnung_id', id)
        .order('datum', { ascending: false }),
      loadGutschriftSettings(),
    ]);
    setGutschriften((gsRes.data as unknown as GutschriftBezug[]) ?? []);
    setGsBezeichnung(gsCfg.dokumentbezeichnung);
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

  /** Schalter für Unterschrift/Stempel sofort speichern — sie sind eine
   *  Ausgabe-Option, kein Teil des Kopf-Entwurfs. */
  async function setzeAbsenderSchalter(patch: { mitUnterschrift?: boolean; mitStempel?: boolean }) {
    if (!rechnung) return;
    const neu = {
      mit_unterschrift: patch.mitUnterschrift ?? rechnung.mit_unterschrift ?? true,
      mit_stempel: patch.mitStempel ?? rechnung.mit_stempel ?? true,
    };
    setRechnung({ ...rechnung, ...neu });
    const { error: err } = await supabase
      .from('rechnungen').update(neu).eq('id', rechnung.id);
    if (err) { setError(err.message); await load(); }
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

  async function speicherePositionen(liste: EditorPosition[] = positionen): Promise<boolean> {
    if (!rechnung) return false;
    setSavingPositions(true);
    setError(null);
    try {
      // Lösche alle bestehenden Positionen und schreibe neu (mit position_nr
      // aus dem Index). Bei einer einzelnen Rechnung ist das stabil genug und
      // einfacher als ein Diff (neue/aktualisierte/gelöschte UUIDs zu tracken).
      const { error: delErr } = await supabase
        .from('rechnungspositionen').delete().eq('rechnung_id', rechnung.id);
      if (delErr) throw delErr;
      const rows = liste.map((p, idx) => ({
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
      const sum = berechneSummenProUst(liste, Number(rechnung.ust_satz) || 0);
      const { error: uErr } = await supabase
        .from('rechnungen')
        .update({
          netto_summe: sum.netto,
          ust_betrag: sum.ust,
          brutto_summe: sum.brutto,
          ...(neuerLeistungszeitraum
            ? { leistungszeitraum_von: neuerLeistungszeitraum.von, leistungszeitraum_bis: neuerLeistungszeitraum.bis }
            : {}),
        })
        .eq('id', rechnung.id);
      if (uErr) throw uErr;
      setEditingPos(false);
      setReloadInfo(null);
      setNeuerLeistungszeitraum(null);
      await load(true);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
      return false;
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

  // ---- Auslagen-Prüfung vor „Rechnung erstellen" / Versand (blockiert nie)
  const positionenRef = useRef(positionen);
  useEffect(() => { positionenRef.current = positionen; }, [positionen]);
  const [pruefung, setPruefung] = useState<null | { modus: 'erstellen' | 'versenden' | 'info'; ergebnis: PruefErgebnis; weiter: () => void }>(null);
  /** Dezenter Hinweis im Entwurf (statt Dialog): Prüfergebnis im Hintergrund. */
  const [entwurfPruefung, setEntwurfPruefung] = useState<PruefErgebnis | null>(null);

  async function auslagenPruefen(): Promise<PruefErgebnis> {
    const leer: PruefErgebnis = { touren: [], geprueft: 0, offen: 0 };
    if (!rechnung?.auftraggeber_id) return leer;
    const { data: ag } = await supabase.from('auftraggeber').select('rechnungsformat').eq('id', rechnung.auftraggeber_id).maybeSingle();
    const fmt = formatAusRechnungsformat(ag?.rechnungsformat ?? null);
    const art = rechnung.ist_auslagen_rechnung ? 'auslagen' as const : 'normal' as const;
    if (art === 'normal' && fmt.getrennt) return leer;
    const pos = positionenRef.current;
    const posTouren = [...new Set(pos.map((p) => p.tour_id).filter((x): x is string => !!x))];
    let ids = posTouren;
    if (art === 'auslagen') {
      // Auslagenrechnung: alle Touren des Auftraggebers am selben
      // Rechnungstag wie die Touren dieser Rechnung (so entsteht sie heute).
      const tage = posTouren.length ? await rechnungstageDerTouren(posTouren) : [rechnung.leistungszeitraum_bis];
      const amTag = await ladeTourenZuRechnungstagen(rechnung.auftraggeber_id, tage.filter(Boolean) as string[]);
      ids = [...new Set([...posTouren, ...amTag.map((t) => t.id)])];
    }
    if (ids.length === 0) return leer;
    const [touren, stand, arten] = await Promise.all([ladeAuslagenTouren(ids), ladeAbrechnungsStand(ids), ladeZusatzArten()]);
    return pruefeRechnung({ art, fmt, touren, positionen: pos, stand, arten, eigeneRechnungIds: [rechnung.id] });
  }

  /**
   * Prüfdialog nur beim Übergang Entwurf → erstellte Rechnung: „Rechnung
   * erstellen" oder Versand eines Entwurfs (der setzt ihn auf offen). Nicht
   * beim Speichern, Neuladen oder Versand einer schon erstellten Rechnung.
   */
  async function mitAuslagenPruefung(anlass: 'erstellen' | 'versenden', weiter: () => void) {
    if (anlass === 'versenden' && rechnung?.status !== 'entwurf') { weiter(); return; }
    try {
      const e = await auslagenPruefen();
      if (e.offen > 0) { setPruefung({ modus: anlass, ergebnis: e, weiter }); return; }
    } catch (err) {
      console.warn('[Rechnungen] Auslagen-Prüfung fehlgeschlagen', err);
    }
    weiter();
  }

  // Entwurf: im Hintergrund prüfen → Badge in der Kopfzeile (kein Dialog).
  useEffect(() => {
    if (!rechnung || rechnung.status !== 'entwurf' || editingPos) { queueMicrotask(() => setEntwurfPruefung(null)); return; }
    let weg = false;
    // positionenRef zieht erst im eigenen Effekt nach — hier den aktuellen
    // Stand direkt setzen, damit die Prüfung nicht mit leerer Liste läuft.
    positionenRef.current = positionen;
    void auslagenPruefen().then((e) => { if (!weg) setEntwurfPruefung(e); }).catch(() => {});
    return () => { weg = true; };
  // auslagenPruefen liest den aktuellen Stand aus rechnung/positionenRef.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rechnung, positionen, editingPos]);

  /** Fehlende Zusätze als Positionen anhängen und die Rechnung speichern. */
  async function auslagenUebernehmen(at: AuslagenTour, fehlendeZusaetze: AuslagenZusatz[]): Promise<string> {
    const a = { tour: at, fehlend: fehlendeZusaetze };
    if (!rechnung?.auftraggeber_id) return 'Rechnung ohne Auftraggeber.';
    const [tour] = await ladeTourenPerId([a.tour.id]);
    if (!tour) return 'Tour nicht gefunden.';
    const { data: ag } = await supabase.from('auftraggeber').select('rechnungsformat').eq('id', rechnung.auftraggeber_id).maybeSingle();
    const format = parseRechnungsformat(ag?.rechnungsformat ?? null);
    const fmtEinzeln = format.zusaetze_darstellung === 'einzeln' || format.getrennte_auslagen_rechnung
      ? format : { ...format, zusaetze_darstellung: 'einzeln' as const };
    const fehlend = new Set(a.fehlend.map((z) => z.id));
    const neu = generatePositionenFromTouren([tour], fmtEinzeln, { modus: rechnung.ist_auslagen_rechnung ? 'auslagen' : 'beides' })
      .filter((p) => p.zusatz_id && fehlend.has(p.zusatz_id))
      .map((p) => ({ ...p, key: newKey('aus') }));
    if (neu.length === 0) return 'Diese Auslagen gehören nicht auf diese Rechnung (z.B. auf die Touren-Rechnung) — bitte dort ergänzen.';
    const liste = [...positionenRef.current, ...neu];
    positionenRef.current = liste;
    if (!(await speicherePositionen(liste))) throw new Error('Rechnung konnte nicht gespeichert werden.');
    return `${neu.length} ${neu.length === 1 ? 'Auslage' : 'Auslagen'} von ${a.tour.tour_nr ?? 'der Tour'} übernommen und Rechnung gespeichert (PDF ggf. neu generieren).`;
  }

  /**
   * "Touren erneut laden": erzeugt die Positionen der Touren, die auf
   * dieser Rechnung stehen, aus deren aktuellem Stand neu — die Touren
   * werden über ihre IDs geladen, unabhängig von Rechnungsdatum oder
   * Leistungszeitraum (lib/rechnungNeuLaden). Rechnungsdatum und -nummer
   * bleiben unverändert; manuelle Positionen optional erhalten. Wirksam
   * wird das Ergebnis erst mit „Speichern".
   */
  async function reloadTourenPositionen(keepManualRows: boolean) {
    if (!rechnung?.auftraggeber_id) {
      setError('Rechnung ohne Auftraggeber — Touren können nicht geladen werden.');
      return;
    }
    setReloadingTouren(true);
    setError(null);
    setReloadInfo(null);
    try {
      const { data: agData, error: agErr } = await supabase
        .from('auftraggeber')
        .select('rechnungsformat')
        .eq('id', rechnung.auftraggeber_id)
        .maybeSingle();
      if (agErr) throw new Error(agErr.message);
      const format = parseRechnungsformat(agData?.rechnungsformat ?? null);

      // 1) Vorhandene Positionen über die Tour-IDs aktualisieren.
      const tourIds = positionen.map((p) => p.tour_id).filter((x): x is string => !!x);
      const list = tourIds.length ? await ladeTourenPerId(tourIds) : [];
      const modus = modusFuerRechnung(rechnung.ist_auslagen_rechnung, format);
      const { positionen: aktualisiert } = positionenNeuAufbauen(positionen, list, format, modus, keepManualRows);
      const bilanz = neuLadenBilanz(positionen, aktualisiert, list);
      const nichtGefunden = new Set(tourIds).size - list.length;

      // 2) Neue passende Touren ergänzen (Rechnungsdatum/Leistungszeitraum).
      const suche = await sucheNeueTouren({
        rechnungId: rechnung.id,
        auftraggeberId: rechnung.auftraggeber_id,
        auftraggeberName: rechnung.auftraggeber?.name ?? 'Auftraggeber',
        rechnungsempfaengerId: rechnung.rechnungsempfaenger_id ?? null,
        istAuslagen: rechnung.ist_auslagen_rechnung,
        zeitraum: suchZeitraum(rechnung, tourIds.length > 0),
        vorhandeneTourIds: tourIds,
      });
      const zusatzPos = generatePositionenFromTouren(suche.touren, format, { modus });
      const hinzuTouren = new Set(zusatzPos.map((p) => p.tour_id));
      // Neue Positionen vor die manuellen, damit Touren beisammen bleiben.
      const manuell = aktualisiert.filter((p) => p.ist_manuell);
      const ohneManuell = aktualisiert.filter((p) => !p.ist_manuell);
      const gesamt = [...ohneManuell, ...zusatzPos, ...manuell];
      setPositionen(gesamt.map((p) => ('key' in p ? p as EditorPosition : { ...p, key: newKey('tour') })));
      // Leistungszeitraum beim Speichern an alle Touren anpassen, wenn
      // welche dazukamen (bei einer leeren Rechnung ist er sonst der Anlagetag).
      if (hinzuTouren.size > 0) {
        const alle = [...list, ...suche.touren.filter((t) => hinzuTouren.has(t.id))];
        const starts = alle.map((t) => t.startdatum ?? t.enddatum).filter(Boolean) as string[];
        const enden = alle.map((t) => t.enddatum ?? t.startdatum).filter(Boolean) as string[];
        setNeuerLeistungszeitraum(starts.length ? { von: starts.sort()[0], bis: enden.sort()[enden.length - 1] } : null);
      }
      setReloadInfo(`${bilanzText(bilanz, nichtGefunden, {
        touren: hinzuTouren.size, suche: suche.beschreibung, aufAndererRechnung: suche.aufAndererRechnung,
      })} Mit „Speichern" übernehmen.`);

      // Tour-Infos für die neue Positionsliste aktualisieren.
      const m = new Map<string, string>();
      for (const t of [...list, ...suche.touren]) {
        if (t.info && t.info.trim()) m.set(t.id, t.info.trim());
      }
      setTourInfoById(m);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Touren konnten nicht neu geladen werden.');
    } finally {
      setReloadingTouren(false);
    }
  }

  /**
   * Löscht die Rechnung endgültig. Positions-CASCADE räumt die
   * Positionen mit.
   *
   * PDF-Cleanup in OneDrive: Der bestehende /api/onedrive?action=delete-pdf-Endpoint
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
    // Ungespeicherte Änderungen würden in der PDF fehlen (die Generierung
    // liest frisch aus der DB) — erst speichern lassen.
    if (editingKopf || editingPos) {
      setError('Bitte zuerst die offene Bearbeitung speichern — die PDF wird aus dem gespeicherten Stand erzeugt.');
      return;
    }
    setGeneratingPdf(true);
    setError(null);
    try {
      // Rechnung + Positionen IMMER frisch aus der DB laden — niemals
      // aus dem UI-State bauen. Der State kann veraltet sein (Änderung
      // von anderem Gerät / anderem Tab / gerade abgeschlossener Save),
      // was früher dazu führte, dass "PDF neu generieren" die ALTE
      // Version erzeugte.
      const [fRes, pRes] = await Promise.all([
        supabase
          .from('rechnungen')
          .select(`
            *,
            auftraggeber:auftraggeber_id (id, name, kontakt, kunden_uid, zahlungsziel_tage),
            rechnungsadresse:rechnungsadresse_id (
              id, firma, ansprechpartner, strasse, plz_ort, land, ist_standard, auftraggeber_id, created_at
            )
          `)
          .eq('id', rechnung.id)
          .single(),
        supabase
          .from('rechnungspositionen')
          .select('*')
          .eq('rechnung_id', rechnung.id)
          .order('position_nr', { ascending: true }),
      ]);
      if (fRes.error) throw fRes.error;
      if (pRes.error) throw pRes.error;
      const fresh = fRes.data as unknown as RechnungFull;
      const freshPositionen = (pRes.data ?? []) as Rechnungsposition[];

      const defaultSatz = Number(fresh.ust_satz) || 0;
      const pdfPositionen: RechnungPdfPosition[] = freshPositionen.map((p, idx) => ({
        position_nr: idx + 1,
        bezeichnung: p.bezeichnung,
        unterzeilen: p.unterzeilen ?? [],
        menge: Number(p.menge),
        einzelpreis: Number(p.einzelpreis),
        gesamtpreis: Number(p.gesamtpreis),
        ust_satz: p.ust_satz == null ? null : Number(p.ust_satz),
      }));
      // Fällig-Datum aus Zahlungsziel + Rechnungsdatum — gedruckt wie
      // bisher NUR bei Auftraggeber-Rechnungen. Seit Migration 115 wird
      // die Fälligkeit beim Erstellen einmalig gespeichert (faellig_am,
      // zahlungsziel_tage); ist sie gespeichert, gilt dieser Wert. Alte
      // Rechnungen (Felder leer) rechnen exakt wie bisher. Manuelle
      // Rechnungen: Zahlungsziel wird gespeichert, aber (noch) nicht
      // gedruckt — das PDF bleibt unverändert.
      const zahlungsziel = fresh.empfaenger_typ === 'manuell'
        ? null
        : (fresh.zahlungsziel_tage ?? fresh.auftraggeber?.zahlungsziel_tage ?? null);
      let faelligAm: string | null = null;
      if (zahlungsziel != null && Number.isFinite(zahlungsziel) && fresh.datum) {
        const d = new Date(`${fresh.datum}T12:00:00`);
        d.setDate(d.getDate() + Number(zahlungsziel));
        faelligAm = fresh.faellig_am ?? d.toISOString().slice(0, 10);
      }
      // Unterschrift/Stempel des Absenders — nur das laden, was diese
      // Rechnung auch einsetzen soll.
      const absender = await ladeAbsenderBilder({
        mitUnterschrift: fresh.mit_unterschrift ?? true,
        mitStempel: fresh.mit_stempel ?? true,
      });
      const blob = await generateRechnungPdf({
        rechnungsnummer: fresh.rechnungsnummer,
        datum: fresh.datum,
        anrede: fresh.anrede,
        kundennummer: fresh.kundennummer,
        sachbearbeiter: fresh.sachbearbeiter,
        faelligAm,
        empfaenger: {
          firma:           fresh.rechnungsadresse_firma   ?? fresh.rechnungsadresse?.firma           ?? null,
          ansprechpartner: fresh.ansprechpartner          ?? fresh.rechnungsadresse?.ansprechpartner ?? null,
          strasse:         fresh.rechnungsadresse_strasse ?? fresh.rechnungsadresse?.strasse         ?? null,
          plz_ort:         fresh.rechnungsadresse_plz_ort ?? fresh.rechnungsadresse?.plz_ort         ?? null,
          land:            fresh.rechnungsadresse_land    ?? fresh.rechnungsadresse?.land            ?? null,
        },
        // Bei manuellen Rechnungen gibt es keinen Auftraggeber — die
        // USt-IdNr. kommt dann aus dem Empfänger-Feld der Rechnung.
        kundenUid: fresh.empfaenger_typ === 'manuell'
          ? (fresh.empfaenger_ust_id ?? null)
          : (fresh.auftraggeber?.kunden_uid ?? null),
        zahlungszielTage: zahlungsziel,
        ustSatzDefault: defaultSatz,
        positionen: pdfPositionen,
        absenderUnterschrift: absender.unterschrift,
        absenderStempel: absender.stempel,
      });

      const jahr = (fresh.datum ?? '').slice(0, 4) || String(new Date().getFullYear());
      const filename = rechnungPdfFilename(fresh.rechnungsnummer);
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
            {/* Entwurf: dezenter Auslagen-Hinweis statt Dialog — anklickbar. */}
            {status === 'entwurf' && entwurfPruefung && entwurfPruefung.offen > 0 && (
              <button
                type="button"
                data-testid="auslagen-entwurf-hinweis"
                onClick={() => setPruefung({ modus: 'info', ergebnis: entwurfPruefung, weiter: () => {} })}
                className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-800 hover:ring-1 hover:ring-orange-400 dark:!bg-orange-900/50 dark:!text-orange-100"
                title="Auslagen dieser Rechnung prüfen"
              >
                <span aria-hidden="true">⚠</span>
                Auslagen: {entwurfPruefung.offen} {entwurfPruefung.offen === 1 ? 'Tour' : 'Touren'} prüfen
              </button>
            )}
            {rechnung.ist_auslagen_rechnung && (
              <span className="inline-flex rounded-full bg-maja-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-maja-accent">
                Auslagen
              </span>
            )}
          </div>
          <p className="text-sm text-maja-muted">
            {rechnung.empfaenger_typ === 'manuell'
              ? `${empfaengerAusSnapshot({
                  firma: rechnung.rechnungsadresse_firma,
                  ansprechpartner: rechnung.ansprechpartner,
                })} (manuell)`
              : (rechnung.auftraggeber?.name ?? '—')} · Zeitraum {formatDate(rechnung.leistungszeitraum_von)} – {formatDate(rechnung.leistungszeitraum_bis)}
            {' · '}Rechnungsdatum {formatDate(rechnung.datum)}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={zurueck}>
          Zurück
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {hinweis && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <span>{hinweis}</span>
          <button type="button" className="text-xs font-semibold underline" onClick={() => setHinweis(null)}>OK</button>
        </div>
      )}

      {/* Status-Aktionen — Flow: Entwurf → Offen → Bezahlt. */}
      <section className="card flex flex-wrap items-center gap-2 p-4">
        {status === 'entwurf' && (
          <button
            type="button" className="btn-primary"
            disabled={statusBusy}
            onClick={() => void mitAuslagenPruefung('erstellen', () => void patchStatus({ status: 'offen' }))}
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
        {reloadInfo && (
          <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <span>{reloadInfo}</span>
            <button type="button" className="text-xs font-semibold underline" onClick={() => setReloadInfo(null)}>OK</button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-maja-navy">Positionen</h2>
          <div className="flex items-center gap-2">
            {editingPos ? (
              <>
                <button
                  type="button" className="btn-secondary text-sm"
                  onClick={() => setPositionen((rows) => [...rows, emptyManuellePosition()])}
                >+ Leere Position</button>
                <button
                  type="button" className="btn-secondary text-sm"
                  onClick={() => setTourPickerOpen(true)}
                  title={rechnung.auftraggeber_id
                    ? 'Tour auswählen + Positionen automatisch erzeugen'
                    : 'Manuelle Rechnung — Suche läuft ohne Auftraggeber-Filter über alle Touren'}
                >+ Tour hinzufügen</button>
                <button
                  type="button" className="btn-secondary text-sm"
                  onClick={() => { setKeepManual(true); setReloadConfirm(true); }}
                  disabled={!rechnung.auftraggeber_id || reloadingTouren}
                  title={rechnung.auftraggeber_id
                    ? 'Positionen neu aus den aktuellen Touren-Daten generieren'
                    : 'Ohne Auftraggeber gibt es keine automatisch zuordenbaren Touren'}
                >{reloadingTouren ? 'Lade …' : 'Touren erneut laden'}</button>
                <button
                  type="button" className="btn-primary text-sm"
                  onClick={() => void speicherePositionen()}
                  disabled={savingPositions}
                >{savingPositions ? 'Speichert …' : 'Speichern'}</button>
                <button
                  type="button" className="btn-secondary text-sm"
                  onClick={() => { setEditingPos(false); setReloadInfo(null); setNeuerLeistungszeitraum(null); void load(); }}
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
          tourInfoById={tourInfoById}
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
        <AbsenderSignaturSchalter
          signatur={absenderSig}
          mitUnterschrift={rechnung.mit_unterschrift ?? true}
          mitStempel={rechnung.mit_stempel ?? true}
          disabled={generatingPdf}
          zielBeschreibung="über die Absenderzeile unter dem Gruß"
          onChange={(patch) => void setzeAbsenderSchalter(patch)}
        />
        {rechnung.pdf_url ? (
          <div className="space-y-2">
            <RechnungPdfButtons
              pdfUrl={rechnung.pdf_url}
              filename={rechnungPdfFilename(rechnung.rechnungsnummer)}
              onRegenerate={() => void generierePdf()}
              regenerating={generatingPdf}
            />
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => void mitAuslagenPruefung('versenden', () => setEmailOpen(true))}
            >
              Rechnung per E-Mail versenden
            </button>
            {rechnung.email_versendet_am && (
              <p className="text-xs text-maja-muted">
                Zuletzt per E-Mail versendet am {formatDate(rechnung.email_versendet_am)}.
              </p>
            )}
          </div>
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

      {/* Versandstatus + Verlauf (Migration 111) */}
      <VersandAbschnitt
        typ="rechnung"
        belegId={rechnung.id}
        belegStatus={rechnung.status}
        stand={`${rechnung.email_versendet_am ?? ''}|${versandStand}`}
        onStatus={setVersand}
      />

      {/* Gutschriften / Rechnungskorrekturen zu dieser Rechnung */}
      <section className="card space-y-2 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-maja-navy">{gsBezeichnung}en</h2>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => navigate(`/gutschriften/neu?rechnung=${rechnung.id}`)}
          >
            {gsBezeichnung} erstellen
          </button>
        </div>
        {gutschriften.length === 0 ? (
          <p className="text-sm text-maja-muted">
            Noch keine {gsBezeichnung} zu dieser Rechnung. Beim Erstellen
            werden Empfänger, Adresse und Positionen übernommen — einzelne
            Positionen lassen sich abwählen.
          </p>
        ) : (
          <ul className="space-y-1">
            {gutschriften.map((g) => (
              <li key={g.id} className="text-sm">
                <button
                  type="button"
                  className="text-maja-accent hover:underline"
                  onClick={() => navigate(`/gutschriften/${g.id}`)}
                >
                  {gsBezeichnung} vorhanden: {g.gutschrift_nr}
                </button>
                <span className="text-maja-muted">
                  {' '}· {formatDate(g.datum)} · {formatEuro(Number(g.brutto_summe))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Zugeordnete Belege (Aufgabe 2) */}
      <section className="card space-y-2 p-5">
        <h2 className="text-base font-semibold text-maja-navy">Zugeordnete Belege</h2>
        {rechnung.belege_pdf_url ? (
          <BelegeAttachmentRow
            path={rechnung.belege_pdf_url}
            rechnungsnummer={rechnung.rechnungsnummer}
            onRemove={() => void handleRemoveBelege()}
          />
        ) : (
          <p className="text-sm text-maja-muted">
            Keine Belege zugeordnet. Im Belege-Reiter über „Rechnung zuordnen"
            verknüpfen.
          </p>
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

      {pruefung && (
        <AuslagenPruefDialog
          ergebnis={pruefung.ergebnis}
          modus={pruefung.modus}
          neuPruefen={auslagenPruefen}
          onZusaetzeHinzufuegen={editingPos ? undefined : auslagenUebernehmen}
          onAbbrechen={() => { setPruefung(null); if (rechnung?.status === 'entwurf') void auslagenPruefen().then(setEntwurfPruefung); }}
          onFortfahren={() => { const w = pruefung.weiter; setPruefung(null); w(); }}
        />
      )}

      {/* Confirm-Dialoge */}
      {reloadConfirm && (
        <ConfirmDialog
          title={versand?.letzter ? 'Inhalte nach dem Versand ändern?' : 'Touren erneut laden?'}
          message={
            <>
              {versand?.letzter && (
                <span role="alert" className="mb-2 block rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                  Diese Rechnung wurde am {eintragZeit(versand.letzter)} versendet
                  {versand.letzter.art === 'manuell' ? ' (als versendet markiert)' : ''}. Inhalte nach dem Versand ändern?
                </span>
              )}
              Die Positionen der Touren auf dieser Rechnung werden aus dem
              aktuellen Stand der Touren neu erzeugt (unabhängig vom Datum).
              Zusätzlich werden passende neue Touren des Auftraggebers zum
              Rechnungsdatum bzw. Leistungszeitraum ergänzt, sofern sie auf
              keiner anderen Rechnung stehen. Rechnungsdatum und
              Rechnungsnummer bleiben unverändert.
              Manuelle Änderungen an erzeugten Positionen gehen verloren.
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                  checked={keepManual}
                  onChange={(e) => setKeepManual(e.target.checked)}
                />
                <span className="text-maja-ink">Manuelle Positionen behalten</span>
              </label>
            </>
          }
          confirmLabel="Neu laden"
          destructive
          onConfirm={() => { setReloadConfirm(false); void reloadTourenPositionen(keepManual); }}
          onClose={() => setReloadConfirm(false)}
        />
      )}
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
      {/* Bei manuellen Rechnungen ohne Auftraggeber-Filter — einzelne
          Touren lassen sich trotzdem referenzieren. */}
      {tourPickerOpen && (
        <AddTourPositionDialog
          auftraggeberId={rechnung.auftraggeber_id}
          leistungszeitraumVon={rechnung.leistungszeitraum_von}
          leistungszeitraumBis={rechnung.leistungszeitraum_bis}
          excludeRechnungId={rechnung.id}
          modus="beides"
          onClose={() => setTourPickerOpen(false)}
          onAdd={(neueP, tour) => {
            setPositionen((rows) => [
              ...rows,
              ...neueP.map((p) => ({ ...p, key: newKey('tour') })),
            ]);
            if (tour.info && tour.info.trim()) {
              setTourInfoById((m) => {
                const next = new Map(m);
                next.set(tour.id, tour.info!.trim());
                return next;
              });
            }
            setTourPickerOpen(false);
          }}
        />
      )}

      {emailOpen && (
        <RechnungEmailDialog
          rechnung={{
            id: rechnung.id,
            rechnungsnummer: rechnung.rechnungsnummer,
            datum: rechnung.datum,
            brutto_summe: Number(rechnung.brutto_summe),
            auftraggeber_id: rechnung.auftraggeber_id,
            empfaenger_email: rechnung.empfaenger_email,
            pdf_url: rechnung.pdf_url,
            belege_pdf_url: rechnung.belege_pdf_url,
            status: rechnung.status,
          }}
          onClose={() => { setEmailOpen(false); setVersandStand((n) => n + 1); }}
          onSent={({ newStatus }) => {
            setEmailOpen(false);
            setVersandStand((n) => n + 1);
            setRechnung((r) => r ? {
              ...r,
              email_versendet_am: new Date().toISOString(),
              status: newStatus ?? r.status,
            } : r);
          }}
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
 * Vorschau-Hinweis: previewOneDrivePdf entscheidet selbst, ob es einen
 * neuen Tab öffnet (Chrome/Edge/Firefox) oder ins globale PdfPreview-
 * Modal fällt (Safari/iOS- und Mac-PWA, wo window.open() blockt). Der
 * Dateiname wird mitgegeben, damit der Modal-Header korrekt ist.
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
    setBusy('preview');
    try {
      const ok = await previewOneDrivePdf(pdfUrl, { filename });
      if (!ok) alert('PDF konnte nicht geöffnet werden. Prüfe Popup-Blocker oder lade die Datei stattdessen herunter.');
    } catch (err) {
      console.error('[Rechnung PDF] Vorschau-Error:', err);
      alert(`Vorschau fehlgeschlagen: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`);
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setBusy('download');
    try {
      const ok = await triggerOneDriveDownload(pdfUrl, filename);
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

/**
 * Zeigt eine zugeordnete Beleg-PDF mit Vorschau-/Download-Button und
 * "Zuordnung entfernen". OneDrive-Aktionen laufen über den bestehenden
 * Admin-Pfad — Admins dürfen jeden Pfad unter Maja-Logistik/ öffnen.
 */
function BelegeAttachmentRow({
  path, rechnungsnummer, onRemove,
}: { path: string; rechnungsnummer: string; onRemove: () => void }) {
  const [busy, setBusy] = useState<'view' | 'download' | null>(null);
  const filename = `Belege_${rechnungsnummer}.pdf`;
  async function preview() {
    setBusy('view');
    const ok = await previewOneDrivePdf(path, { filename });
    setBusy(null);
    if (!ok) alert('Vorschau fehlgeschlagen.');
  }
  async function download() {
    setBusy('download');
    const ok = await triggerOneDriveDownload(path, filename);
    setBusy(null);
    if (!ok) alert('Download fehlgeschlagen.');
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-maja-navy/10 bg-white p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-maja-ink">{filename}</p>
        <p className="text-xs text-maja-muted">{path}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary text-sm"
                onClick={() => void preview()} disabled={busy !== null}>
          {busy === 'view' ? 'Lädt …' : 'Vorschau'}
        </button>
        <button type="button" className="btn-secondary text-sm"
                onClick={() => void download()} disabled={busy !== null}>
          {busy === 'download' ? 'Lädt …' : 'Herunterladen'}
        </button>
        <button type="button"
                className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                onClick={onRemove}>
          Zuordnung entfernen
        </button>
      </div>
    </div>
  );
}

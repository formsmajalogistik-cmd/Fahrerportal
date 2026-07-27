import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useFahrerContext } from '../auth/FahrerContext';
import { Spinner } from '../components/Spinner';
import { useTestGuard, useTestMode } from '../auth/TestModeContext';
import { TourCreateDialog } from './touren/TourCreateDialog';
import { TourDetailDialog } from './touren/TourDetailDialog';
import { TourImportDialog } from './touren/TourImportDialog';
import { exportTourenExcel } from '../lib/tourenExport';
import { BESTAETIGUNG_FENSTER_TAGE } from '../components/AdminShell';
import { sendEmail } from '../lib/onedrive';
import { loadMailboxes } from '../lib/mailboxSettings';
import { bodyWithSignatureHtml, signatureFromProfile } from '../lib/emailSignature';
import { flattenedFahrerOptions, type FahrerOptionRaw } from './touren/FahrerSelect';
import { fahrerName as resolveFahrerName } from '../lib/names';
import {
  computeTourStatus, formatAnzahl, formatDate, formatEuro, formatKm, tourTitel,
} from '../lib/touren';
import { letzterWerktagVor, naechsterWerktagNach } from '../lib/rechnungsformat';
import {
  asPdfPathList, downloadFormPdf, previewFormPdf,
} from '../lib/pdfGenerate';
import {
  CheckBoxCheckedIcon, CheckBoxEmptyIcon, DownloadIcon, EyeIcon,
} from '../components/icons';
import type {
  AppUser, Auftraggeber, Fahrer, Tour, TourStatus,
} from '../types/db';

type FahrerWithUser = Pick<Fahrer, 'id' | 'user_id' | 'aktiv' | 'vorname' | 'nachname'> & {
  user: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null;
};

interface TourRow extends Tour {
  auftraggeber: Pick<Auftraggeber, 'name' | 'kontakt' | 'externe_app_name' | 'externe_app_url'> | null;
  fahrer: FahrerWithUser | null;
  schriftliches_protokoll: { id: string; name: string } | null;
  /** Mehrere Protokoll-Zuweisungen via tour_protokoll_zuweisungen — die
   *  alte single-id-Spalte oben bleibt nur für Legacy-Reads. */
  protokoll_zuweisungen: Array<{
    id: string;
    template: { id: string; name: string } | null;
  }>;
  eingang: EingangLite | null;
  zusaetze: TourZusatzLite[];
}

interface EingangLite {
  id: string;
  status: 'draft' | 'submitted';
  pdf_paths: unknown;
  template: { id: string; name: string; pdfs: import('../types/db').TemplatePdf[] | null } | null;
}

interface TourZusatzLite {
  id: string;
  kategorie: string;
  anzahl: number;
  betrag: number;
  notiz: string | null;
  kennzeichen: string | null;
}

const PAGE_SIZE = 25;

type StatusFilter = 'alle' | TourStatus;

const STATUS_LABEL: Record<TourStatus, string> = {
  geplant: 'Geplant',
  aktiv: 'Aktiv',
  abgeschlossen: 'Abgeschlossen',
};

const STATUS_BADGE: Record<TourStatus, string> = {
  geplant:        'bg-blue-100 text-blue-700',
  aktiv:          'bg-emerald-100 text-emerald-700',
  abgeschlossen:  'bg-gray-100 text-gray-600',
};

export function TourenlistePage() {
  const { profile, session } = useAuth();
  const { activeFahrer, availableFahrer } = useFahrerContext();
  const { isTestUser, effectiveRole, scopedFahrerIds: testScopedFahrerIds } = useTestMode();
  const isAdmin = profile?.role === 'admin';
  // Test+Fahrer-Sicht simuliert einen echten Fahrer (Auswahl im Banner):
  // gleiche Tour-Sicht wie ein echter Fahrer — nur Touren des gewählten
  // Fahrers + Unterkonten. RLS lässt Test alles lesen; der Filter
  // erzwingt die realistische Sicht clientseitig.
  const isTestFahrerSim = isTestUser && effectiveRole === 'fahrer';
  // Konten, deren Touren mein aktives Konto sieht: das aktive Konto selbst,
  // und — falls es das Haupt-Konto ist — alle eigenen Unterkonten.
  const scopedFahrerIds = useMemo(() => {
    if (isTestFahrerSim) return testScopedFahrerIds;
    if (!activeFahrer) return [] as string[];
    if (activeFahrer.ist_unterkonto) return [activeFahrer.id];
    const subs = availableFahrer
      .filter((f) => f.ist_unterkonto && f.haupt_user_id === activeFahrer.id)
      .map((f) => f.id);
    return [activeFahrer.id, ...subs];
  }, [isTestFahrerSim, testScopedFahrerIds, activeFahrer, availableFahrer]);
  const navigate = useNavigate();
  const [openingProtokoll, setOpeningProtokoll] = useState<string | null>(null);

  /**
   * Öffnet das verknüpfte schriftliche Protokoll für den aktuellen Fahrer.
   * Sucht einen vorhandenen Draft (fahrer + template) — falls keiner existiert,
   * wird ein neuer angelegt. Anschließend Navigation auf /formular/<id>.
   */
  /**
   * Legt für den aktuellen Fahrer immer eine NEUE Formular-Instanz des
   * Tour-Protokolls an und navigiert dorthin. Frühere Drafts bleiben
   * unverändert im Formulare-Reiter sichtbar und können dort einzeln
   * fortgesetzt oder gelöscht werden.
   */
  async function openSchriftlichesProtokoll(t: TourRow, templateId?: string) {
    const tplId = templateId
      ?? t.schriftliches_protokoll?.id
      ?? t.schriftliches_protokoll_id;
    if (!tplId || !session) return;
    setOpeningProtokoll(`${t.id}:${tplId}`);
    try {
      const { data: fahrerRow } = await supabase
        .from('fahrer').select('id').eq('user_id', session.user.id).maybeSingle();
      if (!fahrerRow?.id) {
        setOpeningProtokoll(null);
        return;
      }
      // Konsistenz mit dem Formulare-Reiter: existiert für diese
      // Tour+Template bereits ein offener Entwurf dieses Fahrers, denselben
      // öffnen (kein zweiter, getrennter Stand). Sonst neu anlegen.
      const { data: existingDraft } = await supabase
        .from('ausgefuellte_formulare')
        .select('id')
        .eq('fahrer_id', fahrerRow.id)
        .eq('template_id', tplId)
        .eq('status', 'draft')
        .eq('daten->>_tour_id', t.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingDraft?.id) {
        navigate(`/formular/${existingDraft.id}`);
        return;
      }
      // Prefill-Daten der Zuweisung mitnehmen, sofern vorhanden.
      const { data: assignment } = await supabase
        .from('tour_protokoll_zuweisungen')
        .select('vorgefuellte_daten')
        .eq('tour_id', t.id).eq('template_id', tplId).maybeSingle();
      const prefillRaw = assignment?.vorgefuellte_daten;
      const initialDaten: Record<string, unknown> = (prefillRaw && typeof prefillRaw === 'object')
        ? { ...(prefillRaw as Record<string, unknown>) }
        : {};
      initialDaten._tour_id = t.id;
      const { data: created, error } = await supabase
        .from('ausgefuellte_formulare')
        .insert({
          fahrer_id: fahrerRow.id,
          template_id: tplId,
          daten: initialDaten as unknown as never,
        })
        .select('id').single();
      if (error || !created) {
        console.warn('Konnte Protokoll-Draft nicht anlegen', error);
        setOpeningProtokoll(null);
        return;
      }
      navigate(`/formular/${created.id}`);
    } finally {
      setOpeningProtokoll(null);
    }
  }

  const [rows, setRows] = useState<TourRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default-Filter: aktueller Monat (1. → letzter Tag).
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const ymd = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const [dateFrom, setDateFrom] = useState<string>(ymd(monthStart));
  const [dateTo, setDateTo]     = useState<string>(ymd(monthEnd));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('alle');
  const [auftraggeberFilter, setAuftraggeberFilter] = useState<string>('');
  const [fahrerFilter, setFahrerFilter]             = useState<string>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [openTourId, setOpenTourId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<TourRow | null>(null);
  const [ablehnToast, setAblehnToastRaw] = useState<string | null>(null);
  function setAblehnToast(t: string) {
    setAblehnToastRaw(t);
    window.setTimeout(() => setAblehnToastRaw((cur) => (cur === t ? null : cur)), 6000);
  }
  const [confirmBusyId, setConfirmBusyId] = useState<string | null>(null);
  /** Aktiver Abrechnungs-Warnungs-Filter (Banner-Klick): zeigt exklusiv
   *  die betroffenen Touren; zweiter Klick hebt ihn wieder auf. */
  const [hinweisFilter, setHinweisFilter] = useState<null | 'kein_preis' | 'ohne_rechnung'>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError(null);
    // Hintergrund-Cleanup: koppelt abgeschlossene Touren von ihrem
    // Greimel-Zugang. RPC ist idempotent — wenn der User kein execute
    // hat (z.B. Fahrer), schlucken wir den Fehler still.
    if (isAdmin) {
      try { await supabase.rpc('release_completed_greimel_zugaenge'); }
      catch { /* RPC-Fehler ignorieren — RLS / Berechtigungen */ }
    }
    // Egress-Optimierung: Nur die Spalten laden, die die Listen-Ansicht
    // tatsächlich rendert (siehe TourCard + Filter + KPIs). Sensible
    // Felder (verguetung, barauslagen, fahrer_honorar, zusaetze) bleiben
    // bei Admins; für Fahrer fallen sie ohnehin raus. JSONB-Spalten
    // (kontakt_start/ziel/rueck, eingang.daten) und Detail-Felder
    // (adresse_*, km_hin/rueck, app_notiz, info, sondervereinbarung,
    // protokoll_daten_felder*) werden NICHT mit geladen — sie kommen
    // erst beim Öffnen des Tour-Detail-Panels (das lädt explizit *).
    const baseCols = `
      id, tour_id, start_stadt, ziel_stadt, rueckfuehrung_stadt,
      kundenname, auftraggeber_id, fahrer_id, status, startdatum, enddatum,
      tourenart, kennzeichen, protokoll_art, schriftliches_protokoll_id,
      greimel_zugang_id, ist_e_fahrzeug, fin,
      eingang_id, eingang_id_bc, km_gesamt,
      bearbeitet_markiert_am, bestaetigt, erstellt_von_rolle, created_at,
      abgelehnt, zurueckgestellt
    `;
    const adminCols = `${baseCols},
      verguetung, barauslagen, fahrer_honorar, ist_sondervereinbarung,
      rechnungsdatum_abweichend, rechnungsdatum`;
    const cols = isAdmin
      ? `
        ${adminCols},
        auftraggeber:auftraggeber_id (name, kontakt, externe_app_name, externe_app_url),
        fahrer:fahrer_id (
          id, user_id, aktiv, vorname, nachname,
          user:user_id (email, vorname, nachname)
        ),
        schriftliches_protokoll:schriftliches_protokoll_id (id, name),
        protokoll_zuweisungen:tour_protokoll_zuweisungen (
          id, template:template_id (id, name)
        ),
        eingang:eingang_id (
          id, status, pdf_paths,
          template:template_id (id, name, pdfs)
        ),
        zusaetze:tour_zusaetze (id, kategorie, anzahl, betrag, notiz, kennzeichen)
      `
      : `
        ${baseCols},
        auftraggeber:auftraggeber_id (name, kontakt, externe_app_name, externe_app_url),
        fahrer:fahrer_id (
          id, user_id, aktiv, vorname, nachname,
          user:user_id (email, vorname, nachname)
        ),
        schriftliches_protokoll:schriftliches_protokoll_id (id, name),
        protokoll_zuweisungen:tour_protokoll_zuweisungen (
          id, template:template_id (id, name)
        ),
        eingang:eingang_id (
          id, status, pdf_paths,
          template:template_id (id, name, pdfs)
        )
      `;
    let query = supabase
      .from('touren')
      .select(cols);
    // Nicht-Admins: nur Touren des aktiven Kontos (inkl. eigener Unterkonten,
    // wenn aktives Konto ein Haupt-Konto ist).
    if (!isAdmin && scopedFahrerIds.length > 0) {
      query = query.in('fahrer_id', scopedFahrerIds);
    }
    const { data, error: err } = await query
      .order('startdatum', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (err) {
      setError(err.message);
      setRows([]);
    } else {
      // Defensive Normalisierung: Supabase kann je nach Schema-Cache-Zustand
      // text[]-Spalten als null oder ein vergessener Default-Wert liefern.
      // Wir stellen sicher, dass kennzeichen IMMER ein Array ist und auch
      // die joined Relationen kein "undefined" einschleusen.
      const list = Array.isArray(data) ? data : [];
      const normalized = list.map((r: unknown) => {
        const row = (r as Record<string, unknown>) ?? {};
        const kz = row.kennzeichen;
        return {
          ...row,
          kennzeichen: Array.isArray(kz) ? kz : [],
          auftraggeber: (row.auftraggeber as TourRow['auftraggeber']) ?? null,
          fahrer: (row.fahrer as TourRow['fahrer']) ?? null,
          schriftliches_protokoll: (row.schriftliches_protokoll as TourRow['schriftliches_protokoll']) ?? null,
          eingang: (row.eingang as TourRow['eingang']) ?? null,
          zusaetze: Array.isArray(row.zusaetze)
            ? (row.zusaetze as Array<Record<string, unknown>>).map((z) => ({
                id: String(z.id ?? ''),
                kategorie: String(z.kategorie ?? ''),
                anzahl: Number.isFinite(Number(z.anzahl)) ? Math.max(0.01, Number(z.anzahl)) : 1,
                betrag: Number(z.betrag ?? 0),
                notiz: typeof z.notiz === 'string' ? z.notiz : null,
                kennzeichen: typeof z.kennzeichen === 'string' ? z.kennzeichen : null,
              }))
            : [],
        } as TourRow;
      });
      setRows(normalized);
    }
    if (silent) setRefreshing(false); else setLoading(false);
  }, [isAdmin, scopedFahrerIds]);

  useEffect(() => { void load(); }, [load]);

  // Rechnungs-Referenzen pro Tour (read-only, nur Admin): aus welchen
  // Rechnungen die Tour als Position stammt. Separat geladen, damit das
  // manuelle Info-Feld der Tour unberührt bleibt.
  const [rechnungByTour, setRechnungByTour] = useState<Record<string, string[]>>({});
  // Erst NACH Abschluss der Positions-Query dürfen „Ohne Rechnung"-
  // Hinweise erscheinen — sonst flackern sie an jeder Tour auf, solange
  // die Map noch leer ist.
  const [rechnungInfoGeladen, setRechnungInfoGeladen] = useState(false);
  useEffect(() => {
    if (!isAdmin || rows.length === 0) {
      // Asynchron zurücksetzen, damit kein synchrones setState im Effect
      // läuft (react-hooks/set-state-in-effect).
      queueMicrotask(() => { setRechnungByTour({}); setRechnungInfoGeladen(false); });
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      setRechnungInfoGeladen(false);
      const ids = rows.map((r) => r.id);
      const { data, error: posErr } = await supabase
        .from('rechnungspositionen')
        .select('tour_id, rechnung:rechnung_id (id, rechnungsnummer)')
        .in('tour_id', ids);
      if (cancelled) return;
      type PosRow = { tour_id: string | null; rechnung: { id: string; rechnungsnummer: string } | null };
      const map: Record<string, string[]> = {};
      const seen: Record<string, Set<string>> = {};
      for (const p of (data as unknown as PosRow[]) ?? []) {
        const tid = p.tour_id; const re = p.rechnung;
        if (!tid || !re) continue;
        if (!map[tid]) { map[tid] = []; seen[tid] = new Set(); }
        if (seen[tid].has(re.id)) continue;
        seen[tid].add(re.id);
        map[tid].push(re.rechnungsnummer);
      }
      setRechnungByTour(map);
      if (!posErr) setRechnungInfoGeladen(true);
    })();
    return () => { cancelled = true; };
  }, [isAdmin, rows]);

  // Reset Pagination wenn Filter sich ändern
  useEffect(() => { setPage(1); }, [dateFrom, dateTo, statusFilter, search, auftraggeberFilter, fahrerFilter, hinweisFilter]);

  /**
   * Toggle für die "Heute bearbeitet"-Markierung pro aktiver Tour.
   * Markierung wird mit dem aktuellen Datum gespeichert; ein Klick auf
   * eine bereits markierte Tour setzt zurück. Datum >= heute zählt als
   * "an", ältere Markierungen werden automatisch ignoriert — kein
   * Cron-Reset nötig. Nur Admins dürfen togglen.
   */
  const todayYmd = useMemo(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);
  // Untergrenze für Abrechnungs-Hinweise: maximal 7 Tage zurückschauen —
  // ältere Touren bleiben ohne Markierung (keine Alt-Touren-Flut).
  const hinweisCutoffYmd = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);

  // Abrechnungs-Hinweise über ALLE geladenen Touren (unabhängig vom
  // Datumsbereich-Filter, das 7-Tage-Fenster begrenzt ohnehin) — speist
  // die Karten-Badges UND die Zusammenfassung oben.
  const hinweise = useMemo(() => {
    const keinPreis = new Set<string>();
    const ohneRechnung = new Set<string>();
    if (!isAdmin) return { keinPreis, ohneRechnung };
    for (const t of rows) {
      if (!t.enddatum || t.enddatum < hinweisCutoffYmd) continue;
      const s = computeTourStatus(t.startdatum, t.enddatum);
      if ((s === 'aktiv' || s === 'abgeschlossen') && !(Number(t.verguetung) > 0)) {
        keinPreis.add(t.id);
      }
      if (s === 'abgeschlossen' && rechnungInfoGeladen
          && (rechnungByTour[t.id]?.length ?? 0) === 0) {
        ohneRechnung.add(t.id);
      }
    }
    return { keinPreis, ohneRechnung };
  }, [isAdmin, rows, hinweisCutoffYmd, rechnungInfoGeladen, rechnungByTour]);

  const toggleBearbeitet = useCallback(async (tourId: string, current: string | null) => {
    if (!isAdmin) return;
    const next = current === todayYmd ? null : todayYmd;
    setRows((prev) => prev.map((r) =>
      r.id === tourId ? { ...r, bearbeitet_markiert_am: next } : r,
    ));
    const { error: err } = await supabase
      .from('touren')
      .update({ bearbeitet_markiert_am: next })
      .eq('id', tourId);
    if (err) {
      console.warn('[TourenlistePage] toggleBearbeitet fehlgeschlagen', err.message);
      setRows((prev) => prev.map((r) =>
        r.id === tourId ? { ...r, bearbeitet_markiert_am: current } : r,
      ));
    }
  }, [isAdmin, todayYmd]);

  // Lookup-Listen für die Filter-Dropdowns (eigene Queries, damit auch
  // Auftraggeber / Fahrer angezeigt werden, deren Touren noch nicht im
  // aktuellen Zeitraum liegen).
  const [auftraggeberOptions, setAuftraggeberOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [fahrerOptions, setFahrerOptions] = useState<Array<{ id: string; label: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Auftraggeber-Dropdown: alle (für Admin), sonst nur die der eigenen Touren —
      // hier reicht aber „alle" da RLS allen authentifizierten Lesezugriff erlaubt.
      const agRes = await supabase.from('auftraggeber').select('id, name').order('name');
      if (cancelled) return;
      setAuftraggeberOptions(Array.isArray(agRes.data) ? agRes.data : []);

      // Fahrer-Filter:
      // - Admin: alle aktiven Fahrer mit Haupt/Unterkonto-Gruppierung
      // - Haupt-Konto mit Unterkonten: eigene Konten als Optionen
      // - Sonst: leer (Dropdown wird ausgeblendet)
      if (isAdmin) {
        const faRes = await supabase
          .from('fahrer')
          .select('id, vorname, nachname, ist_unterkonto, haupt_user_id, user:user_id (email, vorname, nachname)')
          .eq('aktiv', true);
        if (cancelled) return;
        const list = (Array.isArray(faRes.data) ? faRes.data : []) as unknown as FahrerOptionRaw[];
        setFahrerOptions(flattenedFahrerOptions(list));
      } else if (scopedFahrerIds.length > 1) {
        const list = availableFahrer.filter((f) => scopedFahrerIds.includes(f.id));
        setFahrerOptions(flattenedFahrerOptions(list as unknown as FahrerOptionRaw[]));
      } else {
        setFahrerOptions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, scopedFahrerIds, availableFahrer, profile]);

  // ---- Unbestätigte Touren (von Auftraggebern eingereicht) ----
  // Erscheinen für Admins in einem eigenen Bereich GANZ OBEN — ohne
  // Datums-/Status-Filter, damit nichts untergeht. Fahrer sehen
  // unbestätigte Touren per RLS ohnehin nie (fahrer_id ist null).
  /** Alle offenen Einreichungen (nicht bestätigt, nicht abgelehnt). */
  const offeneEinreichungen = useMemo(
    () => (isAdmin ? (rows ?? []).filter((t) => t.bestaetigt === false && !t.abgelehnt) : []),
    [rows, isAdmin],
  );

  /**
   * Dreiteilung der offenen Einreichungen (Punkt 4):
   *  - aktuell:      Start innerhalb der nächsten 14 Tage → oben,
   *                  zählt für den Notification-Blip.
   *  - zukuenftig:   Start weiter in der Zukunft → eingeklappt.
   *  - zurueckgestellt: manuell per "Später" → eingeklappt, zählt nicht.
   * Rutscht eine zukünftige Tour ins Fenster, erscheint sie automatisch
   * oben (rein datumsbasiert, kein Zustand nötig).
   */
  const fensterBisYmd = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + BESTAETIGUNG_FENSTER_TAGE);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);

  const unbestaetigteRows = useMemo(
    () => offeneEinreichungen.filter(
      (t) => !t.zurueckgestellt && (!t.startdatum || t.startdatum <= fensterBisYmd),
    ),
    [offeneEinreichungen, fensterBisYmd],
  );
  const zukuenftigeRows = useMemo(
    () => offeneEinreichungen.filter(
      (t) => !t.zurueckgestellt && !!t.startdatum && t.startdatum > fensterBisYmd,
    ),
    [offeneEinreichungen, fensterBisYmd],
  );
  const zurueckgestellteRows = useMemo(
    () => offeneEinreichungen.filter((t) => t.zurueckgestellt),
    [offeneEinreichungen],
  );

  const [zukunftOffen, setZukunftOffen] = useState(false);
  const [zurueckOffen, setZurueckOffen] = useState(false);
  /** Auswahl für die Sammelaktion "Ausgewählte zurückstellen". */
  const [selectedEinreichungen, setSelectedEinreichungen] = useState<Set<string>>(new Set());

  // ---- Touren im gewählten Datums-Bereich ----
  // Maßgeblich ist das ENDDATUM (Fallback auf startdatum, falls noch
  // kein Enddatum gesetzt ist) — eine Tour mit enddatum im Januar 2026
  // gehört damit zum Januar 2026.
  const rangeRows = useMemo(() => {
    const fromKey = dateFrom.replace(/-/g, '');
    const toKey   = dateTo.replace(/-/g, '');
    return (rows ?? []).filter((t) => {
      // Unbestätigte Touren laufen über den eigenen Bereich oben.
      if (t.bestaetigt === false) return false;
      const ref = t?.enddatum ?? t?.startdatum;
      if (!ref) return false;
      const d = new Date(ref);
      if (isNaN(d.getTime())) return false;
      const pad = (n: number) => String(n).padStart(2, '0');
      const key = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
      return key >= fromKey && key <= toKey;
    });
  }, [rows, dateFrom, dateTo]);

  // ---- Gefilterte Touren (Status [computed] + Suche) ----
  const filteredRows = useMemo(() => {
    // Hinweis-Filter (Klick auf die Warn-Zusammenfassung): exklusiver
    // Modus — zeigt genau die betroffenen Touren, unabhängig von
    // Datums-/Status-/Such-Filtern, damit Zähler und Liste immer
    // übereinstimmen.
    if (hinweisFilter) {
      const set = hinweisFilter === 'kein_preis' ? hinweise.keinPreis : hinweise.ohneRechnung;
      return (rows ?? []).filter((t) => set.has(t.id));
    }
    const q = search.trim().toLowerCase();
    return (rangeRows ?? []).filter((t) => {
      if (statusFilter !== 'alle' && computeTourStatus(t.startdatum, t.enddatum) !== statusFilter) return false;
      if (auftraggeberFilter && t.auftraggeber_id !== auftraggeberFilter) return false;
      if (fahrerFilter && t.fahrer_id !== fahrerFilter) return false;
      if (!q) return true;
      const fahrerName = resolveFahrerName(t.fahrer ?? null, t.fahrer?.user ?? null).toLowerCase();
      const haystack = [
        t.tour_id ?? '',
        t.start_stadt ?? '',
        t.ziel_stadt ?? '',
        t.rueckfuehrung_stadt ?? '',
        t.kundenname ?? '',
        t.fin ?? '',
        fahrerName,
        ...(Array.isArray(t.kennzeichen) ? t.kennzeichen : []),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [rangeRows, rows, statusFilter, search, auftraggeberFilter, fahrerFilter, hinweisFilter, hinweise]);

  // ---- KPI-Daten ----
  // Alle KPIs respektieren Auftraggeber- und Fahrer-Filter (siehe Spec:
  // "wenn ich nach Auftraggeber filtere, zeigen die KPIs nur die Werte
  // des gefilterten Auftraggebers"). Aktiv/Geplant ignorieren bewusst
  // den Status-Filter, damit die Zahlen beim Wechsel der Status-Pills
  // stabil bleiben.
  const kpiRangeRows = useMemo(() => {
    return (rangeRows ?? []).filter((t) => {
      if (auftraggeberFilter && t.auftraggeber_id !== auftraggeberFilter) return false;
      if (fahrerFilter && t.fahrer_id !== fahrerFilter) return false;
      return true;
    });
  }, [rangeRows, auftraggeberFilter, fahrerFilter]);

  const kpi = useMemo(() => {
    const sum = (filteredRows ?? []).reduce((acc, t) => acc + Number(t.verguetung ?? 0), 0);
    let aktiv = 0;
    let geplant = 0;
    for (const t of kpiRangeRows) {
      const s = computeTourStatus(t.startdatum, t.enddatum);
      if (s === 'aktiv') aktiv += 1;
      if (s === 'geplant') geplant += 1;
    }
    return {
      total: kpiRangeRows.length,
      sum,
      sumCount: (filteredRows ?? []).length,
      aktiv, geplant,
    };
  }, [kpiRangeRows, filteredRows]);

  const guard = useTestGuard();

  /** Unbestätigte Tour freigeben — wandert danach in die normale Liste. */
  async function handleBestaetigen(t: TourRow) {
    if (guard()) return;
    setConfirmBusyId(t.id);
    const { error: err } = await supabase
      .from('touren')
      .update({ bestaetigt: true })
      .eq('id', t.id);
    setConfirmBusyId(null);
    if (err) { setError(err.message); return; }
    void load(true);
    window.dispatchEvent(new CustomEvent('maja:einreichungen-changed'));
  }

  /** Einreichung(en) zurückstellen ("Später") bzw. wieder aktivieren. */
  async function setZurueckgestellt(ids: string[], wert: boolean) {
    if (ids.length === 0) return;
    if (guard()) return;
    const { error: err } = await supabase
      .from('touren')
      .update({
        zurueckgestellt: wert,
        zurueckgestellt_am: wert ? new Date().toISOString() : null,
      })
      .in('id', ids);
    if (err) { setError(err.message); return; }
    setSelectedEinreichungen(new Set());
    void load(true);
    // Blip sofort aktualisieren — zurückgestellte zählen nicht mehr.
    window.dispatchEvent(new CustomEvent('maja:einreichungen-changed'));
    setAblehnToast(wert
      ? `${ids.length} Einreichung${ids.length === 1 ? '' : 'en'} zurückgestellt.`
      : 'Einreichung wieder aktiviert.');
  }

  /** Unbestätigte Tour ablehnen: KEIN Hard-Delete mehr — Status
   *  abgelehnt + Grund + Zeitstempel, damit die Einreichung für den
   *  Auftraggeber nachvollziehbar bleibt. Optional Info-Mail an die
   *  hinterlegte Adresse des Einreichers (Fehler beim Versand lassen
   *  die Ablehnung bestehen — nur Hinweis anzeigen). */
  async function handleAblehnen(t: TourRow, grund: string, mailSenden: boolean) {
    if (guard()) { setRejecting(null); return; }
    const { error: err } = await supabase
      .from('touren')
      .update({
        abgelehnt: true,
        ablehnungsgrund: grund.trim() || null,
        abgelehnt_am: new Date().toISOString(),
      })
      .eq('id', t.id);
    if (err) { setError(err.message); setRejecting(null); return; }
    setRejecting(null);
    void load(true);
    // Abgelehnte zählen nicht mehr → Blip sofort neu berechnen.
    window.dispatchEvent(new CustomEvent('maja:einreichungen-changed'));

    if (!mailSenden) { setAblehnToast('Tour abgelehnt.'); return; }
    try {
      // Empfänger: E-Mail des einreichenden Auftraggeber-Users; Fallback
      // auf die Stamm-Adresse (email1) des Auftraggebers.
      const { data: info } = await supabase
        .from('touren')
        .select('erstellt_von, auftraggeber:auftraggeber_id (name, email1)')
        .eq('id', t.id)
        .maybeSingle();
      type Info = { erstellt_von: string | null; auftraggeber: { name: string; email1: string | null } | null };
      const inf = info as unknown as Info | null;
      let empfaenger: string | null = null;
      if (inf?.erstellt_von) {
        const { data: u } = await supabase
          .from('app_users').select('email').eq('id', inf.erstellt_von).maybeSingle();
        if (u?.email && u.email.includes('@')) empfaenger = u.email;
      }
      if (!empfaenger && inf?.auftraggeber?.email1?.includes('@')) {
        empfaenger = inf.auftraggeber.email1;
      }
      if (!empfaenger) {
        setAblehnToast('Tour abgelehnt — keine E-Mail-Adresse hinterlegt, bitte manuell informieren.');
        return;
      }
      const ref = t.tour_id ?? tourTitel(t);
      const von = (await loadMailboxes()).find((m) => m.key === 'mail_inbox_1')?.address;
      const body = `Guten Tag,\n\nIhre eingereichte Tour ${ref} wurde abgelehnt.`
        + (grund.trim() ? `\n\nGrund: ${grund.trim()}` : '')
        + '\n\nBei Fragen melden Sie sich gern.';
      await sendEmail({
        to: [empfaenger],
        subject: `Tour ${ref} abgelehnt`,
        body,
        bodyHtml: bodyWithSignatureHtml({ body, sig: signatureFromProfile(profile) }),
        from: von || undefined,
        attachments: [],
      });
      setAblehnToast(`Tour abgelehnt — Auftraggeber per E-Mail informiert (${empfaenger}).`);
    } catch (mailErr) {
      console.warn('[Tour ablehnen] Info-Mail fehlgeschlagen', mailErr);
      setAblehnToast('Tour abgelehnt — Info-E-Mail konnte NICHT versendet werden, bitte manuell informieren.');
    }
  }

  /** Excel-Export des aktuell gewählten Zeitraums (+ Auftraggeber-Filter,
   *  falls gesetzt). Roundtrip-kompatibel mit dem Touren-Import. */
  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const n = await exportTourenExcel({
        dateFrom, dateTo,
        auftraggeberId: auftraggeberFilter || null,
      });
      if (n === 0) setError('Keine Touren im gewählten Zeitraum — nichts zu exportieren.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export fehlgeschlagen.');
    } finally {
      setExporting(false);
    }
  }

  // ---- Pagination ----
  const totalPages = Math.max(1, Math.ceil((filteredRows ?? []).length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = (filteredRows ?? []).slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (loading) return <Spinner label="Touren werden geladen …" />;
  if (error)   return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Tourenliste</h1>
          <p className="text-sm text-maja-muted">
            Übersicht und Verwaltung aller Touren.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void load(true)}
            disabled={refreshing}
          >
            {refreshing ? 'Lädt …' : 'Aktualisieren'}
          </button>
          {isAdmin && (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void handleExport()}
                disabled={exporting}
                title="Touren des gewählten Zeitraums als Excel-Backup exportieren"
              >
                {exporting ? 'Exportiert …' : 'Export (Excel)'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowImport(true)}>
                Touren importieren
              </button>
              <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>
                + Neue Tour
              </button>
            </>
          )}
        </div>
      </div>

      {/* Zur Bestätigung: von Auftraggebern eingereichte Touren.
          Dreigeteilt (Punkt 4): aktuelles 14-Tage-Fenster oben,
          weiter entfernte und manuell zurückgestellte eingeklappt. */}
      {isAdmin && unbestaetigteRows.length > 0 && (
        <section className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">
            Zur Bestätigung ({unbestaetigteRows.length})
          </h2>
          <p className="text-xs text-amber-800">
            Von Auftraggebern eingereichte Touren mit Start in den nächsten
            {' '}{BESTAETIGUNG_FENSTER_TAGE} Tagen. Öffnen, fehlende Daten
            (Fahrer, km, Preis) ergänzen und bestätigen — oder ablehnen.
          </p>

          {/* Sammelaktion: bewusst nur "Zurückstellen" — Bestätigen und
              Ablehnen brauchen pro Tour Daten bzw. einen Grund. */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-amber-900">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                checked={unbestaetigteRows.every((t) => selectedEinreichungen.has(t.id))}
                onChange={(e) => setSelectedEinreichungen(
                  e.target.checked ? new Set(unbestaetigteRows.map((t) => t.id)) : new Set(),
                )}
              />
              Alle auswählen
            </label>
            {selectedEinreichungen.size > 0 && (
              <>
                <span className="font-medium text-amber-900">
                  {selectedEinreichungen.size} ausgewählt
                </span>
                <button
                  type="button"
                  className="rounded-full bg-amber-600 px-3 py-1 font-semibold text-white hover:bg-amber-700"
                  onClick={() => void setZurueckgestellt([...selectedEinreichungen], true)}
                >
                  Ausgewählte zurückstellen
                </button>
                <button
                  type="button"
                  className="font-medium text-amber-900 underline hover:no-underline"
                  onClick={() => setSelectedEinreichungen(new Set())}
                >
                  Auswahl aufheben
                </button>
              </>
            )}
          </div>

          <ul className="space-y-2">
            {unbestaetigteRows.map((t) => (
              <EinreichungCard
                key={t.id}
                tour={t}
                selectable
                selected={selectedEinreichungen.has(t.id)}
                onToggleSelected={() => setSelectedEinreichungen((prev) => {
                  const next = new Set(prev);
                  if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                  return next;
                })}
                busy={confirmBusyId === t.id}
                onOpen={() => setOpenTourId(t.id)}
                onBestaetigen={() => void handleBestaetigen(t)}
                onAblehnen={() => setRejecting(t)}
                onSpaeter={() => void setZurueckgestellt([t.id], true)}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Zukünftige Einreichungen (Start jenseits des Fensters) */}
      {isAdmin && zukuenftigeRows.length > 0 && (
        <section className="rounded-xl border border-maja-navy/15 bg-white">
          <button
            type="button"
            onClick={() => setZukunftOffen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
            aria-expanded={zukunftOffen}
          >
            <span className="text-sm font-semibold text-maja-navy">
              Zukünftige Einreichungen ({zukuenftigeRows.length})
            </span>
            <span className="text-xs text-maja-muted">
              {zukunftOffen ? 'Einklappen' : 'Ausklappen'}
            </span>
          </button>
          {zukunftOffen && (
            <div className="border-t border-maja-navy/10 px-4 py-3">
              <p className="mb-2 text-xs text-maja-muted">
                Start liegt mehr als {BESTAETIGUNG_FENSTER_TAGE} Tage in der
                Zukunft. Sie rücken automatisch nach oben, sobald das Fenster
                erreicht ist — bearbeiten geht aber jederzeit auch hier.
              </p>
              <ul className="space-y-2">
                {zukuenftigeRows.map((t) => (
                  <EinreichungCard
                    key={t.id}
                    tour={t}
                    busy={confirmBusyId === t.id}
                    onOpen={() => setOpenTourId(t.id)}
                    onBestaetigen={() => void handleBestaetigen(t)}
                    onAblehnen={() => setRejecting(t)}
                    onSpaeter={() => void setZurueckgestellt([t.id], true)}
                  />
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Zurückgestellte Einreichungen */}
      {isAdmin && zurueckgestellteRows.length > 0 && (
        <section className="rounded-xl border border-maja-navy/15 bg-white">
          <button
            type="button"
            onClick={() => setZurueckOffen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
            aria-expanded={zurueckOffen}
          >
            <span className="text-sm font-semibold text-maja-navy">
              Zurückgestellt ({zurueckgestellteRows.length})
            </span>
            <span className="text-xs text-maja-muted">
              {zurueckOffen ? 'Einklappen' : 'Ausklappen'}
            </span>
          </button>
          {zurueckOffen && (
            <div className="border-t border-maja-navy/10 px-4 py-3">
              <ul className="space-y-2">
                {zurueckgestellteRows.map((t) => (
                  <EinreichungCard
                    key={t.id}
                    tour={t}
                    busy={confirmBusyId === t.id}
                    onOpen={() => setOpenTourId(t.id)}
                    onBestaetigen={() => void handleBestaetigen(t)}
                    onAblehnen={() => setRejecting(t)}
                    onReaktivieren={() => void setZurueckgestellt([t.id], false)}
                  />
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Datums-Filter */}
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="t-from" className="label">Startdatum</label>
            <input id="t-from" type="date" className="input"
                   value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label htmlFor="t-to" className="label">Enddatum</label>
            <input id="t-to" type="date" className="input"
                   value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          {(() => {
            const heuteYmd = ymd(today);
            const vortagYmd = ymd(letzterWerktagVor(today));
            const naechsterYmd = ymd(naechsterWerktagNach(today));
            const monthYmdFrom = ymd(monthStart);
            const monthYmdTo = ymd(monthEnd);
            const yearStart = new Date(today.getFullYear(), 0, 1);
            const yearEnd = new Date(today.getFullYear(), 11, 31);
            const yearYmdFrom = ymd(yearStart);
            const yearYmdTo = ymd(yearEnd);
            const heuteAktiv = dateFrom === heuteYmd && dateTo === heuteYmd;
            const vortagAktiv = dateFrom === vortagYmd && dateTo === vortagYmd;
            const naechsterAktiv = dateFrom === naechsterYmd && dateTo === naechsterYmd;
            const monatAktiv = dateFrom === monthYmdFrom && dateTo === monthYmdTo;
            const jahrAktiv = dateFrom === yearYmdFrom && dateTo === yearYmdTo;
            // Identische Pill-Optik wie die Status-Pills weiter unten —
            // gleicher Radius, Padding, Border, Hover, Aktiv-Zustand.
            const pillCls = (active: boolean) => `inline-block rounded-full px-3 py-1.5 text-sm font-medium transition ${
              active ? 'bg-maja-navy text-white' : 'bg-white text-maja-navy hover:bg-maja-light border border-maja-navy/15'
            }`;
            // Tages-Toggle: zweiter Klick stellt den Monats-Standard
            // wieder her. Monat/Jahr setzen den Bereich direkt — der
            // Aktiv-Zustand fällt automatisch zurück, sobald ein anderer
            // Bereich gewählt wird.
            const toggleDay = (active: boolean, target: string) => {
              if (active) { setDateFrom(monthYmdFrom); setDateTo(monthYmdTo); }
              else { setDateFrom(target); setDateTo(target); }
            };
            return (
              <>
                <button type="button" className={pillCls(heuteAktiv)}
                        onClick={() => toggleDay(heuteAktiv, heuteYmd)}>
                  Heute
                </button>
                <button type="button" className={pillCls(vortagAktiv)}
                        onClick={() => toggleDay(vortagAktiv, vortagYmd)}>
                  Vortag
                </button>
                <button type="button" className={pillCls(naechsterAktiv)}
                        onClick={() => toggleDay(naechsterAktiv, naechsterYmd)}>
                  Nächster Tag
                </button>
                <button type="button" className={pillCls(monatAktiv)}
                        onClick={() => { setDateFrom(monthYmdFrom); setDateTo(monthYmdTo); }}>
                  Aktueller Monat
                </button>
                <button type="button" className={pillCls(jahrAktiv)}
                        onClick={() => { setDateFrom(yearYmdFrom); setDateTo(yearYmdTo); }}>
                  Aktuelles Jahr
                </button>
              </>
            );
          })()}
        </div>
      </div>

      {/* Abrechnungs-Warnungen (nur Admin, letzte 7 Tage) — Klick filtert
          die Liste exklusiv auf die betroffenen Touren; zweiter Klick
          bzw. „Filter aufheben" stellt die normale Ansicht wieder her.
          Ohne Warnungen erscheint gar nichts. */}
      {isAdmin && (hinweise.keinPreis.size > 0 || hinweise.ohneRechnung.size > 0 || hinweisFilter) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-400/30">
          <span aria-hidden="true" className="text-amber-800">⚠</span>
          {hinweise.keinPreis.size > 0 && (
            <button
              type="button"
              onClick={() => setHinweisFilter((cur) => (cur === 'kein_preis' ? null : 'kein_preis'))}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                hinweisFilter === 'kein_preis'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-100 text-amber-800 hover:ring-1 hover:ring-amber-400'
              }`}
            >
              {hinweise.keinPreis.size} {hinweise.keinPreis.size === 1 ? 'Tour' : 'Touren'} ohne Preis
            </button>
          )}
          {hinweise.ohneRechnung.size > 0 && (
            <button
              type="button"
              onClick={() => setHinweisFilter((cur) => (cur === 'ohne_rechnung' ? null : 'ohne_rechnung'))}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                hinweisFilter === 'ohne_rechnung'
                  ? 'bg-orange-600 text-white'
                  : 'bg-orange-100 text-orange-700 hover:ring-1 hover:ring-orange-400'
              }`}
            >
              {hinweise.ohneRechnung.size} abgeschlossene ohne Rechnung
            </button>
          )}
          {hinweisFilter && (
            <button
              type="button"
              onClick={() => setHinweisFilter(null)}
              className="text-xs font-medium text-amber-800 underline hover:no-underline"
            >
              Filter aufheben
            </button>
          )}
        </div>
      )}

      {/* KPI-Karten — Summe Ansicht (Vergütung) nur für Admins */}
      <div className={`grid gap-3 sm:grid-cols-2 ${isAdmin ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        <KpiCard
          title="Touren im Zeitraum"
          value={String(kpi.total)}
          hint={`${dateFrom} – ${dateTo}`}
        />
        {isAdmin && (
          <KpiCard
            title="Summe Ansicht"
            value={formatEuro(kpi.sum)}
            hint={`${kpi.sumCount} ${kpi.sumCount === 1 ? 'Tour' : 'Touren'}`}
          />
        )}
        <KpiCard
          title="Aktiv"
          value={String(kpi.aktiv)}
          hint="läuft gerade"
          accent
        />
        <KpiCard
          title="Geplant"
          value={String(kpi.geplant)}
          hint="nächste Tage"
        />
      </div>

      {/* Suche + Status-Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="input flex-1 min-w-[16rem]"
          placeholder="Tour-ID, Stadt, Fahrer, Kennzeichen ..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap gap-1">
          {(['alle', 'aktiv', 'geplant', 'abgeschlossen'] as const).map((s) => {
            const active = statusFilter === s;
            const label = s === 'alle' ? 'Alle' : STATUS_LABEL[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`inline-block rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  active ? 'bg-maja-navy text-white' : 'bg-white text-maja-navy hover:bg-maja-light border border-maja-navy/15'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Auftraggeber + Fahrer Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-1 min-w-[12rem] flex-col">
          <label htmlFor="t-ag-filter" className="text-xs font-medium uppercase tracking-wide text-maja-muted">
            Auftraggeber
          </label>
          <select
            id="t-ag-filter"
            className="input"
            value={auftraggeberFilter}
            onChange={(e) => setAuftraggeberFilter(e.target.value)}
          >
            <option value="">Alle Auftraggeber</option>
            {auftraggeberOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        {fahrerOptions.length > 0 && (
          <div className="flex flex-1 min-w-[12rem] flex-col">
            <label htmlFor="t-fa-filter" className="text-xs font-medium uppercase tracking-wide text-maja-muted">
              Fahrer
            </label>
            <select
              id="t-fa-filter"
              className="input"
              value={fahrerFilter}
              onChange={(e) => setFahrerFilter(e.target.value)}
            >
              <option value="">Alle Fahrer</option>
              {fahrerOptions.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </div>
        )}
        {(auftraggeberFilter || fahrerFilter) && (
          <button
            type="button"
            className="btn-secondary self-end px-3 py-2 text-sm"
            onClick={() => { setAuftraggeberFilter(''); setFahrerFilter(''); }}
          >
            Filter zurücksetzen
          </button>
        )}
      </div>

      {/* Tourenliste */}
      {(pageRows ?? []).length === 0 ? (
        <div className="card p-8 text-center text-sm text-maja-muted">
          Keine Touren entsprechen den aktuellen Filtern.
        </div>
      ) : (
        <ul className="space-y-3">
          {(pageRows ?? []).map((t) => (
            <TourCard
              key={t.id}
              tour={t}
              onOpen={() => setOpenTourId(t.id)}
              onOpenProtokoll={(templateId) => void openSchriftlichesProtokoll(t, templateId)}
              opening={openingProtokoll}
              isAdmin={isAdmin}
              todayYmd={todayYmd}
              onToggleBearbeitet={() => void toggleBearbeitet(t.id, t.bearbeitet_markiert_am ?? null)}
              rechnungsnummern={rechnungByTour[t.id]}
              hinweisKeinPreis={hinweise.keinPreis.has(t.id)}
              hinweisOhneRechnung={hinweise.ohneRechnung.has(t.id)}
            />
          ))}
        </ul>
      )}

      {/* Pagination */}
      {filteredRows.length > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-maja-muted">
            Seite {safePage} von {totalPages} · {filteredRows.length} Touren
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
            >
              Zurück
            </button>
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
            >
              Weiter
            </button>
          </div>
        </div>
      )}

      {showCreate && isAdmin && (
        <TourCreateDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); void load(); }}
        />
      )}

      {showImport && isAdmin && (
        <TourImportDialog
          onClose={() => setShowImport(false)}
          onImported={() => { void load(); }}
        />
      )}

      {openTourId && (
        <TourDetailDialog
          tourId={openTourId}
          onClose={() => setOpenTourId(null)}
          onChanged={() => void load(true)}
          onDeleted={() => { setOpenTourId(null); void load(); }}
        />
      )}

      {rejecting && (
        <TourAblehnenDialog
          tourLabel={rejecting.tour_id ?? tourTitel(rejecting)}
          onConfirm={(grund, mailSenden) => void handleAblehnen(rejecting, grund, mailSenden)}
          onClose={() => setRejecting(null)}
        />
      )}

      {ablehnToast && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-maja-navy px-4 py-2 text-sm font-medium text-white shadow-lg">
          {ablehnToast}
        </div>
      )}
    </div>
  );
}

/**
 * Karte einer offenen Einreichung im Bestätigungs-Bereich. Wird für alle
 * drei Gruppen (aktuell / zukünftig / zurückgestellt) genutzt — je nach
 * Gruppe mit „Später" oder „Wieder aktivieren".
 */
function EinreichungCard({
  tour, busy, onOpen, onBestaetigen, onAblehnen, onSpaeter, onReaktivieren,
  selectable, selected, onToggleSelected,
}: {
  tour: TourRow;
  busy: boolean;
  onOpen: () => void;
  onBestaetigen: () => void;
  onAblehnen: () => void;
  onSpaeter?: () => void;
  onReaktivieren?: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
}) {
  return (
    <li className="card flex flex-wrap items-center justify-between gap-3 p-4 ring-1 ring-amber-300">
      {selectable && (
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 rounded border-maja-navy/30 text-maja-navy"
          checked={!!selected}
          onChange={onToggleSelected}
          aria-label={`${tour.tour_id ?? tourTitel(tour)} auswählen`}
        />
      )}
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <div className="flex flex-wrap items-center gap-2">
          {tour.tour_id && (
            <span className="inline-block rounded-full bg-maja-light px-2 py-0.5 text-xs font-semibold text-maja-navy">
              {tour.tour_id}
            </span>
          )}
          <span className="text-sm font-semibold text-maja-navy">{tourTitel(tour)}</span>
          <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
            Unbestätigt
          </span>
          {tour.zurueckgestellt && (
            <span className="inline-block rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-700">
              Zurückgestellt
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-maja-muted">
          {formatDate(tour.startdatum)} – {formatDate(tour.enddatum)}
          {tour.auftraggeber?.name && <> · {tour.auftraggeber.name}</>}
          {(tour.kennzeichen ?? []).length > 0 && <> · {(tour.kennzeichen ?? []).join(', ')}</>}
          {tour.kundenname && <> · {tour.kundenname}</>}
        </div>
      </button>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary px-3 py-1.5 text-sm"
          disabled={busy}
          onClick={onBestaetigen}
        >
          {busy ? 'Bestätigt …' : 'Tour bestätigen'}
        </button>
        <button
          type="button"
          className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
          onClick={onAblehnen}
        >
          Ablehnen
        </button>
        {onSpaeter && (
          <button
            type="button"
            className="rounded-lg border border-maja-navy/25 bg-white px-3 py-1.5 text-sm font-medium text-maja-navy hover:bg-maja-light"
            title="Einreichung zurückstellen — verschwindet aus diesem Bereich und zählt nicht mehr für den Hinweis-Punkt"
            onClick={onSpaeter}
          >
            Später
          </button>
        )}
        {onReaktivieren && (
          <button
            type="button"
            className="rounded-lg border border-maja-navy/25 bg-white px-3 py-1.5 text-sm font-medium text-maja-navy hover:bg-maja-light"
            onClick={onReaktivieren}
          >
            Wieder aktivieren
          </button>
        )}
      </div>
    </li>
  );
}

/** Ablehnen-Dialog: Pflicht-Grund + optionale Info-Mail an den
 *  Auftraggeber (Checkbox, default an). */
function TourAblehnenDialog({
  tourLabel, onConfirm, onClose,
}: {
  tourLabel: string;
  onConfirm: (grund: string, mailSenden: boolean) => void;
  onClose: () => void;
}) {
  const [grund, setGrund] = useState('');
  const [mailSenden, setMailSenden] = useState(true);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-maja-ink/40 px-4">
      <div className="card w-full max-w-md p-5">
        <h3 className="text-base font-semibold text-maja-navy">Tour ablehnen?</h3>
        <p className="mt-1 text-sm text-maja-ink">
          Die eingereichte Tour <strong>{tourLabel}</strong> wird als
          <strong> abgelehnt</strong> markiert (nicht gelöscht) und dem
          Auftraggeber mit Grund angezeigt.
        </p>
        <label htmlFor="ablehn-grund" className="label mt-3">Grund der Ablehnung *</label>
        <textarea
          id="ablehn-grund"
          className="input min-h-[4.5rem]"
          value={grund}
          onChange={(e) => setGrund(e.target.value)}
          placeholder="Warum wird abgelehnt? (wird dem Auftraggeber angezeigt)"
          autoFocus
        />
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-maja-ink">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
            checked={mailSenden}
            onChange={(e) => setMailSenden(e.target.checked)}
          />
          Auftraggeber per E-Mail informieren
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button
            type="button"
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            disabled={!grund.trim()}
            onClick={() => onConfirm(grund, mailSenden)}
          >
            Ablehnen
          </button>
        </div>
      </div>
    </div>
  );
}

interface KpiProps { title: string; value: string; hint?: string; accent?: boolean }
function KpiCard({ title, value, hint, accent }: KpiProps) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-maja-muted">{title}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ? 'text-maja-accent' : 'text-maja-navy'}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-maja-muted">{hint}</div>}
    </div>
  );
}

interface CardProps {
  tour: TourRow;
  onOpen: () => void;
  onOpenProtokoll: (templateId: string) => void;
  /** Busy-Key der Form `${tour.id}:${templateId}` für den gerade öffnenden
   *  Button, sonst null. */
  opening: string | null;
  isAdmin: boolean;
  todayYmd: string;
  onToggleBearbeitet: () => void;
  /** Rechnungsnummern, auf denen die Tour als Position verwendet wird
   *  (read-only, aus rechnungspositionen ermittelt). Nur für Admin. */
  rechnungsnummern?: string[];
  /** Abrechnungs-Hinweise (nur Admin, Enddatum max. 7 Tage zurück):
   *  kein Preis berechnet bzw. abgeschlossen ohne Rechnungsposition. */
  hinweisKeinPreis?: boolean;
  hinweisOhneRechnung?: boolean;
}
function TourCard({
  tour, onOpen, onOpenProtokoll, opening, isAdmin, todayYmd, onToggleBearbeitet,
  rechnungsnummern, hinweisKeinPreis, hinweisOhneRechnung,
}: CardProps) {
  // Mehrere Protokoll-Zuweisungen via tour_protokoll_zuweisungen — pro
  // Zuweisung ein eigener Open-Button. Fallback auf die Legacy-Spalte,
  // wenn die Zuweisungen noch nicht geladen / migriert sind.
  const protokollItems = (tour.protokoll_zuweisungen ?? [])
    .filter((p) => p.template != null)
    .map((p) => ({ id: p.template!.id, name: p.template!.name }));
  if (protokollItems.length === 0 && tour.schriftliches_protokoll_id) {
    protokollItems.push({
      id: tour.schriftliches_protokoll_id,
      name: tour.schriftliches_protokoll?.name ?? 'Protokoll',
    });
  }
  const hasSchriftlich = tour.protokoll_art === 'schriftlich' && protokollItems.length > 0;
  const fahrerName = resolveFahrerName(tour.fahrer ?? null, tour.fahrer?.user ?? null) || '— kein Fahrer —';
  const computedStatus = computeTourStatus(tour.startdatum, tour.enddatum);
  const bearbeitetHeute = tour.bearbeitet_markiert_am === todayYmd;
  const dateRange = (() => {
    if (!tour.startdatum && !tour.enddatum) return null;
    if (tour.startdatum && tour.enddatum) {
      return `${formatDate(tour.startdatum)} – ${formatDate(tour.enddatum)}`;
    }
    return formatDate(tour.startdatum ?? tour.enddatum);
  })();

  const zusaetze = tour.zusaetze ?? [];
  const hasZusaetze = zusaetze.length > 0;
  const zusaetzeSumme = zusaetze.reduce(
    (acc, z) => acc + (Number(z.anzahl) || 1) * Number(z.betrag ?? 0),
    0,
  );
  const [zusaetzeOpen, setZusaetzeOpen] = useState(false);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={`card w-full p-5 text-left transition hover:shadow-lg ${
          hasZusaetze ? 'rounded-b-none' : ''
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {tour.tour_id && (
                <span className="inline-block rounded-full bg-maja-light px-2 py-0.5 text-xs font-semibold text-maja-navy">
                  {tour.tour_id}
                </span>
              )}
              <h3 className="text-base font-semibold text-maja-navy break-words">
                {tourTitel(tour)}
              </h3>
            </div>

            <div className="mt-3 grid gap-2 text-sm text-maja-ink sm:grid-cols-2">
              <Meta icon={<IconUser />}>{fahrerName}</Meta>
              {isAdmin && <Meta icon={<IconPin />}>{formatKm(tour.km_gesamt)}</Meta>}
              {dateRange && <Meta icon={<IconCalendar />}>{dateRange}</Meta>}
              {((tour.kennzeichen ?? []).length > 0) && (
                <Meta icon={<IconCar />}>
                  {(tour.kennzeichen ?? []).join(', ')}
                  {tour.fin && (
                    <span className="ml-1 text-xs text-maja-muted">· FIN: {tour.fin}</span>
                  )}
                </Meta>
              )}
              {((tour.kennzeichen ?? []).length === 0) && tour.fin && (
                <Meta icon={<IconCar />}>FIN: {tour.fin}</Meta>
              )}
              {tour.auftraggeber && (
                <Meta icon={<IconBuilding />}>
                  <span className="block">{tour.auftraggeber.name}</span>
                  {tour.auftraggeber.kontakt && (
                    <span className="block text-xs text-maja-muted">
                      {tour.auftraggeber.kontakt}
                    </span>
                  )}
                </Meta>
              )}
            </div>

            {/* Externe Protokoll-App des Auftraggebers — direkter Sprung
                aus der Tour-Card, ohne den Detail-Dialog zu öffnen. */}
            {tour.protokoll_art === 'app' && tour.auftraggeber?.externe_app_url && (
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  if (tour.auftraggeber?.externe_app_url) {
                    window.open(tour.auftraggeber.externe_app_url, '_blank', 'noopener,noreferrer');
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    e.preventDefault();
                    if (tour.auftraggeber?.externe_app_url) {
                      window.open(tour.auftraggeber.externe_app_url, '_blank', 'noopener,noreferrer');
                    }
                  }
                }}
                className="mt-3 inline-flex cursor-pointer items-center gap-1 rounded-full bg-maja-accent px-3 py-1 text-xs font-medium text-white transition hover:bg-maja-navy"
              >
                {(tour.auftraggeber.externe_app_name?.trim() || 'externe App')} öffnen ↗
              </div>
            )}

            {/* Eingereichte Protokoll-PDFs (für Fahrer & Admin): Vorschau und
                Download direkt aus der Tour-Karte. Nur sichtbar, wenn die
                Tour mit einem submitted Eingang verknüpft ist. */}
            {tour.eingang?.status === 'submitted' && tour.eingang.template
              && (tour.eingang.template.pdfs ?? []).length > 0 && (
              <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                <TourEingangPdfButtons eingang={tour.eingang} />
              </div>
            )}

            {/* Schriftliches Protokoll: pro Zuweisung ein Pill — Admins
                sehen nur den Template-Namen, Fahrer öffnen direkt. */}
            {hasSchriftlich && (
              <div className="mt-3 flex flex-wrap gap-2">
                {protokollItems.map((p) => (
                  isAdmin ? (
                    <div
                      key={p.id}
                      className="inline-flex items-center gap-1 rounded-full bg-maja-light px-3 py-1 text-xs font-medium text-maja-navy"
                    >
                      <IconClipboard /> {p.name}
                    </div>
                  ) : (
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); onOpenProtokoll(p.id); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onOpenProtokoll(p.id); }
                      }}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-maja-navy px-3 py-1 text-xs font-medium text-white transition hover:bg-maja-accent"
                    >
                      <IconClipboard />
                      {opening === `${tour.id}:${p.id}` ? 'Öffne …' : `Protokoll: ${p.name}`}
                    </div>
                  )
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            {computedStatus === 'aktiv' && isAdmin ? (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggleBearbeitet(); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation(); e.preventDefault(); onToggleBearbeitet();
                  }
                }}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
                  bearbeitetHeute
                    ? 'bg-emerald-600 text-white ring-1 ring-emerald-700'
                    : `${STATUS_BADGE.aktiv} hover:ring-1 hover:ring-emerald-300`
                }`}
                title={bearbeitetHeute
                  ? 'Heute bereits bearbeitet — klicken zum Zurücksetzen'
                  : 'Als heute bearbeitet markieren'}
                aria-pressed={bearbeitetHeute}
              >
                {bearbeitetHeute
                  ? <CheckBoxCheckedIcon className="h-3.5 w-3.5" />
                  : <CheckBoxEmptyIcon className="h-3.5 w-3.5" />}
                Aktiv
              </span>
            ) : (
              <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                STATUS_BADGE[computedStatus]
              }`}>
                {STATUS_LABEL[computedStatus]}
              </span>
            )}
            {tour.ist_e_fahrzeug && (
              <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                E-Fahrzeug
              </span>
            )}
            {isAdmin && rechnungsnummern && rechnungsnummern.length > 0 && (
              <span
                className="inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-700"
                title={`Auf Rechnung: ${rechnungsnummern.join(', ')}`}
              >
                auf Rechnung
              </span>
            )}
            {/* Abweichendes Rechnungsdatum — nur wenn wirklich gesetzt. */}
            {isAdmin && tour.rechnungsdatum_abweichend && tour.rechnungsdatum && (
              <span
                className="inline-block rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-800"
                title="Abweichendes Rechnungsdatum — die Tour wird zu diesem Datum abgerechnet, nicht zum Enddatum."
              >
                Rechnungsdatum {formatDate(tour.rechnungsdatum)}
              </span>
            )}
            {/* Abrechnungs-Hinweise (max. 7 Tage zurück, nur Admin). */}
            {hinweisKeinPreis && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800"
                title="Für diese Tour ist noch kein Preis berechnet (Vergütung leer/0)."
              >
                <span aria-hidden="true">⚠</span> Kein Preis
              </span>
            )}
            {hinweisOhneRechnung && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-700"
                title="Abgeschlossene Tour ohne Rechnungsposition — noch nicht berechnet."
              >
                <span aria-hidden="true">⚠</span> Ohne Rechnung
              </span>
            )}
            {isAdmin && (
              <div className="text-right">
                <div className="text-2xl font-bold text-maja-navy">
                  {formatEuro(tour.verguetung)}
                </div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-maja-muted">
                  Netto
                </div>
              </div>
            )}
          </div>
        </div>
      </button>
      {hasZusaetze && (
        <div
          className={`border-t border-maja-navy/10 bg-[#E8F0F8] text-sm text-maja-ink dark:border-surface-700 dark:bg-surface-700 dark:text-slate-200 ${
            zusaetzeOpen ? '' : 'rounded-b-xl'
          }`}
        >
          <button
            type="button"
            onClick={() => setZusaetzeOpen((v) => !v)}
            aria-expanded={zusaetzeOpen}
            className={`flex w-full items-center justify-between gap-3 px-5 py-2 text-left text-sm font-medium text-maja-navy transition hover:bg-maja-navy/5 ${
              zusaetzeOpen ? '' : 'rounded-b-xl'
            }`}
          >
            <span>
              Zusätze ({zusaetze.length}) · {formatEuro(zusaetzeSumme)}
            </span>
            <span aria-hidden="true" className="text-xs">
              {zusaetzeOpen ? '▲' : '▼'}
            </span>
          </button>
          {zusaetzeOpen && (
            <div className="rounded-b-xl border-t border-maja-navy/10 px-5 py-3">
              <ul className="space-y-1">
                {zusaetze.map((z) => {
                  const anzahl = Math.max(0.01, Number(z.anzahl) || 1);
                  const betrag = Number(z.betrag ?? 0);
                  const gesamt = Math.round(anzahl * betrag * 100) / 100;
                  return (
                    <li key={z.id} className="flex flex-wrap items-baseline gap-x-1">
                      {z.kennzeichen && (
                        <span className="font-semibold text-maja-navy">{z.kennzeichen}:</span>
                      )}
                      <span className="font-medium">{z.kategorie}</span>
                      <span className="text-maja-muted">:</span>
                      {anzahl !== 1 ? (
                        <span>
                          {formatAnzahl(anzahl)} × {formatEuro(betrag)} = {formatEuro(gesamt)}
                        </span>
                      ) : (
                        <span>{formatEuro(betrag)}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2 flex justify-between border-t border-maja-navy/10 pt-2 text-sm font-semibold text-maja-navy">
                <span>Zusätze gesamt</span>
                <span>{formatEuro(zusaetzeSumme)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function TourEingangPdfButtons({ eingang }: { eingang: EingangLite }) {
  if (!eingang.template) return null;
  // pdf_paths ist die Wahrheit für die TATSÄCHLICH erzeugten PDFs.
  // Legacy-Eingänge ohne pdf_paths (vor Migration 037) sind hier nicht
  // verlinkt — sie lassen sich weiterhin im Detail-Panel/Eingaenge-
  // Reiter laden, wo daten + schema vorhanden sind. Wir verzichten in
  // der Touren-Liste auf den Legacy-Fallback, um egress-intensive
  // JSONB-Felder (eingang.daten) nicht für jeden Tour-Card-Render zu
  // laden — siehe Egress-Optimierung.
  const persisted = asPdfPathList(eingang.pdf_paths);
  if (persisted.length === 0) return null;
  const list = persisted.map((p) => ({
    id: p.pdf_id, name: p.pdf_name, filename: p.filename, onedrive_path: p.onedrive_path,
  }));
  if (list.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-maja-muted">Protokoll-PDFs:</span>
      {list.map((p) => (
        <TourPdfButton
          key={p.id}
          label={p.name}
          filename={p.filename}
          path={p.onedrive_path}
          formularId={eingang.id}
        />
      ))}
    </div>
  );
}

function TourPdfButton({
  label, filename, path, formularId,
}: { label: string; filename: string; path: string; formularId: string }) {
  const [busy, setBusy] = useState<'download' | 'preview' | null>(null);
  async function download(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy('download');
    const ok = await downloadFormPdf(path, filename, formularId);
    setBusy(null);
    if (!ok) alert('PDF noch nicht generiert oder nicht erreichbar.');
  }
  async function preview(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy('preview');
    const ok = await previewFormPdf(path, formularId);
    setBusy(null);
    if (!ok) alert('Vorschau fehlgeschlagen.');
  }
  return (
    <span className="inline-flex items-stretch overflow-hidden rounded-full border border-slate-300 bg-maja-light text-xs text-maja-navy dark:border-slate-600 dark:bg-surface-700">
      <button
        type="button"
        onClick={preview}
        disabled={busy !== null}
        className="flex items-center px-2 py-1 hover:bg-maja-accent/20 dark:hover:bg-surface-600"
        title={`Vorschau: ${filename}`}
        aria-label="Vorschau"
      >{busy === 'preview' ? <span>…</span> : <EyeIcon className="h-4 w-4" />}</button>
      <button
        type="button"
        onClick={download}
        disabled={busy !== null}
        className="flex items-center gap-1 border-l border-slate-300 px-2 py-1 hover:bg-maja-accent/20 dark:border-slate-600 dark:hover:bg-surface-600"
        title={`Download: ${filename}\n${path}`}
      >
        {busy === 'download' ? <span>…</span> : <DownloadIcon className="h-4 w-4" />}
        {label}
      </button>
    </span>
  );
}

function Meta({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-maja-accent">
        {icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// --- Inline-SVG-Icons (Heroicons mini, hand-trimmed) ---
function IconUser() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M10 9a3 3 0 100-6 3 3 0 000 6zM3 18a7 7 0 1114 0H3z" />
    </svg>
  );
}
function IconPin() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M10 18s6-5.686 6-10A6 6 0 104 8c0 4.314 6 10 6 10zm0-8a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.5A2.25 2.25 0 0118 6.25v9.5A2.25 2.25 0 0115.75 18H4.25A2.25 2.25 0 012 15.75v-9.5A2.25 2.25 0 014.25 4h.75V2.75A.75.75 0 015.75 2zM3.5 8v7.75c0 .414.336.75.75.75h11.5a.75.75 0 00.75-.75V8h-13z" />
    </svg>
  );
}
function IconCar() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M4.5 7l1.2-2.5A2 2 0 017.5 3.5h5a2 2 0 011.8 1L15.5 7H17a1 1 0 011 1v3a1 1 0 01-1 1h-.5v1a1.5 1.5 0 11-3 0v-1h-7v1a1.5 1.5 0 11-3 0v-1H3a1 1 0 01-1-1V8a1 1 0 011-1h1.5zM6 9a1 1 0 100 2 1 1 0 000-2zm8 0a1 1 0 100 2 1 1 0 000-2z" />
    </svg>
  );
}
function IconClipboard() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M7 2a2 2 0 00-2 2H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1a2 2 0 00-2-2H7zm0 2h6v2H7V4zm-1 5h8v1H6V9zm0 3h8v1H6v-1zm0 3h5v1H6v-1z" />
    </svg>
  );
}
function IconBuilding() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v13h1.25a.75.75 0 010 1.5H1.75a.75.75 0 010-1.5H3V4zm3 2v2h2V6H6zm4 0v2h2V6h-2zm-4 4v2h2v-2H6zm4 0v2h2v-2h-2zm-4 4v3h2v-3H6zm4 0v3h2v-3h-2z" />
    </svg>
  );
}

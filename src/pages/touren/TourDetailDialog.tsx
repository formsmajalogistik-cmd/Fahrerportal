import {
  useCallback, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { supabase } from '../../lib/supabase';
import { cachedQuery } from '../../lib/queryCache';
import { useAuth } from '../../auth/AuthContext';
import { useFahrerContext } from '../../auth/FahrerContext';
import { useTestGuard } from '../../auth/TestModeContext';
import { Spinner } from '../../components/Spinner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TfBlock } from '../../components/TfBlock';
import { AuftragEmailDialog } from './AuftragEmailDialog';
import { TourDokumenteSection } from '../../components/TourDokumenteSection';
import { RouteSelectorDialog } from '../../components/RouteSelectorDialog';
import { StationFeldsatz } from '../../components/StationFeldsatz';
import { RouteFeldsatz } from '../../components/RouteFeldsatz';
import { composeAdresse, effektiveAdresse } from '../../lib/adresse';
import { useScrollLock } from '../../lib/useScrollLock';
import { CheckIcon, DownloadIcon, EyeIcon, XIcon } from '../../components/icons';
import { fahrerName } from '../../lib/names';

function fahrerNameOf(f: { vorname: string | null; nachname: string | null; user: { email: string; vorname: string | null; nachname: string | null } | null }): string {
  return fahrerName(f, f.user);
}
import {
  abrechnungsKm, abschnittLabels, computeKmGesamt, computeTourStatus, fetchTourPriceBreakdown,
  formatAnzahl, formatDate, formatDateTime, formatEuro, formatKm,
  hasTwoProtokollSlots, tourTitel,
  type TourPriceBreakdown,
} from '../../lib/touren';
import {
  asPdfPathList, downloadFormPdf, previewFormPdf,
} from '../../lib/pdfGenerate';
import { assignFahrerToZugang, isGreimelAuftraggeber, releaseZugangIfUnused } from '../../lib/greimel';
import { FahrerSelect, type FahrerOptionRaw } from './FahrerSelect';
import {
  loadTourProtokollZuweisungen, ProtokollSection,
  type TourProtokollZuweisung,
} from './ProtokollSection';
import type {
  AppUser, Auftraggeber, AuftraggeberKontakt, AusgefuelltesFormular, Fahrer,
  FormularTemplate, GreimelZugang, ProtokollArt, TemplatePdf, Tour, TourenArt,
  TourStatus, TourZusatz,
} from '../../types/db';

type FahrerWithUser = Pick<Fahrer, 'id' | 'user_id' | 'aktiv' | 'vorname' | 'nachname' | 'ist_unterkonto' | 'haupt_user_id'> & {
  user: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null;
};

interface FullTour extends Tour {
  auftraggeber: Pick<Auftraggeber, 'id' | 'name' | 'kontakt' | 'externe_app_name' | 'externe_app_url'> | null;
  fahrer: FahrerWithUser | null;
  kontakt: AuftraggeberKontakt | null;
}

interface Props {
  tourId: string;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
  /**
   * "modal" (Default): Overlay-Dialog. "embedded": ohne Overlay, das
   * Panel wird vom Eltern-Layout positioniert (z.B. Side-by-Side im
   * Posteingang).
   */
  variant?: 'modal' | 'embedded';
  /** Bei true startet die Tour direkt im Edit-Modus (für Side-by-Side). */
  startInEditMode?: boolean;
}

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

import { ZUSATZ_KATEGORIEN as ZUSATZ_KATEGORIEN_BASE } from '../../lib/zusatzKategorien';
import { SuggestCombobox } from '../../components/SuggestCombobox';
import {
  ABC_WARNUNG_TEXT, automatischeTourenart, brauchtAbcWarnung,
} from '../../lib/tourenartAutomatik';
import {
  ladeAnsprechpartner, leereKontaktMap, speichereAlleAnsprechpartner,
  type KontaktEntwurf, type KontaktMap, type Station,
} from '../../lib/tourAnsprechpartner';
const ZUSATZ_KATEGORIEN: readonly string[] = ZUSATZ_KATEGORIEN_BASE;

// Lesbare Labels für die Tour-Spalten, die durch ein Protokoll befüllt
// werden können — werden im "Verknüpfung lösen"-Dialog angezeigt.
const PROTOKOLL_FELD_LABEL: Record<string, string> = {
  fin: 'FIN',
  kennzeichen: 'Kennzeichen',
  adresse_start: 'Adresse Übernahme',
  adresse_ziel: 'Adresse Übergabe',
  adresse_rueckfuehrung: 'Adresse Rückführung',
  kontakt_start: 'Kontakt Übernahme',
  kontakt_ziel: 'Kontakt Übergabe',
  kontakt_rueckfuehrung: 'Kontakt Rückführung',
  kundenname: 'Kundenname',
  km_hin: 'KM hin',
  km_gesamt: 'KM gesamt',
  startdatum: 'Startdatum',
};

// Fallback für Touren, die vor Migration 026 verknüpft wurden und für
// die wir nicht wissen, welche Felder konkret aus dem Protokoll kamen.
const DEFAULT_PROTOKOLL_FIELDS: string[] = [
  'fin', 'kennzeichen',
  'adresse_start', 'adresse_ziel',
  'kontakt_start', 'kontakt_ziel',
  'kundenname',
  'km_hin', 'km_gesamt',
];

// ---------- Helpers ----------

/**
 * Liefert die SELECT-Cols-Liste für die Tour-Detail-Query. Admin sieht
 * alle Spalten; Fahrer NUR die nicht-preisrelevanten — damit sensible
 * Daten erst gar nicht beim Client landen.
 */
function buildTourSelectCols(admin: boolean): string {
  if (admin) {
    return `
      *,
      auftraggeber:auftraggeber_id (id, name, kontakt, externe_app_name, externe_app_url),
      kontakt:kontakt_id (id, auftraggeber_id, name, telefon, email, position, created_at),
      fahrer:fahrer_id (
        id, user_id, aktiv,
        user:user_id (email, vorname, nachname)
      )
    `;
  }
  return `
    id, tour_id, start_stadt, ziel_stadt, rueckfuehrung_stadt,
    adresse_start, adresse_ziel, adresse_rueckfuehrung,
    kundenname, auftraggeber_id, fahrer_id, status, startdatum, enddatum,
    tourenart, kennzeichen, protokoll_art, schriftliches_protokoll_id,
    greimel_zugang_id, ist_e_fahrzeug, fin, fin_rueck, kontakt_id, eingang_id,
    kontakt_start, kontakt_ziel, kontakt_rueckfuehrung, app_notiz,
    created_at, updated_at,
    auftraggeber:auftraggeber_id (id, name, kontakt, externe_app_name, externe_app_url),
    kontakt:kontakt_id (id, auftraggeber_id, name, telefon, email, position, created_at),
    fahrer:fahrer_id (
      id, user_id, aktiv,
      user:user_id (email, vorname, nachname)
    )
  `;
}

function parseInteger(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || Math.floor(n) !== n || n < 0) return null;
  return n;
}

function parseDecimal(input: string): number | null {
  const normalized = input.trim().replace(/\./g, '').replace(',', '.');
  if (!normalized) return 0;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function decimalToInput(value: number | null | undefined): string {
  if (value == null) return '';
  return Number(value).toFixed(2).replace('.', ',');
}

function intToInput(value: number | null | undefined): string {
  if (value == null) return '';
  return String(value);
}

function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  // <input type="date"> erwartet "YYYY-MM-DD" — direkt aus der Postgres-
  // date-Spalte oder als Substring eines Timestamps.
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------- Edit-Form-Draft ----------

interface EditDraft {
  status: TourStatus;
  fahrerId: string;
  auftraggeberId: string;
  tourenart: TourenArt | '';
  startStadt: string;
  zielStadt: string;
  rueckfuehrungStadt: string;
  hatRueckfuehrung: boolean;
  kmHin: string;
  kmRueck: string;
  /**
   * Nur ABA: Ausnahme-Kennzeichen für die Abrechnung. false (Standard)
   * = Preis über km Hin, true = Preis über km Gesamt. Siehe
   * abrechnungsKm() in lib/touren.ts.
   */
  abaGesamtKm: boolean;
  startdatum: string;
  enddatum: string;
  kennzeichenHin: string;
  kennzeichenRueck: string;
  istSondervereinbarung: boolean;
  sondervereinbarung: string;
  kundenname: string;
  verguetung: string;
  info: string;
  // Adresse strukturiert (Migration 086). Die Stadt steckt in
  // startStadt / zielStadt / rueckfuehrungStadt — kein zweites Feld.
  strasseStart: string;
  hausnummerStart: string;
  plzStart: string;
  strasseZiel: string;
  hausnummerZiel: string;
  plzZiel: string;
  strasseRueck: string;
  hausnummerRueck: string;
  plzRueck: string;
  /** Bestands-Freitext, nur zur Anzeige — wird nicht zerlegt. */
  freitextStart: string;
  freitextZiel: string;
  freitextRueck: string;
  /** Auf Eis: Tour steht fest, Termin noch offen (Migration 086). */
  aufEis: boolean;
  aufEisNotiz: string;
  protokollArt: ProtokollArt | null;
  schriftlichesProtokollId: string | null;
  greimelZugangId: string | null;
  istEFahrzeug: boolean;
  fin: string;
  finRueck: string;
  kontaktId: string;
  appNotiz: string;
  // Fahrzeugmodell + Zeiten je Station (Migration 080). Die Kontakte
  // liegen NICHT mehr im Draft, sondern in tour_ansprechpartner.
  /** True, sobald der Nutzer die Tourenart selbst gewählt hat — ab dann
   *  greift die AB/ABC-Automatik nicht mehr. */
  tourenartManuell: boolean;
  fahrzeugmodell: string;
  fahrzeugmodellRueck: string;
  zeitStart: string;
  zeitZiel: string;
  zeitRueck: string;
  // Rechnungsdatum (optional, abweichend vom Tourendatum)
  rechnungsdatumAbweichend: boolean;
  rechnungsdatum: string;
}

function draftFromTour(t: FullTour): EditDraft {
  const hat = !!t.rueckfuehrung_stadt;
  const kz = Array.isArray(t.kennzeichen) ? t.kennzeichen : [];
  const isAba = t.tourenart === 'ABA';
  return {
    status: t.status,
    fahrerId: t.fahrer_id ?? '',
    auftraggeberId: t.auftraggeber_id ?? '',
    tourenart: t.tourenart ?? '',
    // Bestandstouren werden NICHT nachträglich umgestellt.
    tourenartManuell: true,
    startStadt: t.start_stadt,
    zielStadt: t.ziel_stadt,
    rueckfuehrungStadt: t.rueckfuehrung_stadt ?? '',
    hatRueckfuehrung: hat,
    kmHin: intToInput(t.km_hin),
    kmRueck: intToInput(t.km_rueck),
    abaGesamtKm: isAba && !!t.aba_gesamt_km_berechnen,
    startdatum: isoToLocalInput(t.startdatum),
    enddatum: isoToLocalInput(t.enddatum),
    kennzeichenHin: kz[0] ?? '',
    kennzeichenRueck: kz[1] ?? '',
    istSondervereinbarung: !!t.ist_sondervereinbarung,
    sondervereinbarung: t.sondervereinbarung ?? '',
    kundenname: t.kundenname ?? '',
    verguetung: decimalToInput(t.verguetung),
    info: t.info ?? '',
    strasseStart: t.strasse_start ?? '',
    hausnummerStart: t.hausnummer_start ?? '',
    plzStart: t.plz_start ?? '',
    strasseZiel: t.strasse_ziel ?? '',
    hausnummerZiel: t.hausnummer_ziel ?? '',
    plzZiel: t.plz_ziel ?? '',
    strasseRueck: t.strasse_rueckfuehrung ?? '',
    hausnummerRueck: t.hausnummer_rueckfuehrung ?? '',
    plzRueck: t.plz_rueckfuehrung ?? '',
    freitextStart: t.adresse_start ?? '',
    freitextZiel: t.adresse_ziel ?? '',
    freitextRueck: t.adresse_rueckfuehrung ?? '',
    aufEis: !!t.auf_eis,
    aufEisNotiz: t.auf_eis_notiz ?? '',
    protokollArt: t.protokoll_art ?? null,
    schriftlichesProtokollId: t.schriftliches_protokoll_id ?? null,
    greimelZugangId: t.greimel_zugang_id ?? null,
    istEFahrzeug: !!t.ist_e_fahrzeug,
    fin: t.fin ?? '',
    finRueck: t.fin_rueck ?? '',
    kontaktId: t.kontakt_id ?? '',
    appNotiz: t.app_notiz ?? '',
    fahrzeugmodell: t.fahrzeugmodell ?? '',
    fahrzeugmodellRueck: t.fahrzeugmodell_rueck ?? '',
    zeitStart: t.zeit_start ?? '',
    zeitZiel: t.zeit_ziel ?? '',
    zeitRueck: t.zeit_rueckfuehrung ?? '',
    rechnungsdatumAbweichend: !!t.rechnungsdatum_abweichend,
    rechnungsdatum: isoToLocalInput(t.rechnungsdatum),
  };
}

// ---------- Component ----------

export function TourDetailDialog({
  tourId, onClose, onChanged, onDeleted,
  variant = 'modal', startInEditMode = false,
}: Props) {
  const { profile } = useAuth();
  const fahrerCtx = useFahrerContext();
  const isAdmin = profile?.role === 'admin';
  const guard = useTestGuard();

  const [tour, setTour] = useState<FullTour | null>(null);
  const [zusaetze, setZusaetze] = useState<TourZusatz[]>([]);
  const [auftraggeber, setAuftraggeber] = useState<Auftraggeber[]>([]);
  const [fahrer, setFahrer] = useState<FahrerWithUser[]>([]);
  const [templates, setTemplates] = useState<Array<Pick<FormularTemplate, 'id' | 'name'>>>([]);
  const [zugaenge, setZugaenge] = useState<GreimelZugang[]>([]);

  // Verknüpfte Eingänge (ausgefüllte_formulare) inklusive Template — werden
  // gelesen, sobald tour.eingang_id bzw. tour.eingang_id_bc gesetzt sind,
  // um die PDF-Downloads direkt im Tour-Detail anbieten zu können.
  // ABA/ABC-Touren können bis zu ZWEI Eingänge verknüpfen — einen pro
  // Streckenabschnitt (AB / BC bzw. Rück).
  type LinkedEingang = {
    formular: AusgefuelltesFormular;
    template: { id: string; name: string; pdfs: TemplatePdf[]; schema: unknown };
  };
  const [eingangAb, setEingangAb] = useState<LinkedEingang | null>(null);
  const [eingangBc, setEingangBc] = useState<LinkedEingang | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /**
   * Welcher Routen-Selector ist offen? null = keiner. "hin" berechnet
   * Start → Ziel und füllt km_hin (bzw. km_gesamt_aba bei ABA). "rueck"
   * berechnet Ziel → Rückführung und füllt km_rueck. Wird auch von der
   * Auto-Berechnung nach Eingang-Verknüpfung genutzt (Aufgabe 3).
   */
  const [routeDialog, setRouteDialog] = useState<null | 'hin' | 'rueck'>(null);
  /** Erfolgs-Quittung pro Strecke nach „Entfernung berechnen". */
  const [routeConfirm, setRouteConfirm] = useState<{ hin?: number; rueck?: number }>({});
  /** Welcher Abschnitt soll beim Verknüpfung-Lösen behandelt werden? null = Dialog zu. */
  const [unlinkOpen, setUnlinkOpen] = useState<null | 'ab' | 'bc'>(null);
  const [unlinkBusy, setUnlinkBusy] = useState(false);
  /** Dialog "Mit Tour verknüpfen" auch aus dem Detail heraus öffnen, pro Abschnitt. */
  const [relinkSlot, setRelinkSlot] = useState<null | 'ab' | 'bc'>(null);

  // Barauslagen / Fahrer-Honorar (separate Auto-Save Felder)
  const [barauslagenInput, setBarauslagenInput] = useState('');
  const [honorarInput, setHonorarInput] = useState('');

  // Zusatz-Eingabe. Bei ABA/ABC-Touren kann pro Zusatz ein konkretes
  // Kennzeichen (Hin oder Rück) gewählt werden — wird in tour_zusaetze
  // gespeichert und in der Rechnungsgenerierung als {kennzeichen}-
  // Platzhalter verwendet.
  const [neueKategorie, setNeueKategorie] = useState('');
  const [neueAnzahl, setNeueAnzahl]       = useState<string>('1');
  const [neuerBetrag, setNeuerBetrag]     = useState('');
  const [neueNotiz, setNeueNotiz]         = useState('');
  const [neuesKennzeichen, setNeuesKennzeichen] = useState('');
  const [addingZusatz, setAddingZusatz] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [tRes, zRes, agRes, faRes, tplRes, gzRes] = await Promise.all([
      // Sensible Spalten (verguetung, km_*, fahrer_honorar, barauslagen,
      // sondervereinbarung, info, rechnungsdatum_*) für Nicht-Admins NICHT
      // mit selektieren — sie kommen damit gar nicht erst beim Client an.
      supabase
        .from('touren')
        .select(buildTourSelectCols(isAdmin))
        .eq('id', tourId)
        .single(),
      supabase
        .from('tour_zusaetze')
        .select('*')
        .eq('tour_id', tourId)
        .order('created_at', { ascending: true }),
      // Egress: nur Felder für das Dropdown + Anzeige in der Tour-Detail.
      // Cache reduziert den Round-Trip bei jedem Klick auf eine Tour.
      cachedQuery('auftraggeber.list.lite', async () =>
        await supabase.from('auftraggeber')
          .select('id, name, kontakt, externe_app_name, externe_app_url')
          .order('name'),
        60_000,
      ),
      supabase
        .from('fahrer')
        .select('id, user_id, aktiv, vorname, nachname, ist_unterkonto, haupt_user_id, user:user_id (email, vorname, nachname)')
        .eq('aktiv', true),
      supabase.from('formular_templates').select('id, name').eq('archiviert', false).order('name'),
      supabase.from('greimel_zugaenge').select('*'),
    ]);
    if (tRes.error) { setError(tRes.error.message); setLoading(false); return; }
    const raw = (tRes.data ?? {}) as unknown as Record<string, unknown>;
    const full: FullTour = {
      ...(raw as unknown as FullTour),
      kennzeichen: Array.isArray(raw.kennzeichen) ? (raw.kennzeichen as string[]) : [],
      auftraggeber: (raw.auftraggeber as FullTour['auftraggeber']) ?? null,
      fahrer: (raw.fahrer as FullTour['fahrer']) ?? null,
      kontakt: (raw.kontakt as FullTour['kontakt']) ?? null,
    };
    setTour(full);
    setBarauslagenInput(decimalToInput(full.barauslagen));
    setHonorarInput(decimalToInput(full.fahrer_honorar));
    setZusaetze(Array.isArray(zRes.data) ? (zRes.data as TourZusatz[]) : []);
    setAuftraggeber(Array.isArray(agRes.data) ? (agRes.data as unknown as Auftraggeber[]) : []);
    const rawFahrer = Array.isArray(faRes.data) ? (faRes.data as unknown as FahrerWithUser[]) : [];
    // Nicht-Admin: nur eigene Konten (Haupt + eigene Unterkonten) als
    // Zuweisungs-Optionen anbieten — Admin sieht alle.
    const isAdminView = profile?.role === 'admin';
    const ownIds = new Set(fahrerCtx.availableFahrer.map((f) => f.id));
    const faList = isAdminView ? rawFahrer : rawFahrer.filter((f) => ownIds.has(f.id));
    setFahrer(faList.sort((a, b) =>
      (fahrerNameOf(a)).localeCompare(fahrerNameOf(b), 'de'),
    ));
    setTemplates(Array.isArray(tplRes.data) ? (tplRes.data as Array<Pick<FormularTemplate, 'id' | 'name'>>) : []);
    // Natürliche Sortierung nach Titel ("Zugang 2" vor "Zugang 10").
    const zList = Array.isArray(gzRes.data) ? (gzRes.data as GreimelZugang[]) : [];
    setZugaenge([...zList].sort((a, b) =>
      a.titel.localeCompare(b.titel, 'de', { numeric: true, sensitivity: 'base' }),
    ));

    // Verknüpfte Eingänge je Slot (AB + BC) laden. Eine kombinierte Query
    // mit .in([id_ab, id_bc]) spart einen Roundtrip; danach pro Slot
    // zuordnen.
    const ids: string[] = [];
    if (full.eingang_id) ids.push(full.eingang_id);
    if (full.eingang_id_bc) ids.push(full.eingang_id_bc);
    let abEingang: LinkedEingang | null = null;
    let bcEingang: LinkedEingang | null = null;
    if (ids.length > 0) {
      const { data: rows } = await supabase
        .from('ausgefuellte_formulare')
        .select('*, template:template_id (id, name, pdfs, schema)')
        .in('id', ids);
      type RowWithTemplate = AusgefuelltesFormular & {
        template?: { id: string; name: string; pdfs: TemplatePdf[]; schema: unknown } | null;
      };
      for (const row of (rows ?? []) as unknown as RowWithTemplate[]) {
        if (!row.template) continue;
        const entry: LinkedEingang = { formular: row, template: row.template };
        if (row.id === full.eingang_id) abEingang = entry;
        if (row.id === full.eingang_id_bc) bcEingang = entry;
      }
    }
    setEingangAb(abEingang);
    setEingangBc(bcEingang);
    setLoading(false);
  }, [tourId]);

  useEffect(() => { void load(); }, [load]);

  // ----- Edit-Modus -----

  function startEdit() {
    if (!tour) return;
    setDraft(draftFromTour(tour));
    setEditing(true);
    setStatusMsg(null);
  }

  // Side-by-Side / Posteingang: wenn das Eltern-Panel mit
  // startInEditMode öffnet, fahren wir direkt in den Edit-Modus,
  // sobald die Tour geladen ist. Damit greift der "Tour öffnen"-Pfad
  // aus dem Posteingang sofort als Bearbeiten-Formular.
  const autoEditedRef = useRef(false);
  useEffect(() => {
    if (!startInEditMode || !tour || editing || autoEditedRef.current) return;
    autoEditedRef.current = true;
    setDraft(draftFromTour(tour));
    setEditing(true);
  }, [startInEditMode, tour, editing]);

  function cancelEdit() {
    setEditing(false);
    setDraft(null);
    setStatusMsg(null);
  }

  // Ansprechpartner je Station — eigene Tabelle seit Migration 080.
  // Bewusst ohne useCallback: die Abhängigkeit ist nur die Tour-ID, und
  // der React-Compiler kann die Memoisierung über `tour?.id` sonst nicht
  // erhalten.
  const [kontakte, setKontakte] = useState<KontaktMap>(() => leereKontaktMap());
  const [abcWarnung, setAbcWarnung] = useState(false);
  const [auftragMailOpen, setAuftragMailOpen] = useState(false);
  const kontakteTourId = tour?.id ?? null;
  useEffect(() => {
    if (!kontakteTourId) return;
    let abgebrochen = false;
    const t = window.setTimeout(() => {
      void ladeAnsprechpartner(kontakteTourId).then((m) => {
        if (!abgebrochen) setKontakte(m);
      });
    }, 0);
    return () => { abgebrochen = true; window.clearTimeout(t); };
  }, [kontakteTourId]);

  function patchDraft(p: Partial<EditDraft>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  function toggleRueckfuehrung() {
    if (!draft) return;
    if (draft.hatRueckfuehrung) {
      patchDraft({
        hatRueckfuehrung: false,
        rueckfuehrungStadt: '',
        kmRueck: '',
        kennzeichenRueck: '',
        finRueck: '',
        strasseRueck: '', hausnummerRueck: '', plzRueck: '',
      });
    } else {
      patchDraft({ hatRueckfuehrung: true });
    }
  }

  const draftIsAba = draft?.tourenart === 'ABA';

  const liveKmGesamt = useMemo(() => {
    if (!draft) return null;
    return computeKmGesamt({
      km_hin: parseInteger(draft.kmHin),
      km_rueck: parseInteger(draft.kmRueck),
      hatRueckfuehrung: draft.hatRueckfuehrung,
    });
  }, [draft]);

  /**
   * Kilometer für die Preisstufen-Suche. Bei ABA zählt ausschließlich
   * die Hinfahrt — außer die Ausnahme-Checkbox ist gesetzt.
   */
  const livePreisKm = useMemo(() => {
    if (!draft) return null;
    return abrechnungsKm({
      tourenart: draft.tourenart || 'AB',
      km_hin: parseInteger(draft.kmHin),
      km_gesamt: liveKmGesamt,
      abaGesamtKmBerechnen: draft.abaGesamtKm,
    });
  }, [draft, liveKmGesamt]);

  const draftSelectedAg = useMemo(
    () => (draft ? (auftraggeber ?? []).find((a) => a.id === draft.auftraggeberId) ?? null : null),
    [auftraggeber, draft],
  );

  // Auto-Preis im Edit-Modus
  const [breakdown, setBreakdown] = useState<TourPriceBreakdown | null>(null);
  const [pricing, setPricing] = useState(false);

  useEffect(() => {
    if (!editing || !draft) { setBreakdown(null); return; }
    if (draft.istSondervereinbarung) { setBreakdown(null); return; }
    if (!draft.auftraggeberId || livePreisKm == null) { setBreakdown(null); return; }
    let cancelled = false;
    setPricing(true);
    void fetchTourPriceBreakdown({
      auftraggeberId: draft.auftraggeberId,
      km: livePreisKm,
      tourenart: (draft.tourenart || 'AB') as TourenArt,
      istEFahrzeug: draft.istEFahrzeug,
    }).then((b) => {
      if (cancelled) return;
      setBreakdown(b);
      setPricing(false);
    });
    return () => { cancelled = true; };
  }, [editing, draft, livePreisKm]);

  // Breakdown für die View-Anzeige (Aufschlüsselung zum gespeicherten Preis).
  const [viewBreakdown, setViewBreakdown] = useState<TourPriceBreakdown | null>(null);
  useEffect(() => {
    if (!tour || tour.ist_sondervereinbarung) { setViewBreakdown(null); return; }
    const km = abrechnungsKm({
      tourenart: tour.tourenart,
      km_hin: tour.km_hin,
      km_gesamt: tour.km_gesamt,
      abaGesamtKmBerechnen: tour.aba_gesamt_km_berechnen,
    });
    if (!tour.auftraggeber_id || km == null) { setViewBreakdown(null); return; }
    let cancelled = false;
    void fetchTourPriceBreakdown({
      auftraggeberId: tour.auftraggeber_id,
      km,
      tourenart: (tour.tourenart || 'AB') as TourenArt,
      istEFahrzeug: !!tour.ist_e_fahrzeug,
    }).then((b) => { if (!cancelled) setViewBreakdown(b); });
    return () => { cancelled = true; };
  }, [tour]);

  // Kontakte für den im Edit-Draft gewählten Auftraggeber.
  const [editKontakte, setEditKontakte] = useState<AuftraggeberKontakt[]>([]);
  useEffect(() => {
    if (!editing || !draft?.auftraggeberId) { setEditKontakte([]); return; }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('auftraggeber_kontakte')
        .select('*')
        .eq('auftraggeber_id', draft.auftraggeberId)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      setEditKontakte(Array.isArray(data) ? data : []);
    })();
    return () => { cancelled = true; };
  }, [editing, draft?.auftraggeberId]);

  // AB/ABC-Automatik, solange der Nutzer die Tourenart nicht selbst
  // gewählt hat. Bestehende Touren starten mit tourenartManuell=true,
  // werden also nie automatisch umgestellt.
  const draftTourenart = draft?.tourenart ?? '';
  const draftRueckStadt = draft?.rueckfuehrungStadt ?? '';
  // Adressen aus den Einzelteilen; Bestandstouren fallen auf ihren
  // Freitext zurück. Daran hängen Routenberechnung und Anzeige.
  const draftAdresseStart = draft ? effektiveAdresse(
    { strasse: draft.strasseStart, hausnummer: draft.hausnummerStart,
      plz: draft.plzStart, stadt: draft.startStadt },
    draft.freitextStart,
  ) : '';
  const draftAdresseZiel = draft ? effektiveAdresse(
    { strasse: draft.strasseZiel, hausnummer: draft.hausnummerZiel,
      plz: draft.plzZiel, stadt: draft.zielStadt },
    draft.freitextZiel,
  ) : '';
  const draftRueckAdresse = draft ? effektiveAdresse(
    { strasse: draft.strasseRueck, hausnummer: draft.hausnummerRueck,
      plz: draft.plzRueck, stadt: draft.rueckfuehrungStadt },
    draft.freitextRueck,
  ) : '';
  const draftTourenartManuell = draft?.tourenartManuell ?? true;
  useEffect(() => {
    const naechste = automatischeTourenart({
      aktuell: draftTourenart,
      rueckStadt: draftRueckStadt,
      rueckAdresse: draftRueckAdresse,
      manuell: draftTourenartManuell,
    });
    if (naechste == null) return;
    const t = window.setTimeout(
      () => setDraft((d) => (d ? { ...d, tourenart: naechste } : d)), 0,
    );
    return () => window.clearTimeout(t);
  }, [draftTourenart, draftRueckStadt, draftRueckAdresse, draftTourenartManuell]);

  /** Speichern mit vorgeschaltetem ABC-Sicherheitsnetz. */
  function handleSaveMitPruefung() {
    if (draft && brauchtAbcWarnung(
      draft.tourenart, draft.rueckfuehrungStadt, draftRueckAdresse,
    )) {
      setAbcWarnung(true);
      return;
    }
    void handleSave();
  }

  async function handleSave() {
    if (!draft || !tour) return;
    if (guard()) return;

    const start = draft.startStadt.trim();
    const ziel  = draft.zielStadt.trim();
    if (!start || !ziel) {
      setStatusMsg({ kind: 'err', text: 'Start-Stadt und Ziel-Stadt dürfen nicht leer sein.' });
      return;
    }
    if (draft.hatRueckfuehrung && !draft.rueckfuehrungStadt.trim()) {
      setStatusMsg({ kind: 'err', text: 'Rückführung aktiviert: Stadt darf nicht leer sein.' });
      return;
    }

    let verguetung: number | null;
    if (draft.istSondervereinbarung) {
      const t = draft.verguetung.trim();
      if (t === '') {
        verguetung = null;
      } else {
        const v = parseDecimal(t);
        if (v === null) { setStatusMsg({ kind: 'err', text: 'Vergütung ist ungültig.' }); return; }
        verguetung = v;
      }
    } else {
      verguetung = breakdown?.total ?? null;
    }

    const km_hin = parseInteger(draft.kmHin);
    const km_rueck = draft.hatRueckfuehrung ? parseInteger(draft.kmRueck) : null;

    const kennzeichen: string[] = [];
    if (draft.kennzeichenHin.trim()) kennzeichen.push(draft.kennzeichenHin.trim().toUpperCase());
    if (draft.hatRueckfuehrung && draft.kennzeichenRueck.trim()) {
      kennzeichen.push(draft.kennzeichenRueck.trim().toUpperCase());
    }

    setSaving(true);
    // Protokoll-Felder normalisieren — bei Status 'abgeschlossen' wird der
    // Greimel-Zugang freigegeben (siehe unten).
    const draftAg = draftSelectedAg;
    const isGreimelTour = isGreimelAuftraggeber(draftAg);
    // Status wird live aus dem Datum berechnet — Greimel-Zugang wird nur
    // gehalten, solange die Tour nicht "abgeschlossen" ist.
    // <input type="date"> liefert "YYYY-MM-DD" — Postgres-date-Spalte
    // erwartet genau das, keine Timezone-Umrechnung nötig.
    // startdatum/enddatum sind seit Migration 028 NOT NULL — wir leeren
    // sie auch im UI nicht.
    // Bei einer Tour auf Eis darf das Datum leer sein — dann wird auch
    // wirklich null geschrieben statt auf den Altwert zurückzufallen.
    const draftDateStart = draft.aufEis
      ? (draft.startdatum || null)
      : ((draft.startdatum || tour.startdatum) as string);
    const draftDateEnd = draft.aufEis
      ? (draft.enddatum || null)
      : ((draft.enddatum || tour.enddatum) as string);
    // Touren auf Eis dürfen ohne Datum gespeichert werden — sie sind
    // bewusst noch nicht terminiert.
    if (!draft.aufEis && (!draft.startdatum || !draft.enddatum)) {
      setStatusMsg({
        kind: 'err',
        text: 'Start- und Enddatum sind Pflichtfelder. Ohne festen Termin die Tour auf Eis legen.',
      });
      setSaving(false);
      return;
    }
    const willComplete = computeTourStatus(draftDateStart, draftDateEnd) === 'abgeschlossen';

    let nextGreimelId: string | null = null;
    if (draft.protokollArt === 'app' && isGreimelTour && !willComplete) {
      nextGreimelId = draft.greimelZugangId ?? null;
    }
    // Protokoll-Zuweisungen leben jetzt in `tour_protokoll_zuweisungen`.
    // Die alte Spalte `schriftliches_protokoll_id` wird beim Wechsel auf
    // protokoll_art != 'schriftlich' geleert und sonst beibehalten —
    // sie ist nur noch Legacy für nicht migrierte Lesepfade.
    const nextSchriftlichesId = draft.protokollArt === 'schriftlich'
      ? (tour.schriftliches_protokoll_id ?? null)
      : null;

    const previousGreimelId = tour.greimel_zugang_id ?? null;
    const previousFahrerId = tour.fahrer_id ?? null;

    const { error: err } = await supabase
      .from('touren')
      .update({
        // status wird im Frontend live aus dem Datum berechnet — wir
        // schreiben den Wert nicht mehr in die DB (Spalte bleibt mit
        // ihrem Default-Wert bestehen).
        fahrer_id: draft.fahrerId || null,
        auftraggeber_id: draft.auftraggeberId || null,
        kontakt_id: draft.kontaktId || null,
        tourenart: draft.tourenart || null,
        start_stadt: start,
        ziel_stadt: ziel,
        rueckfuehrung_stadt: draft.hatRueckfuehrung ? draft.rueckfuehrungStadt.trim() : null,
        km_hin,
        km_rueck,
        km_gesamt: liveKmGesamt,
        // Nur bei ABA relevant — sonst zurücksetzen, damit ein Wechsel
        // der Tourenart keinen Altwert mitschleppt.
        aba_gesamt_km_berechnen: draftIsAba ? draft.abaGesamtKm : false,
        startdatum: draftDateStart,
        enddatum: draftDateEnd,
        kennzeichen,
        ist_sondervereinbarung: draft.istSondervereinbarung,
        sondervereinbarung: draft.istSondervereinbarung
          ? (draft.sondervereinbarung.trim() || null)
          : null,
        kundenname: draft.kundenname.trim() || null,
        verguetung,
        info: draft.info.trim() || null,
        // Freitext-Spalte weiter befüllen — daran hängen Auftrags-
        // E-Mail, Excel-Export und Routenberechnung. Bei einer
        // Bestandstour ohne Einzelteile bleibt der alte Wert stehen.
        adresse_start: composeAdresse({
          strasse: draft.strasseStart, hausnummer: draft.hausnummerStart,
          plz: draft.plzStart, stadt: draft.startStadt,
        }) ?? (draft.freitextStart.trim() || null),
        adresse_ziel: composeAdresse({
          strasse: draft.strasseZiel, hausnummer: draft.hausnummerZiel,
          plz: draft.plzZiel, stadt: draft.zielStadt,
        }) ?? (draft.freitextZiel.trim() || null),
        strasse_start: draft.strasseStart.trim() || null,
        hausnummer_start: draft.hausnummerStart.trim() || null,
        plz_start: draft.plzStart.trim() || null,
        strasse_ziel: draft.strasseZiel.trim() || null,
        hausnummer_ziel: draft.hausnummerZiel.trim() || null,
        plz_ziel: draft.plzZiel.trim() || null,
        strasse_rueckfuehrung: draft.hatRueckfuehrung ? (draft.strasseRueck.trim() || null) : null,
        hausnummer_rueckfuehrung: draft.hatRueckfuehrung ? (draft.hausnummerRueck.trim() || null) : null,
        plz_rueckfuehrung: draft.hatRueckfuehrung ? (draft.plzRueck.trim() || null) : null,
        auf_eis: draft.aufEis,
        auf_eis_notiz: draft.aufEis ? (draft.aufEisNotiz.trim() || null) : null,
        // Zeitstempel nur beim Wechsel setzen bzw. beim Aufheben leeren.
        auf_eis_seit: draft.aufEis
          ? (tour.auf_eis ? tour.auf_eis_seit : new Date().toISOString())
          : null,
        adresse_rueckfuehrung: draft.hatRueckfuehrung
          ? (composeAdresse({
              strasse: draft.strasseRueck, hausnummer: draft.hausnummerRueck,
              plz: draft.plzRueck, stadt: draft.rueckfuehrungStadt,
            }) ?? (draft.freitextRueck.trim() || null))
          : null,
        ist_e_fahrzeug: draft.istEFahrzeug,
        fin: draft.fin.trim() || null,
        fin_rueck: draft.hatRueckfuehrung
          ? (draft.finRueck.trim().toUpperCase() || null)
          : null,
        protokoll_art: draft.protokollArt,
        schriftliches_protokoll_id: nextSchriftlichesId,
        greimel_zugang_id: nextGreimelId,
        app_notiz: draft.protokollArt === 'app' && draft.appNotiz.trim()
          ? draft.appNotiz.trim() : null,
        // kontakt_* wird NICHT mehr hier geschrieben — die Ansprech-
        // partner liegen in tour_ansprechpartner, ein DB-Trigger spiegelt
        // den ersten je Station in die Alt-Spalten (Migration 080).
        fahrzeugmodell: draft.fahrzeugmodell.trim() || null,
        fahrzeugmodell_rueck: draft.hatRueckfuehrung
          ? (draft.fahrzeugmodellRueck.trim() || null) : null,
        zeit_start: draft.zeitStart.trim() || null,
        zeit_ziel: draft.zeitZiel.trim() || null,
        zeit_rueckfuehrung: draft.hatRueckfuehrung
          ? (draft.zeitRueck.trim() || null) : null,
        // Haken ohne eingetragenes Datum wird beim Speichern automatisch
        // bereinigt — sonst fällt die Tour aus den Rechnungs-Queries
        // (leeres effektives Rechnungsdatum).
        rechnungsdatum_abweichend: draft.rechnungsdatumAbweichend && !!draft.rechnungsdatum,
        rechnungsdatum: draft.rechnungsdatumAbweichend && draft.rechnungsdatum
          ? draft.rechnungsdatum
          : null,
      })
      .eq('id', tour.id);
    if (err) { setSaving(false); setStatusMsg({ kind: 'err', text: err.message }); return; }
    // Ansprechpartner separat schreiben (eigene Tabelle seit 080).
    try {
      await speichereAlleAnsprechpartner(tour.id, kontakte);
    } catch (kErr) {
      setSaving(false);
      setStatusMsg({
        kind: 'err',
        text: kErr instanceof Error ? kErr.message : 'Ansprechpartner konnten nicht gespeichert werden.',
      });
      return;
    }

    // Greimel-Zugang Zuweisung synchron halten:
    // - Wenn Tour 'abgeschlossen' wurde → vorherige Zuweisung freigeben.
    // - Wenn Zugang gewechselt/entfernt ODER Fahrer gewechselt →
    //   vorherigen Fahrer entfernen (sofern keine andere aktive Tour
    //   von ihm denselben Zugang nutzt).
    // - Wenn neuer Zugang/Fahrer → Fahrer hinzufügen.
    const nextFahrerId = draft.fahrerId || null;
    try {
      if (willComplete && previousGreimelId && previousFahrerId) {
        await releaseZugangIfUnused(previousGreimelId, previousFahrerId, tour.id);
      } else if (
        previousGreimelId && previousFahrerId
        && (previousGreimelId !== nextGreimelId || previousFahrerId !== nextFahrerId)
      ) {
        await releaseZugangIfUnused(previousGreimelId, previousFahrerId, tour.id);
      }
      if (nextGreimelId && nextFahrerId
          && (nextGreimelId !== previousGreimelId || nextFahrerId !== previousFahrerId)) {
        await assignFahrerToZugang(nextGreimelId, nextFahrerId);
      }
    } catch (e) {
      console.warn('Greimel-Zugang-Zuweisung konnte nicht synchronisiert werden', e);
    }

    setSaving(false);
    setEditing(false);
    setDraft(null);
    setStatusMsg({ kind: 'ok', text: 'Tour gespeichert.' });
    await load();
    onChanged();
  }

  // ----- Barauslagen / Honorar (separates Auto-Save) -----

  async function commitBarauslagen() {
    if (!tour || !isAdmin) return;
    const v = parseDecimal(barauslagenInput);
    if (v === null) {
      setBarauslagenInput(decimalToInput(tour.barauslagen));
      return;
    }
    if (v === Number(tour.barauslagen)) return;
    const { error: err } = await supabase
      .from('touren').update({ barauslagen: v }).eq('id', tour.id);
    if (err) { setStatusMsg({ kind: 'err', text: err.message }); return; }
    setTour({ ...tour, barauslagen: v });
    onChanged();
  }

  async function commitHonorar() {
    if (!tour || !isAdmin) return;
    const v = parseDecimal(honorarInput);
    if (v === null) {
      setHonorarInput(decimalToInput(tour.fahrer_honorar));
      return;
    }
    if (v === Number(tour.fahrer_honorar)) return;
    const { error: err } = await supabase
      .from('touren').update({ fahrer_honorar: v }).eq('id', tour.id);
    if (err) { setStatusMsg({ kind: 'err', text: err.message }); return; }
    setTour({ ...tour, fahrer_honorar: v });
    onChanged();
  }

  // ----- Zusätze -----

  async function handleAddZusatz() {
    if (!tour || !isAdmin) return;
    const kategorie = neueKategorie.trim();
    if (!kategorie) {
      setStatusMsg({ kind: 'err', text: 'Kategorie darf nicht leer sein.' });
      return;
    }
    const betrag = parseDecimal(neuerBetrag);
    if (betrag === null) {
      setStatusMsg({ kind: 'err', text: 'Betrag ist ungültig.' });
      return;
    }
    const anzahlVal = parseDecimal(neueAnzahl);
    const anzahl = anzahlVal !== null && anzahlVal >= 0.01 ? anzahlVal : 1;
    // Bei ABA/ABC-Touren ist das Kennzeichen-Feld sichtbar — und Pflicht,
    // damit der Admin nicht versehentlich ohne Zuordnung speichert. Bei
    // AB-Touren wird automatisch das einzige Kennzeichen genommen (oder
    // NULL, falls keins erfasst ist).
    const twoSlots = tour.tourenart === 'ABA' || tour.tourenart === 'ABC';
    let kennzeichen: string | null = null;
    if (twoSlots) {
      const picked = neuesKennzeichen.trim();
      if (!picked) {
        setStatusMsg({ kind: 'err', text: 'Bitte das Kennzeichen wählen.' });
        return;
      }
      kennzeichen = picked;
    } else {
      kennzeichen = (tour.kennzeichen?.[0]?.trim() || null);
    }
    if (guard()) return;
    setAddingZusatz(true);
    const { data, error: err } = await supabase
      .from('tour_zusaetze')
      .insert({
        tour_id: tour.id,
        kategorie,
        anzahl,
        betrag,
        notiz: neueNotiz.trim() || null,
        kennzeichen,
      })
      .select('*')
      .single();
    setAddingZusatz(false);
    if (err) { setStatusMsg({ kind: 'err', text: err.message }); return; }
    setZusaetze((z) => [...z, data as TourZusatz]);
    setNeueKategorie('');
    setNeueAnzahl('1');
    setNeuerBetrag('');
    setNeueNotiz('');
    setNeuesKennzeichen('');
    setStatusMsg(null);
    onChanged();
  }

  async function handleDeleteZusatz(id: string) {
    if (!isAdmin) return;
    if (guard()) return;
    const { error: err } = await supabase.from('tour_zusaetze').delete().eq('id', id);
    if (err) { setStatusMsg({ kind: 'err', text: err.message }); return; }
    setZusaetze((z) => z.filter((x) => x.id !== id));
    onChanged();
  }

  // ----- Tour löschen -----

  async function handleDeleteTour() {
    if (!tour) return;
    if (guard()) return;
    // Hängt ein Greimel-Zugang an der Tour: Fahrer-Zuweisung freigeben,
    // bevor die Tour weg ist — sonst bleibt der Zugang als „zugewiesen"
    // blockiert, obwohl keine verknüpfte Tour mehr existiert.
    if (tour.greimel_zugang_id && tour.fahrer_id) {
      try {
        await releaseZugangIfUnused(tour.greimel_zugang_id, tour.fahrer_id, tour.id);
      } catch (e) {
        console.warn('Greimel-Freigabe beim Tour-Löschen fehlgeschlagen', e);
      }
    }
    const { error: err } = await supabase.from('touren').delete().eq('id', tour.id);
    if (err) throw err;
    onDeleted();
  }

  // ----- Tour bestätigen (Auftraggeber-Einreichungen) -----

  async function handleBestaetigen() {
    if (!tour || !isAdmin) return;
    if (guard()) return;
    const { error: err } = await supabase
      .from('touren')
      .update({ bestaetigt: true })
      .eq('id', tour.id);
    if (err) { setStatusMsg({ kind: 'err', text: err.message }); return; }
    setTour({ ...tour, bestaetigt: true });
    setStatusMsg({ kind: 'ok', text: 'Tour bestätigt.' });
    onChanged();
  }

  // ----- Protokoll-Verknüpfung lösen -----

  /**
   * Löst die Verknüpfung Tour ↔ Eingang/Protokoll und setzt — auf Wunsch —
   * die durch das Protokoll befüllten Felder zurück. Funktioniert pro Slot
   * (AB oder BC): nur die Felder DIESES Abschnitts werden zurückgesetzt.
   *
   * resetFields=true:  Felder aus protokoll_daten_felder[_bc] zurücksetzen
   *                    (Legacy-AB-Touren ohne Tracking: Standard-Protokoll-
   *                    Felder).
   * resetFields=false: nur die jeweilige eingang_id auf null, Daten bleiben.
   */
  async function handleUnlinkProtokoll(resetFields: boolean) {
    if (!tour || !isAdmin || !unlinkOpen) return;
    const slot = unlinkOpen;
    setUnlinkBusy(true);
    setError(null);
    const tracked = slot === 'bc'
      ? (tour.protokoll_daten_felder_bc ?? [])
      : (tour.protokoll_daten_felder ?? []);
    const fieldsToReset = resetFields
      ? (tracked.length > 0
          ? tracked
          : (slot === 'ab' ? DEFAULT_PROTOKOLL_FIELDS : []))
      : [];
    const patch: Record<string, unknown> = slot === 'bc'
      ? { eingang_id_bc: null, protokoll_daten_felder_bc: [] }
      : { eingang_id: null, protokoll_daten_felder: [] };
    for (const f of fieldsToReset) {
      patch[f] = f === 'kennzeichen' ? [] : null;
    }
    const { error: err } = await supabase
      .from('touren')
      .update(patch as never)
      .eq('id', tour.id);
    setUnlinkBusy(false);
    if (err) { setError(err.message); return; }
    setUnlinkOpen(null);
    setStatusMsg({
      kind: 'ok',
      text: resetFields
        ? `Verknüpfung gelöst, ${fieldsToReset.length} ${fieldsToReset.length === 1 ? 'Feld' : 'Felder'} zurückgesetzt.`
        : 'Verknüpfung gelöst, Daten beibehalten.',
    });
    await load();
    onChanged();
  }

  // ----- Render -----

  if (loading) {
    return (
      <Shell onClose={onClose} variant={variant}>
        <Spinner label="Tour wird geladen …" />
      </Shell>
    );
  }
  if (error || !tour) {
    return (
      <Shell onClose={onClose} variant={variant}>
        <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
          {error ?? 'Tour nicht gefunden.'}
        </div>
      </Shell>
    );
  }

  const fahrerLabel = tour.fahrer
    ? fahrerName(tour.fahrer, tour.fahrer.user ?? null) || '—'
    : '—';
  const titel = tourTitel(tour);
  const hatRueckfuehrung = !!tour.rueckfuehrung_stadt;

  return (
    <Shell onClose={onClose} variant={variant}>
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-maja-navy break-words">{titel}</h2>
          <p className="text-xs text-maja-muted">
            {tour.tour_id ?? '—'}
            {tour.auftraggeber ? ` · ${tour.auftraggeber.name}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
          aria-label="Schließen"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Route-Banner — Vergütung nur für Admins */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-maja-navy px-5 py-4 text-white">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wider text-white/70">Route</div>
          <div className="mt-0.5 text-base font-semibold break-words">{titel}</div>
        </div>
        {isAdmin && (
          <div className="text-right">
            <div className="text-2xl font-bold">{formatEuro(tour.verguetung)}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-white/70">Netto</div>
          </div>
        )}
      </div>

      {statusMsg && (
        <div
          role="status"
          className={`mb-4 rounded-lg p-3 text-sm ${
            statusMsg.kind === 'ok'
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {statusMsg.text}
        </div>
      )}

      {/* Detail-Felder */}
      {!editing || !draft ? (
        <ViewMode tour={tour} fahrerName={fahrerLabel} hatRueckfuehrung={hatRueckfuehrung} zugaenge={zugaenge} isAdmin={isAdmin} viewBreakdown={viewBreakdown} />
      ) : (
        <EditMode
          draft={draft}
          patchDraft={patchDraft}
          toggleRueckfuehrung={toggleRueckfuehrung}
          liveKmGesamt={liveKmGesamt}
          livePreisKm={livePreisKm}
          adressen={{
            start: draftAdresseStart, ziel: draftAdresseZiel, rueck: draftRueckAdresse,
          }}
          auftraggeber={auftraggeber}
          fahrer={fahrer}
          draftSelectedAg={draftSelectedAg}
          breakdown={breakdown}
          pricing={pricing}
          templates={templates}
          zugaenge={zugaenge}
          kontakte={editKontakte}
          stationsKontakte={kontakte}
          onStationsKontakte={(station, next) =>
            setKontakte((m) => ({ ...m, [station]: next }))}
          onOpenRouteDialog={setRouteDialog}
          routeConfirm={routeConfirm}
          tourId={tour.id}
        />
      )}

      {/* Verknüpfte Eingänge — bei ABA/ABC zwei Slots, sonst einer. */}
      <VerknuepfteEingaenge
        tour={tour}
        isAdmin={isAdmin}
        eingangAb={eingangAb}
        eingangBc={eingangBc}
        onUnlink={(slot) => setUnlinkOpen(slot)}
        onLink={(slot) => setRelinkSlot(slot)}
      />

      {relinkSlot && (
        <RelinkLauncher
          tour={tour}
          slot={relinkSlot}
          onClose={() => setRelinkSlot(null)}
          onLinked={() => { setRelinkSlot(null); void load(); onChanged(); }}
        />
      )}

      {/* Zusätze — nur für Admins */}
      {isAdmin && (
      <div className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-base font-semibold text-maja-navy">Zusätze zur Tour</h3>
          <span className="inline-flex items-center justify-center rounded-full bg-maja-light px-2 py-0.5 text-xs font-semibold text-maja-navy">
            {zusaetze.length} {zusaetze.length === 1 ? 'Eintrag' : 'Einträge'}
          </span>
        </div>

        {isAdmin && (() => {
          // Bei ABA/ABC sind zwei Kennzeichen möglich; der Admin wählt
          // pro Zusatz das passende. AB-Touren ohne Wahl-UI bleiben
          // visuell wie bisher.
          const twoSlots = tour.tourenart === 'ABA' || tour.tourenart === 'ABC';
          const kennzeichenOpts = (tour.kennzeichen ?? []).filter((k) => k.trim());
          const labels = twoSlots ? abschnittLabels(tour) : null;
          const colsClass = twoSlots
            ? 'sm:grid-cols-[8rem_1fr_5rem_8rem_1fr_auto]'
            : 'sm:grid-cols-[1fr_5rem_8rem_1fr_auto]';
          return (
          <div className="card mb-3 space-y-3 p-4">
            <div className={`grid gap-2 ${colsClass} sm:items-end`}>
              {twoSlots && (
                <div>
                  <label htmlFor="z-kz" className="label">Kennzeichen</label>
                  <select
                    id="z-kz"
                    className="input"
                    value={neuesKennzeichen}
                    onChange={(e) => setNeuesKennzeichen(e.target.value)}
                  >
                    <option value="">— wählen —</option>
                    {kennzeichenOpts[0] && (
                      <option value={kennzeichenOpts[0]}>
                        {kennzeichenOpts[0]} ({labels?.ab.short ?? 'Hin'})
                      </option>
                    )}
                    {kennzeichenOpts[1] && (
                      <option value={kennzeichenOpts[1]}>
                        {kennzeichenOpts[1]} ({labels?.bc.short ?? 'Rück'})
                      </option>
                    )}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="z-kat" className="label">Kategorie</label>
                <select
                  id="z-kat"
                  className="input"
                  value={neueKategorie}
                  onChange={(e) => setNeueKategorie(e.target.value)}
                >
                  <option value="">— wählen —</option>
                  {(ZUSATZ_KATEGORIEN ?? []).map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="z-anzahl" className="label">Anzahl</label>
                <input
                  id="z-anzahl"
                  className="input"
                  type="text"
                  inputMode="decimal"
                  value={neueAnzahl}
                  onChange={(e) => setNeueAnzahl(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="z-betrag" className="label">Betrag (€)</label>
                <input
                  id="z-betrag"
                  className="input"
                  type="text"
                  inputMode="decimal"
                  value={neuerBetrag}
                  onChange={(e) => setNeuerBetrag(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="z-notiz" className="label">Notiz (optional)</label>
                <input
                  id="z-notiz"
                  className="input"
                  value={neueNotiz}
                  onChange={(e) => setNeueNotiz(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleAddZusatz()}
                disabled={addingZusatz || !neueKategorie || !neuerBetrag || (twoSlots && !neuesKennzeichen)}
              >
                {addingZusatz ? '…' : '+ Hinzufügen'}
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(ZUSATZ_KATEGORIEN ?? []).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setNeueKategorie(k)}
                  className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium transition ${
                    neueKategorie === k
                      ? 'bg-maja-navy text-white'
                      : 'bg-maja-light text-maja-navy hover:bg-maja-light/70'
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
          );
        })()}

        {(zusaetze ?? []).length === 0 ? (
          <p className="text-sm text-maja-muted">Noch keine Zusätze erfasst.</p>
        ) : (
          <div className="card overflow-hidden">
            <ul className="divide-y divide-maja-navy/10">
              {(zusaetze ?? []).map((z) => {
                const anzahl = Math.max(0.01, Number(z.anzahl ?? 1));
                const betrag = Number(z.betrag);
                const gesamt = Math.round(betrag * anzahl * 100) / 100;
                return (
                  <li key={z.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="text-maja-ink">
                        {z.kennzeichen && (
                          <>
                            <span className="rounded-full bg-maja-light px-2 py-0.5 text-xs font-semibold text-maja-navy">
                              {z.kennzeichen}
                            </span>
                            <span className="text-maja-muted"> — </span>
                          </>
                        )}
                        <span className="font-medium">{z.kategorie}</span>
                        <span className="text-maja-muted">: </span>
                        {anzahl !== 1 ? (
                          <>
                            {formatAnzahl(anzahl)} × {formatEuro(betrag)} = <span className="font-semibold">{formatEuro(gesamt)}</span>
                          </>
                        ) : (
                          <span className="font-semibold">{formatEuro(betrag)}</span>
                        )}
                      </div>
                      {z.notiz && <div className="text-xs text-maja-muted">{z.notiz}</div>}
                    </div>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteZusatz(z.id)}
                        aria-label="Zusatz löschen"
                        className="rounded-md px-2 py-1 text-red-600 hover:bg-red-50"
                      >
                        <XIcon className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between border-t border-maja-navy/10 bg-maja-light/40 px-4 py-2 text-sm">
              <span className="font-medium text-maja-navy">Zusätze gesamt</span>
              <span className="font-semibold text-maja-navy">
                {formatEuro(
                  (zusaetze ?? []).reduce(
                    (acc, z) => acc + Number(z.betrag) * Math.max(0.01, Number(z.anzahl ?? 1)),
                    0,
                  ),
                )}
              </span>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Barauslagen + Fahrer-Honorar — nur für Admins */}
      {isAdmin && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <FinanceField
            label="Barauslagen"
            value={barauslagenInput}
            onChange={setBarauslagenInput}
            onCommit={commitBarauslagen}
          />
          <FinanceField
            label="Fahrer Honorar"
            value={honorarInput}
            onChange={setHonorarInput}
            onCommit={commitHonorar}
          />
        </div>
      )}

      {/* Bereich 6: Fahrzeug & Adressen — nur in der Ansicht. Im
          Edit-Modus stehen diese Felder in den Blöcken oben
          (Fahrzeug Hinfahrt / Abholort / Zielort / …). */}
      {(!editing || !draft) && (
        <div className="mt-6 space-y-4">
          <h3 className="border-b border-maja-navy/10 pb-2 text-base font-semibold text-maja-navy">
            Fahrzeug &amp; Adressen
          </h3>
          <VehicleAndAddressView
            tour={tour}
            hatRueckfuehrung={hatRueckfuehrung}
            kontakte={kontakte}
          />
        </div>
      )}

      {/* Footer */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-maja-navy/10 pt-4">
        {isAdmin && !editing && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              Löschen
            </button>
            {/* Auftrag an den Fahrer — bewusst unten links, gegenüber
                dem Bearbeiten-Button. Nur für Admins. */}
            <button
              type="button"
              onClick={() => { if (!guard()) setAuftragMailOpen(true); }}
              className="btn-secondary"
            >
              Auftrag als E-Mail versenden
            </button>
            {tour.auftrag_versendet_am && (
              <span className="text-xs text-maja-muted">
                Auftrag versendet: {formatDateTime(tour.auftrag_versendet_am)}
              </span>
            )}
          </div>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {editing ? (
            <>
              <button type="button" onClick={cancelEdit} className="btn-secondary" disabled={saving}>
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleSaveMitPruefung}
                className="btn-primary"
                disabled={saving}
              >
                {saving ? 'Speichert …' : 'Speichern'}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onClose} className="btn-secondary">
                Schließen
              </button>
              {isAdmin && tour.bestaetigt === false && (
                <button
                  type="button"
                  onClick={() => void handleBestaetigen()}
                  className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700"
                >
                  Tour bestätigen
                </button>
              )}
              {isAdmin && (
                <button type="button" onClick={startEdit} className="btn-primary">
                  Bearbeiten
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {confirmDelete && (() => {
        // Eingangs-Verknüpfungs-Anzahl für die Warnung (Aufgabe 2):
        // Bei AB-Touren maximal 1 (eingang_id), bei ABA/ABC bis zu 2
        // (eingang_id + eingang_id_bc).
        const linkedCount = (tour.eingang_id ? 1 : 0) + (tour.eingang_id_bc ? 1 : 0);
        const routeLabel = `${tour.start_stadt} → ${tour.ziel_stadt}`
          + (tour.rueckfuehrung_stadt ? ` → ${tour.rueckfuehrung_stadt}` : '');
        return (
          <ConfirmDialog
            title="Tour löschen?"
            message={
              <>
                Tour <strong>{tour.tour_id ?? tour.id.slice(0, 8)}</strong> ({routeLabel})
                unwiderruflich löschen? Alle erfassten Zusätze werden ebenfalls gelöscht.
                {linkedCount > 0 && (
                  <span className="mt-2 block rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Diese Tour ist mit {linkedCount} {linkedCount === 1 ? 'Eingang' : 'Eingängen'} verknüpft.
                    Die Verknüpfung wird automatisch gelöst — die Eingänge bleiben erhalten.
                  </span>
                )}
              </>
            }
            confirmLabel="Löschen"
            destructive
            onConfirm={handleDeleteTour}
            onClose={() => setConfirmDelete(false)}
          />
        );
      })()}

      {unlinkOpen && (
        <UnlinkProtokollDialog
          fields={(unlinkOpen === 'bc'
            ? tour.protokoll_daten_felder_bc
            : tour.protokoll_daten_felder) ?? []}
          busy={unlinkBusy}
          onConfirm={(reset) => void handleUnlinkProtokoll(reset)}
          onClose={() => setUnlinkOpen(null)}
        />
      )}

      {auftragMailOpen && tour && (
        <AuftragEmailDialog
          tour={{
            id: tour.id,
            tour_id: tour.tour_id,
            start_stadt: tour.start_stadt,
            ziel_stadt: tour.ziel_stadt,
            rueckfuehrung_stadt: tour.rueckfuehrung_stadt,
            adresse_start: tour.adresse_start,
            adresse_ziel: tour.adresse_ziel,
            adresse_rueckfuehrung: tour.adresse_rueckfuehrung,
            strasse_start: tour.strasse_start,
            hausnummer_start: tour.hausnummer_start,
            plz_start: tour.plz_start,
            strasse_ziel: tour.strasse_ziel,
            hausnummer_ziel: tour.hausnummer_ziel,
            plz_ziel: tour.plz_ziel,
            strasse_rueckfuehrung: tour.strasse_rueckfuehrung,
            hausnummer_rueckfuehrung: tour.hausnummer_rueckfuehrung,
            plz_rueckfuehrung: tour.plz_rueckfuehrung,
            zeit_start: tour.zeit_start,
            zeit_ziel: tour.zeit_ziel,
            zeit_rueckfuehrung: tour.zeit_rueckfuehrung,
            startdatum: tour.startdatum,
            enddatum: tour.enddatum,
            tourenart: tour.tourenart,
            kennzeichen: tour.kennzeichen,
            fin: tour.fin,
            fin_rueck: tour.fin_rueck,
            fahrzeugmodell: tour.fahrzeugmodell,
            fahrzeugmodell_rueck: tour.fahrzeugmodell_rueck,
            kundenname: tour.kundenname,
            info: tour.info,
            fahrer_honorar: tour.fahrer_honorar,
          }}
          fahrerEmail={tour.fahrer?.user?.email ?? null}
          fahrerName={tour.fahrer ? fahrerNameOf(tour.fahrer) : null}
          auftraggeberName={tour.auftraggeber?.name ?? null}
          auftraggeberId={tour.auftraggeber_id}
          onClose={() => setAuftragMailOpen(false)}
          onSent={() => {
            setAuftragMailOpen(false);
            setStatusMsg({ kind: 'ok', text: 'Auftrag versendet.' });
            void load();
          }}
        />
      )}

      {abcWarnung && draft && (
        <ConfirmDialog
          title="Tourenart prüfen"
          message={ABC_WARNUNG_TEXT}
          confirmLabel="Auf ABC ändern"
          cancelLabel="AB beibehalten"
          onConfirm={async () => {
            setDraft((d) => (d ? { ...d, tourenart: 'ABC', tourenartManuell: true } : d));
            setAbcWarnung(false);
            await handleSave();
          }}
          onClose={() => {
            // "AB beibehalten" — bewusste Entscheidung, also speichern.
            setAbcWarnung(false);
            void handleSave();
          }}
        />
      )}

      {routeDialog && draft && (() => {
        // Origin/Destination je nach Abschnitt. "hin": Start → Ziel,
        // füllt km_hin (oder km_gesamt_aba bei ABA). "rueck": Ziel →
        // Rückführung, füllt km_rueck.
        const isHin = routeDialog === 'hin';
        // Routenberechnung auf der zusammengesetzten Adresse
        // ("Straße Nr., PLZ Stadt") — bei Bestandstouren weiterhin auf
        // dem alten Freitext.
        const origin = (isHin ? draftAdresseStart : draftAdresseZiel).trim();
        const destination = (isHin ? draftAdresseZiel : draftRueckAdresse).trim();
        const title = isHin ? 'Routen für Hin-Strecke' : 'Routen für Rück-Strecke';
        const closeAndAdvance = () => setRouteDialog(null);
        return (
          <RouteSelectorDialog
            title={title}
            origin={origin}
            destination={destination}
            onClose={closeAndAdvance}
            onApply={(km) => {
              if (isHin) {
                patchDraft({ kmHin: String(km) });
                setRouteConfirm((c) => ({ ...c, hin: km }));
              } else {
                patchDraft({ kmRueck: String(km) });
                setRouteConfirm((c) => ({ ...c, rueck: km }));
              }
              closeAndAdvance();
            }}
          />
        );
      })()}
    </Shell>
  );
}

// ---------- Unlink-Protokoll-Dialog ----------

interface UnlinkProps {
  fields: string[];
  busy: boolean;
  onConfirm: (resetFields: boolean) => void;
  onClose: () => void;
}

/**
 * Zwei-Pfad-Bestätigung:
 *  - Wenn das Tracking (protokoll_daten_felder) vorhanden ist: zeigt die
 *    konkrete Liste und bietet einen einzelnen "Verknüpfung lösen"-Button,
 *    der die Felder zurücksetzt.
 *  - Für Legacy-Touren ohne Tracking: bietet zwei Aktionen
 *    ("Alle Protokoll-Felder zurücksetzen" vs. "Nur Verknüpfung lösen").
 */
function UnlinkProtokollDialog({ fields, busy, onConfirm, onClose }: UnlinkProps) {
  const hasTracking = fields.length > 0;
  const display = hasTracking ? fields : DEFAULT_PROTOKOLL_FIELDS;
  return (
    <div role="dialog" aria-modal="true"
         className="fixed inset-0 z-40 flex items-center justify-center bg-maja-ink/40 p-4"
         onClick={onClose}>
      <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-maja-navy">Protokoll-Verknüpfung lösen?</h2>
        {hasTracking ? (
          <p className="mt-2 text-sm text-maja-ink">
            Folgende automatisch übernommene Daten werden entfernt:
          </p>
        ) : (
          <p className="mt-2 text-sm text-amber-800">
            <strong>Achtung:</strong> Es kann nicht festgestellt werden, welche Daten
            automatisch übernommen wurden. Du kannst entweder alle Protokoll-typischen
            Felder zurücksetzen oder nur die Verknüpfung lösen und die Daten beibehalten.
          </p>
        )}
        <ul className="mt-3 list-inside list-disc rounded-lg bg-maja-light/40 px-4 py-2 text-sm text-maja-ink">
          {display.map((f) => (
            <li key={f}>{PROTOKOLL_FELD_LABEL[f] ?? f}</li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          {!hasTracking && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onConfirm(false)}
              disabled={busy}
            >
              Nur Verknüpfung lösen
            </button>
          )}
          <button
            type="button"
            className="btn-primary bg-red-600 hover:bg-red-700"
            onClick={() => onConfirm(true)}
            disabled={busy}
          >
            {busy
              ? 'Wird gelöst …'
              : hasTracking ? 'Verknüpfung lösen' : 'Alle Protokoll-Felder zurücksetzen'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Layout-Shell ----------

function Shell({
  children, onClose, variant = 'modal',
}: { children: ReactNode; onClose: () => void; variant?: 'modal' | 'embedded' }) {
  // Punkt 3: Hintergrund darf nicht scrollen, solange das Overlay offen
  // ist — greift auch bei ESC, Hintergrund-Klick und „Abbrechen", weil
  // die Sperre am Unmount dieses Shells hängt.
  useScrollLock(variant === 'modal');
  // ESC schließt nur im Modal — im embedded Side-by-Side soll Escape
  // den Eltern-Container nicht stören.
  useEffect(() => {
    if (variant !== 'modal') return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, variant]);

  if (variant === 'embedded') {
    return <div className="card w-full p-5">{children}</div>;
  }
  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-5xl p-5">
        {children}
      </div>
    </div>
  );
}

// ---------- View-Mode ----------

interface ViewModeProps {
  tour: FullTour;
  fahrerName: string;
  hatRueckfuehrung: boolean;
  zugaenge: GreimelZugang[];
  isAdmin: boolean;
  viewBreakdown: TourPriceBreakdown | null;
}

function ViewMode({ tour, fahrerName, hatRueckfuehrung, zugaenge, isAdmin, viewBreakdown }: ViewModeProps) {
  const linkedZugang = zugaenge.find((z) => z.id === tour.greimel_zugang_id) ?? null;
  const computedStatus = computeTourStatus(tour.startdatum, tour.enddatum);

  return (
    <div className="space-y-6">
      {/* Bereich 1: Status */}
      <SectionHeader title="Status" />
      <div>
        <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${STATUS_BADGE[computedStatus]}`}>
          {STATUS_LABEL[computedStatus]}
        </span>
        <span className="ml-2 text-xs text-maja-muted">(automatisch nach Datum)</span>
      </div>

      {/* Bereich 2: Kerndaten */}
      <SectionHeader title="Kerndaten" />
      <div className="grid gap-4 sm:grid-cols-2">
        <DetailItem label="Auftraggeber">
          {tour.auftraggeber ? (
            <>
              <span className="block">{tour.auftraggeber.name}</span>
              {tour.auftraggeber.kontakt && (
                <span className="block text-xs text-maja-muted">{tour.auftraggeber.kontakt}</span>
              )}
            </>
          ) : '—'}
        </DetailItem>
        <DetailItem label="Fahrer">{fahrerName}</DetailItem>
        <DetailItem label="Startdatum">{formatDate(tour.startdatum)}</DetailItem>
        <DetailItem label="Enddatum">{formatDate(tour.enddatum)}</DetailItem>
        {isAdmin && tour.rechnungsdatum_abweichend && tour.rechnungsdatum && (
          <DetailItem label="Rechnungsdatum">{formatDate(tour.rechnungsdatum)}</DetailItem>
        )}
        {isAdmin && (
          tour.tourenart === 'ABA' ? (
            <DetailItem label="Kilometer gesamt">{formatKm(tour.km_gesamt)}</DetailItem>
          ) : (
            <>
              <DetailItem label="km Gesamt">{formatKm(tour.km_gesamt)}</DetailItem>
              <DetailItem label="km Hin">{formatKm(tour.km_hin)}</DetailItem>
              {hatRueckfuehrung && <DetailItem label="km Rück">{formatKm(tour.km_rueck)}</DetailItem>}
            </>
          )
        )}
        <DetailItem label="Tourenart">
          {tour.tourenart ?? '—'}
          {tour.ist_e_fahrzeug && (
            <span className="ml-2 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              E-Fahrzeug
            </span>
          )}
        </DetailItem>
        <DetailItem label="Rechnungsempfänger">
          {tour.kontakt ? (
            <>
              <span className="block">{tour.kontakt.name}</span>
              {tour.kontakt.position && (
                <span className="block text-xs text-maja-muted">{tour.kontakt.position}</span>
              )}
              {(tour.kontakt.telefon || tour.kontakt.email) && (
                <span className="block text-xs text-maja-muted">
                  {[tour.kontakt.telefon, tour.kontakt.email].filter(Boolean).join(' · ')}
                </span>
              )}
            </>
          ) : '—'}
        </DetailItem>
        <DetailItem label="Kundenname">{tour.kundenname || '—'}</DetailItem>
        {isAdmin && (
          <DetailItem label="Sondervereinbarung" full>
            {tour.ist_sondervereinbarung ? (
              <>
                <span className="font-medium text-maja-navy">Ja</span>
                {tour.sondervereinbarung && (
                  <span className="ml-2 text-maja-muted">— {tour.sondervereinbarung}</span>
                )}
              </>
            ) : 'Nein'}
          </DetailItem>
        )}
        {isAdmin && (
          <DetailItem label="Vergütung" full>
            <span className="text-base font-semibold text-maja-navy">{formatEuro(tour.verguetung)}</span>
            {tour.ist_sondervereinbarung ? (
              <span className="ml-2 text-xs text-maja-muted">Manueller Preis (Sondervereinbarung)</span>
            ) : viewBreakdown && (viewBreakdown.abaAufschlag > 0 || viewBreakdown.eAufschlag > 0) ? (
              <div className="mt-1 text-xs text-maja-muted">
                {formatEuro(viewBreakdown.base)}
                {viewBreakdown.abaAufschlag > 0 && (
                  <> + {formatEuro(viewBreakdown.abaAufschlag)} ABA</>
                )}
                {viewBreakdown.eAufschlag > 0 && (
                  <> + {formatEuro(viewBreakdown.eAufschlag)} E-Aufschlag</>
                )}
                <> = {formatEuro(viewBreakdown.total)}</>
              </div>
            ) : (
              <span className="ml-2 text-xs text-maja-muted">Auto (Preisliste)</span>
            )}
          </DetailItem>
        )}
        {isAdmin && tour.info && (
          <DetailItem label="Info" full>
            <span className="whitespace-pre-wrap">{tour.info}</span>
          </DetailItem>
        )}
        {isAdmin && <ViewModeRechnungsRef tourId={tour.id} />}
        {/* Extern hochgeladene Protokolle (076) — Upload/Löschen nur Admin,
            Fahrer sehen ihre eigenen Tour-Dokumente read-only. */}
        <div className="sm:col-span-2">
          <TourDokumenteSection tourId={tour.id} canEdit={isAdmin} />
        </div>
      </div>

      {/* Bereich 3: Protokoll */}
      <SectionHeader title="Protokoll" />
      <div className="rounded-lg border border-maja-navy/10 p-3 text-sm text-maja-ink">
        {tour.protokoll_art == null ? (
          <span className="text-maja-muted">Noch nicht festgelegt.</span>
        ) : tour.protokoll_art === 'app' ? (
          <div className="space-y-2">
            <div className="font-medium">App</div>
            {tour.auftraggeber?.externe_app_url && (
              <a
                href={tour.auftraggeber.externe_app_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-maja-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-maja-navy"
              >
                {(tour.auftraggeber.externe_app_name?.trim() || 'externe App')} öffnen
                <span aria-hidden="true">↗</span>
              </a>
            )}
            {tour.app_notiz && (
              <div className="whitespace-pre-wrap text-sm text-maja-ink">{tour.app_notiz}</div>
            )}
            {linkedZugang && (
              <div className="rounded-md bg-maja-light/60 p-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-maja-muted">
                  Greimel Zugang
                </div>
                <div className="mt-0.5 font-medium text-maja-ink">{linkedZugang.titel}</div>
                <div className="text-xs text-maja-muted">{linkedZugang.benutzername}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <div className="font-medium">Schriftlich</div>
            <ViewModeProtokollList tourId={tour.id} />
          </div>
        )}
      </div>

    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="border-b border-maja-navy/10 pb-2 text-base font-semibold text-maja-navy">
      {title}
    </h3>
  );
}

function DetailItem({
  label, children, full,
}: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <div className="text-xs font-medium uppercase tracking-wide text-maja-muted">{label}</div>
      <div className="mt-1 text-sm text-maja-ink">{children}</div>
    </div>
  );
}

// ---------- Edit-Mode ----------

interface EditModeProps {
  draft: EditDraft;
  patchDraft: (p: Partial<EditDraft>) => void;
  toggleRueckfuehrung: () => void;
  liveKmGesamt: number | null;
  /** km, mit denen der Preis ermittelt wird (bei ABA = km Hin). */
  livePreisKm: number | null;
  /** Zusammengesetzte Adressen je Station — steuern die Berechnen-Buttons. */
  adressen: { start: string; ziel: string; rueck: string };
  auftraggeber: Auftraggeber[];
  fahrer: FahrerWithUser[];
  draftSelectedAg: Auftraggeber | null;
  breakdown: TourPriceBreakdown | null;
  pricing: boolean;
  templates: Array<Pick<FormularTemplate, 'id' | 'name'>>;
  zugaenge: GreimelZugang[];
  kontakte: AuftraggeberKontakt[];
  /** Ansprechpartner je Station (Migration 080). */
  stationsKontakte: KontaktMap;
  onStationsKontakte: (station: Station, next: KontaktEntwurf[]) => void;
  onOpenRouteDialog: (which: 'hin' | 'rueck') => void;
  /** km der jeweils zuletzt übernommenen Route — Bestätigung neben dem
   *  Berechnen-Button (Aufgabe 2). */
  routeConfirm: { hin?: number; rueck?: number };
  /** Aktuelle Tour-ID — Pflicht für die ProtokollSection (Protokoll-
   *  Zuweisungen werden direkt in tour_protokoll_zuweisungen persistiert). */
  tourId: string | null;
}

function RouteIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
         className={className} aria-hidden="true">
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M8 19h6a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h6" />
    </svg>
  );
}

function EditMode(p: EditModeProps) {
  const {
    draft, patchDraft, toggleRueckfuehrung, liveKmGesamt, livePreisKm, adressen,
    auftraggeber, fahrer, draftSelectedAg, templates, zugaenge, kontakte,
    stationsKontakte, onStationsKontakte, routeConfirm, onOpenRouteDialog,
    breakdown, pricing,
  } = p;
  const isGreimel = isGreimelAuftraggeber(draftSelectedAg);
  const isAba = draft.tourenart === 'ABA';
  // Live-Status aus dem Datum (analog zur Anzeige in der Liste).
  const computedStatus = computeTourStatus(draft.startdatum || null, draft.enddatum || null);
  return (
    <div className="space-y-3">
      <div className="rounded-md bg-maja-light/60 px-3 py-2 text-xs text-maja-muted">
        Status wird automatisch aus dem Startdatum berechnet:{' '}
        <span className={`ml-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[computedStatus]}`}>
          {STATUS_LABEL[computedStatus]}
        </span>
      </div>

      {/* -----------------------------------------------------------
          1 — Auftragsdaten
          ----------------------------------------------------------- */}
      <TfBlock titel="Auftragsdaten">
        <div className="tf-grid">
          <div className="sm:col-span-3 lg:col-span-4">
            <label className="tf-label">Auftraggeber</label>
            <select className="tf-input" value={draft.auftraggeberId}
                    onChange={(e) => patchDraft({ auftraggeberId: e.target.value, kontaktId: '' })}>
              <option value="">— kein Auftraggeber —</option>
              {(auftraggeber ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3 lg:col-span-4">
            <label className="tf-label">Fahrer</label>
            <FahrerSelect
              className="tf-input"
              value={draft.fahrerId}
              onChange={(id) => patchDraft({ fahrerId: id })}
              fahrer={fahrer as FahrerOptionRaw[]}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-2">
            <label className="tf-label">Tourenart</label>
            <select className="tf-input" value={draft.tourenart}
                    onChange={(e) => {
                      const art = e.target.value as TourenArt | '';
                      // ABA/ABC haben immer eine Rückführung — die
                      // zugehörigen Blöcke direkt einblenden. Einmalig
                      // beim Umschalten, damit "Rückführung entfernen"
                      // danach trotzdem greift.
                      patchDraft({
                        tourenart: art,
                        tourenartManuell: true,
                        ...(art === 'ABA' || art === 'ABC' ? { hatRueckfuehrung: true } : {}),
                      });
                    }}>
              <option value="">—</option>
              <option value="AB">AB</option>
              <option value="ABC">ABC</option>
              <option value="ABA">ABA</option>
            </select>
          </div>
          <div className="sm:col-span-4 lg:col-span-2">
            <label className="tf-label">Kundenname</label>
            <input className="tf-input" value={draft.kundenname}
                   onChange={(e) => patchDraft({ kundenname: e.target.value })} />
          </div>

          {draft.auftraggeberId && kontakte.length > 0 && (
            <div className="sm:col-span-6 lg:col-span-4">
              <label className="tf-label">Rechnungsempfänger</label>
              <select className="tf-input" value={draft.kontaktId}
                      onChange={(e) => patchDraft({ kontaktId: e.target.value })}>
                <option value="">— kein Rechnungsempfänger —</option>
                {kontakte.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}{k.position ? ` · ${k.position}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="sm:col-span-4 lg:col-span-5">
            <label className="tf-check">
              <input
                type="checkbox"
                checked={draft.rechnungsdatumAbweichend}
                onChange={(e) => patchDraft({
                  rechnungsdatumAbweichend: e.target.checked,
                  rechnungsdatum: e.target.checked ? draft.rechnungsdatum : '',
                })}
              />
              Rechnungsdatum abweichend
            </label>
          </div>
          {draft.rechnungsdatumAbweichend && (
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="tf-label">Rechnungsdatum</label>
              <input type="date" className="tf-input" value={draft.rechnungsdatum}
                     onChange={(e) => patchDraft({ rechnungsdatum: e.target.value })} />
            </div>
          )}

          <div className="sm:col-span-3 lg:col-span-3">
            <label className="tf-check">
              <input
                type="checkbox"
                checked={draft.istSondervereinbarung}
                onChange={(e) => patchDraft({ istSondervereinbarung: e.target.checked })}
              />
              Sondervereinbarung
            </label>
          </div>
          <div className="sm:col-span-3 lg:col-span-2">
            <label className="tf-check">
              <input
                type="checkbox"
                checked={draft.istEFahrzeug}
                onChange={(e) => patchDraft({ istEFahrzeug: e.target.checked })}
              />
              E-Fahrzeug
            </label>
          </div>
          {draft.istSondervereinbarung && (
            <div className="sm:col-span-6 lg:col-span-7">
              <label className="tf-label">Anmerkung zur Sondervereinbarung</label>
              <input className="tf-input" value={draft.sondervereinbarung}
                     onChange={(e) => patchDraft({ sondervereinbarung: e.target.value })} />
            </div>
          )}

          <div className="sm:col-span-3 lg:col-span-3">
            <label className="tf-label">Vergütung (€)</label>
            {draft.istSondervereinbarung ? (
              <>
                <input
                  className="tf-input"
                  type="text"
                  inputMode="decimal"
                  value={draft.verguetung}
                  onChange={(e) => patchDraft({ verguetung: e.target.value })}
                />
                <p className="tf-hint">Manueller Preis (Sondervereinbarung aktiv).</p>
              </>
            ) : (
              <>
                <input
                  className="tf-input bg-maja-light"
                  type="text"
                  readOnly
                  value={pricing ? '…' : (breakdown?.total == null ? '' : Number(breakdown.total).toFixed(2).replace('.', ','))}
                />
                <p className="tf-hint">
                  {draft.auftraggeberId && livePreisKm != null
                    ? breakdown == null
                      ? 'Auto (Preisliste): keine passende Stufe gefunden.'
                      : breakdown.abaAufschlag === 0 && breakdown.eAufschlag === 0
                        ? `Auto (Preisliste), ${formatKm(livePreisKm)}`
                        : (
                          <>
                            {formatEuro(breakdown.base)}
                            {breakdown.abaAufschlag > 0 && (
                              <> + {formatEuro(breakdown.abaAufschlag)} ABA</>
                            )}
                            {breakdown.eAufschlag > 0 && (
                              <> + {formatEuro(breakdown.eAufschlag)} E-Aufschlag</>
                            )}
                            <> = {formatEuro(breakdown.total)}</>
                          </>
                        )
                    : 'Auto (Preisliste): Auftraggeber + km wählen.'}
                </p>
              </>
            )}
          </div>

          <div className="sm:col-span-6 lg:col-span-12">
            <label className="tf-label">Info</label>
            <textarea className="tf-input min-h-[3.5rem]" rows={2} value={draft.info}
                      onChange={(e) => patchDraft({ info: e.target.value })} />
          </div>
        </div>
      </TfBlock>

      {/* Route — dieselben Städte wie in den Ort-Blöcken, hier an der
          Stelle bearbeitbar, an der sie in der Tourenliste erscheinen. */}
      <RouteFeldsatz
        idPrefix="td"
        pflicht
        startStadt={draft.startStadt} onStartStadt={(v) => patchDraft({ startStadt: v })}
        zielStadt={draft.zielStadt} onZielStadt={(v) => patchDraft({ zielStadt: v })}
        rueckStadt={draft.hatRueckfuehrung ? draft.rueckfuehrungStadt : undefined}
        onRueckStadt={draft.hatRueckfuehrung
          ? ((v: string) => patchDraft({ rueckfuehrungStadt: v }))
          : undefined}
      />

      {/* -----------------------------------------------------------
          2 — Fahrzeug Hinfahrt
          ----------------------------------------------------------- */}
      <TfBlock titel="Fahrzeug Hinfahrt" akzent="hin">
        <div className="tf-grid">
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="tf-label">
              {draft.hatRueckfuehrung ? 'Kennzeichen Hin' : 'Kennzeichen'}
            </label>
            <input className="tf-input" value={draft.kennzeichenHin}
                   onChange={(e) => patchDraft({ kennzeichenHin: e.target.value })} />
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <label className="tf-label">Fahrzeugmodell</label>
            <SuggestCombobox
              className="tf-input"
              feldTyp="fahrzeugmodell"
              value={draft.fahrzeugmodell}
              onChange={(v) => patchDraft({ fahrzeugmodell: v })}
              placeholder="z.B. VW Polo"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-5">
            <label className="tf-label">{draft.hatRueckfuehrung ? 'FIN Hin' : 'FIN'}</label>
            <input className="tf-input"
                   value={draft.fin}
                   onChange={(e) => patchDraft({ fin: e.target.value.toUpperCase() })} />
          </div>
        </div>
      </TfBlock>

      {/* -----------------------------------------------------------
          3 — Abholort
          ----------------------------------------------------------- */}
      <StationFeldsatz
        titel="Abholort"
        idPrefix="td-ks"
        stadtLabel="Stadt" stadtPflicht
        stadt={draft.startStadt}
        onStadt={(v) => patchDraft({ startStadt: v })}
        strasse={draft.strasseStart} onStrasse={(v) => patchDraft({ strasseStart: v })}
        hausnummer={draft.hausnummerStart} onHausnummer={(v) => patchDraft({ hausnummerStart: v })}
        plz={draft.plzStart} onPlz={(v) => patchDraft({ plzStart: v })}
        adresseFreitext={draft.freitextStart}
        zeit={draft.zeitStart}
        onZeit={(v) => patchDraft({ zeitStart: v })}
        zeitLabel="Zeit Abholung"
        kontakte={stationsKontakte.start}
        onKontakte={(next) => onStationsKontakte('start', next)}
      />

      {/* -----------------------------------------------------------
          4 — Zielort
          ----------------------------------------------------------- */}
      <StationFeldsatz
        titel="Zielort"
        idPrefix="td-kz"
        stadtLabel="Stadt" stadtPflicht
        stadt={draft.zielStadt}
        onStadt={(v) => patchDraft({ zielStadt: v })}
        strasse={draft.strasseZiel} onStrasse={(v) => patchDraft({ strasseZiel: v })}
        hausnummer={draft.hausnummerZiel} onHausnummer={(v) => patchDraft({ hausnummerZiel: v })}
        plz={draft.plzZiel} onPlz={(v) => patchDraft({ plzZiel: v })}
        adresseFreitext={draft.freitextZiel}
        zeit={draft.zeitZiel}
        onZeit={(v) => patchDraft({ zeitZiel: v })}
        zeitLabel="Zeit Anlieferung"
        kontakte={stationsKontakte.ziel}
        onKontakte={(next) => onStationsKontakte('ziel', next)}
      />

      {!draft.hatRueckfuehrung && (
        <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={toggleRueckfuehrung}>
          + Rückführung
        </button>
      )}

      {draft.hatRueckfuehrung && (
        <>
          {/* -------------------------------------------------------
              5 — Fahrzeug Rückfahrt (nur ABA/ABC)
              ------------------------------------------------------- */}
          <TfBlock titel="Fahrzeug Rückfahrt" akzent="rueck">
            <div className="tf-grid">
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="tf-label">Kennzeichen Rück</label>
                <input className="tf-input" value={draft.kennzeichenRueck}
                       onChange={(e) => patchDraft({ kennzeichenRueck: e.target.value })} />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <label className="tf-label">Fahrzeugmodell Rück</label>
                <SuggestCombobox
                  className="tf-input"
                  feldTyp="fahrzeugmodell"
                  value={draft.fahrzeugmodellRueck}
                  onChange={(v) => patchDraft({ fahrzeugmodellRueck: v })}
                  placeholder="z.B. Audi A3"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-5">
                <label className="tf-label">FIN Rück</label>
                <input className="tf-input"
                       value={draft.finRueck}
                       onChange={(e) => patchDraft({ finRueck: e.target.value.toUpperCase() })} />
              </div>
            </div>
          </TfBlock>

          {/* -------------------------------------------------------
              6 — Rückführungsort (nur ABA/ABC)
              ------------------------------------------------------- */}
          <StationFeldsatz
            titel="Rückführungsort"
            idPrefix="td-kr"
            akzent="rueck"
            stadtLabel="Stadt"
            stadt={draft.rueckfuehrungStadt}
            onStadt={(v) => patchDraft({ rueckfuehrungStadt: v })}
            strasse={draft.strasseRueck} onStrasse={(v) => patchDraft({ strasseRueck: v })}
            hausnummer={draft.hausnummerRueck} onHausnummer={(v) => patchDraft({ hausnummerRueck: v })}
            plz={draft.plzRueck} onPlz={(v) => patchDraft({ plzRueck: v })}
            adresseFreitext={draft.freitextRueck}
            zeit={draft.zeitRueck}
            onZeit={(v) => patchDraft({ zeitRueck: v })}
            zeitLabel="Zeit Rückführung"
            kontakte={stationsKontakte.rueckfuehrung}
            onKontakte={(next) => onStationsKontakte('rueckfuehrung', next)}
            aktion={(
              <button
                type="button"
                onClick={toggleRueckfuehrung}
                className="text-[11px] font-medium normal-case text-red-600 hover:underline"
              >
                Rückführung entfernen
              </button>
            )}
          />
        </>
      )}

      {/* -----------------------------------------------------------
          7 — Kilometer & Termine
          ----------------------------------------------------------- */}
      <TfBlock titel="Kilometer & Termine">
        <div className="tf-grid">
          <div className="sm:col-span-3 lg:col-span-2">
            <label className="tf-label">
              Startdatum {!draft.aufEis && <span className="text-red-600">*</span>}
            </label>
            <input type="date" className="tf-input" required={!draft.aufEis} value={draft.startdatum}
                   onChange={(e) => patchDraft({ startdatum: e.target.value })} />
          </div>
          <div className="sm:col-span-3 lg:col-span-2">
            <label className="tf-label">
              Enddatum {!draft.aufEis && <span className="text-red-600">*</span>}
            </label>
            <input type="date" className="tf-input" required={!draft.aufEis} value={draft.enddatum}
                   onChange={(e) => patchDraft({ enddatum: e.target.value })} />
          </div>
          <div className="sm:col-span-3 lg:col-span-3">
            <label className="tf-label">km Hin (Start → Ziel)</label>
            <input className="tf-input" type="number" min={0} step={1}
                   value={draft.kmHin}
                   onChange={(e) => patchDraft({ kmHin: e.target.value })} />
            <RouteCalcRow
              disabled={!adressen.start.trim() || !adressen.ziel.trim()}
              label="Entfernung berechnen"
              confirmKm={routeConfirm.hin}
              onClick={() => onOpenRouteDialog('hin')}
            />
          </div>
          {draft.hatRueckfuehrung && (
            <div className="sm:col-span-3 lg:col-span-3">
              <label className="tf-label">km Rück (Ziel → Rückführung)</label>
              <input className="tf-input" type="number" min={0} step={1}
                     value={draft.kmRueck}
                     onChange={(e) => patchDraft({ kmRueck: e.target.value })} />
              <RouteCalcRow
                disabled={!adressen.ziel.trim() || !adressen.rueck.trim()}
                label="Entfernung berechnen"
                confirmKm={routeConfirm.rueck}
                onClick={() => onOpenRouteDialog('rueck')}
              />
            </div>
          )}
          <div className="sm:col-span-6 lg:col-span-2">
            <span className="tf-label">km Gesamt</span>
            <div className="rounded-md bg-maja-light px-2 py-1.5 text-sm font-semibold text-maja-navy">
              {formatKm(liveKmGesamt)}
            </div>
          </div>

          {/* Auf Eis: Termin bewusst offen. Ein bereits eingetragenes
              Datum bleibt stehen und gilt als unverbindlich. */}
          <div className="sm:col-span-6 lg:col-span-12">
            <label className="tf-check">
              <input
                type="checkbox"
                checked={draft.aufEis}
                onChange={(e) => patchDraft({ aufEis: e.target.checked })}
              />
              Auf Eis legen — Termin noch offen
            </label>
            <p className="tf-hint">
              {draft.aufEis
                ? 'Die Tour findet statt, ist aber noch nicht terminiert. Datum darf leer bleiben; ein eingetragenes Datum ist unverbindlich. Die Tour bleibt über den Bereich „Auf Eis" in der Tourenliste auffindbar.'
                : 'Für Touren, die sicher stattfinden, aber noch kein festes Datum haben.'}
            </p>
          </div>
          {draft.aufEis && (
            <div className="sm:col-span-6 lg:col-span-12">
              <label className="tf-label">Notiz zur offenen Terminierung</label>
              <input className="tf-input"
                     placeholder="z.B. Kunde meldet sich Ende KW 34"
                     value={draft.aufEisNotiz}
                     onChange={(e) => patchDraft({ aufEisNotiz: e.target.value })} />
            </div>
          )}

          {/* Abrechnungs-Ausnahme — nur bei ABA. */}
          {isAba && (
            <div className="sm:col-span-6 lg:col-span-12">
              <label className="tf-check">
                <input
                  type="checkbox"
                  checked={draft.abaGesamtKm}
                  onChange={(e) => patchDraft({ abaGesamtKm: e.target.checked })}
                />
                Gesamt-km für Rechnung verwenden
              </label>
              <p className="tf-hint">
                Standard bei ABA ist die Berechnung nach Hinfahrt. Aktivieren,
                wenn dieser Auftraggeber die Gesamtstrecke abrechnet.
              </p>
            </div>
          )}
        </div>
      </TfBlock>

      {/* Protokoll */}
      <TfBlock titel="Protokoll">
        <ProtokollSection
          tourId={p.tourId ?? null}
          protokollArt={draft.protokollArt}
          greimelZugangId={draft.greimelZugangId}
          appNotiz={draft.appNotiz}
          onChange={(pp) => {
            const patch: Partial<EditDraft> = {};
            if ('protokoll_art' in pp) patch.protokollArt = pp.protokoll_art ?? null;
            if ('greimel_zugang_id' in pp) patch.greimelZugangId = pp.greimel_zugang_id ?? null;
            if ('app_notiz' in pp) patch.appNotiz = pp.app_notiz ?? '';
            patchDraft(patch);
          }}
          isGreimel={isGreimel}
          fahrerId={draft.fahrerId || null}
          templates={templates}
          zugaenge={zugaenge}
          externeApp={draftSelectedAg ? {
            name: draftSelectedAg.externe_app_name,
            url:  draftSelectedAg.externe_app_url,
          } : null}
        />
      </TfBlock>
    </div>
  );
}


// ---------- Finance-Field ----------

interface FinanceFieldProps {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  onCommit?: () => void;
  readOnly?: boolean;
}

function FinanceField({ label, value, onChange, onCommit, readOnly }: FinanceFieldProps) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-maja-muted">
        {label}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <input
          className="input"
          type="text"
          inputMode="decimal"
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange?.(e.target.value)}
          onBlur={() => onCommit?.()}
        />
        <span className="text-sm text-maja-muted">€</span>
      </div>
    </div>
  );
}

// ---------- Bereich 6: Fahrzeug & Adressen ----------

function VehicleAndAddressView({
  tour, hatRueckfuehrung, kontakte,
}: { tour: FullTour; hatRueckfuehrung: boolean; kontakte: KontaktMap }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <DetailItem label={hatRueckfuehrung ? 'Kennzeichen Hin' : 'Kennzeichen'}>
          {tour.kennzeichen?.[0] ?? '—'}
        </DetailItem>
        {hatRueckfuehrung && (
          <DetailItem label="Kennzeichen Rück">{tour.kennzeichen?.[1] ?? '—'}</DetailItem>
        )}
        <DetailItem label={hatRueckfuehrung ? 'FIN Hin' : 'FIN'}>{tour.fin || '—'}</DetailItem>
        {hatRueckfuehrung && (
          <DetailItem label="FIN Rück">{tour.fin_rueck || '—'}</DetailItem>
        )}
        {/* Optionale Felder nur zeigen, wenn gepflegt — sonst bliebe
            überall ein "—" stehen, das niemandem hilft. */}
        {tour.fahrzeugmodell && (
          <DetailItem label="Fahrzeugmodell">{tour.fahrzeugmodell}</DetailItem>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <AddressBlockView
          stadt={tour.start_stadt}
          adresse={effektiveAdresse(
            { strasse: tour.strasse_start, hausnummer: tour.hausnummer_start,
              plz: tour.plz_start, stadt: tour.start_stadt },
            tour.adresse_start,
          )}
          kontakte={kontakte.start}
          zeit={tour.zeit_start}
        />
        <AddressBlockView
          stadt={tour.ziel_stadt}
          adresse={effektiveAdresse(
            { strasse: tour.strasse_ziel, hausnummer: tour.hausnummer_ziel,
              plz: tour.plz_ziel, stadt: tour.ziel_stadt },
            tour.adresse_ziel,
          )}
          kontakte={kontakte.ziel}
          zeit={tour.zeit_ziel}
        />
        {hatRueckfuehrung && tour.rueckfuehrung_stadt && (
          <AddressBlockView
            stadt={tour.rueckfuehrung_stadt}
            adresse={effektiveAdresse(
              { strasse: tour.strasse_rueckfuehrung, hausnummer: tour.hausnummer_rueckfuehrung,
                plz: tour.plz_rueckfuehrung, stadt: tour.rueckfuehrung_stadt },
              tour.adresse_rueckfuehrung,
            )}
            kontakte={kontakte.rueckfuehrung}
          zeit={tour.zeit_rueckfuehrung}
          />
        )}
      </div>
    </>
  );
}

function AddressBlockView({
  stadt, adresse, kontakte, zeit,
}: {
  stadt: string;
  adresse: string | null;
  /** Alle Ansprechpartner der Station (Migration 080). */
  kontakte: KontaktEntwurf[];
  /** Freitext-Zeitangabe (Migration 081). */
  zeit: string | null;
}) {
  const gefuellt = kontakte.filter((k) => k.name || k.telefon || k.email);
  const zeitText = (zeit ?? '').trim();
  return (
    <div className="rounded-lg border border-maja-navy/10 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-maja-muted">
        {stadt}
      </div>
      <div className="mt-1 whitespace-pre-wrap text-sm text-maja-ink">
        {adresse || '—'}
      </div>
      {/* Zeit nur zeigen, wenn gepflegt. */}
      {zeitText && (
        <div className="mt-1 text-xs text-maja-muted">{zeitText}</div>
      )}
      <div className="mt-2 border-t border-maja-navy/10 pt-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-maja-muted">
          {gefuellt.length > 1 ? `Kontakte vor Ort (${gefuellt.length})` : 'Kontakt vor Ort'}
        </div>
        {gefuellt.length === 0 ? (
          <div className="mt-1 text-xs text-maja-muted">—</div>
        ) : (
          <ul className="mt-1 space-y-1">
            {gefuellt.map((k) => (
              <li key={k.key} className="text-sm text-maja-ink">
                <div>{k.name || '—'}</div>
                <div className="text-xs text-maja-muted">
                  {k.telefon ? (
                    <a href={`tel:${k.telefon}`} className="text-maja-accent hover:underline">{k.telefon}</a>
                  ) : '—'}
                  {' · '}
                  {k.email ? (
                    <a href={`mailto:${k.email}`} className="text-maja-accent hover:underline">{k.email}</a>
                  ) : '—'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RouteCalcRow({
  disabled, label, confirmKm, onClick,
}: {
  disabled: boolean;
  label: string;
  confirmKm?: number;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={disabled ? 'Adressen ausfüllen, dann verfügbar' : label}
        className="inline-flex items-center gap-1.5 rounded-md border border-maja-navy/20 bg-white px-3 py-1.5 text-xs font-medium text-maja-navy transition hover:bg-maja-light disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RouteIcon className="h-4 w-4" />
        {label}
      </button>
      {confirmKm != null && confirmKm > 0 && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
          <CheckIcon className="h-3.5 w-3.5" /> {confirmKm} km übernommen
        </span>
      )}
    </div>
  );
}

// ---------- Eingang-PDF-Downloads ----------

function EingangPdfDownloads({
  formular,
}: {
  /** Template wird seit dem pdf_paths-Umbau nicht mehr benötigt —
   *  bleibt in den Props der Aufrufer, hier aber ungenutzt. */
  template?: { id: string; name: string; pdfs: TemplatePdf[]; schema: unknown };
  formular: AusgefuelltesFormular;
}) {
  // NUR tatsächlich generierte PDFs (pdf_paths) verlinken — der frühere
  // Fallback auf die Template-Konfiguration zeigte Buttons für nie
  // erzeugte Dateien (Klick lief ins Leere).
  const persisted = asPdfPathList((formular as unknown as { pdf_paths?: unknown }).pdf_paths);
  const list = persisted.map((p) => ({
    id: p.pdf_id, name: p.pdf_name, filename: p.filename, onedrive_path: p.onedrive_path,
  }));
  if (list.length === 0) {
    return <span className="text-xs text-maja-muted">Noch keine PDFs generiert.</span>;
  }
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {list.map((p) => (
        <EingangPdfButton
          key={p.id}
          label={p.name}
          filename={p.filename}
          path={p.onedrive_path}
          formularId={formular.id}
        />
      ))}
    </div>
  );
}

function EingangPdfButton({
  label, filename, path, formularId,
}: { label: string; filename: string; path: string; formularId: string }) {
  const [busy, setBusy] = useState<'download' | 'preview' | null>(null);
  async function download() {
    setBusy('download');
    const ok = await downloadFormPdf(path, filename, formularId);
    setBusy(null);
    if (!ok) alert('PDF noch nicht generiert oder nicht erreichbar.');
  }
  async function preview() {
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

// ---------- Verknüpfte Eingänge (ein oder zwei Slots) ----------

type LinkedEingangProp = {
  formular: AusgefuelltesFormular;
  template: { id: string; name: string; pdfs: TemplatePdf[]; schema: unknown };
} | null;

function VerknuepfteEingaenge({
  tour, isAdmin, eingangAb, eingangBc, onUnlink, onLink,
}: {
  tour: FullTour;
  isAdmin: boolean;
  eingangAb: LinkedEingangProp;
  eingangBc: LinkedEingangProp;
  onUnlink: (slot: 'ab' | 'bc') => void;
  onLink: (slot: 'ab' | 'bc') => void;
}) {
  const twoSlots = hasTwoProtokollSlots(tour.tourenart);

  // AB-only-Touren: alte UI beibehalten — nur rendern, wenn auch verknüpft.
  if (!twoSlots) {
    if (!eingangAb) return null;
    return (
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-maja-navy">Verknüpfter Eingang</h3>
          {isAdmin && (
            <button
              type="button"
              onClick={() => onUnlink('ab')}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              <XIcon className="h-3.5 w-3.5" />
              Verknüpfung lösen
            </button>
          )}
        </div>
        <EingangSlot eingang={eingangAb} />
      </div>
    );
  }

  // ABA/ABC: zwei Slots, jeweils mit eigenem Verknüpfen-/Lösen-Button.
  const labels = abschnittLabels(tour);
  return (
    <div className="mt-6">
      <h3 className="mb-2 text-base font-semibold text-maja-navy">Verknüpfte Eingänge</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <EingangSlotCard
          title={`${labels.ab.short}: ${labels.ab.route}`}
          eingang={eingangAb}
          isAdmin={isAdmin}
          onUnlink={() => onUnlink('ab')}
          onLink={() => onLink('ab')}
        />
        <EingangSlotCard
          title={`${labels.bc.short}: ${labels.bc.route}`}
          eingang={eingangBc}
          isAdmin={isAdmin}
          onUnlink={() => onUnlink('bc')}
          onLink={() => onLink('bc')}
        />
      </div>
    </div>
  );
}

function EingangSlotCard({
  title, eingang, isAdmin, onUnlink, onLink,
}: {
  title: string;
  eingang: LinkedEingangProp;
  isAdmin: boolean;
  onUnlink: () => void;
  onLink: () => void;
}) {
  return (
    <div className="rounded-lg border border-maja-navy/10 bg-white p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-maja-muted">
          {title}
        </div>
        {eingang ? (
          isAdmin && (
            <button
              type="button"
              onClick={onUnlink}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              <XIcon className="h-3.5 w-3.5" />
              Lösen
            </button>
          )
        ) : (
          isAdmin && (
            <button
              type="button"
              onClick={onLink}
              className="inline-flex items-center gap-1 rounded-md bg-maja-navy px-2 py-1 text-xs font-medium text-white hover:bg-maja-accent"
            >
              Verknüpfen
            </button>
          )
        )}
      </div>
      {eingang ? (
        <EingangSlot eingang={eingang} />
      ) : (
        <p className="text-xs text-maja-muted">Noch nicht verknüpft.</p>
      )}
    </div>
  );
}

function EingangSlot({ eingang }: { eingang: NonNullable<LinkedEingangProp> }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="font-medium text-maja-ink">{eingang.template.name}</div>
        <div className="text-xs text-maja-muted">
          {eingang.formular.created_at
            ? new Date(eingang.formular.created_at).toLocaleString('de-DE')
            : '—'}
        </div>
      </div>
      <EingangPdfDownloads
        template={eingang.template}
        formular={eingang.formular}
      />
    </div>
  );
}

/**
 * Aus dem Tour-Detail heraus startet der Admin die Verknüpfung über den
 * normalen "Eingänge"-Reiter — dort gibt es bereits die volle Logik
 * (AB/BC-Picker, Daten-Übernahme) inklusive Suche nach Formularen.
 * Direkt im Tour-Detail einen weiteren EingangLinkDialog einzubetten
 * wäre redundant, da dieser ein konkretes Formular als Pflichteingabe
 * braucht.
 */
function RelinkLauncher({
  onClose, onLinked,
}: {
  tour: FullTour;
  slot: 'ab' | 'bc';
  onClose: () => void;
  onLinked: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-maja-ink/40 px-4">
      <div className="card w-full max-w-md p-5">
        <h3 className="text-base font-semibold text-maja-navy">Eingang verknüpfen</h3>
        <p className="mt-2 text-sm text-maja-ink">
          Öffne den Reiter <strong>Eingänge</strong>, wähle das gewünschte
          Formular und klicke dort auf <em>Mit Tour verknüpfen</em>. Bei
          ABA/ABC-Touren wirst du gefragt, welcher Streckenabschnitt
          befüllt werden soll.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>OK</button>
          <button type="button" className="btn-primary" onClick={onLinked}>Aktualisieren</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Read-only-Anzeige aller Protokoll-Zuweisungen der Tour. Liest direkt
 * aus tour_protokoll_zuweisungen — gerendert wird nur die Liste der
 * Template-Namen, das Editieren passiert ausschließlich im Edit-Modus
 * über die `ProtokollSection`.
 */
/**
 * Read-only Anzeige der Rechnung(en), auf denen diese Tour als Position
 * verwendet wird. Automatisch aus rechnungspositionen.tour_id →
 * rechnungen ermittelt — NICHT ins manuelle Info-Feld geschrieben.
 * Rendert nichts, solange keine Verknüpfung besteht. Nur Admin (Aufrufer
 * gated), daher ist der RLS-Lesezugriff auf Rechnungen unkritisch.
 */
function ViewModeRechnungsRef({ tourId }: { tourId: string }) {
  const [nummern, setNummern] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('rechnungspositionen')
        .select('rechnung:rechnung_id (id, rechnungsnummer)')
        .eq('tour_id', tourId);
      if (cancelled) return;
      type Row = { rechnung: { id: string; rechnungsnummer: string } | null };
      const seen = new Set<string>();
      const list: string[] = [];
      for (const r of (data as unknown as Row[]) ?? []) {
        const re = r.rechnung;
        if (!re || seen.has(re.id)) continue;
        seen.add(re.id);
        list.push(re.rechnungsnummer);
      }
      setNummern(list);
    })();
    return () => { cancelled = true; };
  }, [tourId]);
  if (nummern.length === 0) return null;
  return (
    <DetailItem label={nummern.length > 1 ? 'Auf Rechnungen' : 'Auf Rechnung'} full>
      <span className="font-medium">{nummern.join(', ')}</span>
    </DetailItem>
  );
}

function ViewModeProtokollList({ tourId }: { tourId: string }) {
  const [items, setItems] = useState<TourProtokollZuweisung[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await loadTourProtokollZuweisungen(tourId);
      if (cancelled) return;
      setItems(list);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tourId]);
  if (loading) return <div className="text-maja-muted text-sm">Lade …</div>;
  if (items.length === 0) {
    return <div className="text-maja-muted text-sm">Noch kein Protokoll verknüpft.</div>;
  }
  return (
    <ul className="space-y-0.5 text-sm">
      {items.map((a) => (
        <li key={a.id} className="text-maja-ink">
          <span className="font-medium">{a.template_name}</span>
          {a.vorgefuellte_daten && Object.keys(a.vorgefuellte_daten).length > 0 && (
            <span className="ml-2 text-xs text-maja-muted">
              ({Object.keys(a.vorgefuellte_daten).length} Vorgabe(n))
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

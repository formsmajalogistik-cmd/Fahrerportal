import {
  useCallback, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import { useFahrerContext } from '../../auth/FahrerContext';
import { Spinner } from '../../components/Spinner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { fahrerName } from '../../lib/names';

function fahrerNameOf(f: { vorname: string | null; nachname: string | null; user: { email: string; vorname: string | null; nachname: string | null } | null }): string {
  return fahrerName(f, f.user);
}
import {
  computeKmGesamt, computeTourStatus, fetchTourPriceBreakdown,
  formatDate, formatEuro, formatKm, tourTitel, type TourPriceBreakdown,
} from '../../lib/touren';
import {
  downloadFormPdf, expectedOneDrivePath, resolveFilename,
} from '../../lib/pdfGenerate';
import { assignFahrerToZugang, isGreimelAuftraggeber, unassignFahrerFromZugang } from '../../lib/greimel';
import { FahrerSelect, type FahrerOptionRaw } from './FahrerSelect';
import { ProtokollSection } from './ProtokollSection';
import type {
  AppUser, Auftraggeber, AuftraggeberKontakt, AusgefuelltesFormular, Fahrer,
  FormularTemplate, GreimelZugang, ProtokollArt, TemplatePdf, Tour, TourenArt,
  TourStatus, TourZusatz,
} from '../../types/db';

type FahrerWithUser = Pick<Fahrer, 'id' | 'user_id' | 'aktiv' | 'vorname' | 'nachname' | 'ist_unterkonto' | 'haupt_user_id'> & {
  user: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null;
};

interface FullTour extends Tour {
  auftraggeber: Pick<Auftraggeber, 'id' | 'name' | 'kontakt'> | null;
  fahrer: FahrerWithUser | null;
  kontakt: AuftraggeberKontakt | null;
}

interface Props {
  tourId: string;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
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

const ZUSATZ_KATEGORIEN = [
  'Maut', 'Ladezeit', 'Wartezeit', 'Rote Kennzeichen', 'Reifenhandling',
  'Wäsche', 'Tankauslagen', 'Ladeauslagen', 'Waschauslagen',
  'Tank und Waschauslagen', 'Lade und Waschauslagen', 'Taxiauslagen',
];

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
      auftraggeber:auftraggeber_id (id, name, kontakt),
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
    greimel_zugang_id, ist_e_fahrzeug, fin, kontakt_id, eingang_id,
    kontakt_start, kontakt_ziel, kontakt_rueckfuehrung, app_notiz,
    created_at, updated_at,
    auftraggeber:auftraggeber_id (id, name, kontakt),
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
  kmGesamtAba: string;
  startdatum: string;
  enddatum: string;
  kennzeichenHin: string;
  kennzeichenRueck: string;
  istSondervereinbarung: boolean;
  sondervereinbarung: string;
  kundenname: string;
  verguetung: string;
  info: string;
  adresseStart: string;
  adresseZiel: string;
  adresseRueckfuehrung: string;
  protokollArt: ProtokollArt | null;
  schriftlichesProtokollId: string | null;
  greimelZugangId: string | null;
  istEFahrzeug: boolean;
  fin: string;
  kontaktId: string;
  appNotiz: string;
  // Kontakt pro Adresse (Start / Ziel / Rückführung)
  kontaktStartName: string;
  kontaktStartTelefon: string;
  kontaktStartEmail: string;
  kontaktZielName: string;
  kontaktZielTelefon: string;
  kontaktZielEmail: string;
  kontaktRueckName: string;
  kontaktRueckTelefon: string;
  kontaktRueckEmail: string;
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
    startStadt: t.start_stadt,
    zielStadt: t.ziel_stadt,
    rueckfuehrungStadt: t.rueckfuehrung_stadt ?? '',
    hatRueckfuehrung: hat,
    kmHin: intToInput(t.km_hin),
    kmRueck: intToInput(t.km_rueck),
    kmGesamtAba: isAba ? intToInput(t.km_hin ?? t.km_gesamt) : '',
    startdatum: isoToLocalInput(t.startdatum),
    enddatum: isoToLocalInput(t.enddatum),
    kennzeichenHin: kz[0] ?? '',
    kennzeichenRueck: kz[1] ?? '',
    istSondervereinbarung: !!t.ist_sondervereinbarung,
    sondervereinbarung: t.sondervereinbarung ?? '',
    kundenname: t.kundenname ?? '',
    verguetung: decimalToInput(t.verguetung),
    info: t.info ?? '',
    adresseStart: t.adresse_start ?? '',
    adresseZiel: t.adresse_ziel ?? '',
    adresseRueckfuehrung: t.adresse_rueckfuehrung ?? '',
    protokollArt: t.protokoll_art ?? null,
    schriftlichesProtokollId: t.schriftliches_protokoll_id ?? null,
    greimelZugangId: t.greimel_zugang_id ?? null,
    istEFahrzeug: !!t.ist_e_fahrzeug,
    fin: t.fin ?? '',
    kontaktId: t.kontakt_id ?? '',
    appNotiz: t.app_notiz ?? '',
    kontaktStartName:    readKontaktField(t.kontakt_start, 'name'),
    kontaktStartTelefon: readKontaktField(t.kontakt_start, 'telefon'),
    kontaktStartEmail:   readKontaktField(t.kontakt_start, 'email'),
    kontaktZielName:     readKontaktField(t.kontakt_ziel, 'name'),
    kontaktZielTelefon:  readKontaktField(t.kontakt_ziel, 'telefon'),
    kontaktZielEmail:    readKontaktField(t.kontakt_ziel, 'email'),
    kontaktRueckName:    readKontaktField(t.kontakt_rueckfuehrung, 'name'),
    kontaktRueckTelefon: readKontaktField(t.kontakt_rueckfuehrung, 'telefon'),
    kontaktRueckEmail:   readKontaktField(t.kontakt_rueckfuehrung, 'email'),
    rechnungsdatumAbweichend: !!t.rechnungsdatum_abweichend,
    rechnungsdatum: isoToLocalInput(t.rechnungsdatum),
  };
}

function readKontaktField(raw: unknown, key: 'name' | 'telefon' | 'email'): string {
  if (raw && typeof raw === 'object') {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'string') return v;
  }
  return '';
}

function kontaktFromDraft(
  name: string, telefon: string, email: string,
): { name: string; telefon: string; email: string } | null {
  const n = name.trim(); const t = telefon.trim(); const e = email.trim();
  if (!n && !t && !e) return null;
  return { name: n, telefon: t, email: e };
}

// ---------- Component ----------

export function TourDetailDialog({ tourId, onClose, onChanged, onDeleted }: Props) {
  const { profile } = useAuth();
  const fahrerCtx = useFahrerContext();
  const isAdmin = profile?.role === 'admin';

  const [tour, setTour] = useState<FullTour | null>(null);
  const [zusaetze, setZusaetze] = useState<TourZusatz[]>([]);
  const [auftraggeber, setAuftraggeber] = useState<Auftraggeber[]>([]);
  const [fahrer, setFahrer] = useState<FahrerWithUser[]>([]);
  const [templates, setTemplates] = useState<Array<Pick<FormularTemplate, 'id' | 'name'>>>([]);
  const [zugaenge, setZugaenge] = useState<GreimelZugang[]>([]);

  // Verknüpfter Eingang (ausgefuelltes_formular) inklusive Template — wird
  // gelesen, sobald tour.eingang_id gesetzt ist, um die PDF-Downloads
  // direkt im Tour-Detail anbieten zu können.
  const [eingang, setEingang] = useState<{
    formular: AusgefuelltesFormular;
    template: { id: string; name: string; pdfs: TemplatePdf[]; schema: unknown };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [unlinkBusy, setUnlinkBusy] = useState(false);

  // Barauslagen / Fahrer-Honorar (separate Auto-Save Felder)
  const [barauslagenInput, setBarauslagenInput] = useState('');
  const [honorarInput, setHonorarInput] = useState('');

  // Zusatz-Eingabe
  const [neueKategorie, setNeueKategorie] = useState('');
  const [neueAnzahl, setNeueAnzahl]       = useState<string>('1');
  const [neuerBetrag, setNeuerBetrag]     = useState('');
  const [neueNotiz, setNeueNotiz]         = useState('');
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
      supabase.from('auftraggeber').select('*').order('name'),
      supabase
        .from('fahrer')
        .select('id, user_id, aktiv, vorname, nachname, ist_unterkonto, haupt_user_id, user:user_id (email, vorname, nachname)')
        .eq('aktiv', true),
      supabase.from('formular_templates').select('id, name').order('name'),
      supabase.from('greimel_zugaenge').select('*').order('titel'),
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
    setAuftraggeber(Array.isArray(agRes.data) ? agRes.data : []);
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
    setZugaenge(Array.isArray(gzRes.data) ? (gzRes.data as GreimelZugang[]) : []);

    // Optional: zugehörigen Eingang + Template laden.
    if (full.eingang_id) {
      const { data: eingangRow } = await supabase
        .from('ausgefuellte_formulare')
        .select('*, template:template_id (id, name, pdfs, schema)')
        .eq('id', full.eingang_id)
        .maybeSingle();
      if (eingangRow && eingangRow.template) {
        setEingang({
          formular: eingangRow as unknown as AusgefuelltesFormular,
          template: (eingangRow as unknown as { template: { id: string; name: string; pdfs: TemplatePdf[]; schema: unknown } }).template,
        });
      } else {
        setEingang(null);
      }
    } else {
      setEingang(null);
    }
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

  function cancelEdit() {
    setEditing(false);
    setDraft(null);
    setStatusMsg(null);
  }

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
        adresseRueckfuehrung: '',
      });
    } else {
      patchDraft({ hatRueckfuehrung: true });
    }
  }

  const draftIsAba = draft?.tourenart === 'ABA';

  const liveKmGesamt = useMemo(() => {
    if (!draft) return null;
    if (draftIsAba) return parseInteger(draft.kmGesamtAba);
    return computeKmGesamt({
      km_hin: parseInteger(draft.kmHin),
      km_rueck: parseInteger(draft.kmRueck),
      hatRueckfuehrung: draft.hatRueckfuehrung,
    });
  }, [draft, draftIsAba]);

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
    if (!draft.auftraggeberId || liveKmGesamt == null) { setBreakdown(null); return; }
    let cancelled = false;
    setPricing(true);
    void fetchTourPriceBreakdown({
      auftraggeberId: draft.auftraggeberId,
      km: liveKmGesamt,
      tourenart: (draft.tourenart || 'AB') as TourenArt,
      istEFahrzeug: draft.istEFahrzeug,
    }).then((b) => {
      if (cancelled) return;
      setBreakdown(b);
      setPricing(false);
    });
    return () => { cancelled = true; };
  }, [editing, draft, liveKmGesamt]);

  // Breakdown für die View-Anzeige (Aufschlüsselung zum gespeicherten Preis).
  const [viewBreakdown, setViewBreakdown] = useState<TourPriceBreakdown | null>(null);
  useEffect(() => {
    if (!tour || tour.ist_sondervereinbarung) { setViewBreakdown(null); return; }
    if (!tour.auftraggeber_id || tour.km_gesamt == null) { setViewBreakdown(null); return; }
    let cancelled = false;
    void fetchTourPriceBreakdown({
      auftraggeberId: tour.auftraggeber_id,
      km: tour.km_gesamt,
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

  async function handleSave() {
    if (!draft || !tour) return;

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

    let km_hin: number | null;
    let km_rueck: number | null;
    if (draftIsAba) {
      km_hin = parseInteger(draft.kmGesamtAba);
      km_rueck = null;
    } else {
      km_hin = parseInteger(draft.kmHin);
      km_rueck = draft.hatRueckfuehrung ? parseInteger(draft.kmRueck) : null;
    }

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
    const draftDateStart = (draft.startdatum || tour.startdatum) as string;
    const draftDateEnd   = (draft.enddatum   || tour.enddatum)   as string;
    if (!draft.startdatum || !draft.enddatum) {
      setStatusMsg({ kind: 'err', text: 'Start- und Enddatum sind Pflichtfelder.' });
      setSaving(false);
      return;
    }
    const willComplete = computeTourStatus(draftDateStart, draftDateEnd) === 'abgeschlossen';

    let nextGreimelId: string | null = null;
    if (draft.protokollArt === 'app' && isGreimelTour && !willComplete) {
      nextGreimelId = draft.greimelZugangId ?? null;
    }
    const nextSchriftlichesId = draft.protokollArt === 'schriftlich'
      ? (draft.schriftlichesProtokollId ?? null)
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
        adresse_start: draft.adresseStart.trim() || null,
        adresse_ziel: draft.adresseZiel.trim() || null,
        adresse_rueckfuehrung: draft.hatRueckfuehrung
          ? (draft.adresseRueckfuehrung.trim() || null)
          : null,
        ist_e_fahrzeug: draft.istEFahrzeug,
        fin: draft.fin.trim() || null,
        protokoll_art: draft.protokollArt,
        schriftliches_protokoll_id: nextSchriftlichesId,
        greimel_zugang_id: nextGreimelId,
        app_notiz: draft.protokollArt === 'app' && draft.appNotiz.trim()
          ? draft.appNotiz.trim() : null,
        kontakt_start: kontaktFromDraft(
          draft.kontaktStartName, draft.kontaktStartTelefon, draft.kontaktStartEmail,
        ),
        kontakt_ziel: kontaktFromDraft(
          draft.kontaktZielName, draft.kontaktZielTelefon, draft.kontaktZielEmail,
        ),
        kontakt_rueckfuehrung: draft.hatRueckfuehrung
          ? kontaktFromDraft(
            draft.kontaktRueckName, draft.kontaktRueckTelefon, draft.kontaktRueckEmail,
          )
          : null,
        rechnungsdatum_abweichend: draft.rechnungsdatumAbweichend,
        rechnungsdatum: draft.rechnungsdatumAbweichend && draft.rechnungsdatum
          ? draft.rechnungsdatum
          : null,
      })
      .eq('id', tour.id);
    if (err) { setSaving(false); setStatusMsg({ kind: 'err', text: err.message }); return; }

    // Greimel-Zugang Zuweisung synchron halten:
    // - Wenn Tour 'abgeschlossen' wurde → vorherige Zuweisung freigeben.
    // - Wenn neuer Zugang gewählt → Fahrer hinzufügen.
    // - Wenn Zugang gewechselt/entfernt → vorherigen Fahrer entfernen.
    try {
      if (willComplete && previousGreimelId && previousFahrerId) {
        await unassignFahrerFromZugang(previousGreimelId, previousFahrerId);
      } else if (previousGreimelId && previousGreimelId !== nextGreimelId && previousFahrerId) {
        await unassignFahrerFromZugang(previousGreimelId, previousFahrerId);
      }
      if (nextGreimelId && draft.fahrerId && nextGreimelId !== previousGreimelId) {
        await assignFahrerToZugang(nextGreimelId, draft.fahrerId);
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
    const anzahlNum = parseInt(neueAnzahl, 10);
    const anzahl = Number.isFinite(anzahlNum) && anzahlNum >= 1 ? anzahlNum : 1;
    setAddingZusatz(true);
    const { data, error: err } = await supabase
      .from('tour_zusaetze')
      .insert({
        tour_id: tour.id,
        kategorie,
        anzahl,
        betrag,
        notiz: neueNotiz.trim() || null,
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
    setStatusMsg(null);
    onChanged();
  }

  async function handleDeleteZusatz(id: string) {
    if (!isAdmin) return;
    const { error: err } = await supabase.from('tour_zusaetze').delete().eq('id', id);
    if (err) { setStatusMsg({ kind: 'err', text: err.message }); return; }
    setZusaetze((z) => z.filter((x) => x.id !== id));
    onChanged();
  }

  // ----- Tour löschen -----

  async function handleDeleteTour() {
    if (!tour) return;
    const { error: err } = await supabase.from('touren').delete().eq('id', tour.id);
    if (err) throw err;
    onDeleted();
  }

  // ----- Protokoll-Verknüpfung lösen -----

  /**
   * Löst die Verknüpfung Tour ↔ Eingang/Protokoll und setzt — auf Wunsch —
   * die durch das Protokoll befüllten Felder zurück.
   *
   * resetFields=true:  Felder aus protokoll_daten_felder zurücksetzen
   *                    (oder bei Legacy-Touren ohne Tracking: die
   *                    Standard-Protokoll-Felder).
   * resetFields=false: nur eingang_id auf null, Daten bleiben stehen.
   */
  async function handleUnlinkProtokoll(resetFields: boolean) {
    if (!tour || !isAdmin) return;
    setUnlinkBusy(true);
    setError(null);
    const tracked = tour.protokoll_daten_felder ?? [];
    const fieldsToReset = resetFields
      ? (tracked.length > 0 ? tracked : DEFAULT_PROTOKOLL_FIELDS)
      : [];
    const patch: Record<string, unknown> = {
      eingang_id: null,
      protokoll_daten_felder: [],
    };
    for (const f of fieldsToReset) {
      patch[f] = f === 'kennzeichen' ? [] : null;
    }
    const { error: err } = await supabase
      .from('touren')
      .update(patch as never)
      .eq('id', tour.id);
    setUnlinkBusy(false);
    if (err) { setError(err.message); return; }
    setUnlinkOpen(false);
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
      <Shell onClose={onClose}>
        <Spinner label="Tour wird geladen …" />
      </Shell>
    );
  }
  if (error || !tour) {
    return (
      <Shell onClose={onClose}>
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
    <Shell onClose={onClose}>
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
          ✕
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
        <ViewMode tour={tour} fahrerName={fahrerLabel} hatRueckfuehrung={hatRueckfuehrung} templates={templates} zugaenge={zugaenge} isAdmin={isAdmin} viewBreakdown={viewBreakdown} />
      ) : (
        <EditMode
          draft={draft}
          patchDraft={patchDraft}
          toggleRueckfuehrung={toggleRueckfuehrung}
          liveKmGesamt={liveKmGesamt}
          auftraggeber={auftraggeber}
          fahrer={fahrer}
          draftSelectedAg={draftSelectedAg}
          breakdown={breakdown}
          pricing={pricing}
          templates={templates}
          zugaenge={zugaenge}
          kontakte={editKontakte}
        />
      )}

      {/* Verknüpfter Eingang — PDF-Downloads */}
      {eingang && (
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-maja-navy">Verknüpfter Eingang</h3>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setUnlinkOpen(true)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                ✕ Verknüpfung lösen
              </button>
            )}
          </div>
          <div className="rounded-lg border border-maja-navy/10 bg-white p-3 text-sm">
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
          </div>
        </div>
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

        {isAdmin && (
          <div className="card mb-3 space-y-3 p-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_5rem_8rem_1fr_auto] sm:items-end">
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
                  type="number"
                  min={1}
                  step={1}
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
                disabled={addingZusatz || !neueKategorie || !neuerBetrag}
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
        )}

        {(zusaetze ?? []).length === 0 ? (
          <p className="text-sm text-maja-muted">Noch keine Zusätze erfasst.</p>
        ) : (
          <div className="card overflow-hidden">
            <ul className="divide-y divide-maja-navy/10">
              {(zusaetze ?? []).map((z) => {
                const anzahl = Math.max(1, Math.round(Number(z.anzahl ?? 1)));
                const betrag = Number(z.betrag);
                const gesamt = Math.round(betrag * anzahl * 100) / 100;
                return (
                  <li key={z.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="text-maja-ink">
                        <span className="font-medium">{z.kategorie}</span>
                        <span className="text-maja-muted"> — </span>
                        {anzahl > 1 ? (
                          <>
                            {anzahl} × {formatEuro(betrag)} = <span className="font-semibold">{formatEuro(gesamt)}</span>
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
                        ✕
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
                    (acc, z) => acc + Number(z.betrag) * Math.max(1, Math.round(Number(z.anzahl ?? 1))),
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

      {/* Bereich 6: Fahrzeug & Adressen */}
      <div className="mt-6 space-y-4">
        <h3 className="border-b border-maja-navy/10 pb-2 text-base font-semibold text-maja-navy">
          Fahrzeug & Adressen
        </h3>
        {!editing || !draft ? (
          <VehicleAndAddressView
            tour={tour}
            hatRueckfuehrung={hatRueckfuehrung}
          />
        ) : (
          <VehicleAndAddressEdit
            draft={draft}
            patchDraft={patchDraft}
          />
        )}
      </div>

      {/* Footer */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-maja-navy/10 pt-4">
        {isAdmin && !editing && (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            Löschen
          </button>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {editing ? (
            <>
              <button type="button" onClick={cancelEdit} className="btn-secondary" disabled={saving}>
                Abbrechen
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
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
              {isAdmin && (
                <button type="button" onClick={startEdit} className="btn-primary">
                  Bearbeiten
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Tour löschen?"
          message={
            <>
              Soll Tour <strong>{tour.tour_id ?? tour.id.slice(0, 8)}</strong> wirklich
              gelöscht werden? Alle erfassten Zusätze werden mitgelöscht.
            </>
          }
          confirmLabel="Löschen"
          destructive
          onConfirm={handleDeleteTour}
          onClose={() => setConfirmDelete(false)}
        />
      )}

      {unlinkOpen && (
        <UnlinkProtokollDialog
          fields={tour.protokoll_daten_felder ?? []}
          busy={unlinkBusy}
          onConfirm={(reset) => void handleUnlinkProtokoll(reset)}
          onClose={() => setUnlinkOpen(false)}
        />
      )}
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

function Shell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  // ESC schließt
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-3xl p-6">
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
  templates: Array<Pick<FormularTemplate, 'id' | 'name'>>;
  zugaenge: GreimelZugang[];
  isAdmin: boolean;
  viewBreakdown: TourPriceBreakdown | null;
}

function ViewMode({ tour, fahrerName, hatRueckfuehrung, templates, zugaenge, isAdmin, viewBreakdown }: ViewModeProps) {
  const linkedTemplate = templates.find((t) => t.id === tour.schriftliches_protokoll_id) ?? null;
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
      </div>

      {/* Bereich 3: Protokoll */}
      <SectionHeader title="Protokoll" />
      <div className="rounded-lg border border-maja-navy/10 p-3 text-sm text-maja-ink">
        {tour.protokoll_art == null ? (
          <span className="text-maja-muted">Noch nicht festgelegt.</span>
        ) : tour.protokoll_art === 'app' ? (
          <div className="space-y-2">
            <div className="font-medium">App</div>
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
            <div className="text-maja-muted">
              {linkedTemplate
                ? <>Verknüpft: <span className="font-medium text-maja-ink">{linkedTemplate.name}</span></>
                : 'Noch kein Protokoll verknüpft.'}
            </div>
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
  auftraggeber: Auftraggeber[];
  fahrer: FahrerWithUser[];
  draftSelectedAg: Auftraggeber | null;
  breakdown: TourPriceBreakdown | null;
  pricing: boolean;
  templates: Array<Pick<FormularTemplate, 'id' | 'name'>>;
  zugaenge: GreimelZugang[];
  kontakte: AuftraggeberKontakt[];
}

function EditMode(p: EditModeProps) {
  const { draft, patchDraft, toggleRueckfuehrung, liveKmGesamt, auftraggeber, fahrer, draftSelectedAg, breakdown, pricing, templates, zugaenge, kontakte } = p;
  const isGreimel = isGreimelAuftraggeber(draftSelectedAg);
  // Live-Status aus dem Datum (analog zur Anzeige in der Liste).
  const computedStatus = computeTourStatus(draft.startdatum || null, draft.enddatum || null);
  return (
    <div className="space-y-5">
      <div className="rounded-md bg-maja-light/60 p-3 text-xs text-maja-muted">
        Status wird automatisch aus dem Startdatum berechnet:{' '}
        <span className={`ml-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[computedStatus]}`}>
          {STATUS_LABEL[computedStatus]}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Fahrer</label>
          <FahrerSelect
            value={draft.fahrerId}
            onChange={(id) => patchDraft({ fahrerId: id })}
            fahrer={fahrer as FahrerOptionRaw[]}
          />
        </div>
        <div>
          <label className="label">Auftraggeber</label>
          <select className="input" value={draft.auftraggeberId}
                  onChange={(e) => patchDraft({ auftraggeberId: e.target.value, kontaktId: '' })}>
            <option value="">— kein Auftraggeber —</option>
            {(auftraggeber ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Tourenart</label>
          <select className="input" value={draft.tourenart}
                  onChange={(e) => patchDraft({ tourenart: e.target.value as TourenArt | '' })}>
            <option value="">—</option>
            <option value="AB">AB</option>
            <option value="ABC">ABC</option>
            <option value="ABA">ABA</option>
          </select>
        </div>
        {draft.auftraggeberId && kontakte.length > 0 && (
          <div className="sm:col-span-2">
            <label className="label">Rechnungsempfänger</label>
            <select className="input" value={draft.kontaktId}
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
        <div>
          <label className="label">Start-Stadt *</label>
          <input className="input" value={draft.startStadt}
                 onChange={(e) => patchDraft({ startStadt: e.target.value })} />
        </div>
        <div>
          <label className="label">Ziel-Stadt *</label>
          <input className="input" value={draft.zielStadt}
                 onChange={(e) => patchDraft({ zielStadt: e.target.value })} />
        </div>
      </div>

      {/* Rückführung */}
      {!draft.hatRueckfuehrung ? (
        <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={toggleRueckfuehrung}>
          + Rückführung
        </button>
      ) : (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="label mb-0">Rückführung-Stadt</label>
            <button
              type="button"
              onClick={toggleRueckfuehrung}
              className="text-xs font-medium text-red-600 hover:underline"
            >
              Rückführung entfernen
            </button>
          </div>
          <input className="input" value={draft.rueckfuehrungStadt}
                 onChange={(e) => patchDraft({ rueckfuehrungStadt: e.target.value })} />
        </div>
      )}

      {/* km */}
      {draft.tourenart === 'ABA' ? (
        <div>
          <label className="label">Kilometer gesamt</label>
          <input
            className="input"
            type="number"
            min={0}
            step={1}
            value={draft.kmGesamtAba}
            onChange={(e) => patchDraft({ kmGesamtAba: e.target.value })}
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label">km Hin</label>
            <input className="input" type="number" min={0} step={1}
                   value={draft.kmHin}
                   onChange={(e) => patchDraft({ kmHin: e.target.value })} />
          </div>
          {draft.hatRueckfuehrung && (
            <div>
              <label className="label">km Rück</label>
              <input className="input" type="number" min={0} step={1}
                     value={draft.kmRueck}
                     onChange={(e) => patchDraft({ kmRueck: e.target.value })} />
            </div>
          )}
          <div>
            <label className="label">km Gesamt</label>
            <input
              className="input bg-maja-light"
              value={liveKmGesamt == null ? '' : String(liveKmGesamt)}
              readOnly
            />
          </div>
        </div>
      )}

      {/* Datum */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Startdatum <span className="text-red-600">*</span></label>
          <input type="date" className="input" required value={draft.startdatum}
                 onChange={(e) => patchDraft({ startdatum: e.target.value })} />
        </div>
        <div>
          <label className="label">Enddatum <span className="text-red-600">*</span></label>
          <input type="date" className="input" required value={draft.enddatum}
                 onChange={(e) => patchDraft({ enddatum: e.target.value })} />
        </div>
      </div>

      {/* Rechnungsdatum (optional, abweichend vom Tourendatum) — Admin-only */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-maja-ink">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy focus:ring-maja-accent"
            checked={draft.rechnungsdatumAbweichend}
            onChange={(e) => patchDraft({
              rechnungsdatumAbweichend: e.target.checked,
              rechnungsdatum: e.target.checked ? draft.rechnungsdatum : '',
            })}
          />
          Rechnungsdatum abweichend vom Tourendatum
        </label>
        {draft.rechnungsdatumAbweichend && (
          <div>
            <label className="label">Rechnungsdatum</label>
            <input type="date" className="input" value={draft.rechnungsdatum}
                   onChange={(e) => patchDraft({ rechnungsdatum: e.target.value })} />
          </div>
        )}
      </div>

      {/* Protokoll */}
      <ProtokollSection
        protokollArt={draft.protokollArt}
        schriftlichesProtokollId={draft.schriftlichesProtokollId}
        greimelZugangId={draft.greimelZugangId}
        appNotiz={draft.appNotiz}
        onChange={(p) => {
          const patch: Partial<EditDraft> = {};
          if ('protokoll_art' in p) patch.protokollArt = p.protokoll_art ?? null;
          if ('schriftliches_protokoll_id' in p) patch.schriftlichesProtokollId = p.schriftliches_protokoll_id ?? null;
          if ('greimel_zugang_id' in p) patch.greimelZugangId = p.greimel_zugang_id ?? null;
          if ('app_notiz' in p) patch.appNotiz = p.app_notiz ?? '';
          patchDraft(patch);
        }}
        isGreimel={isGreimel}
        fahrerId={draft.fahrerId || null}
        templates={templates}
        zugaenge={zugaenge}
      />

      {/* E-Fahrzeug-Checkbox (FIN, Kennzeichen, Adressen sind in Bereich 6) */}
      <label className="flex items-center gap-2 text-sm font-medium text-maja-ink">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy focus:ring-maja-accent"
          checked={draft.istEFahrzeug}
          onChange={(e) => patchDraft({ istEFahrzeug: e.target.checked })}
        />
        E-Fahrzeug
      </label>

      {/* Sondervereinbarung */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-maja-ink">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy focus:ring-maja-accent"
            checked={draft.istSondervereinbarung}
            onChange={(e) => patchDraft({ istSondervereinbarung: e.target.checked })}
          />
          Sondervereinbarung
        </label>
        {draft.istSondervereinbarung && (
          <div>
            <label className="label">Anmerkung zur Sondervereinbarung</label>
            <input className="input" value={draft.sondervereinbarung}
                   onChange={(e) => patchDraft({ sondervereinbarung: e.target.value })} />
          </div>
        )}
      </div>

      {/* Vergütung + Kundenname */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Vergütung (€)</label>
          {draft.istSondervereinbarung ? (
            <>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                value={draft.verguetung}
                onChange={(e) => patchDraft({ verguetung: e.target.value })}
              />
              <p className="mt-1 text-xs text-maja-muted">
                Manueller Preis (Sondervereinbarung aktiv).
              </p>
            </>
          ) : (
            <>
              <input
                className="input bg-maja-light"
                type="text"
                readOnly
                value={pricing ? '…' : (breakdown?.total == null ? '' : Number(breakdown.total).toFixed(2).replace('.', ','))}
              />
              <p className="mt-1 text-xs text-maja-muted">
                {draft.auftraggeberId && liveKmGesamt != null
                  ? breakdown == null
                    ? 'Auto (Preisliste): keine passende Stufe gefunden.'
                    : breakdown.abaAufschlag === 0 && breakdown.eAufschlag === 0
                      ? 'Auto (Preisliste)'
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
        <div>
          <label className="label">Kundenname</label>
          <input className="input" value={draft.kundenname}
                 onChange={(e) => patchDraft({ kundenname: e.target.value })} />
        </div>
      </div>

      <div>
        <label className="label">Info</label>
        <textarea className="input min-h-[5rem]" value={draft.info}
                  onChange={(e) => patchDraft({ info: e.target.value })} />
      </div>

      {/* Bereich 6 (Fahrzeug & Adressen) wird vom Eltern-Component nach
          Sektion 4 + 5 inline gerendert — siehe TourDetailDialog. */}
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
  tour, hatRueckfuehrung,
}: { tour: FullTour; hatRueckfuehrung: boolean }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <DetailItem label={hatRueckfuehrung ? 'Kennzeichen Hin' : 'Kennzeichen'}>
          {tour.kennzeichen?.[0] ?? '—'}
        </DetailItem>
        {hatRueckfuehrung && (
          <DetailItem label="Kennzeichen Rück">{tour.kennzeichen?.[1] ?? '—'}</DetailItem>
        )}
        <DetailItem label="FIN">{tour.fin || '—'}</DetailItem>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <AddressBlockView
          stadt={tour.start_stadt}
          adresse={tour.adresse_start}
          kontakt={tour.kontakt_start}
        />
        <AddressBlockView
          stadt={tour.ziel_stadt}
          adresse={tour.adresse_ziel}
          kontakt={tour.kontakt_ziel}
        />
        {hatRueckfuehrung && tour.rueckfuehrung_stadt && (
          <AddressBlockView
            stadt={tour.rueckfuehrung_stadt}
            adresse={tour.adresse_rueckfuehrung}
            kontakt={tour.kontakt_rueckfuehrung}
          />
        )}
      </div>
    </>
  );
}

function AddressBlockView({
  stadt, adresse, kontakt,
}: {
  stadt: string;
  adresse: string | null;
  kontakt: unknown;
}) {
  const k = (kontakt && typeof kontakt === 'object'
    ? kontakt as { name?: unknown; telefon?: unknown; email?: unknown }
    : {} as { name?: unknown; telefon?: unknown; email?: unknown });
  const name = typeof k.name === 'string' ? k.name : '';
  const tel  = typeof k.telefon === 'string' ? k.telefon : '';
  const mail = typeof k.email === 'string' ? k.email : '';
  const hasContact = !!(name || tel || mail);
  return (
    <div className="rounded-lg border border-maja-navy/10 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-maja-muted">
        {stadt}
      </div>
      <div className="mt-1 whitespace-pre-wrap text-sm text-maja-ink">
        {adresse || '—'}
      </div>
      <div className="mt-2 border-t border-maja-navy/10 pt-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-maja-muted">
          Kontakt vor Ort
        </div>
        {hasContact ? (
          <div className="mt-1 text-sm text-maja-ink">
            <div>{name || '—'}</div>
            <div className="text-xs text-maja-muted">
              {tel ? (
                <a href={`tel:${tel}`} className="text-maja-accent hover:underline">{tel}</a>
              ) : '—'}
              {' · '}
              {mail ? (
                <a href={`mailto:${mail}`} className="text-maja-accent hover:underline">{mail}</a>
              ) : '—'}
            </div>
          </div>
        ) : (
          <div className="mt-1 text-xs text-maja-muted">—</div>
        )}
      </div>
    </div>
  );
}

function VehicleAndAddressEdit({
  draft, patchDraft,
}: { draft: EditDraft; patchDraft: (p: Partial<EditDraft>) => void }) {
  return (
    <>
      {/* Kennzeichen */}
      {!draft.hatRueckfuehrung ? (
        <div>
          <label className="label">Kennzeichen</label>
          <input className="input" value={draft.kennzeichenHin}
                 onChange={(e) => patchDraft({ kennzeichenHin: e.target.value })} />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Kennzeichen Hin</label>
            <input className="input" value={draft.kennzeichenHin}
                   onChange={(e) => patchDraft({ kennzeichenHin: e.target.value })} />
          </div>
          <div>
            <label className="label">Kennzeichen Rück</label>
            <input className="input" value={draft.kennzeichenRueck}
                   onChange={(e) => patchDraft({ kennzeichenRueck: e.target.value })} />
          </div>
        </div>
      )}
      {/* FIN */}
      <div>
        <label className="label">FIN</label>
        <input className="input"
               value={draft.fin}
               onChange={(e) => patchDraft({ fin: e.target.value.toUpperCase() })} />
      </div>

      {/* Adresse + Kontakt pro Stadt */}
      <AddressBlockEdit
        stadt={draft.startStadt}
        adresseValue={draft.adresseStart}
        onAdresse={(v) => patchDraft({ adresseStart: v })}
        name={draft.kontaktStartName}
        onName={(v) => patchDraft({ kontaktStartName: v })}
        telefon={draft.kontaktStartTelefon}
        onTelefon={(v) => patchDraft({ kontaktStartTelefon: v })}
        email={draft.kontaktStartEmail}
        onEmail={(v) => patchDraft({ kontaktStartEmail: v })}
      />
      <AddressBlockEdit
        stadt={draft.zielStadt}
        adresseValue={draft.adresseZiel}
        onAdresse={(v) => patchDraft({ adresseZiel: v })}
        name={draft.kontaktZielName}
        onName={(v) => patchDraft({ kontaktZielName: v })}
        telefon={draft.kontaktZielTelefon}
        onTelefon={(v) => patchDraft({ kontaktZielTelefon: v })}
        email={draft.kontaktZielEmail}
        onEmail={(v) => patchDraft({ kontaktZielEmail: v })}
      />
      {draft.hatRueckfuehrung && (
        <AddressBlockEdit
          stadt={draft.rueckfuehrungStadt}
          adresseValue={draft.adresseRueckfuehrung}
          onAdresse={(v) => patchDraft({ adresseRueckfuehrung: v })}
          name={draft.kontaktRueckName}
          onName={(v) => patchDraft({ kontaktRueckName: v })}
          telefon={draft.kontaktRueckTelefon}
          onTelefon={(v) => patchDraft({ kontaktRueckTelefon: v })}
          email={draft.kontaktRueckEmail}
          onEmail={(v) => patchDraft({ kontaktRueckEmail: v })}
        />
      )}
    </>
  );
}

interface AddressBlockEditProps {
  stadt: string;
  adresseValue: string;
  onAdresse: (v: string) => void;
  name: string;
  onName: (v: string) => void;
  telefon: string;
  onTelefon: (v: string) => void;
  email: string;
  onEmail: (v: string) => void;
}

function AddressBlockEdit(p: AddressBlockEditProps) {
  return (
    <div className="rounded-lg border border-maja-navy/10 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-maja-muted">
        {p.stadt || '—'}
      </div>
      <textarea
        className="input mt-1 min-h-[4rem]"
        placeholder="Adresse"
        value={p.adresseValue}
        onChange={(e) => p.onAdresse(e.target.value)}
      />
      <div className="mt-3 border-t border-maja-navy/10 pt-3">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-maja-muted">
          Kontakt vor Ort
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <div>
            <label className="label">Name</label>
            <input className="input" value={p.name}
                   onChange={(e) => p.onName(e.target.value)} />
          </div>
          <div>
            <label className="label">Telefon</label>
            <input className="input" type="tel" value={p.telefon}
                   onChange={(e) => p.onTelefon(e.target.value)} />
          </div>
          <div>
            <label className="label">E-Mail</label>
            <input className="input" type="email" value={p.email}
                   onChange={(e) => p.onEmail(e.target.value)} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Eingang-PDF-Downloads ----------

function EingangPdfDownloads({
  template, formular,
}: {
  template: { id: string; name: string; pdfs: TemplatePdf[]; schema: unknown };
  formular: AusgefuelltesFormular;
}) {
  const tpl: FormularTemplate = {
    id: template.id,
    name: template.name,
    schema: (template.schema as FormularTemplate['schema']) ?? { sections: [] },
    pdfs: template.pdfs ?? [],
    email_config: null,
    sichtbar: true,
  };
  if (!tpl.pdfs || tpl.pdfs.length === 0) {
    return <span className="text-xs text-maja-muted">keine PDF-Vorlagen</span>;
  }
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {tpl.pdfs.map((p) => {
        const filename = resolveFilename(p.filename_pattern, formular.daten, p.id);
        const path = expectedOneDrivePath(tpl, formular, p);
        return (
          <EingangPdfButton
            key={p.id}
            label={p.name}
            filename={filename}
            path={path}
          />
        );
      })}
    </div>
  );
}

function EingangPdfButton({
  label, filename, path,
}: { label: string; filename: string; path: string }) {
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    const ok = await downloadFormPdf(path, filename);
    setBusy(false);
    if (!ok) alert('PDF noch nicht generiert oder nicht erreichbar.');
  }
  return (
    <button
      onClick={open}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-full bg-maja-light px-2 py-1 text-xs text-maja-navy hover:bg-maja-accent/20"
      title={`${filename}\n${path}`}
    >
      {busy ? '…' : '⬇'} {label}
    </button>
  );
}

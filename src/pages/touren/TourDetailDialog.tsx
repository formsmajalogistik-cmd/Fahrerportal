import {
  useCallback, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import { Spinner } from '../../components/Spinner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { displayName } from '../../lib/names';
import {
  computeKmGesamt, fetchTourPrice, formatDateTime, formatEuro, formatKm, tourTitel,
} from '../../lib/touren';
import { assignFahrerToZugang, isGreimelAuftraggeber, unassignFahrerFromZugang } from '../../lib/greimel';
import { ProtokollSection } from './ProtokollSection';
import type { FormularTemplate, GreimelZugang, ProtokollArt } from '../../types/db';
import type {
  AppUser, Auftraggeber, Fahrer, Tour, TourenArt, TourStatus, TourZusatz,
} from '../../types/db';

type FahrerWithUser = Fahrer & { user: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null };

interface FullTour extends Tour {
  auftraggeber: Pick<Auftraggeber, 'id' | 'name' | 'kontakt'> | null;
  fahrer: FahrerWithUser | null;
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
  geplant:        'bg-gray-100 text-gray-700',
  aktiv:          'bg-maja-accent/15 text-maja-accent',
  abgeschlossen:  'bg-emerald-100 text-emerald-700',
};

const ZUSATZ_KATEGORIEN = [
  'Maut', 'Ladezeit', 'Wartezeit', 'Rote Kennzeichen', 'Reifenhandling',
  'Wäsche', 'Tankauslagen', 'Ladeauslagen', 'Waschauslagen',
  'Tank und Waschauslagen', 'Lade und Waschauslagen',
];

// ---------- Helpers ----------

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
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // datetime-local erwartet "YYYY-MM-DDTHH:mm" in lokaler Zeit
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  };
}

// ---------- Component ----------

export function TourDetailDialog({ tourId, onClose, onChanged, onDeleted }: Props) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [tour, setTour] = useState<FullTour | null>(null);
  const [zusaetze, setZusaetze] = useState<TourZusatz[]>([]);
  const [auftraggeber, setAuftraggeber] = useState<Auftraggeber[]>([]);
  const [fahrer, setFahrer] = useState<FahrerWithUser[]>([]);
  const [templates, setTemplates] = useState<Array<Pick<FormularTemplate, 'id' | 'name'>>>([]);
  const [zugaenge, setZugaenge] = useState<GreimelZugang[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Barauslagen / Fahrer-Honorar (separate Auto-Save Felder)
  const [barauslagenInput, setBarauslagenInput] = useState('');
  const [honorarInput, setHonorarInput] = useState('');

  // Zusatz-Eingabe
  const [neueKategorie, setNeueKategorie] = useState('');
  const [neuerBetrag, setNeuerBetrag] = useState('');
  const [neueNotiz, setNeueNotiz] = useState('');
  const [addingZusatz, setAddingZusatz] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [tRes, zRes, agRes, faRes, tplRes, gzRes] = await Promise.all([
      supabase
        .from('touren')
        .select(`
          *,
          auftraggeber:auftraggeber_id (id, name, kontakt),
          fahrer:fahrer_id (
            id, user_id, aktiv,
            user:user_id (email, vorname, nachname)
          )
        `)
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
        .select('*, user:user_id (email, vorname, nachname)')
        .eq('aktiv', true),
      supabase.from('formular_templates').select('id, name').order('name'),
      supabase.from('greimel_zugaenge').select('*').order('titel'),
    ]);
    if (tRes.error) { setError(tRes.error.message); setLoading(false); return; }
    const raw = (tRes.data ?? {}) as Record<string, unknown>;
    const full: FullTour = {
      ...(raw as unknown as FullTour),
      kennzeichen: Array.isArray(raw.kennzeichen) ? (raw.kennzeichen as string[]) : [],
      auftraggeber: (raw.auftraggeber as FullTour['auftraggeber']) ?? null,
      fahrer: (raw.fahrer as FullTour['fahrer']) ?? null,
    };
    setTour(full);
    setBarauslagenInput(decimalToInput(full.barauslagen));
    setHonorarInput(decimalToInput(full.fahrer_honorar));
    setZusaetze(Array.isArray(zRes.data) ? (zRes.data as TourZusatz[]) : []);
    setAuftraggeber(Array.isArray(agRes.data) ? agRes.data : []);
    const faList = Array.isArray(faRes.data) ? (faRes.data as unknown as FahrerWithUser[]) : [];
    setFahrer(faList.sort((a, b) =>
      displayName(a.user ?? null).localeCompare(displayName(b.user ?? null), 'de'),
    ));
    setTemplates(Array.isArray(tplRes.data) ? (tplRes.data as Array<Pick<FormularTemplate, 'id' | 'name'>>) : []);
    setZugaenge(Array.isArray(gzRes.data) ? (gzRes.data as GreimelZugang[]) : []);
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
  const [autoPrice, setAutoPrice] = useState<number | null>(null);
  const [pricing, setPricing] = useState(false);

  useEffect(() => {
    if (!editing || !draft) { setAutoPrice(null); return; }
    if (draft.istSondervereinbarung) { setAutoPrice(null); return; }
    if (!draft.auftraggeberId || liveKmGesamt == null) { setAutoPrice(null); return; }
    let cancelled = false;
    setPricing(true);
    void fetchTourPrice({
      auftraggeberId: draft.auftraggeberId,
      km: liveKmGesamt,
      tourenart: (draft.tourenart || 'AB') as TourenArt,
    }).then((p) => {
      if (cancelled) return;
      setAutoPrice(p);
      setPricing(false);
    });
    return () => { cancelled = true; };
  }, [editing, draft, liveKmGesamt]);

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
      verguetung = autoPrice;
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
    const willComplete = draft.status === 'abgeschlossen';

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
        status: draft.status,
        fahrer_id: draft.fahrerId || null,
        auftraggeber_id: draft.auftraggeberId || null,
        tourenart: draft.tourenart || null,
        start_stadt: start,
        ziel_stadt: ziel,
        rueckfuehrung_stadt: draft.hatRueckfuehrung ? draft.rueckfuehrungStadt.trim() : null,
        km_hin,
        km_rueck,
        km_gesamt: liveKmGesamt,
        startdatum: draft.startdatum ? new Date(draft.startdatum).toISOString() : null,
        enddatum: draft.enddatum ? new Date(draft.enddatum).toISOString() : null,
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
        protokoll_art: draft.protokollArt,
        schriftliches_protokoll_id: nextSchriftlichesId,
        greimel_zugang_id: nextGreimelId,
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
    setAddingZusatz(true);
    const { data, error: err } = await supabase
      .from('tour_zusaetze')
      .insert({
        tour_id: tour.id,
        kategorie,
        betrag,
        notiz: neueNotiz.trim() || null,
      })
      .select('*')
      .single();
    setAddingZusatz(false);
    if (err) { setStatusMsg({ kind: 'err', text: err.message }); return; }
    setZusaetze((z) => [...z, data as TourZusatz]);
    setNeueKategorie('');
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

  const fahrerName = displayName(tour.fahrer?.user ?? null) || '—';
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

      {/* Preis-Banner */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-maja-navy px-5 py-4 text-white">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wider text-white/70">Route</div>
          <div className="mt-0.5 text-base font-semibold break-words">{titel}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold">{formatEuro(tour.verguetung)}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/70">Netto</div>
        </div>
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
        <ViewMode tour={tour} fahrerName={fahrerName} hatRueckfuehrung={hatRueckfuehrung} templates={templates} zugaenge={zugaenge} />
      ) : (
        <EditMode
          draft={draft}
          patchDraft={patchDraft}
          toggleRueckfuehrung={toggleRueckfuehrung}
          liveKmGesamt={liveKmGesamt}
          auftraggeber={auftraggeber}
          fahrer={fahrer}
          draftSelectedAg={draftSelectedAg}
          autoPrice={autoPrice}
          pricing={pricing}
          templates={templates}
          zugaenge={zugaenge}
        />
      )}

      {/* Zusätze */}
      <div className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-base font-semibold text-maja-navy">Zusätze zur Tour</h3>
          <span className="inline-flex items-center justify-center rounded-full bg-maja-light px-2 py-0.5 text-xs font-semibold text-maja-navy">
            {zusaetze.length} {zusaetze.length === 1 ? 'Eintrag' : 'Einträge'}
          </span>
        </div>

        {isAdmin && (
          <div className="card mb-3 space-y-3 p-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_8rem_1fr_auto] sm:items-end">
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
          <ul className="card divide-y divide-maja-navy/10 overflow-hidden">
            {(zusaetze ?? []).map((z) => (
              <li key={z.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-maja-ink">{z.kategorie}</div>
                  {z.notiz && <div className="text-xs text-maja-muted">{z.notiz}</div>}
                </div>
                <div className="font-semibold text-maja-navy">{formatEuro(Number(z.betrag))}</div>
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
            ))}
          </ul>
        )}
      </div>

      {/* Barauslagen + Fahrer-Honorar */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <FinanceField
          label="Barauslagen"
          value={isAdmin ? barauslagenInput : decimalToInput(tour.barauslagen)}
          onChange={isAdmin ? setBarauslagenInput : undefined}
          onCommit={isAdmin ? commitBarauslagen : undefined}
          readOnly={!isAdmin}
        />
        <FinanceField
          label="Fahrer Honorar"
          value={isAdmin ? honorarInput : decimalToInput(tour.fahrer_honorar)}
          onChange={isAdmin ? setHonorarInput : undefined}
          onCommit={isAdmin ? commitHonorar : undefined}
          readOnly={!isAdmin}
        />
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
    </Shell>
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
}

function ViewMode({ tour, fahrerName, hatRueckfuehrung, templates, zugaenge }: ViewModeProps) {
  const linkedTemplate = templates.find((t) => t.id === tour.schriftliches_protokoll_id) ?? null;
  const linkedZugang = zugaenge.find((z) => z.id === tour.greimel_zugang_id) ?? null;
  const dateRange = (() => {
    if (!tour.startdatum && !tour.enddatum) return '—';
    const a = formatDateTime(tour.startdatum);
    const b = formatDateTime(tour.enddatum);
    if (tour.startdatum && tour.enddatum) return `${a} – ${b}`;
    return tour.startdatum ? a : b;
  })();

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <DetailItem label="Status">
          <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${STATUS_BADGE[tour.status]}`}>
            {STATUS_LABEL[tour.status]}
          </span>
        </DetailItem>
        <DetailItem label="Fahrer">{fahrerName}</DetailItem>
        <DetailItem label="Auftraggeber">
          {tour.auftraggeber ? (
            <>
              <span className="block">{tour.auftraggeber.name}</span>
              {tour.auftraggeber.kontakt && (
                <span className="block text-xs text-maja-muted">
                  Kontakt: {tour.auftraggeber.kontakt}
                </span>
              )}
            </>
          ) : '—'}
        </DetailItem>
        <DetailItem label="Kundenname">{tour.kundenname || '—'}</DetailItem>
        <DetailItem label="Tourenart">{tour.tourenart ?? '—'}</DetailItem>
        <DetailItem label="Vergütung">
          {formatEuro(tour.verguetung)}
          {!tour.ist_sondervereinbarung && tour.auftraggeber_id && tour.km_gesamt != null && (
            <span className="ml-2 text-xs text-maja-muted">Auto (Preisliste)</span>
          )}
        </DetailItem>
        <DetailItem label="Startdatum + Uhrzeit">{formatDateTime(tour.startdatum)}</DetailItem>
        <DetailItem label="Enddatum + Uhrzeit">{formatDateTime(tour.enddatum)}</DetailItem>
        {tour.tourenart === 'ABA' ? (
          <DetailItem label="Kilometer gesamt">{formatKm(tour.km_gesamt)}</DetailItem>
        ) : (
          <>
            <DetailItem label="km Hin">{formatKm(tour.km_hin)}</DetailItem>
            {hatRueckfuehrung && <DetailItem label="km Rück">{formatKm(tour.km_rueck)}</DetailItem>}
            <DetailItem label="km Gesamt">{formatKm(tour.km_gesamt)}</DetailItem>
          </>
        )}
        <DetailItem label={hatRueckfuehrung ? 'Kennzeichen Hin' : 'Kennzeichen'}>
          {tour.kennzeichen?.[0] ?? '—'}
        </DetailItem>
        {hatRueckfuehrung && (
          <DetailItem label="Kennzeichen Rück">{tour.kennzeichen?.[1] ?? '—'}</DetailItem>
        )}
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
        <DetailItem label="Info" full>
          {tour.info ? <span className="whitespace-pre-wrap">{tour.info}</span> : '—'}
        </DetailItem>
        {/* Datum-Bereich (Komfort-Anzeige) */}
        <DetailItem label="Zeitraum" full>{dateRange}</DetailItem>
      </div>

      {/* Protokoll */}
      <div>
        <h3 className="mb-2 text-base font-semibold text-maja-navy">Protokoll</h3>
        <div className="rounded-lg border border-maja-navy/10 p-3 text-sm text-maja-ink">
          {tour.protokoll_art == null ? (
            <span className="text-maja-muted">Noch nicht festgelegt.</span>
          ) : tour.protokoll_art === 'app' ? (
            <div className="space-y-2">
              <div>
                <span className="font-medium">App.</span>{' '}
                <span className="text-maja-muted">Die Protokollierung erfolgt über die App.</span>
              </div>
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
              <div className="font-medium">Schriftlich.</div>
              <div className="text-maja-muted">
                {linkedTemplate
                  ? <>Verknüpft: <span className="font-medium text-maja-ink">{linkedTemplate.name}</span></>
                  : 'Noch kein Protokoll verknüpft.'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Adressen */}
      <div>
        <h3 className="mb-2 text-base font-semibold text-maja-navy">Adressen</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <AddressItem stadt={tour.start_stadt} adresse={tour.adresse_start} />
          <AddressItem stadt={tour.ziel_stadt} adresse={tour.adresse_ziel} />
          {hatRueckfuehrung && tour.rueckfuehrung_stadt && (
            <AddressItem stadt={tour.rueckfuehrung_stadt} adresse={tour.adresse_rueckfuehrung} />
          )}
        </div>
      </div>
    </div>
  );
}

function AddressItem({ stadt, adresse }: { stadt: string; adresse: string | null }) {
  return (
    <div className="rounded-lg border border-maja-navy/10 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-maja-muted">{stadt}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm text-maja-ink">
        {adresse || '—'}
      </div>
    </div>
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
  autoPrice: number | null;
  pricing: boolean;
  templates: Array<Pick<FormularTemplate, 'id' | 'name'>>;
  zugaenge: GreimelZugang[];
}

function EditMode(p: EditModeProps) {
  const { draft, patchDraft, toggleRueckfuehrung, liveKmGesamt, auftraggeber, fahrer, draftSelectedAg, autoPrice, pricing, templates, zugaenge } = p;
  const isAba = draft.tourenart === 'ABA';
  const abaAufschlag = draftSelectedAg?.aba_aufschlag_prozent ?? null;
  const isGreimel = isGreimelAuftraggeber(draftSelectedAg);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Status</label>
          <select className="input" value={draft.status}
                  onChange={(e) => patchDraft({ status: e.target.value as TourStatus })}>
            {(['geplant', 'aktiv', 'abgeschlossen'] as TourStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Fahrer</label>
          <select className="input" value={draft.fahrerId}
                  onChange={(e) => patchDraft({ fahrerId: e.target.value })}>
            <option value="">— kein Fahrer —</option>
            {(fahrer ?? []).map((f) => (
              <option key={f.id} value={f.id}>{displayName(f.user ?? null)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Auftraggeber</label>
          <select className="input" value={draft.auftraggeberId}
                  onChange={(e) => patchDraft({ auftraggeberId: e.target.value })}>
            <option value="">— kein Auftraggeber —</option>
            {(auftraggeber ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          {draftSelectedAg?.kontakt && (
            <p className="mt-1 text-xs text-maja-muted">Kontakt: {draftSelectedAg.kontakt}</p>
          )}
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

      {/* Zeit */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Startdatum + Uhrzeit</label>
          <input type="datetime-local" className="input" value={draft.startdatum}
                 onChange={(e) => patchDraft({ startdatum: e.target.value })} />
        </div>
        <div>
          <label className="label">Enddatum + Uhrzeit</label>
          <input type="datetime-local" className="input" value={draft.enddatum}
                 onChange={(e) => patchDraft({ enddatum: e.target.value })} />
        </div>
      </div>

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

      {/* Protokoll */}
      <ProtokollSection
        protokollArt={draft.protokollArt}
        schriftlichesProtokollId={draft.schriftlichesProtokollId}
        greimelZugangId={draft.greimelZugangId}
        onChange={(p) => {
          const patch: Partial<EditDraft> = {};
          if ('protokoll_art' in p) patch.protokollArt = p.protokoll_art ?? null;
          if ('schriftliches_protokoll_id' in p) patch.schriftlichesProtokollId = p.schriftliches_protokoll_id ?? null;
          if ('greimel_zugang_id' in p) patch.greimelZugangId = p.greimel_zugang_id ?? null;
          patchDraft(patch);
        }}
        isGreimel={isGreimel}
        fahrerId={draft.fahrerId || null}
        templates={templates}
        zugaenge={zugaenge}
      />

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
                value={pricing ? '…' : (autoPrice == null ? '' : Number(autoPrice).toFixed(2).replace('.', ','))}
              />
              <p className="mt-1 text-xs text-maja-muted">
                {draft.auftraggeberId && liveKmGesamt != null
                  ? autoPrice == null
                    ? 'Auto (Preisliste): keine passende Stufe gefunden.'
                    : (
                      <>
                        Auto (Preisliste)
                        {isAba && abaAufschlag != null && Number(abaAufschlag) > 0 && (
                          <> · ABA +{Number(abaAufschlag).toString().replace('.', ',')}%</>
                        )}
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

      {/* Adressen */}
      <div>
        <h3 className="mb-2 text-base font-semibold text-maja-navy">Adressen</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-maja-muted">
              {draft.startStadt || '—'}
            </div>
            <textarea
              className="input mt-1 min-h-[4rem]"
              placeholder="Adresse Start"
              value={draft.adresseStart}
              onChange={(e) => patchDraft({ adresseStart: e.target.value })}
            />
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-maja-muted">
              {draft.zielStadt || '—'}
            </div>
            <textarea
              className="input mt-1 min-h-[4rem]"
              placeholder="Adresse Ziel"
              value={draft.adresseZiel}
              onChange={(e) => patchDraft({ adresseZiel: e.target.value })}
            />
          </div>
          {draft.hatRueckfuehrung && (
            <div className="sm:col-span-2">
              <div className="text-xs font-medium uppercase tracking-wide text-maja-muted">
                {draft.rueckfuehrungStadt || '—'}
              </div>
              <textarea
                className="input mt-1 min-h-[4rem]"
                placeholder="Adresse Rückführung"
                value={draft.adresseRueckfuehrung}
                onChange={(e) => patchDraft({ adresseRueckfuehrung: e.target.value })}
              />
            </div>
          )}
        </div>
      </div>
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

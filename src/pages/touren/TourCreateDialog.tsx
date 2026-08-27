import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { CheckIcon, XIcon } from '../../components/icons';
import { RouteSelectorDialog } from '../../components/RouteSelectorDialog';
import {
  abrechnungsKm, computeKmGesamt, computeTourStatus, fetchTourPriceBreakdown,
  formatEuro, formatKm, type TourPriceBreakdown,
} from '../../lib/touren';
import { useScrollLock } from '../../lib/useScrollLock';
import { assignFahrerToZugang, isGreimelAuftraggeber } from '../../lib/greimel';
import { FahrerSelect, type FahrerOptionRaw } from './FahrerSelect';
import { ProtokollSection } from './ProtokollSection';
import { useTestGuard } from '../../auth/TestModeContext';
import { SuggestCombobox } from '../../components/SuggestCombobox';
import { merkeTourAdressen } from '../../lib/feldVorschlaege';
import { StationFeldsatz } from '../../components/StationFeldsatz';
import { RouteFeldsatz } from '../../components/RouteFeldsatz';
import { composeAdresse, effektiveAdresse } from '../../lib/adresse';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TfBlock } from '../../components/TfBlock';
import {
  ABC_WARNUNG_TEXT, automatischeTourenart, brauchtAbcWarnung,
} from '../../lib/tourenartAutomatik';
import {
  leereKontaktMap, speichereAlleAnsprechpartner, type KontaktMap,
} from '../../lib/tourAnsprechpartner';
import type {
  AppUser, Auftraggeber, AuftraggeberKontakt, Fahrer, FormularTemplate, GreimelZugang, ProtokollArt, TourenArt,
} from '../../types/db';

type FahrerWithUser = Fahrer & { user: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null };

interface Props {
  onClose: () => void;
  /** Wird nach erfolgreicher Tour-Anlage aufgerufen. Optional bekommt
   *  der Aufrufer Daten der angelegten Tour mit — heute reicht der
   *  Posteingang-Workflow damit den gewählten Greimel-Zugang an die
   *  Auto-Antwort weiter (siehe TourFromEmailPanel). */
  onCreated: (info?: { greimelZugangId: string | null }) => void;
  /**
   * "modal" (Default): klassisches Overlay-Modal.
   * "embedded": Inhalt wird in den Eltern-Container gerendert — ohne
   * fixed/bg-Overlay. Wird vom Posteingang-Side-by-Side genutzt.
   */
  variant?: 'modal' | 'embedded';
  /** Vorbelegung einzelner Felder aus dem Aufrufer (z.B. E-Mail). */
  initial?: {
    startStadt?: string;
    zielStadt?: string;
    kundenname?: string;
    info?: string;
    fin?: string;
    kennzeichen?: string[];
  };
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
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}


export function TourCreateDialog({ onClose, onCreated, variant = 'modal', initial }: Props) {
  const guard = useTestGuard();
  // Punkt 3: Hintergrund darf nicht scrollen, solange das Modal offen
  // ist. Im "embedded"-Modus gibt es kein Overlay — dort keine Sperre.
  useScrollLock(variant === 'modal');
  // Pflichtfelder
  const [startStadt, setStartStadt] = useState(initial?.startStadt ?? '');
  const [zielStadt, setZielStadt]   = useState(initial?.zielStadt ?? '');

  // Rückführung
  const [hatRueckfuehrung, setHatRueckfuehrung] = useState(false);
  const [rueckfuehrungStadt, setRueckfuehrungStadt] = useState('');

  // km
  const [kmHin, setKmHin]     = useState('');
  const [kmRueck, setKmRueck] = useState('');
  /**
   * Nur ABA: Ausnahme für Auftraggeber, die die Gesamtstrecke abrechnen.
   * Standard (false) = Preis über km Hin. Siehe abrechnungsKm().
   */
  const [abaGesamtKm, setAbaGesamtKm] = useState(false);

  // Auftraggeber/Fahrer
  const [auftraggeber, setAuftraggeber] = useState<Auftraggeber[]>([]);
  const [fahrer, setFahrer] = useState<FahrerWithUser[]>([]);
  const [auftraggeberId, setAuftraggeberId] = useState('');
  const [fahrerId, setFahrerId] = useState('');

  // Tourenart + Daten
  const [tourenart, setTourenart]   = useState<TourenArt | ''>('');
  const [startdatum, setStartdatum] = useState('');
  const [enddatum, setEnddatum]     = useState('');
  // Auf Eis (Migration 086): Tour findet statt, Termin noch offen.
  const [aufEis, setAufEis] = useState(false);
  const [aufEisNotiz, setAufEisNotiz] = useState('');

  // Rechnungsdatum (optional, abweichend vom Tourendatum)
  const [rechnungsdatumAbweichend, setRechnungsdatumAbweichend] = useState(false);
  const [rechnungsdatum, setRechnungsdatum] = useState('');

  // Kennzeichen — 1 oder 2 Felder
  const [kennzeichenHin, setKennzeichenHin]   = useState(initial?.kennzeichen?.[0] ?? '');
  const [kennzeichenRueck, setKennzeichenRueck] = useState(initial?.kennzeichen?.[1] ?? '');

  // Sondervereinbarung (Checkbox + manueller Preis + Anmerkung)
  const [istSondervereinbarung, setIstSondervereinbarung] = useState(false);
  const [sondervereinbarung, setSondervereinbarung] = useState('');
  const [verguetungInput, setVerguetungInput] = useState('');

  const [kundenname, setKundenname] = useState(initial?.kundenname ?? '');
  const [info, setInfo] = useState(initial?.info ?? '');

  // E-Fahrzeug + FIN + Kontakt
  const [istEFahrzeug, setIstEFahrzeug] = useState(false);
  const [fin, setFin] = useState(initial?.fin ?? '');
  const [finRueck, setFinRueck] = useState('');
  const [kontaktId, setKontaktId] = useState('');
  const [kontakte, setKontakte] = useState<AuftraggeberKontakt[]>([]);

  // Adressen + Kontakte vor Ort (JSONB-Spalten auf touren). Wurden
  // bisher nur im Tour-Detail-Panel im Edit-Modus angeboten — für den
  // Side-by-Side aus dem Posteingang stehen sie ebenfalls hier zur
  // Verfügung.
  // Adresse strukturiert (Migration 086): Straße / Nr. / PLZ je
  // Station. Die Stadt ist die Tour-Stadt (startStadt/zielStadt/
  // rueckfuehrungStadt) — kein zweites Feld.
  const [strasseStart, setStrasseStart] = useState('');
  const [plzStart, setPlzStart] = useState('');
  const [strasseZiel, setStrasseZiel] = useState('');
  const [plzZiel, setPlzZiel] = useState('');
  const [strasseRueck, setStrasseRueck] = useState('');
  const [plzRueck, setPlzRueck] = useState('');
  const [stationsKontakte, setStationsKontakte] = useState<KontaktMap>(() => leereKontaktMap());
  // Optionale Zusatzangaben (Migration 080).
  const [fahrzeugmodell, setFahrzeugmodell] = useState('');
  const [fahrzeugmodellRueck, setFahrzeugmodellRueck] = useState('');
  // Merkt sich, ob der Nutzer die Tourenart selbst gewählt hat — ab dann
  // greift die AB/ABC-Automatik nicht mehr (sonst wäre ABA nicht haltbar).
  const [tourenartManuell, setTourenartManuell] = useState(false);
  const [abcWarnung, setAbcWarnung] = useState(false);
  // Zeitangabe je Station als Freitext (081) — steht beim jeweiligen
  // Adressblock, nicht neben dem Datum.
  const [zeitStart, setZeitStart] = useState('');
  const [zeitZiel, setZeitZiel] = useState('');
  const [zeitRueck, setZeitRueck] = useState('');

  // Routen-Dialog (km berechnen über Google Routes API). Identisches
  // Verhalten wie im Tour-Detail-Panel.
  const [routeDialog, setRouteDialog] = useState<null | 'hin' | 'rueck'>(null);
  /** Erfolgs-Quittung pro Strecke nach „Entfernung berechnen". */
  const [routeConfirm, setRouteConfirm] = useState<{ hin?: number; rueck?: number }>({});

  // Protokoll
  const [protokollArt, setProtokollArt] = useState<ProtokollArt | null>(null);
  // Protokoll-Zuweisungen werden erst nach dem Tour-Save möglich
  // (brauchen die Tour-ID). Die Legacy-Spalte `schriftliches_protokoll_id`
  // bleibt beim Neuanlegen NULL — Zuweisungen passieren danach im
  // Tour-Detail-Panel.
  const [greimelZugangId, setGreimelZugangId] = useState<string | null>(null);
  const [appNotiz, setAppNotiz] = useState('');
  const [templates, setTemplates] = useState<Array<Pick<FormularTemplate, 'id' | 'name'>>>([]);
  const [zugaenge, setZugaenge] = useState<GreimelZugang[]>([]);

  // Auto-Preis-Aufschlüsselung
  const [breakdown, setBreakdown] = useState<TourPriceBreakdown | null>(null);
  const [pricing, setPricing] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [agRes, faRes, tplRes, zRes] = await Promise.all([
        // Egress: nur die Felder, die das Dropdown + greimel-Check braucht.
        supabase.from('auftraggeber').select('id, name, kontakt, externe_app_name, externe_app_url').order('name'),
        supabase
          .from('fahrer')
          .select('*, user:user_id (email, vorname, nachname)')
          .eq('aktiv', true),
        supabase.from('formular_templates').select('id, name').eq('archiviert', false).order('name'),
        supabase.from('greimel_zugaenge').select('*'),
      ]);
      setAuftraggeber(Array.isArray(agRes.data) ? (agRes.data as unknown as Auftraggeber[]) : []);
      const faList = Array.isArray(faRes.data) ? (faRes.data as unknown as FahrerWithUser[]) : [];
      setFahrer(faList);
      setTemplates(Array.isArray(tplRes.data) ? (tplRes.data as Array<Pick<FormularTemplate, 'id' | 'name'>>) : []);
      // Natürliche Sortierung nach Titel ("Zugang 2" vor "Zugang 10").
      const zList = Array.isArray(zRes.data) ? (zRes.data as GreimelZugang[]) : [];
      setZugaenge([...zList].sort((a, b) =>
        a.titel.localeCompare(b.titel, 'de', { numeric: true, sensitivity: 'base' }),
      ));
    })();
  }, []);

  const selectedAg = useMemo(
    () => (auftraggeber ?? []).find((a) => a.id === auftraggeberId) ?? null,
    [auftraggeber, auftraggeberId],
  );

  const isAba = tourenart === 'ABA';

  // Zusammengesetzte Adressen — daran hängen Auftrags-E-Mail,
  // Excel-Export und die Routenberechnung.
  const adresseStart = useMemo(() => effektiveAdresse(
    { strasse: strasseStart, plz: plzStart, stadt: startStadt }, null,
  ), [strasseStart, plzStart, startStadt]);
  const adresseZiel = useMemo(() => effektiveAdresse(
    { strasse: strasseZiel, plz: plzZiel, stadt: zielStadt }, null,
  ), [strasseZiel, plzZiel, zielStadt]);
  const adresseRueckfuehrung = useMemo(() => effektiveAdresse(
    { strasse: strasseRueck, plz: plzRueck, stadt: rueckfuehrungStadt }, null,
  ), [strasseRueck, plzRueck, rueckfuehrungStadt]);

  const kmGesamt = useMemo(() => computeKmGesamt({
    km_hin: parseInteger(kmHin),
    km_rueck: parseInteger(kmRueck),
    hatRueckfuehrung,
  }), [kmHin, kmRueck, hatRueckfuehrung]);

  /**
   * Kilometer für die Preisstufen-Suche. Bei ABA ist das die Hinfahrt,
   * nicht die Summe — außer die Ausnahme-Checkbox ist gesetzt.
   */
  const preisKm = useMemo(() => abrechnungsKm({
    tourenart: tourenart || 'AB',
    km_hin: parseInteger(kmHin),
    km_gesamt: kmGesamt,
    abaGesamtKmBerechnen: abaGesamtKm,
  }), [tourenart, kmHin, kmGesamt, abaGesamtKm]);

  // Auto-Preis berechnen, sobald Auftraggeber + km + tourenart + ist_e_fahrzeug sich ändern
  useEffect(() => {
    if (istSondervereinbarung) { setBreakdown(null); return; }
    if (!auftraggeberId || preisKm == null) { setBreakdown(null); return; }
    let cancelled = false;
    setPricing(true);
    void fetchTourPriceBreakdown({
      auftraggeberId,
      km: preisKm,
      tourenart: (tourenart || 'AB') as TourenArt,
      istEFahrzeug,
    }).then((b) => {
      if (cancelled) return;
      setBreakdown(b);
      setPricing(false);
    });
    return () => { cancelled = true; };
  }, [auftraggeberId, preisKm, tourenart, istSondervereinbarung, istEFahrzeug]);

  // Kontakte des ausgewählten Auftraggebers laden
  useEffect(() => {
    if (!auftraggeberId) { setKontakte([]); setKontaktId(''); return; }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('auftraggeber_kontakte')
        .select('*')
        .eq('auftraggeber_id', auftraggeberId)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      setKontakte(Array.isArray(data) ? data : []);
    })();
    return () => { cancelled = true; };
  }, [auftraggeberId]);

  function toggleRueckfuehrung() {
    if (hatRueckfuehrung) {
      setHatRueckfuehrung(false);
      setRueckfuehrungStadt('');
      setStrasseRueck(''); setPlzRueck('');
      setKmRueck('');
      setKennzeichenRueck('');
      setFinRueck('');
    } else {
      setHatRueckfuehrung(true);
    }
  }


  // AB/ABC automatisch, solange der Nutzer die Tourenart nicht selbst
  // gewählt hat. Deferred, damit kein synchrones setState im Effect steht.
  useEffect(() => {
    const naechste = automatischeTourenart({
      aktuell: tourenart,
      rueckStadt: rueckfuehrungStadt,
      rueckAdresse: adresseRueckfuehrung,
      manuell: tourenartManuell,
    });
    if (naechste == null) return;
    const t = window.setTimeout(() => setTourenart(naechste), 0);
    return () => window.clearTimeout(t);
  }, [tourenart, rueckfuehrungStadt, adresseRueckfuehrung, tourenartManuell]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Sicherheitsnetz: Rückführung befüllt, aber Tourenart AB.
    if (brauchtAbcWarnung(tourenart, rueckfuehrungStadt, adresseRueckfuehrung)) {
      setAbcWarnung(true);
      return;
    }
    void speichern();
  }

  /** Eigentliches Speichern — nach der ABC-Warnung ggf. erneut aufgerufen. */
  async function speichern() {
    setError(null);

    const start = startStadt.trim();
    const ziel  = zielStadt.trim();
    if (!start || !ziel) {
      setError('Start-Stadt und Ziel-Stadt sind Pflichtfelder.');
      return;
    }
    // Touren auf Eis dürfen ohne Datum angelegt werden.
    if (!aufEis && (!startdatum || !enddatum)) {
      setError('Start- und Enddatum sind Pflichtfelder. '
        + 'Ohne festen Termin die Tour auf Eis legen.');
      return;
    }

    if (hatRueckfuehrung && !rueckfuehrungStadt.trim()) {
      setError('Rückführung aktiviert: Stadt darf nicht leer sein.');
      return;
    }

    const km_hin = parseInteger(kmHin);
    const km_rueck = hatRueckfuehrung ? parseInteger(kmRueck) : null;

    // Index 0 = Hin, Index 1 = Rück. Ist nur das Rück-Kennzeichen
    // bekannt, bleibt Index 0 als leerer Platzhalter stehen — sonst
    // würde der Rück-Wert überall als Hin-Kennzeichen gelesen.
    const kzHin = kennzeichenHin.trim().toUpperCase();
    const kzRueck = hatRueckfuehrung ? kennzeichenRueck.trim().toUpperCase() : '';
    const kennzeichen: string[] = [];
    if (kzHin || kzRueck) kennzeichen.push(kzHin);
    if (kzRueck) kennzeichen.push(kzRueck);

    let verguetung: number | null;
    if (istSondervereinbarung) {
      const t = verguetungInput.trim();
      if (t === '') {
        verguetung = null;
      } else {
        const v = parseDecimal(t);
        if (v === null) { setError('Vergütung ist ungültig.'); return; }
        verguetung = v;
      }
    } else {
      verguetung = breakdown?.total ?? null;
    }

    if (guard()) { onClose(); return; }
    setSaving(true);
    const ag = (auftraggeber ?? []).find((a) => a.id === auftraggeberId) ?? null;
    // Bei einer rückwirkend angelegten Tour (Datum bereits in der Vergangenheit)
    // wird der Greimel-Zugang nicht zugewiesen, weil die Tour als
    // "abgeschlossen" gilt.
    // <input type="date"> liefert direkt "YYYY-MM-DD" — exakt das Format,
    // das eine Postgres-date-Spalte erwartet. Keine Timezone-Umrechnung.
    // startdatum/enddatum sind seit Migration 028 NOT NULL.
    const dateStart = startdatum || null;
    const dateEnd   = enddatum || null;
    const willBeCompleted = computeTourStatus(dateStart, dateEnd) === 'abgeschlossen';
    const greimelEffective = isGreimelAuftraggeber(ag) && protokollArt === 'app' && !willBeCompleted
      ? greimelZugangId
      : null;
    const schriftlichEffective: string | null = null;

    const payload = {
      start_stadt: start,
      ziel_stadt: ziel,
      rueckfuehrung_stadt: hatRueckfuehrung ? rueckfuehrungStadt.trim() : null,
      km_hin,
      km_rueck,
      km_gesamt: kmGesamt,
      // Nur bei ABA relevant — sonst immer false, damit ein späterer
      // Wechsel der Tourenart keinen Altwert mitschleppt.
      aba_gesamt_km_berechnen: isAba ? abaGesamtKm : false,
      auftraggeber_id: auftraggeberId || null,
      fahrer_id: fahrerId || null,
      kontakt_id: kontaktId || null,
      tourenart: tourenart || null,
      startdatum: dateStart,
      enddatum: dateEnd,
      auf_eis: aufEis,
      auf_eis_notiz: aufEis ? (aufEisNotiz.trim() || null) : null,
      auf_eis_seit: aufEis ? new Date().toISOString() : null,
      ist_sondervereinbarung: istSondervereinbarung,
      sondervereinbarung: istSondervereinbarung
        ? (sondervereinbarung.trim() || null)
        : null,
      verguetung,
      kundenname: kundenname.trim() || null,
      info: info.trim() || null,
      kennzeichen,
      ist_e_fahrzeug: istEFahrzeug,
      fin: fin.trim() || null,
      fin_rueck: hatRueckfuehrung ? (finRueck.trim().toUpperCase() || null) : null,
      protokoll_art: protokollArt,
      schriftliches_protokoll_id: schriftlichEffective,
      greimel_zugang_id: greimelEffective,
      app_notiz: protokollArt === 'app' && appNotiz.trim() ? appNotiz.trim() : null,
      // Haken ohne eingetragenes Datum wird beim Speichern automatisch
      // bereinigt — sonst hätte die Tour ein leeres effektives
      // Rechnungsdatum und würde nie in eine Rechnung gezogen.
      rechnungsdatum_abweichend: rechnungsdatumAbweichend && !!rechnungsdatum,
      rechnungsdatum: rechnungsdatumAbweichend && rechnungsdatum ? rechnungsdatum : null,
      adresse_start: composeAdresse({
        strasse: strasseStart, plz: plzStart, stadt: start,
      }),
      adresse_ziel: composeAdresse({
        strasse: strasseZiel, plz: plzZiel, stadt: ziel,
      }),
      adresse_rueckfuehrung: hatRueckfuehrung ? composeAdresse({
        strasse: strasseRueck, plz: plzRueck,
        stadt: rueckfuehrungStadt.trim(),
      }) : null,
      strasse_start: strasseStart.trim() || null,
      plz_start: plzStart.trim() || null,
      strasse_ziel: strasseZiel.trim() || null,
      plz_ziel: plzZiel.trim() || null,
      strasse_rueckfuehrung: hatRueckfuehrung ? (strasseRueck.trim() || null) : null,
      plz_rueckfuehrung: hatRueckfuehrung ? (plzRueck.trim() || null) : null,
      // kontakt_* setzt der Spiegel-Trigger aus tour_ansprechpartner.
      fahrzeugmodell: fahrzeugmodell.trim() || null,
      fahrzeugmodell_rueck: hatRueckfuehrung ? (fahrzeugmodellRueck.trim() || null) : null,
      zeit_start: zeitStart.trim() || null,
      zeit_ziel: zeitZiel.trim() || null,
      zeit_rueckfuehrung: hatRueckfuehrung ? (zeitRueck.trim() || null) : null,
    };

    const { data: neu, error: err } = await supabase
      .from('touren').insert(payload).select('id').single();
    if (err) { setSaving(false); setError(err.message); return; }

    // Ansprechpartner in die eigene Tabelle (Migration 080) — der
    // Spiegel-Trigger füllt danach kontakt_* für die Alt-Anzeigen.
    if (neu?.id) {
      try { await speichereAlleAnsprechpartner(neu.id, stationsKontakte); }
      catch (kErr) { console.warn('Ansprechpartner konnten nicht gespeichert werden', kErr); }
    }

    // Adressteile in den Vorschlags-Pool (4b) — dieselben Töpfe, aus
    // denen auch die Formular-Adressfelder schöpfen. Fehlschläge sind
    // unkritisch, die Tour ist bereits gespeichert.
    void merkeTourAdressen([
      { strasse: strasseStart, plz: plzStart, stadt: startStadt },
      { strasse: strasseZiel, plz: plzZiel, stadt: zielStadt },
      ...(hatRueckfuehrung
        ? [{ strasse: strasseRueck, plz: plzRueck, stadt: rueckfuehrungStadt }]
        : []),
    ], false);

    // Greimel-Zugang automatisch dem Fahrer zuweisen
    if (greimelEffective && fahrerId) {
      try { await assignFahrerToZugang(greimelEffective, fahrerId); }
      catch (e) { console.warn('Greimel-Zugang-Zuweisung fehlgeschlagen', e); }
    }

    setSaving(false);
    onCreated({ greimelZugangId: greimelEffective });
  }

  // Wrapper-Klassen je nach variant:
  //  - modal:     klassisches Overlay
  //  - embedded:  einfache Card im Eltern-Container (für Side-by-Side
  //               im Posteingang)
  const outerCls = variant === 'embedded'
    ? ''
    : 'fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8';
  // Der Container darf breiter werden — das mehrspaltige Raster braucht
  // Platz, spart dafür aber deutlich Scrollen.
  const innerCls = variant === 'embedded'
    ? 'card w-full p-4'
    : 'card w-full max-w-5xl p-5';
  return (
    <div className={outerCls}>
      <div className={innerCls}>
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-maja-navy">Neue Tour anlegen</h2>
            <p className="text-xs text-maja-muted">
              Mit <span className="text-red-600">*</span> markierte Felder sind Pflicht.
            </p>
          </div>
          {variant === 'modal' && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
              aria-label="Schließen"
            >
              <XIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
          {/* ---------------------------------------------------------
              1 — Auftragsdaten
              --------------------------------------------------------- */}
          <TfBlock titel="Auftragsdaten">
            <div className="tf-grid">
              <div className="sm:col-span-3 lg:col-span-4">
                <label htmlFor="t-ag" className="tf-label">Auftraggeber</label>
                <select id="t-ag" className="tf-input"
                        value={auftraggeberId}
                        onChange={(e) => setAuftraggeberId(e.target.value)}>
                  <option value="">— kein Auftraggeber —</option>
                  {(auftraggeber ?? []).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-3 lg:col-span-4">
                <label htmlFor="t-fa" className="tf-label">Fahrer</label>
                <FahrerSelect
                  id="t-fa"
                  className="tf-input"
                  value={fahrerId}
                  onChange={setFahrerId}
                  fahrer={fahrer as FahrerOptionRaw[]}
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-2">
                <label htmlFor="t-art" className="tf-label">Tourenart</label>
                <select id="t-art" className="tf-input"
                        value={tourenart}
                        onChange={(e) => {
                          const art = e.target.value as TourenArt | '';
                          setTourenart(art);
                          setTourenartManuell(true);
                          // ABA/ABC haben immer eine Rückführung — die
                          // zugehörigen Blöcke (Fahrzeug Rückfahrt,
                          // Rückführungsort, km Rück) direkt einblenden.
                          // Einmalig beim Umschalten, damit "Rückführung
                          // entfernen" danach trotzdem greift.
                          if (art === 'ABA' || art === 'ABC') setHatRueckfuehrung(true);
                        }}>
                  <option value="">—</option>
                  <option value="AB">AB</option>
                  <option value="ABC">ABC</option>
                  <option value="ABA">ABA</option>
                </select>
              </div>
              <div className="sm:col-span-4 lg:col-span-2">
                <label htmlFor="t-kn" className="tf-label">Kundenname</label>
                <input id="t-kn" className="tf-input"
                       value={kundenname}
                       onChange={(e) => setKundenname(e.target.value)} />
              </div>

              {auftraggeberId && kontakte.length > 0 && (
                <div className="sm:col-span-6 lg:col-span-4">
                  <label htmlFor="t-kontakt" className="tf-label">Rechnungsempfänger</label>
                  <select id="t-kontakt" className="tf-input"
                          value={kontaktId}
                          onChange={(e) => setKontaktId(e.target.value)}>
                    <option value="">— kein Rechnungsempfänger —</option>
                    {kontakte.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name}{k.position ? ` · ${k.position}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Rechnungsdatum abweichend */}
              <div className="sm:col-span-4 lg:col-span-5">
                <label className="tf-check">
                  <input
                    type="checkbox"
                    checked={rechnungsdatumAbweichend}
                    onChange={(e) => setRechnungsdatumAbweichend(e.target.checked)}
                  />
                  Rechnungsdatum abweichend
                </label>
              </div>
              {rechnungsdatumAbweichend && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <label htmlFor="t-rechn-dt" className="tf-label">Rechnungsdatum</label>
                  <input id="t-rechn-dt" type="date" className="tf-input"
                         value={rechnungsdatum}
                         onChange={(e) => setRechnungsdatum(e.target.value)} />
                </div>
              )}

              {/* Sondervereinbarung + E-Fahrzeug */}
              <div className="sm:col-span-3 lg:col-span-3">
                <label className="tf-check">
                  <input
                    type="checkbox"
                    checked={istSondervereinbarung}
                    onChange={(e) => setIstSondervereinbarung(e.target.checked)}
                  />
                  Sondervereinbarung
                </label>
              </div>
              <div className="sm:col-span-3 lg:col-span-2">
                <label className="tf-check">
                  <input
                    type="checkbox"
                    checked={istEFahrzeug}
                    onChange={(e) => setIstEFahrzeug(e.target.checked)}
                  />
                  E-Fahrzeug
                </label>
              </div>
              {istSondervereinbarung && (
                <div className="sm:col-span-6 lg:col-span-7">
                  <label htmlFor="t-sv-note" className="tf-label">Anmerkung zur Sondervereinbarung</label>
                  <input id="t-sv-note" className="tf-input"
                         value={sondervereinbarung}
                         onChange={(e) => setSondervereinbarung(e.target.value)} />
                </div>
              )}

              {/* Vergütung */}
              <div className="sm:col-span-3 lg:col-span-3">
                <label htmlFor="t-verg" className="tf-label">Vergütung (€)</label>
                {istSondervereinbarung ? (
                  <>
                    <input
                      id="t-verg"
                      className="tf-input"
                      type="text"
                      inputMode="decimal"
                      placeholder="z.B. 1234,56"
                      value={verguetungInput}
                      onChange={(e) => setVerguetungInput(e.target.value)}
                    />
                    <p className="tf-hint">Manueller Preis (Sondervereinbarung aktiv).</p>
                  </>
                ) : (
                  <>
                    <input
                      id="t-verg"
                      className="tf-input bg-maja-light"
                      type="text"
                      readOnly
                      value={pricing ? '…' : (breakdown?.total == null ? '' : Number(breakdown.total).toFixed(2).replace('.', ','))}
                    />
                    <p className="tf-hint">
                      {auftraggeberId && preisKm != null
                        ? breakdown == null
                          ? 'Auto (Preisliste): keine passende Stufe gefunden.'
                          : breakdown.abaAufschlag === 0 && breakdown.eAufschlag === 0
                            ? `Auto (Preisliste), ${formatKm(preisKm)}`
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
                <label htmlFor="t-info" className="tf-label">Info</label>
                <textarea id="t-info" className="tf-input min-h-[3.5rem]"
                          rows={2}
                          value={info} onChange={(e) => setInfo(e.target.value)} />
              </div>
            </div>
          </TfBlock>

          {/* Route — dieselben Städte wie in den Ort-Blöcken, hier an
              der Stelle bearbeitbar, an der sie in der Tourenliste
              erscheinen. Gleicher State, also immer identisch. */}
          <RouteFeldsatz
            idPrefix="t"
            pflicht
            startStadt={startStadt} onStartStadt={setStartStadt}
            zielStadt={zielStadt} onZielStadt={setZielStadt}
            rueckStadt={hatRueckfuehrung ? rueckfuehrungStadt : undefined}
            onRueckStadt={hatRueckfuehrung ? setRueckfuehrungStadt : undefined}
          />

          {/* ---------------------------------------------------------
              2 — Fahrzeug Hinfahrt
              --------------------------------------------------------- */}
          <TfBlock titel="Fahrzeug Hinfahrt" akzent="hin">
            <div className="tf-grid">
              <div className="sm:col-span-2 lg:col-span-3">
                <label htmlFor="t-kz" className="tf-label">
                  {hatRueckfuehrung ? 'Kennzeichen Hin' : 'Kennzeichen'}
                </label>
                <input id="t-kz" className="tf-input" placeholder="z.B. M-XY 1234"
                       value={kennzeichenHin}
                       onChange={(e) => setKennzeichenHin(e.target.value)} />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <label htmlFor="t-modell" className="tf-label">Fahrzeugmodell</label>
                <SuggestCombobox
                  id="t-modell"
                  className="tf-input"
                  feldTyp="fahrzeugmodell"
                  value={fahrzeugmodell}
                  onChange={setFahrzeugmodell}
                  placeholder="z.B. VW Polo"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-5">
                <label htmlFor="t-fin" className="tf-label">{hatRueckfuehrung ? 'FIN Hin' : 'FIN'}</label>
                <input id="t-fin" className="tf-input"
                       value={fin}
                       onChange={(e) => setFin(e.target.value.toUpperCase())} />
              </div>
            </div>
          </TfBlock>

          {/* ---------------------------------------------------------
              3 — Abholort
              --------------------------------------------------------- */}
          <StationFeldsatz
            titel="Abholort"
            idPrefix="t-st1"
            stadtLabel="Stadt" stadtPflicht
            stadt={startStadt} onStadt={setStartStadt}
            strasse={strasseStart} onStrasse={setStrasseStart}
            plz={plzStart} onPlz={setPlzStart}
            zeit={zeitStart} onZeit={setZeitStart} zeitLabel="Zeit Abholung"
            kontakte={stationsKontakte.start}
            onKontakte={(next) => setStationsKontakte((m) => ({ ...m, start: next }))}
          />

          {/* ---------------------------------------------------------
              4 — Zielort
              --------------------------------------------------------- */}
          <StationFeldsatz
            titel="Zielort"
            idPrefix="t-st2"
            stadtLabel="Stadt" stadtPflicht
            stadt={zielStadt} onStadt={setZielStadt}
            strasse={strasseZiel} onStrasse={setStrasseZiel}
            plz={plzZiel} onPlz={setPlzZiel}
            zeit={zeitZiel} onZeit={setZeitZiel} zeitLabel="Zeit Anlieferung"
            kontakte={stationsKontakte.ziel}
            onKontakte={(next) => setStationsKontakte((m) => ({ ...m, ziel: next }))}
          />

          {/* Rückführung an-/abschalten. Blöcke 5+6 hängen daran. */}
          {!hatRueckfuehrung && (
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-sm"
              onClick={toggleRueckfuehrung}
            >
              + Rückführung
            </button>
          )}

          {hatRueckfuehrung && (
            <>
              {/* -----------------------------------------------------
                  5 — Fahrzeug Rückfahrt (nur ABA/ABC)
                  ----------------------------------------------------- */}
              <TfBlock titel="Fahrzeug Rückfahrt" akzent="rueck">
                <div className="tf-grid">
                  <div className="sm:col-span-2 lg:col-span-3">
                    <label htmlFor="t-kz-rueck" className="tf-label">Kennzeichen Rück</label>
                    <input id="t-kz-rueck" className="tf-input"
                           value={kennzeichenRueck}
                           onChange={(e) => setKennzeichenRueck(e.target.value)} />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-4">
                    <label htmlFor="t-modell-rueck" className="tf-label">Fahrzeugmodell Rück</label>
                    <SuggestCombobox
                      id="t-modell-rueck"
                      className="tf-input"
                      feldTyp="fahrzeugmodell"
                      value={fahrzeugmodellRueck}
                      onChange={setFahrzeugmodellRueck}
                      placeholder="z.B. Audi A3"
                    />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-5">
                    <label htmlFor="t-fin-rueck" className="tf-label">FIN Rück</label>
                    <input id="t-fin-rueck" className="tf-input"
                           value={finRueck}
                           onChange={(e) => setFinRueck(e.target.value.toUpperCase())} />
                  </div>
                </div>
              </TfBlock>

              {/* -----------------------------------------------------
                  6 — Rückführungsort (nur ABA/ABC)
                  ----------------------------------------------------- */}
              <StationFeldsatz
                titel="Rückführungsort"
                idPrefix="t-st3"
                akzent="rueck"
                stadtLabel="Stadt"
                stadt={rueckfuehrungStadt} onStadt={setRueckfuehrungStadt}
                strasse={strasseRueck} onStrasse={setStrasseRueck}
                plz={plzRueck} onPlz={setPlzRueck}
                zeit={zeitRueck} onZeit={setZeitRueck} zeitLabel="Zeit Rückführung"
                kontakte={stationsKontakte.rueckfuehrung}
                onKontakte={(next) => setStationsKontakte((m) => ({ ...m, rueckfuehrung: next }))}
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

          {/* ---------------------------------------------------------
              7 — Kilometer & Termine
              --------------------------------------------------------- */}
          <TfBlock titel="Kilometer & Termine">
            <div className="tf-grid">
              <div className="sm:col-span-3 lg:col-span-2">
                <label htmlFor="t-start-dt" className="tf-label">
                  Startdatum {!aufEis && <span className="text-red-600">*</span>}
                </label>
                <input id="t-start-dt" type="date" className="tf-input" required={!aufEis}
                       value={startdatum} onChange={(e) => setStartdatum(e.target.value)} />
              </div>
              <div className="sm:col-span-3 lg:col-span-2">
                <label htmlFor="t-end-dt" className="tf-label">
                  Enddatum {!aufEis && <span className="text-red-600">*</span>}
                </label>
                <input id="t-end-dt" type="date" className="tf-input" required={!aufEis}
                       value={enddatum} onChange={(e) => setEnddatum(e.target.value)} />
              </div>
              <div className="sm:col-span-3 lg:col-span-3">
                <label htmlFor="t-km-hin" className="tf-label">km Hin (Start → Ziel)</label>
                <input id="t-km-hin" className="tf-input" type="number" min={0} step={1}
                       value={kmHin} onChange={(e) => setKmHin(e.target.value)} />
                <RouteCalcRow
                  disabled={!adresseStart.trim() || !adresseZiel.trim()}
                  label="Entfernung berechnen"
                  confirmKm={routeConfirm.hin}
                  onClick={() => setRouteDialog('hin')}
                />
              </div>
              {hatRueckfuehrung && (
                <div className="sm:col-span-3 lg:col-span-3">
                  <label htmlFor="t-km-rueck" className="tf-label">km Rück (Ziel → Rückführung)</label>
                  <input id="t-km-rueck" className="tf-input" type="number" min={0} step={1}
                         value={kmRueck} onChange={(e) => setKmRueck(e.target.value)} />
                  <RouteCalcRow
                    disabled={!adresseZiel.trim() || !adresseRueckfuehrung.trim()}
                    label="Entfernung berechnen"
                    confirmKm={routeConfirm.rueck}
                    onClick={() => setRouteDialog('rueck')}
                  />
                </div>
              )}
              <div className="sm:col-span-6 lg:col-span-2">
                <span className="tf-label">Gesamtstrecke</span>
                <div className="rounded-md bg-maja-light px-2 py-1.5 text-sm font-semibold text-maja-navy">
                  {formatKm(kmGesamt)}
                </div>
              </div>

              {/* Auf Eis — Termin bewusst offen. */}
              <div className="sm:col-span-6 lg:col-span-12">
                <label className="tf-check">
                  <input type="checkbox"
                         checked={aufEis} onChange={(e) => setAufEis(e.target.checked)} />
                  Auf Eis legen — Termin steht noch nicht fest
                </label>
                <p className="tf-hint">
                  {aufEis
                    ? 'Die Tour wird ohne Datum angelegt und bleibt über den Bereich „Auf Eis" in der Tourenliste auffindbar.'
                    : 'Für Touren, die sicher stattfinden, aber noch kein festes Datum haben.'}
                </p>
              </div>
              {aufEis && (
                <div className="sm:col-span-6 lg:col-span-12">
                  <label htmlFor="t-eis-notiz" className="tf-label">
                    Notiz zur offenen Terminierung
                  </label>
                  <input id="t-eis-notiz" className="tf-input"
                         placeholder="z.B. Kunde meldet sich Ende KW 34"
                         value={aufEisNotiz} onChange={(e) => setAufEisNotiz(e.target.value)} />
                </div>
              )}

              {/* Abrechnungs-Ausnahme — nur bei ABA. */}
              {isAba && (
                <div className="sm:col-span-6 lg:col-span-12">
                  <label className="tf-check">
                    <input
                      type="checkbox"
                      checked={abaGesamtKm}
                      onChange={(e) => setAbaGesamtKm(e.target.checked)}
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

          {/* Protokoll — Zuweisungen erst nach Save möglich (Tour-ID nötig). */}
          <TfBlock titel="Protokoll">
            <ProtokollSection
              tourId={null}
              protokollArt={protokollArt}
              greimelZugangId={greimelZugangId}
              appNotiz={appNotiz}
              onChange={(p) => {
                if ('protokoll_art' in p) setProtokollArt(p.protokoll_art ?? null);
                if ('greimel_zugang_id' in p) setGreimelZugangId(p.greimel_zugang_id ?? null);
                if ('app_notiz' in p) setAppNotiz(p.app_notiz ?? '');
              }}
              isGreimel={isGreimelAuftraggeber(selectedAg)}
              fahrerId={fahrerId || null}
              templates={templates}
              zugaenge={zugaenge}
              externeApp={selectedAg ? {
                name: selectedAg.externe_app_name,
                url:  selectedAg.externe_app_url,
              } : null}
            />
          </TfBlock>

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary" disabled={saving}>
              Abbrechen
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={saving || !startStadt.trim() || !zielStadt.trim()
                || (!aufEis && (!startdatum || !enddatum))}
            >
              {saving ? 'Anlegen …' : 'Tour anlegen'}
            </button>
          </div>
        </form>
      </div>

      {abcWarnung && (
        <ConfirmDialog
          title="Tourenart prüfen"
          message={ABC_WARNUNG_TEXT}
          confirmLabel="Auf ABC ändern"
          cancelLabel="AB beibehalten"
          onConfirm={async () => {
            setTourenart('ABC');
            setTourenartManuell(true);
            setAbcWarnung(false);
            await speichern();
          }}
          onClose={() => {
            // "AB beibehalten" — bewusste Entscheidung, also speichern.
            setAbcWarnung(false);
            void speichern();
          }}
        />
      )}

      {routeDialog && (() => {
        const isHin = routeDialog === 'hin';
        const origin = isHin ? adresseStart.trim() : adresseZiel.trim();
        const destination = isHin ? adresseZiel.trim() : adresseRueckfuehrung.trim();
        const title = isHin ? 'Routen für Hin-Strecke' : 'Routen für Rück-Strecke';
        return (
          <RouteSelectorDialog
            title={title}
            origin={origin}
            destination={destination}
            onClose={() => setRouteDialog(null)}
            onApply={(km) => {
              if (isHin) {
                setKmHin(String(km));
                setRouteConfirm((c) => ({ ...c, hin: km }));
              } else {
                setKmRueck(String(km));
                setRouteConfirm((c) => ({ ...c, rueck: km }));
              }
              setRouteDialog(null);
            }}
          />
        );
      })()}
    </div>
  );
}

function RouteCalcRow({
  disabled, label, confirmKm, onClick,
}: {
  disabled: boolean;
  label: string;
  /** km der zuletzt übernommenen Berechnung — wenn gesetzt, erscheint
   *  rechts eine kleine grüne Bestätigung. */
  confirmKm?: number;
  onClick: () => void;
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={disabled ? 'Adressen ausfüllen, dann verfügbar' : label}
        className="inline-flex items-center gap-1 rounded-md border border-maja-navy/20 bg-white px-2 py-1 text-[11px] font-medium text-maja-navy transition hover:bg-maja-light disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RouteSmallIcon className="h-3.5 w-3.5" />
        {label}
      </button>
      {confirmKm != null && confirmKm > 0 && (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
          <CheckIcon className="h-3 w-3" /> {confirmKm} km
        </span>
      )}
    </div>
  );
}

function RouteSmallIcon({ className }: { className?: string }) {
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

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { XIcon } from '../../components/icons';
import { computeKmGesamt, computeTourStatus, fetchTourPriceBreakdown, formatEuro, formatKm, type TourPriceBreakdown } from '../../lib/touren';
import { assignFahrerToZugang, isGreimelAuftraggeber } from '../../lib/greimel';
import { FahrerSelect, type FahrerOptionRaw } from './FahrerSelect';
import { ProtokollSection } from './ProtokollSection';
import type {
  AppUser, Auftraggeber, AuftraggeberKontakt, Fahrer, FormularTemplate, GreimelZugang, ProtokollArt, TourenArt,
} from '../../types/db';

type FahrerWithUser = Fahrer & { user: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null };

interface Props {
  onClose: () => void;
  onCreated: () => void;
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
  // Pflichtfelder
  const [startStadt, setStartStadt] = useState(initial?.startStadt ?? '');
  const [zielStadt, setZielStadt]   = useState(initial?.zielStadt ?? '');

  // Rückführung
  const [hatRueckfuehrung, setHatRueckfuehrung] = useState(false);
  const [rueckfuehrungStadt, setRueckfuehrungStadt] = useState('');

  // km
  const [kmHin, setKmHin]     = useState('');
  const [kmRueck, setKmRueck] = useState('');
  const [kmGesamtAba, setKmGesamtAba] = useState(''); // bei Tourenart=ABA

  // Auftraggeber/Fahrer
  const [auftraggeber, setAuftraggeber] = useState<Auftraggeber[]>([]);
  const [fahrer, setFahrer] = useState<FahrerWithUser[]>([]);
  const [auftraggeberId, setAuftraggeberId] = useState('');
  const [fahrerId, setFahrerId] = useState('');

  // Tourenart + Daten
  const [tourenart, setTourenart]   = useState<TourenArt | ''>('');
  const [startdatum, setStartdatum] = useState('');
  const [enddatum, setEnddatum]     = useState('');

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
  const [kontaktId, setKontaktId] = useState('');
  const [kontakte, setKontakte] = useState<AuftraggeberKontakt[]>([]);

  // Protokoll
  const [protokollArt, setProtokollArt] = useState<ProtokollArt | null>(null);
  const [schriftlichesProtokollId, setSchriftlichesProtokollId] = useState<string | null>(null);
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
        supabase.from('auftraggeber').select('*').order('name'),
        supabase
          .from('fahrer')
          .select('*, user:user_id (email, vorname, nachname)')
          .eq('aktiv', true),
        supabase.from('formular_templates').select('id, name').order('name'),
        supabase.from('greimel_zugaenge').select('*'),
      ]);
      setAuftraggeber(Array.isArray(agRes.data) ? agRes.data : []);
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

  const kmGesamt = useMemo(() => {
    if (isAba) return parseInteger(kmGesamtAba);
    return computeKmGesamt({
      km_hin: parseInteger(kmHin),
      km_rueck: parseInteger(kmRueck),
      hatRueckfuehrung,
    });
  }, [isAba, kmGesamtAba, kmHin, kmRueck, hatRueckfuehrung]);

  // Auto-Preis berechnen, sobald Auftraggeber + km + tourenart + ist_e_fahrzeug sich ändern
  useEffect(() => {
    if (istSondervereinbarung) { setBreakdown(null); return; }
    if (!auftraggeberId || kmGesamt == null) { setBreakdown(null); return; }
    let cancelled = false;
    setPricing(true);
    void fetchTourPriceBreakdown({
      auftraggeberId,
      km: kmGesamt,
      tourenart: (tourenart || 'AB') as TourenArt,
      istEFahrzeug,
    }).then((b) => {
      if (cancelled) return;
      setBreakdown(b);
      setPricing(false);
    });
    return () => { cancelled = true; };
  }, [auftraggeberId, kmGesamt, tourenart, istSondervereinbarung, istEFahrzeug]);

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
      setKmRueck('');
      setKennzeichenRueck('');
    } else {
      setHatRueckfuehrung(true);
    }
  }


  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const start = startStadt.trim();
    const ziel  = zielStadt.trim();
    if (!start || !ziel) {
      setError('Start-Stadt und Ziel-Stadt sind Pflichtfelder.');
      return;
    }
    if (!startdatum || !enddatum) {
      setError('Start- und Enddatum sind Pflichtfelder.');
      return;
    }

    if (hatRueckfuehrung && !rueckfuehrungStadt.trim()) {
      setError('Rückführung aktiviert: Stadt darf nicht leer sein.');
      return;
    }

    let km_hin: number | null;
    let km_rueck: number | null;
    if (isAba) {
      km_hin = parseInteger(kmGesamtAba);
      km_rueck = null;
    } else {
      km_hin = parseInteger(kmHin);
      km_rueck = hatRueckfuehrung ? parseInteger(kmRueck) : null;
    }

    const kennzeichen: string[] = [];
    const kzHin = kennzeichenHin.trim().toUpperCase();
    if (kzHin) kennzeichen.push(kzHin);
    if (hatRueckfuehrung) {
      const kzRueck = kennzeichenRueck.trim().toUpperCase();
      if (kzRueck) kennzeichen.push(kzRueck);
    }

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

    setSaving(true);
    const ag = (auftraggeber ?? []).find((a) => a.id === auftraggeberId) ?? null;
    // Bei einer rückwirkend angelegten Tour (Datum bereits in der Vergangenheit)
    // wird der Greimel-Zugang nicht zugewiesen, weil die Tour als
    // "abgeschlossen" gilt.
    // <input type="date"> liefert direkt "YYYY-MM-DD" — exakt das Format,
    // das eine Postgres-date-Spalte erwartet. Keine Timezone-Umrechnung.
    // startdatum/enddatum sind seit Migration 028 NOT NULL.
    const dateStart = startdatum;
    const dateEnd   = enddatum;
    const willBeCompleted = computeTourStatus(dateStart, dateEnd) === 'abgeschlossen';
    const greimelEffective = isGreimelAuftraggeber(ag) && protokollArt === 'app' && !willBeCompleted
      ? greimelZugangId
      : null;
    const schriftlichEffective = protokollArt === 'schriftlich' ? schriftlichesProtokollId : null;

    const payload = {
      start_stadt: start,
      ziel_stadt: ziel,
      rueckfuehrung_stadt: hatRueckfuehrung ? rueckfuehrungStadt.trim() : null,
      km_hin,
      km_rueck,
      km_gesamt: kmGesamt,
      auftraggeber_id: auftraggeberId || null,
      fahrer_id: fahrerId || null,
      kontakt_id: kontaktId || null,
      tourenart: tourenart || null,
      startdatum: dateStart,
      enddatum: dateEnd,
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
      protokoll_art: protokollArt,
      schriftliches_protokoll_id: schriftlichEffective,
      greimel_zugang_id: greimelEffective,
      app_notiz: protokollArt === 'app' && appNotiz.trim() ? appNotiz.trim() : null,
      rechnungsdatum_abweichend: rechnungsdatumAbweichend,
      rechnungsdatum: rechnungsdatumAbweichend && rechnungsdatum ? rechnungsdatum : null,
    };

    const { error: err } = await supabase.from('touren').insert(payload);
    if (err) { setSaving(false); setError(err.message); return; }

    // Greimel-Zugang automatisch dem Fahrer zuweisen
    if (greimelEffective && fahrerId) {
      try { await assignFahrerToZugang(greimelEffective, fahrerId); }
      catch (e) { console.warn('Greimel-Zugang-Zuweisung fehlgeschlagen', e); }
    }

    setSaving(false);
    onCreated();
  }

  // Wrapper-Klassen je nach variant:
  //  - modal:     klassisches Overlay
  //  - embedded:  einfache Card im Eltern-Container (für Side-by-Side
  //               im Posteingang)
  const outerCls = variant === 'embedded'
    ? ''
    : 'fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8';
  const innerCls = variant === 'embedded'
    ? 'card w-full p-5'
    : 'card w-full max-w-2xl p-6';
  return (
    <div className={outerCls}>
      <div className={innerCls}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-maja-navy">Neue Tour anlegen</h2>
            <p className="text-xs text-maja-muted">
              Start- und Ziel-Stadt sowie Start- und Enddatum sind Pflicht. Alle
              anderen Felder sind optional.
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

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {/* Start / Ziel */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="t-start" className="label">Start-Stadt *</label>
              <input id="t-start" className="input" required
                     value={startStadt} onChange={(e) => setStartStadt(e.target.value)} />
            </div>
            <div>
              <label htmlFor="t-ziel" className="label">Ziel-Stadt *</label>
              <input id="t-ziel" className="input" required
                     value={zielStadt} onChange={(e) => setZielStadt(e.target.value)} />
            </div>
          </div>

          {/* Rückführung */}
          {!hatRueckfuehrung ? (
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-sm"
              onClick={toggleRueckfuehrung}
            >
              + Rückführung
            </button>
          ) : (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="t-rueck" className="label mb-0">Rückführung-Stadt</label>
                <button
                  type="button"
                  onClick={toggleRueckfuehrung}
                  className="text-xs font-medium text-red-600 hover:underline"
                >
                  Rückführung entfernen
                </button>
              </div>
              <input
                id="t-rueck"
                className="input"
                value={rueckfuehrungStadt}
                onChange={(e) => setRueckfuehrungStadt(e.target.value)}
              />
            </div>
          )}

          {/* km Felder */}
          {isAba ? (
            <div>
              <label htmlFor="t-km-aba" className="label">Kilometer gesamt</label>
              <input id="t-km-aba" className="input" type="number" min={0} step={1}
                     value={kmGesamtAba} onChange={(e) => setKmGesamtAba(e.target.value)} />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="t-km-hin" className="label">km Hin (Start → Ziel)</label>
                <input id="t-km-hin" className="input" type="number" min={0} step={1}
                       value={kmHin} onChange={(e) => setKmHin(e.target.value)} />
              </div>
              {hatRueckfuehrung && (
                <div>
                  <label htmlFor="t-km-rueck" className="label">km Rück (Ziel → Rückführung)</label>
                  <input id="t-km-rueck" className="input" type="number" min={0} step={1}
                         value={kmRueck} onChange={(e) => setKmRueck(e.target.value)} />
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg bg-maja-light px-3 py-2 text-sm">
            <span className="text-maja-muted">Gesamtstrecke (live): </span>
            <span className="font-semibold text-maja-navy">{formatKm(kmGesamt)}</span>
          </div>

          {/* Auftraggeber + Fahrer */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="t-ag" className="label">Auftraggeber</label>
              <select id="t-ag" className="input"
                      value={auftraggeberId}
                      onChange={(e) => setAuftraggeberId(e.target.value)}>
                <option value="">— kein Auftraggeber —</option>
                {(auftraggeber ?? []).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="t-fa" className="label">Fahrer</label>
              <FahrerSelect
                id="t-fa"
                value={fahrerId}
                onChange={setFahrerId}
                fahrer={fahrer as FahrerOptionRaw[]}
              />
            </div>
          </div>

          {/* Kontakt-Dropdown (nur wenn Auftraggeber + Kontakte vorhanden) */}
          {auftraggeberId && kontakte.length > 0 && (
            <div>
              <label htmlFor="t-kontakt" className="label">Rechnungsempfänger</label>
              <select id="t-kontakt" className="input"
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

          {/* Tourenart + Daten */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="t-art" className="label">Tourenart</label>
              <select id="t-art" className="input"
                      value={tourenart}
                      onChange={(e) => setTourenart(e.target.value as TourenArt | '')}>
                <option value="">—</option>
                <option value="AB">AB</option>
                <option value="ABC">ABC</option>
                <option value="ABA">ABA</option>
              </select>
            </div>
            <div>
              <label htmlFor="t-start-dt" className="label">
                Startdatum <span className="text-red-600">*</span>
              </label>
              <input id="t-start-dt" type="date" className="input" required
                     value={startdatum} onChange={(e) => setStartdatum(e.target.value)} />
            </div>
            <div>
              <label htmlFor="t-end-dt" className="label">
                Enddatum <span className="text-red-600">*</span>
              </label>
              <input id="t-end-dt" type="date" className="input" required
                     value={enddatum} onChange={(e) => setEnddatum(e.target.value)} />
            </div>
          </div>

          {/* Rechnungsdatum (optional, abweichend vom Tourendatum) */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-maja-ink">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy focus:ring-maja-accent"
                checked={rechnungsdatumAbweichend}
                onChange={(e) => setRechnungsdatumAbweichend(e.target.checked)}
              />
              Rechnungsdatum abweichend vom Tourendatum
            </label>
            {rechnungsdatumAbweichend && (
              <div>
                <label htmlFor="t-rechn-dt" className="label">Rechnungsdatum</label>
                <input id="t-rechn-dt" type="date" className="input"
                       value={rechnungsdatum}
                       onChange={(e) => setRechnungsdatum(e.target.value)} />
              </div>
            )}
          </div>

          {/* Kennzeichen */}
          {!hatRueckfuehrung ? (
            <div>
              <label htmlFor="t-kz" className="label">Kennzeichen</label>
              <input id="t-kz" className="input" placeholder="z.B. M-XY 1234"
                     value={kennzeichenHin}
                     onChange={(e) => setKennzeichenHin(e.target.value)} />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="t-kz-hin" className="label">Kennzeichen Hin</label>
                <input id="t-kz-hin" className="input"
                       value={kennzeichenHin}
                       onChange={(e) => setKennzeichenHin(e.target.value)} />
              </div>
              <div>
                <label htmlFor="t-kz-rueck" className="label">Kennzeichen Rück</label>
                <input id="t-kz-rueck" className="input"
                       value={kennzeichenRueck}
                       onChange={(e) => setKennzeichenRueck(e.target.value)} />
              </div>
            </div>
          )}

          {/* Protokoll */}
          <ProtokollSection
            protokollArt={protokollArt}
            schriftlichesProtokollId={schriftlichesProtokollId}
            greimelZugangId={greimelZugangId}
            appNotiz={appNotiz}
            onChange={(p) => {
              if ('protokoll_art' in p) setProtokollArt(p.protokoll_art ?? null);
              if ('schriftliches_protokoll_id' in p) setSchriftlichesProtokollId(p.schriftliches_protokoll_id ?? null);
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

          {/* Sondervereinbarung */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-maja-ink">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy focus:ring-maja-accent"
                checked={istSondervereinbarung}
                onChange={(e) => setIstSondervereinbarung(e.target.checked)}
              />
              Sondervereinbarung
            </label>
            {istSondervereinbarung && (
              <div>
                <label htmlFor="t-sv-note" className="label">Anmerkung zur Sondervereinbarung</label>
                <input id="t-sv-note" className="input"
                       value={sondervereinbarung}
                       onChange={(e) => setSondervereinbarung(e.target.value)} />
              </div>
            )}
          </div>

          {/* E-Fahrzeug-Checkbox + FIN */}
          <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
            <label className="flex items-center gap-2 text-sm font-medium text-maja-ink">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy focus:ring-maja-accent"
                checked={istEFahrzeug}
                onChange={(e) => setIstEFahrzeug(e.target.checked)}
              />
              E-Fahrzeug
            </label>
            <div>
              <label htmlFor="t-fin" className="label">FIN</label>
              <input id="t-fin" className="input"
                     value={fin}
                     onChange={(e) => setFin(e.target.value.toUpperCase())} />
            </div>
          </div>

          {/* Vergütung */}
          <div>
            <label htmlFor="t-verg" className="label">Vergütung (€)</label>
            {istSondervereinbarung ? (
              <>
                <input
                  id="t-verg"
                  className="input"
                  type="text"
                  inputMode="decimal"
                  placeholder="z.B. 1234,56"
                  value={verguetungInput}
                  onChange={(e) => setVerguetungInput(e.target.value)}
                />
                <p className="mt-1 text-xs text-maja-muted">
                  Manueller Preis (Sondervereinbarung aktiv).
                </p>
              </>
            ) : (
              <>
                <input
                  id="t-verg"
                  className="input bg-maja-light"
                  type="text"
                  readOnly
                  value={pricing ? '…' : (breakdown?.total == null ? '' : Number(breakdown.total).toFixed(2).replace('.', ','))}
                />
                <p className="mt-1 text-xs text-maja-muted">
                  {auftraggeberId && kmGesamt != null
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

          {/* Kundenname */}
          <div>
            <label htmlFor="t-kn" className="label">Kundenname</label>
            <input id="t-kn" className="input"
                   value={kundenname}
                   onChange={(e) => setKundenname(e.target.value)} />
          </div>

          {/* Info */}
          <div>
            <label htmlFor="t-info" className="label">Info</label>
            <textarea id="t-info" className="input min-h-[5rem]"
                      value={info} onChange={(e) => setInfo(e.target.value)} />
          </div>

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
              disabled={saving || !startStadt.trim() || !zielStadt.trim() || !startdatum || !enddatum}
            >
              {saving ? 'Anlegen …' : 'Tour anlegen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import { useTestGuard } from '../../auth/TestModeContext';
import { SuggestCombobox } from '../../components/SuggestCombobox';
import { StationFeldsatz } from '../../components/StationFeldsatz';
import { RouteFeldsatz } from '../../components/RouteFeldsatz';
import { composeAdresse } from '../../lib/adresse';
import { TfBlock } from '../../components/TfBlock';
import { useScrollLock } from '../../lib/useScrollLock';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import {
  ABC_WARNUNG_TEXT, automatischeTourenart, brauchtAbcWarnung,
} from '../../lib/tourenartAutomatik';
import { RouteSelectorDialog } from '../../components/RouteSelectorDialog';
import {
  leereKontaktMap, toPayload, type KontaktMap,
} from '../../lib/tourAnsprechpartner';
import type { TourenArt } from '../../types/db';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

/**
 * Vereinfachtes "Neue Tour"-Formular für Auftraggeber-Profile.
 *
 * Bewusst OHNE: Preisberechnung, km-Felder, Vergütung, Preisstufen,
 * Fahrer-Zuweisung, Sondervereinbarung, Greimel. Der Auftraggeber ist
 * fest das eigene Profil-Konto. Gespeichert wird mit bestaetigt=false —
 * die Tour erscheint beim Admin "Zur Bestätigung" und beim Auftraggeber
 * als "In Prüfung".
 */
/**
 * km-Feld plus "Entfernung berechnen"-Button. Steht direkt unter der
 * jeweiligen Adresse — dieselbe Stelle wie in der Admin-Ansicht.
 */
function KmZeile({
  label, kmLabel, km, onKm, disabled, onBerechnen,
}: {
  label: string;
  kmLabel: string;
  km: string;
  onKm: (v: string) => void;
  disabled: boolean;
  onBerechnen: () => void;
}) {
  const id = `km-${kmLabel.replace(/[^a-zA-Z]+/g, '-').toLowerCase()}`;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="tf-label">{kmLabel}</label>
      <input id={id} className="tf-input" inputMode="numeric" placeholder="z.B. 120"
             value={km} onChange={(e) => onKm(e.target.value)} />
      <button
        type="button"
        className="mt-1 inline-flex items-center rounded-md border border-maja-navy/20 bg-white px-2 py-1 text-[11px] font-medium text-maja-navy transition hover:bg-maja-light disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        title={disabled ? 'Beide Adressen ausfüllen, dann ist die Berechnung möglich' : label}
        onClick={onBerechnen}
      >
        {label}
      </button>
    </div>
  );
}

/** km-Eingabe → Ganzzahl oder null (leeres Feld bleibt leer). */
function parseKm(v: string): number | null {
  const t = v.trim().replace(',', '.');
  if (!t) return null;
  const n = Math.round(Number(t));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function AuftraggeberTourCreateDialog({ onClose, onCreated }: Props) {
  const { profile, session } = useAuth();
  const guard = useTestGuard();
  // Punkt 3: Hintergrund darf nicht scrollen, solange das Modal offen ist.
  useScrollLock();

  const [tourenart, setTourenart] = useState<TourenArt | ''>('');
  const [startStadt, setStartStadt] = useState('');
  const [zielStadt, setZielStadt] = useState('');
  const [rueckStadt, setRueckStadt] = useState('');
  const [startdatum, setStartdatum] = useState('');
  const [enddatum, setEnddatum] = useState('');
  // Auf Eis (Migration 086): Tour findet statt, Termin noch offen.
  const [aufEis, setAufEis] = useState(false);
  const [aufEisNotiz, setAufEisNotiz] = useState('');
  const [kennzeichenHin, setKennzeichenHin] = useState('');
  const [kennzeichenRueck, setKennzeichenRueck] = useState('');
  const [fin, setFin] = useState('');
  const [istEFahrzeug, setIstEFahrzeug] = useState(false);
  const [kundenname, setKundenname] = useState('');
  // Adresse strukturiert (Migration 086). Die Stadt ist die Tour-Stadt
  // — kein separates Adress-Stadt-Feld.
  const [strasseStart, setStrasseStart] = useState('');
  const [hausnummerStart, setHausnummerStart] = useState('');
  const [plzStart, setPlzStart] = useState('');
  const [strasseZiel, setStrasseZiel] = useState('');
  const [hausnummerZiel, setHausnummerZiel] = useState('');
  const [plzZiel, setPlzZiel] = useState('');
  const [strasseRueck, setStrasseRueck] = useState('');
  const [hausnummerRueck, setHausnummerRueck] = useState('');
  const [plzRueck, setPlzRueck] = useState('');
  // Zusammengesetzt — daran hängen Routenberechnung und Pflichtprüfung.
  const adresseStart = composeAdresse({
    strasse: strasseStart, hausnummer: hausnummerStart, plz: plzStart, stadt: startStadt,
  }) ?? '';
  const adresseZiel = composeAdresse({
    strasse: strasseZiel, hausnummer: hausnummerZiel, plz: plzZiel, stadt: zielStadt,
  }) ?? '';
  const adresseRueck = composeAdresse({
    strasse: strasseRueck, hausnummer: hausnummerRueck, plz: plzRueck, stadt: rueckStadt,
  }) ?? '';
  const [kontakte, setKontakte] = useState<KontaktMap>(() => leereKontaktMap());
  const [info, setInfo] = useState('');
  // Optionale Zusatzangaben. Zeiten sind Freitext je Station (081).
  const [fahrzeugmodell, setFahrzeugmodell] = useState('');
  const [fahrzeugmodellRueck, setFahrzeugmodellRueck] = useState('');
  // Merkt sich eine manuelle Tourenart-Wahl — ab dann keine Automatik.
  const [tourenartManuell, setTourenartManuell] = useState(false);
  const [abcWarnung, setAbcWarnung] = useState(false);
  const [zeitStart, setZeitStart] = useState('');
  const [zeitZiel, setZeitZiel] = useState('');
  const [zeitRueck, setZeitRueck] = useState('');
  // km darf der Auftraggeber selbst pflegen (081) — der Preis bleibt
  // Sache von Maja-Logistik.
  const [kmHin, setKmHin] = useState('');
  const [kmRueck, setKmRueck] = useState('');
  const [routeDialog, setRouteDialog] = useState<null | 'hin' | 'rueck'>(null);

  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ABA/ABC haben eine Rückführung → Adresse Rückführung wird Pflicht.
  const hatRueckfuehrung = tourenart === 'ABA' || tourenart === 'ABC';
  // km gesamt ergibt sich aus Hin + Rück (bei AB nur Hin).
  const kmGesamt = (() => {
    const hin = parseKm(kmHin) ?? 0;
    const rueck = hatRueckfuehrung ? (parseKm(kmRueck) ?? 0) : 0;
    const summe = hin + rueck;
    return summe > 0 ? summe : null;
  })();

  function inputCls(key: string): string {
    return missing.has(key) ? 'tf-input border-red-500' : 'tf-input';
  }

  // AB/ABC automatisch, solange die Tourenart nicht manuell gewählt wurde.
  useEffect(() => {
    const naechste = automatischeTourenart({
      aktuell: tourenart,
      rueckStadt: rueckStadt,
      rueckAdresse: adresseRueck,
      manuell: tourenartManuell,
    });
    if (naechste == null) return;
    const t = window.setTimeout(() => setTourenart(naechste), 0);
    return () => window.clearTimeout(t);
  }, [tourenart, rueckStadt, adresseRueck, tourenartManuell]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Sicherheitsnetz: Rückführung befüllt, Tourenart aber AB.
    if (brauchtAbcWarnung(tourenart, rueckStadt, adresseRueck)) {
      setAbcWarnung(true);
      return;
    }
    void speichern();
  }

  async function speichern() {
    setError(null);

    // Pflichtfelder prüfen — fehlende rot markieren.
    const miss = new Set<string>();
    if (!tourenart) miss.add('tourenart');
    if (!startStadt.trim()) miss.add('startStadt');
    if (!zielStadt.trim()) miss.add('zielStadt');
    // Ohne festen Termin darf das Datum leer bleiben — dann muss die
    // Tour aber ausdrücklich auf Eis liegen.
    if (!aufEis && !startdatum) miss.add('startdatum');
    if (!aufEis && !enddatum) miss.add('enddatum');
    if (!kennzeichenHin.trim()) miss.add('kennzeichen');
    if (!fin.trim()) miss.add('fin');
    if (!kundenname.trim()) miss.add('kundenname');
    if (!adresseStart.trim()) miss.add('adresseStart');
    if (!adresseZiel.trim()) miss.add('adresseZiel');
    if (!kontakte.start[0]?.name.trim()) miss.add('kontaktStart');
    if (!kontakte.ziel[0]?.name.trim()) miss.add('kontaktZiel');
    if (hatRueckfuehrung) {
      if (!rueckStadt.trim()) miss.add('rueckStadt');
      if (!adresseRueck.trim()) miss.add('adresseRueck');
    }
    setMissing(miss);
    if (miss.size > 0) {
      setError('Bitte alle Pflichtfelder ausfüllen (rot markiert).');
      return;
    }

    if (!profile?.auftraggeber_id || !session) {
      setError('Ihrem Konto ist kein Auftraggeber zugeordnet — bitte wenden Sie sich an Maja-Logistik.');
      return;
    }
    if (guard()) { onClose(); return; }

    const kennzeichen = [kennzeichenHin.trim().toUpperCase()];
    if (hatRueckfuehrung && kennzeichenRueck.trim()) {
      kennzeichen.push(kennzeichenRueck.trim().toUpperCase());
    }

    // Der Payload enthält AUSSCHLIESSLICH Felder, die der Auftraggeber
    // setzen darf. Auftraggeber, Ersteller und Bestätigungs-Status setzt
    // der Server — nicht der Client (siehe ag_tour_anlegen, 084).
    const payload = {
      start_stadt: startStadt.trim(),
      ziel_stadt: zielStadt.trim(),
      rueckfuehrung_stadt: hatRueckfuehrung ? (rueckStadt.trim() || null) : null,
      startdatum: startdatum || null,
      enddatum: enddatum || null,
      auf_eis: aufEis,
      auf_eis_notiz: aufEis ? (aufEisNotiz.trim() || null) : null,
      tourenart: tourenart || null,
      kennzeichen,
      fin: fin.trim() || null,
      ist_e_fahrzeug: istEFahrzeug,
      kundenname: kundenname.trim() || null,
      adresse_start: adresseStart.trim() || null,
      adresse_ziel: adresseZiel.trim() || null,
      adresse_rueckfuehrung: hatRueckfuehrung ? (adresseRueck.trim() || null) : null,
      strasse_start: strasseStart.trim() || null,
      hausnummer_start: hausnummerStart.trim() || null,
      plz_start: plzStart.trim() || null,
      strasse_ziel: strasseZiel.trim() || null,
      hausnummer_ziel: hausnummerZiel.trim() || null,
      plz_ziel: plzZiel.trim() || null,
      strasse_rueckfuehrung: hatRueckfuehrung ? (strasseRueck.trim() || null) : null,
      hausnummer_rueckfuehrung: hatRueckfuehrung ? (hausnummerRueck.trim() || null) : null,
      plz_rueckfuehrung: hatRueckfuehrung ? (plzRueck.trim() || null) : null,
      fahrzeugmodell: fahrzeugmodell.trim() || null,
      fahrzeugmodell_rueck: hatRueckfuehrung ? (fahrzeugmodellRueck.trim() || null) : null,
      zeit_start: zeitStart.trim() || null,
      zeit_ziel: zeitZiel.trim() || null,
      zeit_rueckfuehrung: hatRueckfuehrung ? (zeitRueck.trim() || null) : null,
      km_hin: parseKm(kmHin),
      km_rueck: hatRueckfuehrung ? parseKm(kmRueck) : null,
      km_gesamt: kmGesamt,
      info: info.trim() || null,
    };
    console.log('[AG Tour Insert]', payload);

    setSaving(true);
    const { data: rpcData, error: rpcErr } = await supabase.rpc('ag_tour_anlegen', {
      p_daten: payload as never,
    });
    const ergebnis = (rpcData as unknown as { ok?: boolean; id?: string; fehler?: string } | null);
    if (rpcErr || !ergebnis?.ok) {
      setSaving(false);
      // Technische Meldung nur ins Log — der Nutzer bekommt Klartext.
      console.error('[AG Tour Insert] fehlgeschlagen', rpcErr ?? ergebnis);
      const roh = (ergebnis?.fehler ?? rpcErr?.message ?? '').trim();
      const technisch = !roh
        || /row-level security|violates|constraint|permission denied/i.test(roh);
      setError(technisch
        ? 'Die Tour konnte nicht eingereicht werden. Bitte prüfen Sie Ihre '
          + 'Eingaben oder wenden Sie sich an Maja-Logistik.'
        : roh);
      return;
    }
    const neu = { id: ergebnis.id as string };

    // Ansprechpartner anlegen. Beim ANLEGEN einer eigenen Tour hat der
    // Auftraggeber Insert-Recht auf touren; für die Ansprechpartner-
    // Tabelle nicht — deshalb läuft das über dieselbe RPC wie beim
    // späteren Bearbeiten.
    if (neu?.id) {
      for (const st of ['start', 'ziel', 'rueckfuehrung'] as const) {
        if (st === 'rueckfuehrung' && !hatRueckfuehrung) continue;
        if (toPayload(kontakte[st]).length === 0) continue;
        await supabase.rpc('ag_tour_ansprechpartner_setzen', {
          p_tour_id: neu.id,
          p_station: st,
          p_liste: toPayload(kontakte[st]) as never,
        });
      }
    }
    setSaving(false);
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-5xl p-5">
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-maja-navy">Neue Tour anlegen</h2>
          <p className="text-xs text-maja-muted">
            Die Tour wird nach dem Speichern von Maja-Logistik geprüft und
            bestätigt. Pflichtfelder sind mit * markiert.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
          {/* 1 — Auftragsdaten. Ohne Vergütung und Fahrer: beides ist
              rein intern und für Auftraggeber weder sichtbar noch
              änderbar (siehe ag_tour_felder() in Migration 084). */}
          <TfBlock titel="Auftragsdaten">
            <div className="tf-grid">
              <div className="sm:col-span-2 lg:col-span-3">
                <label htmlFor="at-art" className="tf-label">Tourenart *</label>
                <select id="at-art" className={inputCls('tourenart')}
                        value={tourenart}
                        onChange={(e) => {
                          setTourenart(e.target.value as TourenArt | '');
                          setTourenartManuell(true);
                        }}>
                  <option value="">— wählen —</option>
                  <option value="AB">AB (einfach)</option>
                  <option value="ABA">ABA (hin + zurück)</option>
                  <option value="ABC">ABC (Dreieck)</option>
                </select>
              </div>
              <div className="sm:col-span-4 lg:col-span-4">
                <label htmlFor="at-kunde" className="tf-label">Kundenname *</label>
                <input id="at-kunde" className={inputCls('kundenname')}
                       value={kundenname} onChange={(e) => setKundenname(e.target.value)} />
              </div>
              <div className="sm:col-span-6 lg:col-span-12">
                <label htmlFor="at-info" className="tf-label">Hinweise (optional)</label>
                <textarea id="at-info" className="tf-input min-h-[3.5rem]" rows={2}
                          value={info} onChange={(e) => setInfo(e.target.value)} />
              </div>
            </div>
          </TfBlock>

          {/* 2 — Fahrzeug Hinfahrt */}
          <TfBlock titel="Fahrzeug Hinfahrt" akzent="hin">
            <div className="tf-grid">
              <div className="sm:col-span-2 lg:col-span-3">
                <label htmlFor="at-kz" className="tf-label">Kennzeichen *</label>
                <input id="at-kz" className={inputCls('kennzeichen')}
                       value={kennzeichenHin} onChange={(e) => setKennzeichenHin(e.target.value)} />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label htmlFor="at-modell" className="tf-label">Fahrzeugmodell</label>
                <SuggestCombobox
                  id="at-modell"
                  className="tf-input"
                  feldTyp="fahrzeugmodell"
                  value={fahrzeugmodell}
                  onChange={setFahrzeugmodell}
                  placeholder="z.B. VW Polo"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <label htmlFor="at-fin" className="tf-label">FIN *</label>
                <input id="at-fin" className={inputCls('fin')}
                       value={fin} onChange={(e) => setFin(e.target.value)} />
              </div>
              <div className="sm:col-span-6 lg:col-span-2">
                <label className="tf-check">
                  <input type="checkbox"
                         checked={istEFahrzeug} onChange={(e) => setIstEFahrzeug(e.target.checked)} />
                  E-Fahrzeug
                </label>
              </div>
            </div>
          </TfBlock>

          {/* Route — dieselben Städte wie in den Ort-Blöcken, hier an
              der Stelle bearbeitbar, an der die Tour als Route erscheint. */}
          <RouteFeldsatz
            idPrefix="at"
            pflicht
            startStadt={startStadt} onStartStadt={setStartStadt}
            zielStadt={zielStadt} onZielStadt={setZielStadt}
            rueckStadt={hatRueckfuehrung ? rueckStadt : undefined}
            onRueckStadt={hatRueckfuehrung ? setRueckStadt : undefined}
            startFehler={missing.has('startStadt')}
            zielFehler={missing.has('zielStadt')}
            rueckFehler={missing.has('rueckStadt')}
          />

          {/* 3 — Abholort */}
          <StationFeldsatz
            titel="Abholort"
            idPrefix="at-st1"
            stadtLabel="Stadt"
            stadt={startStadt} onStadt={setStartStadt}
            stadtPflicht stadtFehler={missing.has('startStadt')}
            strasse={strasseStart} onStrasse={setStrasseStart}
            hausnummer={hausnummerStart} onHausnummer={setHausnummerStart}
            plz={plzStart} onPlz={setPlzStart}
            adressePflicht adresseFehler={missing.has('adresseStart')}
            zeit={zeitStart} onZeit={setZeitStart} zeitLabel="Zeit Abholung"
            kontakte={kontakte.start}
            onKontakte={(next) => setKontakte((m) => ({ ...m, start: next }))}
            kontaktPflicht kontaktFehler={missing.has('kontaktStart')}
          />

          {/* 4 — Zielort */}
          <StationFeldsatz
            titel="Zielort"
            idPrefix="at-st2"
            stadtLabel="Stadt"
            stadt={zielStadt} onStadt={setZielStadt}
            stadtPflicht stadtFehler={missing.has('zielStadt')}
            strasse={strasseZiel} onStrasse={setStrasseZiel}
            hausnummer={hausnummerZiel} onHausnummer={setHausnummerZiel}
            plz={plzZiel} onPlz={setPlzZiel}
            adressePflicht adresseFehler={missing.has('adresseZiel')}
            zeit={zeitZiel} onZeit={setZeitZiel} zeitLabel="Zeit Anlieferung"
            kontakte={kontakte.ziel}
            onKontakte={(next) => setKontakte((m) => ({ ...m, ziel: next }))}
            kontaktPflicht kontaktFehler={missing.has('kontaktZiel')}
          />

          {hatRueckfuehrung && (
            <>
              {/* 5 — Fahrzeug Rückfahrt (nur ABA/ABC) */}
              <TfBlock titel="Fahrzeug Rückfahrt" akzent="rueck">
                <div className="tf-grid">
                  <div className="sm:col-span-3 lg:col-span-3">
                    <label htmlFor="at-kz2" className="tf-label">Kennzeichen Rückführung</label>
                    <input id="at-kz2" className="tf-input"
                           value={kennzeichenRueck} onChange={(e) => setKennzeichenRueck(e.target.value)} />
                  </div>
                  <div className="sm:col-span-3 lg:col-span-4">
                    <label htmlFor="at-modell2" className="tf-label">Fahrzeugmodell Rück</label>
                    <SuggestCombobox
                      id="at-modell2"
                      className="tf-input"
                      feldTyp="fahrzeugmodell"
                      value={fahrzeugmodellRueck}
                      onChange={setFahrzeugmodellRueck}
                      placeholder="z.B. Audi A3"
                    />
                  </div>
                </div>
              </TfBlock>

              {/* 6 — Rückführungsort (nur ABA/ABC) */}
              <StationFeldsatz
                titel="Rückführungsort"
                idPrefix="at-st3"
                akzent="rueck"
                stadtLabel="Stadt"
                stadt={rueckStadt} onStadt={setRueckStadt}
                stadtPflicht stadtFehler={missing.has('rueckStadt')}
                strasse={strasseRueck} onStrasse={setStrasseRueck}
              hausnummer={hausnummerRueck} onHausnummer={setHausnummerRueck}
              plz={plzRueck} onPlz={setPlzRueck}
                adressePflicht adresseFehler={missing.has('adresseRueck')}
                zeit={zeitRueck} onZeit={setZeitRueck} zeitLabel="Zeit Rückführung"
                kontakte={kontakte.rueckfuehrung}
                onKontakte={(next) => setKontakte((m) => ({ ...m, rueckfuehrung: next }))}
              />
            </>
          )}

          {/* 7 — Kilometer & Termine */}
          <TfBlock titel="Kilometer & Termine">
            <div className="tf-grid">
              <div className="sm:col-span-3 lg:col-span-2">
                <label htmlFor="at-von" className="tf-label">
                  Startdatum{aufEis ? '' : ' *'}
                </label>
                <input id="at-von" type="date" className={inputCls('startdatum')}
                       value={startdatum} onChange={(e) => setStartdatum(e.target.value)} />
              </div>
              <div className="sm:col-span-3 lg:col-span-2">
                <label htmlFor="at-bis" className="tf-label">
                  Enddatum{aufEis ? '' : ' *'}
                </label>
                <input id="at-bis" type="date" className={inputCls('enddatum')}
                       value={enddatum} onChange={(e) => setEnddatum(e.target.value)} />
              </div>
              <div className="sm:col-span-3 lg:col-span-3">
                <KmZeile
                  label="Entfernung berechnen"
                  kmLabel="km Hin"
                  km={kmHin}
                  onKm={setKmHin}
                  disabled={!adresseStart.trim() || !adresseZiel.trim()}
                  onBerechnen={() => setRouteDialog('hin')}
                />
              </div>
              {hatRueckfuehrung && (
                <div className="sm:col-span-3 lg:col-span-3">
                  <KmZeile
                    label="Entfernung berechnen"
                    kmLabel="km Rück"
                    km={kmRueck}
                    onKm={setKmRueck}
                    disabled={!adresseZiel.trim() || !adresseRueck.trim()}
                    onBerechnen={() => setRouteDialog('rueck')}
                  />
                </div>
              )}
              {/* Auf Eis — Termin bewusst offen. */}
              <div className="sm:col-span-6 lg:col-span-12">
                <label className="tf-check">
                  <input type="checkbox"
                         checked={aufEis} onChange={(e) => setAufEis(e.target.checked)} />
                  Auf Eis legen — Termin steht noch nicht fest
                </label>
                <p className="tf-hint">
                  {aufEis
                    ? 'Die Tour wird ohne Datum eingereicht und bleibt über den Filter „Auf Eis" auffindbar.'
                    : 'Für Touren, die sicher stattfinden, aber noch kein festes Datum haben.'}
                </p>
              </div>
              {aufEis && (
                <div className="sm:col-span-6 lg:col-span-12">
                  <label htmlFor="at-eis-notiz" className="tf-label">
                    Notiz zur offenen Terminierung
                  </label>
                  <input id="at-eis-notiz" className="tf-input"
                         placeholder="z.B. Kunde meldet sich Ende KW 34"
                         value={aufEisNotiz} onChange={(e) => setAufEisNotiz(e.target.value)} />
                </div>
              )}

              <div className="sm:col-span-6 lg:col-span-2">
                <span className="tf-label">km gesamt</span>
                <div className="rounded-md bg-maja-light px-2 py-1.5 text-sm font-semibold text-maja-navy">
                  {kmGesamt == null ? '—' : `${kmGesamt} km`}
                </div>
              </div>
            </div>
          </TfBlock>

          {routeDialog && (
            <RouteSelectorDialog
              title={routeDialog === 'hin' ? 'Routen für die Hinstrecke' : 'Routen für die Rückstrecke'}
              origin={routeDialog === 'hin' ? adresseStart : adresseZiel}
              destination={routeDialog === 'hin' ? adresseZiel : adresseRueck}
              onClose={() => setRouteDialog(null)}
              onApply={(km) => {
                if (routeDialog === 'hin') setKmHin(String(km));
                else setKmRueck(String(km));
                setRouteDialog(null);
              }}
            />
          )}

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
                setAbcWarnung(false);
                void speichern();
              }}
            />
          )}

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary" disabled={saving}>
              Abbrechen
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Speichert …' : 'Tour einreichen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

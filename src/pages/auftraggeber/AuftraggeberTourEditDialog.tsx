import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTestGuard } from '../../auth/TestModeContext';
import { speichereAgTour } from '../../lib/tourAenderungen';
import { meldeTourAenderung } from '../../lib/onedrive';
import { SuggestCombobox } from '../../components/SuggestCombobox';
import { StationFeldsatz } from '../../components/StationFeldsatz';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import {
  ABC_WARNUNG_TEXT, automatischeTourenart, brauchtAbcWarnung,
} from '../../lib/tourenartAutomatik';
import { RouteSelectorDialog } from '../../components/RouteSelectorDialog';
import {
  ladeAnsprechpartner, leereKontaktMap, speichereAgAnsprechpartner,
  type KontaktMap,
} from '../../lib/tourAnsprechpartner';
import type { TourKundensicht, TourenArt } from '../../types/db';

interface Props {
  tour: TourKundensicht;
  onClose: () => void;
  onSaved: (anzahlAenderungen: number) => void;
}

/**
 * Bearbeiten einer eigenen Tour durch den Auftraggeber.
 *
 * Zeigt bewusst nur die Felder, die der Auftraggeber pflegen darf —
 * Vergütung, Fahrer, km und Preisstufen tauchen hier gar nicht auf. Das
 * ist aber nur die UI-Schicht: welche Spalten wirklich geschrieben
 * werden, entscheidet die SECURITY-DEFINER-RPC serverseitig
 * (Migration 079).
 */
/**
 * km-Feld plus "Entfernung berechnen" — gleiche Stelle und Mechanik wie
 * in der Admin-Ansicht.
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
  const id = `etkm-${kmLabel.replace(/[^a-zA-Z]+/g, '-').toLowerCase()}`;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="label">{kmLabel} (optional)</label>
        <input id={id} className="input" inputMode="numeric" placeholder="z.B. 120"
               value={km} onChange={(e) => onKm(e.target.value)} />
      </div>
      <button
        type="button"
        className="btn-secondary shrink-0 text-xs"
        disabled={disabled}
        title={disabled ? 'Beide Adressen ausfüllen, dann ist die Berechnung möglich' : label}
        onClick={onBerechnen}
      >
        {label}
      </button>
    </div>
  );
}

/** km-Eingabe → Ganzzahl oder null. */
function parseKm(v: string): number | null {
  const t = v.trim().replace(',', '.');
  if (!t) return null;
  const n = Math.round(Number(t));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function AuftraggeberTourEditDialog({ tour, onClose, onSaved }: Props) {
  const guard = useTestGuard();

  const kzHinInit = tour.kennzeichen?.[0] ?? '';
  const kzRueckInit = tour.kennzeichen?.[1] ?? '';

  const [tourenart, setTourenart] = useState<TourenArt | ''>((tour.tourenart as TourenArt) ?? '');
  const [startStadt, setStartStadt] = useState(tour.start_stadt ?? '');
  const [zielStadt, setZielStadt] = useState(tour.ziel_stadt ?? '');
  const [rueckStadt, setRueckStadt] = useState(tour.rueckfuehrung_stadt ?? '');
  const [startdatum, setStartdatum] = useState(tour.startdatum ?? '');
  const [enddatum, setEnddatum] = useState(tour.enddatum ?? '');
  const [kennzeichenHin, setKennzeichenHin] = useState(kzHinInit);
  const [kennzeichenRueck, setKennzeichenRueck] = useState(kzRueckInit);
  const [fin, setFin] = useState(tour.fin ?? '');
  const [finRueck, setFinRueck] = useState(tour.fin_rueck ?? '');
  const [istEFahrzeug, setIstEFahrzeug] = useState(!!tour.ist_e_fahrzeug);
  const [kundenname, setKundenname] = useState(tour.kundenname ?? '');
  const [adresseStart, setAdresseStart] = useState(tour.adresse_start ?? '');
  const [adresseZiel, setAdresseZiel] = useState(tour.adresse_ziel ?? '');
  const [adresseRueck, setAdresseRueck] = useState(tour.adresse_rueckfuehrung ?? '');
  const [info, setInfo] = useState(tour.info ?? '');
  const [fahrzeugmodell, setFahrzeugmodell] = useState(tour.fahrzeugmodell ?? '');
  const [fahrzeugmodellRueck, setFahrzeugmodellRueck] = useState(tour.fahrzeugmodell_rueck ?? '');
  // Bestandstouren nie automatisch umstellen.
  const [tourenartManuell, setTourenartManuell] = useState(true);
  const [abcWarnung, setAbcWarnung] = useState(false);
  // Zeiten je Station als Freitext (081).
  const [zeitStart, setZeitStart] = useState(tour.zeit_start ?? '');
  const [zeitZiel, setZeitZiel] = useState(tour.zeit_ziel ?? '');
  const [zeitRueck, setZeitRueck] = useState(tour.zeit_rueckfuehrung ?? '');
  // km darf der Auftraggeber pflegen (081); der Preis bleibt gesperrt.
  const [kmHin, setKmHin] = useState(tour.km_hin != null ? String(tour.km_hin) : '');
  const [kmRueck, setKmRueck] = useState(tour.km_rueck != null ? String(tour.km_rueck) : '');
  const [routeDialog, setRouteDialog] = useState<null | 'hin' | 'rueck'>(null);
  const [kontakte, setKontakte] = useState<KontaktMap>(() => leereKontaktMap());

  // Ansprechpartner nachladen — sie liegen seit 080 in einer eigenen
  // Tabelle, nicht mehr nur in den kontakt_*-Spalten der Tour.
  const ladeKontakte = useCallback(async () => {
    setKontakte(await ladeAnsprechpartner(tour.id));
  }, [tour.id]);
  useEffect(() => {
    const t = window.setTimeout(() => { void ladeKontakte(); }, 0);
    return () => window.clearTimeout(t);
  }, [ladeKontakte]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hatRueckfuehrung = tourenart === 'ABA' || tourenart === 'ABC';
  const kmGesamt = (() => {
    const hin = parseKm(kmHin) ?? 0;
    const rueck = hatRueckfuehrung ? (parseKm(kmRueck) ?? 0) : 0;
    const summe = hin + rueck;
    return summe > 0 ? summe : null;
  })();

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

    if (!startStadt.trim() || !zielStadt.trim()) {
      setError('Start- und Ziel-Stadt sind Pflichtfelder.');
      return;
    }
    if (!startdatum || !enddatum) {
      setError('Start- und Enddatum sind Pflichtfelder.');
      return;
    }
    if (guard()) { onClose(); return; }

    const kennzeichen = [kennzeichenHin.trim().toUpperCase()].filter(Boolean);
    if (hatRueckfuehrung && kennzeichenRueck.trim()) {
      kennzeichen.push(kennzeichenRueck.trim().toUpperCase());
    }

    setSaving(true);
    const ergebnis = await speichereAgTour(tour.id, {
      tourenart: tourenart || null,
      start_stadt: startStadt.trim(),
      ziel_stadt: zielStadt.trim(),
      rueckfuehrung_stadt: hatRueckfuehrung ? (rueckStadt.trim() || null) : null,
      startdatum,
      enddatum,
      kennzeichen,
      fin: fin.trim() || null,
      fin_rueck: hatRueckfuehrung ? (finRueck.trim() || null) : null,
      ist_e_fahrzeug: istEFahrzeug,
      kundenname: kundenname.trim() || null,
      adresse_start: adresseStart.trim() || null,
      adresse_ziel: adresseZiel.trim() || null,
      adresse_rueckfuehrung: hatRueckfuehrung ? (adresseRueck.trim() || null) : null,
      info: info.trim() || null,
      fahrzeugmodell: fahrzeugmodell.trim() || null,
      fahrzeugmodell_rueck: hatRueckfuehrung ? (fahrzeugmodellRueck.trim() || null) : null,
      zeit_start: zeitStart.trim() || null,
      zeit_ziel: zeitZiel.trim() || null,
      zeit_rueckfuehrung: hatRueckfuehrung ? (zeitRueck.trim() || null) : null,
      km_hin: parseKm(kmHin),
      km_rueck: hatRueckfuehrung ? parseKm(kmRueck) : null,
      km_gesamt: kmGesamt,
    });

    if (!ergebnis.ok) {
      setSaving(false);
      setError(ergebnis.fehler ?? 'Speichern fehlgeschlagen.');
      return;
    }

    // Ansprechpartner separat — eigene RPC mit denselben Prüfungen.
    let kontaktAenderungen = 0;
    for (const st of ['start', 'ziel', 'rueckfuehrung'] as const) {
      if (st === 'rueckfuehrung' && !hatRueckfuehrung) continue;
      const res = await speichereAgAnsprechpartner(tour.id, st, kontakte[st]);
      if (!res.ok) {
        setSaving(false);
        setError(res.fehler ?? 'Ansprechpartner konnten nicht gespeichert werden.');
        return;
      }
      if (res.geaendert) kontaktAenderungen += 1;
    }
    setSaving(false);

    const anzahl = (ergebnis.aenderungen?.length ?? 0) + kontaktAenderungen;
    // Bei einer BEREITS BESTÄTIGTEN Tour zusätzlich den Admin per E-Mail
    // informieren — dort ist die Änderung am relevantesten. Betreff und
    // Inhalt baut der Server aus der DB; hier geht nur die Tour-ID raus.
    if (anzahl > 0 && ergebnis.bestaetigt) {
      await meldeTourAenderung(tour.id);
    }
    onSaved(anzahl);
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-2xl p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-maja-navy">Tour bearbeiten</h2>
          <p className="text-xs text-maja-muted">
            {tour.tour_id ? `Tour ${tour.tour_id} · ` : ''}
            Maja-Logistik wird über Ihre Änderungen informiert.
            {tour.bestaetigt && ' Die Tour bleibt bestätigt.'}
          </p>
        </div>

        {tour.bestaetigt && (
          <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Diese Tour ist bereits bestätigt. Änderungen sind möglich, werden
            Maja-Logistik aber gesondert gemeldet — bitte nur vornehmen, wenn
            sie wirklich nötig sind.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {/* Kopf: Tourenart + Datumsfelder, ohne Zeit-Zusatz. */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="min-w-0">
              <label htmlFor="et-art" className="label">Tourenart</label>
              <select id="et-art" className="input" value={tourenart}
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
            <div className="min-w-0">
              <label htmlFor="et-von" className="label">Startdatum *</label>
              <input id="et-von" type="date" className="input"
                     value={startdatum} onChange={(e) => setStartdatum(e.target.value)} />
            </div>
            <div className="min-w-0">
              <label htmlFor="et-bis" className="label">Enddatum *</label>
              <input id="et-bis" type="date" className="input"
                     value={enddatum} onChange={(e) => setEnddatum(e.target.value)} />
            </div>
          </div>

          {/* Fahrzeugdaten: E-Fahrzeug — Kennzeichen + Modell — FIN. */}
          <div className="space-y-3">
            <label className="inline-flex items-center gap-2 text-sm text-maja-ink">
              <input type="checkbox" className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                     checked={istEFahrzeug} onChange={(e) => setIstEFahrzeug(e.target.checked)} />
              E-Fahrzeug
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="et-kz" className="label">Kennzeichen</label>
                <input id="et-kz" className="input"
                       value={kennzeichenHin} onChange={(e) => setKennzeichenHin(e.target.value)} />
              </div>
              <div className="min-w-0">
                <label htmlFor="et-modell" className="label">Fahrzeugmodell</label>
                <SuggestCombobox
                  id="et-modell"
                  feldTyp="fahrzeugmodell"
                  value={fahrzeugmodell}
                  onChange={setFahrzeugmodell}
                  placeholder="z.B. VW Polo"
                />
              </div>
              {hatRueckfuehrung && (
                <>
                  <div className="min-w-0">
                    <label htmlFor="et-kz2" className="label">Kennzeichen Rückführung</label>
                    <input id="et-kz2" className="input"
                           value={kennzeichenRueck} onChange={(e) => setKennzeichenRueck(e.target.value)} />
                  </div>
                  <div className="min-w-0">
                    <label htmlFor="et-modell2" className="label">Fahrzeugmodell Rück (optional)</label>
                    <SuggestCombobox
                      id="et-modell2"
                      feldTyp="fahrzeugmodell"
                      value={fahrzeugmodellRueck}
                      onChange={setFahrzeugmodellRueck}
                      placeholder="z.B. Audi A3"
                    />
                  </div>
                </>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="et-fin" className="label">FIN</label>
                <input id="et-fin" className="input"
                       value={fin} onChange={(e) => setFin(e.target.value)} />
              </div>
              {hatRueckfuehrung && (
                <div className="min-w-0">
                  <label htmlFor="et-fin2" className="label">FIN Rückführung</label>
                  <input id="et-fin2" className="input"
                         value={finRueck} onChange={(e) => setFinRueck(e.target.value)} />
                </div>
              )}
              <div className="min-w-0">
                <label htmlFor="et-kunde" className="label">Kundenname</label>
                <input id="et-kunde" className="input"
                       value={kundenname} onChange={(e) => setKundenname(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Stationen inkl. Zeitangabe und Ansprechpartnern. */}
          <StationFeldsatz
            titel="Start (Abholung)"
            idPrefix="et-st1"
            stadtLabel="Start-Stadt"
            stadt={startStadt} onStadt={setStartStadt} stadtPflicht
            adresse={adresseStart} onAdresse={setAdresseStart}
            zeit={zeitStart} onZeit={setZeitStart}
            kontakte={kontakte.start}
            onKontakte={(next) => setKontakte((m) => ({ ...m, start: next }))}
          />

          <StationFeldsatz
            titel="Ziel (Abgabe)"
            idPrefix="et-st2"
            stadtLabel="Ziel-Stadt"
            stadt={zielStadt} onStadt={setZielStadt} stadtPflicht
            adresse={adresseZiel} onAdresse={setAdresseZiel}
            zeit={zeitZiel} onZeit={setZeitZiel}
            kontakte={kontakte.ziel}
            onKontakte={(next) => setKontakte((m) => ({ ...m, ziel: next }))}
          >
            <KmZeile
              label="Entfernung berechnen"
              kmLabel="km Hin"
              km={kmHin}
              onKm={setKmHin}
              disabled={!adresseStart.trim() || !adresseZiel.trim()}
              onBerechnen={() => setRouteDialog('hin')}
            />
          </StationFeldsatz>

          {hatRueckfuehrung && (
            <StationFeldsatz
              titel="Rückführung"
              idPrefix="et-st3"
              stadtLabel="Rückführung-Stadt"
              stadt={rueckStadt} onStadt={setRueckStadt}
              adresse={adresseRueck} onAdresse={setAdresseRueck}
              zeit={zeitRueck} onZeit={setZeitRueck}
              kontakte={kontakte.rueckfuehrung}
              onKontakte={(next) => setKontakte((m) => ({ ...m, rueckfuehrung: next }))}
            >
              <KmZeile
                label="Entfernung Rückweg berechnen"
                kmLabel="km Rück"
                km={kmRueck}
                onKm={setKmRueck}
                disabled={!adresseZiel.trim() || !adresseRueck.trim()}
                onBerechnen={() => setRouteDialog('rueck')}
              />
            </StationFeldsatz>
          )}

          {kmGesamt != null && (
            <p className="text-xs text-maja-muted">
              km gesamt: <strong className="text-maja-ink">{kmGesamt}</strong>
            </p>
          )}

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

          <div>
            <label htmlFor="et-info" className="label">Hinweise</label>
            <textarea id="et-info" className="input min-h-[72px]"
                      value={info} onChange={(e) => setInfo(e.target.value)} />
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
              {saving ? 'Speichert …' : 'Änderungen speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

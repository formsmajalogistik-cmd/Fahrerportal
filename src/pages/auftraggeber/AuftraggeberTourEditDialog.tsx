import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTestGuard } from '../../auth/TestModeContext';
import { speichereAgTour } from '../../lib/tourAenderungen';
import { meldeTourAenderung } from '../../lib/onedrive';
import { SuggestCombobox } from '../../components/SuggestCombobox';
import { AnsprechpartnerFeldsatz } from '../../components/AnsprechpartnerFeldsatz';
import {
  inputZuZeit, ladeAnsprechpartner, leereKontaktMap, speichereAgAnsprechpartner,
  zeitZuInput, type KontaktMap,
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
  // Migration 080
  const [fahrzeugmodell, setFahrzeugmodell] = useState(tour.fahrzeugmodell ?? '');
  const [abholzeit, setAbholzeit] = useState(zeitZuInput(tour.abholzeit));
  const [abgabezeit, setAbgabezeit] = useState(zeitZuInput(tour.abgabezeit));
  const [rueckZeit, setRueckZeit] = useState(zeitZuInput(tour.rueckfuehrung_zeit));
  const [zeitHinweisStart, setZeitHinweisStart] = useState(tour.zeit_hinweis_start ?? '');
  const [zeitHinweisZiel, setZeitHinweisZiel] = useState(tour.zeit_hinweis_ziel ?? '');
  const [zeitHinweisRueck, setZeitHinweisRueck] = useState(tour.zeit_hinweis_rueckfuehrung ?? '');
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
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
      abholzeit: inputZuZeit(abholzeit),
      abgabezeit: inputZuZeit(abgabezeit),
      rueckfuehrung_zeit: hatRueckfuehrung ? inputZuZeit(rueckZeit) : null,
      zeit_hinweis_start: zeitHinweisStart.trim() || null,
      zeit_hinweis_ziel: zeitHinweisZiel.trim() || null,
      zeit_hinweis_rueckfuehrung: hatRueckfuehrung ? (zeitHinweisRueck.trim() || null) : null,
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
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="et-art" className="label">Tourenart</label>
              <select id="et-art" className="input" value={tourenart}
                      onChange={(e) => setTourenart(e.target.value as TourenArt | '')}>
                <option value="">— wählen —</option>
                <option value="AB">AB (einfach)</option>
                <option value="ABA">ABA (hin + zurück)</option>
                <option value="ABC">ABC (Dreieck)</option>
              </select>
            </div>
            <div>
              <label htmlFor="et-von" className="label">Startdatum *</label>
              <div className="flex gap-2">
                <input id="et-von" type="date" className="input flex-1"
                       value={startdatum} onChange={(e) => setStartdatum(e.target.value)} />
                <input id="et-abholzeit" type="time" className="input w-28"
                       aria-label="Abholzeit (optional)" title="Abholzeit (optional)"
                       value={abholzeit} onChange={(e) => setAbholzeit(e.target.value)} />
              </div>
              <input className="input mt-1 text-xs" placeholder="z.B. vormittags (optional)"
                     aria-label="Zeit-Hinweis Abholung"
                     value={zeitHinweisStart} onChange={(e) => setZeitHinweisStart(e.target.value)} />
            </div>
            <div>
              <label htmlFor="et-bis" className="label">Enddatum *</label>
              <div className="flex gap-2">
                <input id="et-bis" type="date" className="input flex-1"
                       value={enddatum} onChange={(e) => setEnddatum(e.target.value)} />
                <input id="et-abgabezeit" type="time" className="input w-28"
                       aria-label="Abgabezeit (optional)" title="Abgabezeit (optional)"
                       value={abgabezeit} onChange={(e) => setAbgabezeit(e.target.value)} />
              </div>
              <input className="input mt-1 text-xs" placeholder="z.B. nach Absprache (optional)"
                     aria-label="Zeit-Hinweis Abgabe"
                     value={zeitHinweisZiel} onChange={(e) => setZeitHinweisZiel(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="et-start" className="label">Start-Stadt *</label>
              <input id="et-start" className="input"
                     value={startStadt} onChange={(e) => setStartStadt(e.target.value)} />
            </div>
            <div>
              <label htmlFor="et-ziel" className="label">Ziel-Stadt *</label>
              <input id="et-ziel" className="input"
                     value={zielStadt} onChange={(e) => setZielStadt(e.target.value)} />
            </div>
          </div>

          {hatRueckfuehrung && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="et-rueck" className="label">Rückführung-Stadt</label>
                <input id="et-rueck" className="input"
                       value={rueckStadt} onChange={(e) => setRueckStadt(e.target.value)} />
              </div>
              <div>
                <label htmlFor="et-rueckzeit" className="label">Zeit Rückführung</label>
                <div className="flex gap-2">
                  <input id="et-rueckzeit" type="time" className="input w-28"
                         value={rueckZeit} onChange={(e) => setRueckZeit(e.target.value)} />
                  <input className="input flex-1 text-xs" placeholder="Hinweis (optional)"
                         aria-label="Zeit-Hinweis Rückführung"
                         value={zeitHinweisRueck} onChange={(e) => setZeitHinweisRueck(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="et-kz" className="label">Kennzeichen</label>
              <input id="et-kz" className="input"
                     value={kennzeichenHin} onChange={(e) => setKennzeichenHin(e.target.value)} />
            </div>
            {hatRueckfuehrung && (
              <div>
                <label htmlFor="et-kz2" className="label">Kennzeichen Rückführung</label>
                <input id="et-kz2" className="input"
                       value={kennzeichenRueck} onChange={(e) => setKennzeichenRueck(e.target.value)} />
              </div>
            )}
            <div>
              <label htmlFor="et-fin" className="label">FIN</label>
              <input id="et-fin" className="input"
                     value={fin} onChange={(e) => setFin(e.target.value)} />
            </div>
            {hatRueckfuehrung && (
              <div>
                <label htmlFor="et-fin2" className="label">FIN Rückführung</label>
                <input id="et-fin2" className="input"
                       value={finRueck} onChange={(e) => setFinRueck(e.target.value)} />
              </div>
            )}
            <div>
              <label htmlFor="et-kunde" className="label">Kundenname</label>
              <input id="et-kunde" className="input"
                     value={kundenname} onChange={(e) => setKundenname(e.target.value)} />
            </div>
            <div>
              <label htmlFor="et-modell" className="label">Fahrzeugmodell</label>
              <SuggestCombobox
                id="et-modell"
                feldTyp="fahrzeugmodell"
                value={fahrzeugmodell}
                onChange={setFahrzeugmodell}
                placeholder="z.B. VW Polo"
              />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-maja-ink">
            <input type="checkbox" className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                   checked={istEFahrzeug} onChange={(e) => setIstEFahrzeug(e.target.checked)} />
            E-Fahrzeug
          </label>

          <div className="space-y-3">
            <div>
              <label htmlFor="et-adr-start" className="label">Adresse Start</label>
              <input id="et-adr-start" className="input" placeholder="Straße Nr, PLZ Stadt"
                     value={adresseStart} onChange={(e) => setAdresseStart(e.target.value)} />
            </div>
            <div>
              <label htmlFor="et-adr-ziel" className="label">Adresse Ziel</label>
              <input id="et-adr-ziel" className="input" placeholder="Straße Nr, PLZ Stadt"
                     value={adresseZiel} onChange={(e) => setAdresseZiel(e.target.value)} />
            </div>
            {hatRueckfuehrung && (
              <div>
                <label htmlFor="et-adr-rueck" className="label">Adresse Rückführung</label>
                <input id="et-adr-rueck" className="input" placeholder="Straße Nr, PLZ Stadt"
                       value={adresseRueck} onChange={(e) => setAdresseRueck(e.target.value)} />
              </div>
            )}
          </div>

          <AnsprechpartnerFeldsatz
            titel="Kontaktperson Start"
            idPrefix="et-ks"
            liste={kontakte.start}
            onChange={(next) => setKontakte((m) => ({ ...m, start: next }))}
          />
          <AnsprechpartnerFeldsatz
            titel="Kontaktperson Ziel"
            idPrefix="et-kz"
            liste={kontakte.ziel}
            onChange={(next) => setKontakte((m) => ({ ...m, ziel: next }))}
          />
          {hatRueckfuehrung && (
            <AnsprechpartnerFeldsatz
              titel="Kontaktperson Rückführung"
              idPrefix="et-kr"
              liste={kontakte.rueckfuehrung}
              onChange={(next) => setKontakte((m) => ({ ...m, rueckfuehrung: next }))}
            />
          )}

          <div>
            <label htmlFor="et-info" className="label">Hinweise</label>
            <textarea id="et-info" className="input min-h-[72px]"
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
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Speichert …' : 'Änderungen speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

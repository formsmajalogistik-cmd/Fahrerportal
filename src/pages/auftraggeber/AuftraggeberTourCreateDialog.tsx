import { useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import { useTestGuard } from '../../auth/TestModeContext';
import { SuggestCombobox } from '../../components/SuggestCombobox';
import { StationFeldsatz } from '../../components/StationFeldsatz';
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

  const [tourenart, setTourenart] = useState<TourenArt | ''>('');
  const [startStadt, setStartStadt] = useState('');
  const [zielStadt, setZielStadt] = useState('');
  const [rueckStadt, setRueckStadt] = useState('');
  const [startdatum, setStartdatum] = useState('');
  const [enddatum, setEnddatum] = useState('');
  const [kennzeichenHin, setKennzeichenHin] = useState('');
  const [kennzeichenRueck, setKennzeichenRueck] = useState('');
  const [fin, setFin] = useState('');
  const [istEFahrzeug, setIstEFahrzeug] = useState(false);
  const [kundenname, setKundenname] = useState('');
  const [adresseStart, setAdresseStart] = useState('');
  const [adresseZiel, setAdresseZiel] = useState('');
  const [adresseRueck, setAdresseRueck] = useState('');
  const [kontakte, setKontakte] = useState<KontaktMap>(() => leereKontaktMap());
  const [info, setInfo] = useState('');
  // Optionale Zusatzangaben. Zeiten sind Freitext je Station (081).
  const [fahrzeugmodell, setFahrzeugmodell] = useState('');
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
    return missing.has(key) ? 'input border-red-500' : 'input';
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Pflichtfelder prüfen — fehlende rot markieren.
    const miss = new Set<string>();
    if (!tourenart) miss.add('tourenart');
    if (!startStadt.trim()) miss.add('startStadt');
    if (!zielStadt.trim()) miss.add('zielStadt');
    if (!startdatum) miss.add('startdatum');
    if (!enddatum) miss.add('enddatum');
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

    setSaving(true);
    const { data: neu, error: err } = await supabase.from('touren').insert({
      start_stadt: startStadt.trim(),
      ziel_stadt: zielStadt.trim(),
      rueckfuehrung_stadt: hatRueckfuehrung ? rueckStadt.trim() : null,
      startdatum,
      enddatum,
      tourenart: tourenart || null,
      kennzeichen,
      fin: fin.trim(),
      ist_e_fahrzeug: istEFahrzeug,
      kundenname: kundenname.trim(),
      adresse_start: adresseStart.trim(),
      adresse_ziel: adresseZiel.trim(),
      adresse_rueckfuehrung: hatRueckfuehrung ? adresseRueck.trim() : null,
      // kontakt_* wird NICHT hier gesetzt — die Ansprechpartner landen
      // unten in tour_ansprechpartner, der DB-Trigger spiegelt den
      // ersten Eintrag je Station in die Alt-Spalten.
      fahrzeugmodell: fahrzeugmodell.trim() || null,
      zeit_start: zeitStart.trim() || null,
      zeit_ziel: zeitZiel.trim() || null,
      zeit_rueckfuehrung: hatRueckfuehrung ? (zeitRueck.trim() || null) : null,
      km_hin: parseKm(kmHin),
      km_rueck: hatRueckfuehrung ? parseKm(kmRueck) : null,
      km_gesamt: kmGesamt,
      info: info.trim() || null,
      auftraggeber_id: profile.auftraggeber_id,
      bestaetigt: false,
      erstellt_von: session.user.id,
      erstellt_von_rolle: 'auftraggeber',
    }).select('id').single();
    if (err) { setSaving(false); setError(err.message); return; }

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
      <div className="card w-full max-w-2xl p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-maja-navy">Neue Tour anlegen</h2>
          <p className="text-xs text-maja-muted">
            Die Tour wird nach dem Speichern von Maja-Logistik geprüft und
            bestätigt. Pflichtfelder sind mit * markiert.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {/* Kopf: Tourenart + Datumsfelder. Die Datumsfelder bleiben
              bewusst ohne Zeit-Zusatz — die Zeit steht bei der Station. */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="min-w-0">
              <label htmlFor="at-art" className="label">Tourenart *</label>
              <select id="at-art" className={inputCls('tourenart')}
                      value={tourenart}
                      onChange={(e) => setTourenart(e.target.value as TourenArt | '')}>
                <option value="">— wählen —</option>
                <option value="AB">AB (einfach)</option>
                <option value="ABA">ABA (hin + zurück)</option>
                <option value="ABC">ABC (Dreieck)</option>
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor="at-von" className="label">Startdatum *</label>
              <input id="at-von" type="date" className={inputCls('startdatum')}
                     value={startdatum} onChange={(e) => setStartdatum(e.target.value)} />
            </div>
            <div className="min-w-0">
              <label htmlFor="at-bis" className="label">Enddatum *</label>
              <input id="at-bis" type="date" className={inputCls('enddatum')}
                     value={enddatum} onChange={(e) => setEnddatum(e.target.value)} />
            </div>
          </div>

          {/* Fahrzeugdaten in der vorgegebenen Reihenfolge:
              E-Fahrzeug — Kennzeichen + Modell — FIN. */}
          <div className="space-y-3">
            <label className="inline-flex items-center gap-2 text-sm text-maja-ink">
              <input type="checkbox" className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                     checked={istEFahrzeug} onChange={(e) => setIstEFahrzeug(e.target.checked)} />
              E-Fahrzeug
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="at-kz" className="label">Kennzeichen *</label>
                <input id="at-kz" className={inputCls('kennzeichen')}
                       value={kennzeichenHin} onChange={(e) => setKennzeichenHin(e.target.value)} />
              </div>
              <div className="min-w-0">
                <label htmlFor="at-modell" className="label">Fahrzeugmodell (optional)</label>
                <SuggestCombobox
                  id="at-modell"
                  feldTyp="fahrzeugmodell"
                  value={fahrzeugmodell}
                  onChange={setFahrzeugmodell}
                  placeholder="z.B. VW Polo"
                />
              </div>
              {hatRueckfuehrung && (
                <div className="min-w-0">
                  <label htmlFor="at-kz2" className="label">Kennzeichen Rückführung</label>
                  <input id="at-kz2" className="input"
                         value={kennzeichenRueck} onChange={(e) => setKennzeichenRueck(e.target.value)} />
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="at-fin" className="label">FIN *</label>
                <input id="at-fin" className={inputCls('fin')}
                       value={fin} onChange={(e) => setFin(e.target.value)} />
              </div>
              <div className="min-w-0">
                <label htmlFor="at-kunde" className="label">Kundenname *</label>
                <input id="at-kunde" className={inputCls('kundenname')}
                       value={kundenname} onChange={(e) => setKundenname(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Stationen: Stadt, Zeit, Adresse und Ansprechpartner
              gehören zusammen — damit ist auch klar, dass es pro Ort
              eine Zeitangabe gibt. */}
          <StationFeldsatz
            titel="Start (Abholung)"
            idPrefix="at-st1"
            stadtLabel="Start-Stadt"
            stadt={startStadt} onStadt={setStartStadt}
            stadtPflicht stadtFehler={missing.has('startStadt')}
            adresse={adresseStart} onAdresse={setAdresseStart}
            adressePflicht adresseFehler={missing.has('adresseStart')}
            zeit={zeitStart} onZeit={setZeitStart}
            kontakte={kontakte.start}
            onKontakte={(next) => setKontakte((m) => ({ ...m, start: next }))}
            kontaktPflicht kontaktFehler={missing.has('kontaktStart')}
          />

          <StationFeldsatz
            titel="Ziel (Abgabe)"
            idPrefix="at-st2"
            stadtLabel="Ziel-Stadt"
            stadt={zielStadt} onStadt={setZielStadt}
            stadtPflicht stadtFehler={missing.has('zielStadt')}
            adresse={adresseZiel} onAdresse={setAdresseZiel}
            adressePflicht adresseFehler={missing.has('adresseZiel')}
            zeit={zeitZiel} onZeit={setZeitZiel}
            kontakte={kontakte.ziel}
            onKontakte={(next) => setKontakte((m) => ({ ...m, ziel: next }))}
            kontaktPflicht kontaktFehler={missing.has('kontaktZiel')}
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
              idPrefix="at-st3"
              stadtLabel="Rückführung-Stadt"
              stadt={rueckStadt} onStadt={setRueckStadt}
              stadtPflicht stadtFehler={missing.has('rueckStadt')}
              adresse={adresseRueck} onAdresse={setAdresseRueck}
              adressePflicht adresseFehler={missing.has('adresseRueck')}
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

          <div>
            <label htmlFor="at-info" className="label">Hinweise (optional)</label>
            <textarea id="at-info" className="input min-h-[72px]"
                      value={info} onChange={(e) => setInfo(e.target.value)} />
          </div>

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

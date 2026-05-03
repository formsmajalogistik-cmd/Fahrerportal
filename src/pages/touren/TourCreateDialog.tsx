import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { computeKmGesamt, fetchTourPrice, formatKm } from '../../lib/touren';
import { displayName } from '../../lib/names';
import { assignFahrerToZugang, isGreimelAuftraggeber } from '../../lib/greimel';
import { ProtokollSection } from './ProtokollSection';
import type {
  AppUser, Auftraggeber, Fahrer, FormularTemplate, GreimelZugang, ProtokollArt, TourenArt,
} from '../../types/db';

type FahrerWithUser = Fahrer & { user: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null };

interface Props {
  onClose: () => void;
  onCreated: () => void;
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

function decimalToInput(v: number | null | undefined): string {
  if (v == null) return '';
  return Number(v).toFixed(2).replace('.', ',');
}

export function TourCreateDialog({ onClose, onCreated }: Props) {
  // Pflichtfelder
  const [startStadt, setStartStadt] = useState('');
  const [zielStadt, setZielStadt]   = useState('');

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

  // Kennzeichen — 1 oder 2 Felder
  const [kennzeichenHin, setKennzeichenHin]   = useState('');
  const [kennzeichenRueck, setKennzeichenRueck] = useState('');

  // Sondervereinbarung (Checkbox + manueller Preis + Anmerkung)
  const [istSondervereinbarung, setIstSondervereinbarung] = useState(false);
  const [sondervereinbarung, setSondervereinbarung] = useState('');
  const [verguetungInput, setVerguetungInput] = useState('');

  const [kundenname, setKundenname] = useState('');
  const [info, setInfo] = useState('');

  // Protokoll
  const [protokollArt, setProtokollArt] = useState<ProtokollArt | null>(null);
  const [schriftlichesProtokollId, setSchriftlichesProtokollId] = useState<string | null>(null);
  const [greimelZugangId, setGreimelZugangId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Array<Pick<FormularTemplate, 'id' | 'name'>>>([]);
  const [zugaenge, setZugaenge] = useState<GreimelZugang[]>([]);

  // Auto-Preis
  const [autoPrice, setAutoPrice] = useState<number | null>(null);
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
        supabase.from('greimel_zugaenge').select('*').order('titel'),
      ]);
      setAuftraggeber(Array.isArray(agRes.data) ? agRes.data : []);
      const faList = Array.isArray(faRes.data) ? (faRes.data as unknown as FahrerWithUser[]) : [];
      setFahrer(faList.sort((a, b) =>
        displayName(a.user ?? null).localeCompare(displayName(b.user ?? null), 'de'),
      ));
      setTemplates(Array.isArray(tplRes.data) ? (tplRes.data as Array<Pick<FormularTemplate, 'id' | 'name'>>) : []);
      setZugaenge(Array.isArray(zRes.data) ? (zRes.data as GreimelZugang[]) : []);
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

  // Auto-Preis berechnen, sobald Auftraggeber + km + tourenart sich ändern
  useEffect(() => {
    if (istSondervereinbarung) { setAutoPrice(null); return; }
    if (!auftraggeberId || kmGesamt == null) { setAutoPrice(null); return; }
    let cancelled = false;
    setPricing(true);
    void fetchTourPrice({
      auftraggeberId,
      km: kmGesamt,
      tourenart: (tourenart || 'AB') as TourenArt,
    }).then((p) => {
      if (cancelled) return;
      setAutoPrice(p);
      setPricing(false);
    });
    return () => { cancelled = true; };
  }, [auftraggeberId, kmGesamt, tourenart, istSondervereinbarung]);

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

  const abaAufschlag = selectedAg?.aba_aufschlag_prozent ?? null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const start = startStadt.trim();
    const ziel  = zielStadt.trim();
    if (!start || !ziel) {
      setError('Start-Stadt und Ziel-Stadt sind Pflichtfelder.');
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
      verguetung = autoPrice;
    }

    setSaving(true);
    const ag = (auftraggeber ?? []).find((a) => a.id === auftraggeberId) ?? null;
    const greimelEffective = isGreimelAuftraggeber(ag) && protokollArt === 'app'
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
      tourenart: tourenart || null,
      startdatum: startdatum ? new Date(startdatum).toISOString() : null,
      enddatum: enddatum ? new Date(enddatum).toISOString() : null,
      ist_sondervereinbarung: istSondervereinbarung,
      sondervereinbarung: istSondervereinbarung
        ? (sondervereinbarung.trim() || null)
        : null,
      verguetung,
      kundenname: kundenname.trim() || null,
      info: info.trim() || null,
      kennzeichen,
      protokoll_art: protokollArt,
      schriftliches_protokoll_id: schriftlichEffective,
      greimel_zugang_id: greimelEffective,
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

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-2xl p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-maja-navy">Neue Tour anlegen</h2>
            <p className="text-xs text-maja-muted">
              Start- und Ziel-Stadt sind Pflicht. Alle anderen Felder sind optional.
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
              {selectedAg?.kontakt && (
                <p className="mt-1 text-xs text-maja-muted">Kontakt: {selectedAg.kontakt}</p>
              )}
            </div>
            <div>
              <label htmlFor="t-fa" className="label">Fahrer</label>
              <select id="t-fa" className="input"
                      value={fahrerId}
                      onChange={(e) => setFahrerId(e.target.value)}>
                <option value="">— kein Fahrer —</option>
                {(fahrer ?? []).map((f) => (
                  <option key={f.id} value={f.id}>{displayName(f.user ?? null)}</option>
                ))}
              </select>
            </div>
          </div>

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
              <label htmlFor="t-start-dt" className="label">Startdatum + Uhrzeit</label>
              <input id="t-start-dt" type="datetime-local" className="input"
                     value={startdatum} onChange={(e) => setStartdatum(e.target.value)} />
            </div>
            <div>
              <label htmlFor="t-end-dt" className="label">Enddatum + Uhrzeit</label>
              <input id="t-end-dt" type="datetime-local" className="input"
                     value={enddatum} onChange={(e) => setEnddatum(e.target.value)} />
            </div>
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
            onChange={(p) => {
              if ('protokoll_art' in p) setProtokollArt(p.protokoll_art ?? null);
              if ('schriftliches_protokoll_id' in p) setSchriftlichesProtokollId(p.schriftliches_protokoll_id ?? null);
              if ('greimel_zugang_id' in p) setGreimelZugangId(p.greimel_zugang_id ?? null);
            }}
            isGreimel={isGreimelAuftraggeber(selectedAg)}
            fahrerId={fahrerId || null}
            templates={templates}
            zugaenge={zugaenge}
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
                  value={pricing ? '…' : decimalToInput(autoPrice)}
                />
                <p className="mt-1 text-xs text-maja-muted">
                  {auftraggeberId && kmGesamt != null
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
              disabled={saving || !startStadt.trim() || !zielStadt.trim()}
            >
              {saving ? 'Anlegen …' : 'Tour anlegen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

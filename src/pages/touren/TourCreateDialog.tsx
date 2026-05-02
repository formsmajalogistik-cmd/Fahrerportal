import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { computeKmGesamt, formatKm } from '../../lib/touren';
import { displayName } from '../../lib/names';
import type {
  AppUser, Auftraggeber, Fahrer, TourenArt, Zwischenstopp,
} from '../../types/db';
import type { Json } from '../../types/supabase';

type FahrerWithUser = Fahrer & { user: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null };

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

interface ZwischenstoppDraft {
  key: string;
  stadt: string;
  km_ab_vorher: string;
}

function newStop(): ZwischenstoppDraft {
  return { key: `stop-${Math.random().toString(36).slice(2, 10)}`, stadt: '', km_ab_vorher: '' };
}

function parseInteger(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || Math.floor(n) !== n || n < 0) return null;
  return n;
}

export function TourCreateDialog({ onClose, onCreated }: Props) {
  // Pflichtfelder
  const [startStadt, setStartStadt] = useState('');
  const [zielStadt, setZielStadt]   = useState('');

  // Auftraggeber/Fahrer
  const [auftraggeber, setAuftraggeber] = useState<Auftraggeber[]>([]);
  const [fahrer, setFahrer] = useState<FahrerWithUser[]>([]);
  const [auftraggeberId, setAuftraggeberId] = useState('');
  const [fahrerId, setFahrerId] = useState('');

  // Optional
  const [tourenart, setTourenart] = useState<TourenArt | ''>('');
  const [startdatum, setStartdatum] = useState(''); // local datetime input
  const [enddatum, setEnddatum]     = useState('');
  const [sondervereinbarung, setSondervereinbarung] = useState('');
  const [info, setInfo] = useState('');

  // Zwischenstopps + km
  const [stops, setStops] = useState<ZwischenstoppDraft[]>([]);
  const [kmStartZuStop, setKmStartZuStop] = useState('');
  const [kmStopZuZiel, setKmStopZuZiel]   = useState('');

  // Kennzeichen
  const [kennzeichenList, setKennzeichenList] = useState<string[]>([]);
  const [kennzeichenInput, setKennzeichenInput] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [agRes, faRes] = await Promise.all([
        supabase.from('auftraggeber').select('*').order('name'),
        supabase
          .from('fahrer')
          .select('*, user:user_id (email, vorname, nachname)')
          .eq('aktiv', true),
      ]);
      setAuftraggeber(agRes.data ?? []);
      setFahrer(((faRes.data ?? []) as unknown as FahrerWithUser[]).sort((a, b) =>
        displayName(a.user ?? null).localeCompare(displayName(b.user ?? null), 'de'),
      ));
    })();
  }, []);

  const selectedAg = useMemo(
    () => auftraggeber.find((a) => a.id === auftraggeberId) ?? null,
    [auftraggeber, auftraggeberId],
  );

  const liveZwischenstopps: Zwischenstopp[] = useMemo(
    () => stops.map((s) => ({
      stadt: s.stadt.trim(),
      km_ab_vorher: parseInteger(s.km_ab_vorher) ?? 0,
    })),
    [stops],
  );

  const kmGesamt = useMemo(() => computeKmGesamt({
    km_start_bis_erster_stopp: parseInteger(kmStartZuStop),
    zwischenstopps: liveZwischenstopps,
    km_letzter_stopp_bis_ziel: parseInteger(kmStopZuZiel),
  }), [kmStartZuStop, kmStopZuZiel, liveZwischenstopps]);

  const hasStops = stops.length > 0;

  function addStop() {
    setStops((s) => [...s, newStop()]);
  }
  function removeStop(key: string) {
    setStops((s) => s.filter((x) => x.key !== key));
  }
  function updateStop(key: string, patch: Partial<ZwischenstoppDraft>) {
    setStops((s) => s.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }

  function commitKennzeichen() {
    const raw = kennzeichenInput.trim().toUpperCase();
    if (!raw) return;
    setKennzeichenList((list) => (list.includes(raw) ? list : [...list, raw]));
    setKennzeichenInput('');
  }

  function handleKennzeichenKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitKennzeichen();
    } else if (e.key === 'Backspace' && kennzeichenInput === '' && kennzeichenList.length > 0) {
      setKennzeichenList((list) => list.slice(0, -1));
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

    // Validate stops
    const cleanStops: Zwischenstopp[] = [];
    for (const s of stops) {
      const stadt = s.stadt.trim();
      const km = parseInteger(s.km_ab_vorher);
      if (!stadt) {
        setError('Jeder Zwischenstopp braucht eine Stadt.');
        return;
      }
      if (km == null) {
        setError(`Zwischenstopp „${stadt}": km ab vorherigem Stopp ungültig.`);
        return;
      }
      cleanStops.push({ stadt, km_ab_vorher: km });
    }

    const kmStart = parseInteger(kmStartZuStop);
    const kmZiel  = parseInteger(kmStopZuZiel);

    setSaving(true);
    const payload = {
      start_stadt: start,
      ziel_stadt: ziel,
      zwischenstopps: cleanStops as unknown as Json,
      km_start_bis_erster_stopp: kmStart,
      km_letzter_stopp_bis_ziel: hasStops ? kmZiel : null,
      km_gesamt: kmGesamt,
      auftraggeber_id: auftraggeberId || null,
      fahrer_id: fahrerId || null,
      tourenart: tourenart || null,
      startdatum: startdatum ? new Date(startdatum).toISOString() : null,
      enddatum: enddatum ? new Date(enddatum).toISOString() : null,
      sondervereinbarung: sondervereinbarung.trim() || null,
      info: info.trim() || null,
      kennzeichen: kennzeichenList,
    };

    const { error: err } = await supabase.from('touren').insert(payload);
    setSaving(false);
    if (err) { setError(err.message); return; }
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

          {/* Zwischenstopps */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-maja-ink">Zwischenstopps</span>
              <button type="button" className="btn-secondary px-3 py-1 text-sm" onClick={addStop}>
                + Zwischenstopp
              </button>
            </div>
            {stops.length === 0 ? (
              <p className="text-xs text-maja-muted">Keine Zwischenstopps.</p>
            ) : (
              <ul className="space-y-2">
                {stops.map((s, i) => (
                  <li key={s.key} className="grid grid-cols-[auto_1fr_8rem_auto] items-end gap-2">
                    <span className="pb-2 text-xs text-maja-muted">{i + 1}.</span>
                    <div>
                      <label className="label">Stadt</label>
                      <input
                        className="input"
                        value={s.stadt}
                        onChange={(e) => updateStop(s.key, { stadt: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label">km ab vorher</label>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        step={1}
                        value={s.km_ab_vorher}
                        onChange={(e) => updateStop(s.key, { km_ab_vorher: e.target.value })}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeStop(s.key)}
                      className="mb-0.5 rounded-md px-2 py-2 text-red-600 hover:bg-red-50"
                      aria-label="Zwischenstopp löschen"
                      title="Zwischenstopp löschen"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* km Start → erster Stopp / letzter Stopp → Ziel */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="t-km-start" className="label">
                km Start → {hasStops ? 'erster Stopp' : 'Ziel'}
              </label>
              <input
                id="t-km-start"
                className="input"
                type="number"
                min={0}
                step={1}
                value={kmStartZuStop}
                onChange={(e) => setKmStartZuStop(e.target.value)}
              />
            </div>
            {hasStops && (
              <div>
                <label htmlFor="t-km-end" className="label">km letzter Stopp → Ziel</label>
                <input
                  id="t-km-end"
                  className="input"
                  type="number"
                  min={0}
                  step={1}
                  value={kmStopZuZiel}
                  onChange={(e) => setKmStopZuZiel(e.target.value)}
                />
              </div>
            )}
          </div>

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
                {auftraggeber.map((a) => (
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
                {fahrer.map((f) => (
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

          {/* Kennzeichen Tags */}
          <div>
            <label htmlFor="t-kz" className="label">
              Kennzeichen <span className="text-xs font-normal text-maja-muted">
                (Enter zum Hinzufügen)
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-maja-navy/20 bg-white px-2 py-2 focus-within:border-maja-accent focus-within:ring-2 focus-within:ring-maja-accent/30">
              {kennzeichenList.map((k) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-md bg-maja-light px-2 py-1 text-xs font-medium text-maja-navy">
                  {k}
                  <button
                    type="button"
                    onClick={() => setKennzeichenList((l) => l.filter((x) => x !== k))}
                    className="text-maja-muted hover:text-red-600"
                    aria-label={`${k} entfernen`}
                  >
                    ✕
                  </button>
                </span>
              ))}
              <input
                id="t-kz"
                className="flex-1 min-w-[8rem] border-0 bg-transparent px-1 py-1 text-sm focus:outline-none focus:ring-0"
                value={kennzeichenInput}
                onChange={(e) => setKennzeichenInput(e.target.value)}
                onKeyDown={handleKennzeichenKey}
                onBlur={commitKennzeichen}
                placeholder={kennzeichenList.length === 0 ? 'z.B. M-XY 1234' : ''}
              />
            </div>
          </div>

          {/* Sondervereinbarung + Info */}
          <div>
            <label htmlFor="t-sv" className="label">Sondervereinbarung</label>
            <input id="t-sv" className="input"
                   value={sondervereinbarung}
                   onChange={(e) => setSondervereinbarung(e.target.value)} />
          </div>
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

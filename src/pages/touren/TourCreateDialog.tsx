import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { computeKmGesamt, formatKm } from '../../lib/touren';
import { displayName } from '../../lib/names';
import type {
  AppUser, Auftraggeber, Fahrer, TourenArt,
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

  // Sondervereinbarung, Kundenname, Info
  const [sondervereinbarung, setSondervereinbarung] = useState('');
  const [kundenname, setKundenname] = useState('');
  const [info, setInfo] = useState('');

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

  const kmGesamt = useMemo(() => computeKmGesamt({
    km_hin: parseInteger(kmHin),
    km_rueck: parseInteger(kmRueck),
    hatRueckfuehrung,
  }), [kmHin, kmRueck, hatRueckfuehrung]);

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

    if (hatRueckfuehrung && !rueckfuehrungStadt.trim()) {
      setError('Rückführung aktiviert: Stadt darf nicht leer sein.');
      return;
    }

    const km_hin   = parseInteger(kmHin);
    const km_rueck = hatRueckfuehrung ? parseInteger(kmRueck) : null;

    const kennzeichen: string[] = [];
    const kzHin = kennzeichenHin.trim().toUpperCase();
    if (kzHin) kennzeichen.push(kzHin);
    if (hatRueckfuehrung) {
      const kzRueck = kennzeichenRueck.trim().toUpperCase();
      if (kzRueck) kennzeichen.push(kzRueck);
    }

    setSaving(true);
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
      sondervereinbarung: sondervereinbarung.trim() || null,
      kundenname: kundenname.trim() || null,
      info: info.trim() || null,
      kennzeichen,
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

          {/* km Hin / Rück */}
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

          {/* Sondervereinbarung + Kundenname */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="t-sv" className="label">Sondervereinbarung</label>
              <input id="t-sv" className="input"
                     value={sondervereinbarung}
                     onChange={(e) => setSondervereinbarung(e.target.value)} />
            </div>
            <div>
              <label htmlFor="t-kn" className="label">Kundenname</label>
              <input id="t-kn" className="input"
                     value={kundenname}
                     onChange={(e) => setKundenname(e.target.value)} />
            </div>
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

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { displayName } from '../../lib/names';
import { XIcon } from '../../components/icons';
import { computeTourStatus, formatDate, tourTitel } from '../../lib/touren';

interface Props {
  onClose: () => void;
  /** Wird mit der ausgewählten Tour-ID aufgerufen. */
  onPick: (tourId: string) => void;
}

interface PickRow {
  id: string;
  tour_id: string | null;
  start_stadt: string;
  ziel_stadt: string;
  rueckfuehrung_stadt: string | null;
  startdatum: string;
  enddatum: string;
  kennzeichen: string[];
  auftraggeber: { name: string } | null;
  fahrer: {
    id: string;
    vorname: string | null;
    nachname: string | null;
    user: { email: string; vorname: string | null; nachname: string | null } | null;
  } | null;
}

/**
 * Picker für eine bestehende Tour aus dem Posteingang. Filtert nach
 * Tour-ID, Stadt, Kennzeichen oder Fahrername. Limit 100 — typischer
 * Use-Case ist eine konkrete Mail-Anfrage zu einer kürzlich angelegten
 * Tour, eine Volltextsuche über alle Touren ist nicht nötig.
 */
export function TourPickerDialog({ onClose, onPick }: Props) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<PickRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const { data, error: err } = await supabase
        .from('touren')
        .select(`
          id, tour_id, start_stadt, ziel_stadt, rueckfuehrung_stadt,
          startdatum, enddatum, kennzeichen,
          auftraggeber:auftraggeber_id (name),
          fahrer:fahrer_id (
            id, vorname, nachname,
            user:user_id (email, vorname, nachname)
          )
        `)
        .order('startdatum', { ascending: false, nullsFirst: false })
        .limit(150);
      if (cancelled) return;
      if (err) setError(err.message);
      else setRows((data as unknown as PickRow[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const fahrerName = displayName(r.fahrer?.user ?? null).toLowerCase();
      const hay = [
        r.tour_id ?? '',
        r.start_stadt, r.ziel_stadt, r.rueckfuehrung_stadt ?? '',
        ...(r.kennzeichen ?? []),
        r.auftraggeber?.name ?? '',
        fahrerName,
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-2xl p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-maja-navy">Tour öffnen</h2>
            <p className="text-xs text-maja-muted">
              Suche eine bestehende Tour aus, um Daten aus der E-Mail
              einzutragen. Die Tour öffnet sich neben der Mail im
              Bearbeiten-Modus.
            </p>
          </div>
          <button type="button" onClick={onClose}
                  className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
                  aria-label="Schließen">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <input
          className="input"
          placeholder="Suche: Tour-ID, Stadt, Kennzeichen, Fahrer …"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        {error && (
          <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {loading ? (
          <p className="mt-4 text-sm text-maja-muted">Touren werden geladen …</p>
        ) : filtered.length === 0 ? (
          <p className="mt-4 text-sm text-maja-muted">Keine Treffer.</p>
        ) : (
          <ul className="mt-3 max-h-[60vh] space-y-1 overflow-auto">
            {filtered.map((t) => {
              const status = computeTourStatus(t.startdatum, t.enddatum);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onPick(t.id)}
                    className="flex w-full flex-wrap items-start justify-between gap-2 rounded-lg border border-maja-navy/10 bg-white p-3 text-left text-sm hover:bg-maja-light"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {t.tour_id && (
                          <span className="rounded-full bg-maja-light px-2 py-0.5 text-xs font-semibold text-maja-navy">
                            {t.tour_id}
                          </span>
                        )}
                        <span className="font-medium text-maja-ink">{tourTitel(t)}</span>
                      </div>
                      <div className="mt-1 text-xs text-maja-muted">
                        {displayName(t.fahrer?.user ?? null) || '—'}
                        {' · '}{formatDate(t.startdatum)}
                        {(t.kennzeichen ?? []).length > 0 && <> · {(t.kennzeichen ?? []).join(', ')}</>}
                        {t.auftraggeber?.name && <> · {t.auftraggeber.name}</>}
                      </div>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      status === 'aktiv' ? 'bg-emerald-100 text-emerald-700'
                        : status === 'geplant' ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {status === 'aktiv' ? 'Aktiv' : status === 'geplant' ? 'Geplant' : 'Abgeschlossen'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
        </div>
      </div>
    </div>
  );
}

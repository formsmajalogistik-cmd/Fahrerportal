import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { displayName } from '../../lib/names';
import { computeTourStatus, formatDateTime, formatKm, tourTitel } from '../../lib/touren';
import { summarizeEingang, type EingangSummary } from '../../lib/eingangData';
import type {
  AppUser, Auftraggeber, AusgefuelltesFormular, Fahrer, FormularTemplate, Tour,
} from '../../types/db';
import type { Database } from '../../types/supabase';

type TourInsert = Database['public']['Tables']['touren']['Insert'];

type FahrerWithUser = Fahrer & { user: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null };

interface TourRow extends Tour {
  auftraggeber: Pick<Auftraggeber, 'name'> | null;
  fahrer: FahrerWithUser | null;
}

interface Props {
  formular: AusgefuelltesFormular;
  template: Pick<FormularTemplate, 'id' | 'name' | 'auftraggeber_id'> | null;
  onClose: () => void;
  onLinked: () => void;
}

type Tab = 'existing' | 'new';

export function EingangLinkDialog({ formular, template, onClose, onLinked }: Props) {
  const [tab, setTab] = useState<Tab>('existing');
  const [touren, setTouren] = useState<TourRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo(() => summarizeEingang(formular), [formular]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: err } = await supabase
        .from('touren')
        .select(`
          *,
          auftraggeber:auftraggeber_id (name),
          fahrer:fahrer_id (id, user_id, aktiv,
            user:user_id (email, vorname, nachname))
        `)
        .is('eingang_id', null)
        .order('startdatum', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (err) setError(err.message);
      else setTouren(((data as unknown) as TourRow[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const filteredTouren = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return touren;
    return touren.filter((t) => {
      const fahrerName = displayName(t.fahrer?.user ?? null).toLowerCase();
      return [
        t.tour_id ?? '',
        t.start_stadt, t.ziel_stadt, t.rueckfuehrung_stadt ?? '',
        ...(Array.isArray(t.kennzeichen) ? t.kennzeichen : []),
        fahrerName,
      ].join(' ').toLowerCase().includes(q);
    });
  }, [touren, search]);

  async function linkExisting(tour: TourRow) {
    setLinking(true);
    setError(null);
    const { error: err } = await supabase
      .from('touren')
      .update({ eingang_id: formular.id })
      .eq('id', tour.id);
    setLinking(false);
    if (err) { setError(err.message); return; }
    onLinked();
  }

  async function createAndLink() {
    setLinking(true);
    setError(null);
    const payload = buildTourPayload(summary, template?.auftraggeber_id ?? null, formular.id);
    const { error: err } = await supabase.from('touren').insert(payload);
    setLinking(false);
    if (err) { setError(err.message); return; }
    onLinked();
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-3xl p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-maja-navy">Mit Tour verknüpfen</h2>
            <p className="text-xs text-maja-muted">
              {summary.kennzeichen ? `Kennzeichen ${summary.kennzeichen}` : 'Eingang ohne Kennzeichen'}
              {' · '}{formular.created_at?.slice(0, 10) ?? '—'}
            </p>
          </div>
          <button type="button" onClick={onClose}
                  className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
                  aria-label="Schließen">✕</button>
        </div>

        <div className="mb-4 inline-flex rounded-lg border border-maja-navy/15 bg-white p-0.5">
          {([{ id: 'existing', label: 'Bestehende Tour' },
             { id: 'new',      label: '+ Neue Tour anlegen' }] as Array<{ id: Tab; label: string }>)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  tab === t.id ? 'bg-maja-navy text-white' : 'text-maja-navy hover:bg-maja-light'
                }`}
              >
                {t.label}
              </button>
            ))}
        </div>

        {tab === 'existing' && (
          <div className="space-y-3">
            <input
              className="input"
              placeholder="Tour-ID, Stadt, Kennzeichen, Fahrer …"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {loading ? (
              <p className="text-sm text-maja-muted">Touren werden geladen …</p>
            ) : filteredTouren.length === 0 ? (
              <p className="text-sm text-maja-muted">Keine offenen Touren gefunden.</p>
            ) : (
              <ul className="max-h-96 space-y-1 overflow-auto">
                {filteredTouren.map((t) => {
                  const status = computeTourStatus(t.startdatum);
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => void linkExisting(t)}
                        disabled={linking}
                        className="flex w-full flex-wrap items-start justify-between gap-2 rounded-lg border border-maja-navy/10 bg-white p-3 text-left text-sm hover:bg-maja-light disabled:opacity-50"
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
                            {t.startdatum && <> · {formatDateTime(t.startdatum)}</>}
                            {t.km_gesamt != null && <> · {formatKm(t.km_gesamt)}</>}
                            {(t.kennzeichen ?? []).length > 0 && <> · {(t.kennzeichen ?? []).join(', ')}</>}
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
          </div>
        )}

        {tab === 'new' && (
          <div className="space-y-3">
            <p className="text-sm text-maja-muted">
              Eine neue Tour wird mit den Daten aus dem Formular angelegt und direkt
              mit diesem Eingang verknüpft.
            </p>
            <PrefillSummary summary={summary} />
            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => void createAndLink()}
              disabled={linking}
            >
              {linking ? 'Tour wird angelegt …' : 'Neue Tour anlegen + verknüpfen'}
            </button>
          </div>
        )}

        {error && (
          <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="btn-secondary" disabled={linking}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}

function PrefillSummary({ summary }: { summary: EingangSummary }) {
  const items: Array<{ label: string; value: string | null }> = [
    { label: 'Kennzeichen',          value: summary.kennzeichen },
    { label: 'FIN',                  value: summary.fin },
    { label: 'Fahrer',               value: summary.fahrername },
    { label: 'Kunde',                value: summary.kundenname },
    { label: 'Datum',                value: summary.datum?.slice(0, 10) ?? null },
    { label: 'Übernahme-Adresse',    value: summary.adresseUebernahme },
    { label: 'Übergabe-Adresse',     value: summary.adresseUebergabe },
    { label: 'km',                   value: summary.kmGesamt != null ? `${summary.kmGesamt} km` : null },
  ];
  const filled = items.filter((i) => !!i.value);
  if (filled.length === 0) {
    return <p className="text-xs text-maja-muted">Im Formular wurden keine Daten gefunden, die in eine Tour übernommen werden könnten.</p>;
  }
  return (
    <dl className="grid gap-2 rounded-lg bg-maja-light/40 p-3 text-xs sm:grid-cols-2">
      {filled.map((i) => (
        <div key={i.label}>
          <dt className="font-medium uppercase tracking-wide text-maja-muted">{i.label}</dt>
          <dd className="text-maja-ink">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function firstCity(addr: string | null): string {
  if (!addr) return '';
  // Heuristik: nimm den Teil hinter dem letzten Komma; bei "PLZ Stadt"
  // schneide die PLZ ab.
  const tail = addr.split(',').pop()?.trim() ?? addr;
  return tail.replace(/^\d{4,5}\s+/, '').trim();
}

function buildTourPayload(
  s: EingangSummary,
  auftraggeberId: string | null,
  eingangId: string,
): TourInsert {
  const start = firstCity(s.adresseUebernahme) || 'Übernahme';
  const ziel  = firstCity(s.adresseUebergabe) || 'Übergabe';
  const kennzeichen = s.kennzeichen ? [s.kennzeichen.toUpperCase()] : [];
  return {
    start_stadt: start,
    ziel_stadt: ziel,
    auftraggeber_id: auftraggeberId,
    fin: s.fin,
    kennzeichen,
    kundenname: s.kundenname,
    km_hin: s.kmGesamt,
    km_gesamt: s.kmGesamt,
    startdatum: s.datum,
    adresse_start: s.adresseUebernahme,
    adresse_ziel: s.adresseUebergabe,
    eingang_id: eingangId,
  };
}

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { XIcon } from '../../../components/icons';
import { Spinner } from '../../../components/Spinner';
import { formatDate, formatEuro } from '../../../lib/touren';
import {
  generatePositionenFromTouren,
  parseRechnungsformat,
  type GeneratedRechnungsposition,
  type Rechnungsformat,
  type TourForRechnung,
  type TourenartReal,
} from '../../../lib/rechnungsformat';

interface Props {
  auftraggeberId: string;
  /** ISO date "YYYY-MM-DD". Default-Datumsfilter. */
  leistungszeitraumVon: string | null;
  leistungszeitraumBis: string | null;
  /** Rechnung, an die hinzugefügt wird — wird beim "bereits auf Rechnung"-
   *  Check ausgenommen, damit eine Tour, die schon auf DIESER Rechnung
   *  ist, nicht als "verwendet auf <Nummer>" markiert wird. */
  excludeRechnungId?: string | null;
  /**
   * Welche Positionen sollen generiert werden? Bei getrennter Auslagen-
   * Rechnung möchte der Editor je nach Pot nur einen Teil sehen.
   * Default 'beides' = Tour-Position + alle Zusätze.
   */
  modus?: 'touren' | 'auslagen' | 'beides';
  onClose: () => void;
  onAdd: (
    positionen: GeneratedRechnungsposition[],
    tour: Pick<TourRow, 'id' | 'info'>,
  ) => void;
}

interface TourRow {
  id: string;
  tour_id: string | null;
  start_stadt: string;
  ziel_stadt: string;
  rueckfuehrung_stadt: string | null;
  startdatum: string | null;
  enddatum: string | null;
  tourenart: TourenartReal;
  kennzeichen: string[];
  kundenname: string | null;
  fin: string | null;
  fin_rueck: string | null;
  km_hin: number | null;
  km_rueck: number | null;
  km_gesamt: number | null;
  sondervereinbarung: string | null;
  verguetung: number | null;
  info: string | null;
  zusaetze: Array<{
    id: string; kategorie: string; anzahl: number; betrag: number;
    notiz: string | null; kennzeichen: string | null;
  }>;
}

interface UsedInfo {
  rechnungId: string;
  rechnungsnummer: string | null;
}

const ALL_TIME_FROM = '2000-01-01';
const ALL_TIME_TO   = '2999-12-31';

export function AddTourPositionDialog({
  auftraggeberId,
  leistungszeitraumVon,
  leistungszeitraumBis,
  excludeRechnungId,
  modus = 'beides',
  onClose,
  onAdd,
}: Props) {
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState<string>(leistungszeitraumVon ?? ALL_TIME_FROM);
  const [dateTo,   setDateTo]   = useState<string>(leistungszeitraumBis ?? ALL_TIME_TO);
  const [touren, setTouren] = useState<TourRow[]>([]);
  const [usedMap, setUsedMap] = useState<Map<string, UsedInfo>>(new Map());
  const [format, setFormat] = useState<Rechnungsformat | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Auftraggeber → Rechnungsformat einmalig laden. Brauchen wir, um
  // die Positionen wie beim "Neu"-Wizard zu generieren.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: err } = await supabase
        .from('auftraggeber')
        .select('rechnungsformat')
        .eq('id', auftraggeberId)
        .maybeSingle();
      if (cancelled) return;
      if (err) {
        setError(`Auftraggeber konnte nicht geladen werden: ${err.message}`);
        setFormat(parseRechnungsformat(null));
      } else {
        setFormat(parseRechnungsformat(data?.rechnungsformat ?? null));
      }
    })();
    return () => { cancelled = true; };
  }, [auftraggeberId]);

  // Touren des Auftraggebers laden — gefiltert auf das Datumsintervall
  // (enddatum, Fallback startdatum). Vergütungslose / sondervereinbarte
  // werden mitgeführt, damit Zusätze trotzdem ausgewählt werden können.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from('touren')
        .select(`
          id, tour_id, start_stadt, ziel_stadt, rueckfuehrung_stadt,
          startdatum, enddatum, tourenart, kennzeichen,
          kundenname, fin, fin_rueck, km_hin, km_rueck, km_gesamt, sondervereinbarung, verguetung, info,
          zusaetze:tour_zusaetze (id, kategorie, anzahl, betrag, notiz, kennzeichen)
        `)
        .eq('auftraggeber_id', auftraggeberId)
        .gte('enddatum', dateFrom)
        .lte('enddatum', dateTo)
        .order('enddatum', { ascending: true })
        .limit(500);
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setTouren([]);
        setLoading(false);
        return;
      }
      type Raw = TourRow & { kennzeichen: string[] | null };
      const list: TourRow[] = ((data as unknown as Raw[]) ?? []).map((t) => ({
        ...t,
        kennzeichen: Array.isArray(t.kennzeichen) ? t.kennzeichen : [],
        zusaetze: t.zusaetze ?? [],
      }));
      setTouren(list);

      // "Bereits auf Rechnung"-Check: ein Join rechnungspositionen →
      // rechnungen, gefiltert auf die geladenen tour_ids. Wir nehmen
      // den ersten Treffer pro tour_id (bei Mehrfach-Verwendung).
      if (list.length === 0) {
        setUsedMap(new Map());
        setLoading(false);
        return;
      }
      const tourIds = list.map((t) => t.id);
      const usedQuery = supabase
        .from('rechnungspositionen')
        .select('tour_id, rechnung:rechnung_id (id, rechnungsnummer)')
        .in('tour_id', tourIds);
      const { data: usedData } = await usedQuery;
      type UsedRow = { tour_id: string | null; rechnung: { id: string; rechnungsnummer: string | null } | null };
      const map = new Map<string, UsedInfo>();
      for (const u of (usedData as unknown as UsedRow[]) ?? []) {
        if (!u.tour_id || !u.rechnung) continue;
        if (excludeRechnungId && u.rechnung.id === excludeRechnungId) continue;
        if (map.has(u.tour_id)) continue;
        map.set(u.tour_id, {
          rechnungId: u.rechnung.id,
          rechnungsnummer: u.rechnung.rechnungsnummer,
        });
      }
      if (!cancelled) setUsedMap(map);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [auftraggeberId, dateFrom, dateTo, excludeRechnungId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return touren;
    return touren.filter((t) => {
      const hay = [
        t.tour_id ?? '',
        t.start_stadt, t.ziel_stadt, t.rueckfuehrung_stadt ?? '',
        ...(t.kennzeichen ?? []),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [touren, search]);

  function handlePick(t: TourRow) {
    if (!format) return;
    const tourForFmt: TourForRechnung = {
      id: t.id,
      tour_id: t.tour_id,
      start_stadt: t.start_stadt,
      ziel_stadt: t.ziel_stadt,
      rueckfuehrung_stadt: t.rueckfuehrung_stadt,
      startdatum: t.startdatum,
      enddatum: t.enddatum,
      tourenart: t.tourenart,
      kennzeichen: t.kennzeichen,
      kundenname: t.kundenname,
      fin: t.fin,
      fin_rueck: t.fin_rueck,
      km_hin: t.km_hin,
      km_rueck: t.km_rueck,
      km_gesamt: t.km_gesamt,
      sondervereinbarung: t.sondervereinbarung,
      verguetung: t.verguetung,
      info: t.info,
      zusaetze: t.zusaetze,
    };
    const positionen = generatePositionenFromTouren([tourForFmt], format, { modus });
    if (positionen.length === 0) {
      setError('Diese Tour erzeugt im aktuellen Modus keine Position (keine Vergütung & keine passenden Zusätze).');
      return;
    }
    onAdd(positionen, { id: t.id, info: t.info });
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-3xl p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-maja-navy">Tour auswählen</h2>
            <p className="text-xs text-maja-muted">
              Tour aus dem Auftraggeber-Bestand wählen — die Positionen werden
              automatisch nach Rechnungsformat erzeugt und sind anschließend
              editierbar.
            </p>
          </div>
          <button type="button" onClick={onClose}
                  className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
                  aria-label="Schließen"><XIcon className="h-4 w-4" /></button>
        </div>

        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <input
              className="input"
              placeholder="Suche: Stadt, Kennzeichen, Tour-ID …"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="atp-from" className="label">Enddatum ab</label>
            <input
              id="atp-from"
              type="date"
              className="input"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="atp-to" className="label">Enddatum bis</label>
            <input
              id="atp-to"
              type="date"
              className="input"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              className="btn-secondary w-full text-sm"
              onClick={() => { setDateFrom(ALL_TIME_FROM); setDateTo(ALL_TIME_TO); }}
            >
              Datumsfilter aus
            </button>
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-6"><Spinner label="Touren werden geladen …" /></div>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-maja-navy/15 p-6 text-center text-sm text-maja-muted">
            Keine Touren im gewählten Zeitraum gefunden.
          </p>
        ) : (
          <ul className="max-h-[60vh] space-y-1 overflow-auto">
            {filtered.map((t) => {
              const used = usedMap.get(t.id);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => handlePick(t)}
                    disabled={!format}
                    className="flex w-full flex-wrap items-start justify-between gap-2 rounded-lg border border-maja-navy/10 bg-white p-3 text-left text-sm hover:bg-maja-light disabled:opacity-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {t.tour_id && (
                          <span className="rounded-full bg-maja-light px-2 py-0.5 text-xs font-semibold text-maja-navy">
                            {t.tour_id}
                          </span>
                        )}
                        <span className="font-medium text-maja-ink">
                          {t.start_stadt} → {t.ziel_stadt}
                          {t.rueckfuehrung_stadt ? ` → ${t.rueckfuehrung_stadt}` : ''}
                        </span>
                        {t.tourenart && (
                          <span className="rounded-full bg-maja-navy/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-maja-navy">
                            {t.tourenart}
                          </span>
                        )}
                        {used && (
                          <span
                            className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900"
                            title={`Bereits auf Rechnung ${used.rechnungsnummer ?? used.rechnungId.slice(0, 8)}`}
                          >
                            Bereits auf Rechnung{used.rechnungsnummer ? ` ${used.rechnungsnummer}` : ''}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-maja-muted">
                        {t.enddatum && <span>{formatDate(t.enddatum)}</span>}
                        {(t.kennzeichen ?? []).length > 0 && (
                          <span>{(t.kennzeichen ?? []).join(', ')}</span>
                        )}
                        {t.zusaetze.length > 0 && (
                          <span>{t.zusaetze.length} {t.zusaetze.length === 1 ? 'Zusatz' : 'Zusätze'}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-maja-navy tabular-nums">
                        {formatEuro(t.verguetung)}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-maja-muted">
                        Vergütung
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-4 flex justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

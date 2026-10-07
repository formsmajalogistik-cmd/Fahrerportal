import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { displayName } from '../../lib/names';
import { XIcon } from '../../components/icons';
import { computeTourStatus, formatDate, tourTitel } from '../../lib/touren';
import {
  naechstliegendZuerst, zeitfensterGrenzen, zeitfensterOrFilter, type Zeitfenster,
} from '../../lib/tourZeitfenster';

interface Props {
  onClose: () => void;
  /** Wird mit der ausgewählten Tour-ID aufgerufen. */
  onPick: (tourId: string) => void;
  /**
   * Optionales Zeitfenster. Gesetzt (Zusätze/Belege): die Liste zeigt nur
   * Touren, die sich damit überschneiden, plus Touren auf Eis; eine Suche
   * läuft serverseitig ohne Datumsgrenze. Nicht gesetzt („Tour öffnen"):
   * unverändertes Verhalten von vorher.
   */
  zeitfenster?: Zeitfenster;
  titel?: string;
  beschreibung?: string;
}

interface PickRow {
  id: string;
  tour_id: string | null;
  start_stadt: string;
  ziel_stadt: string;
  rueckfuehrung_stadt: string | null;
  startdatum: string | null;
  enddatum: string | null;
  auf_eis: boolean | null;
  kennzeichen: string[];
  auftraggeber: { name: string } | null;
  fahrer: {
    id: string;
    vorname: string | null;
    nachname: string | null;
    user: { email: string; vorname: string | null; nachname: string | null } | null;
  } | null;
}

const SELECT = `
  id, tour_id, start_stadt, ziel_stadt, rueckfuehrung_stadt,
  startdatum, enddatum, auf_eis, kennzeichen,
  auftraggeber:auftraggeber_id (name),
  fahrer:fahrer_id (
    id, vorname, nachname,
    user:user_id (email, vorname, nachname)
  )
`;

/** Clientseitiger Textfilter — für den Modus ohne Zeitfenster und als Rückfall. */
function passtZurSuche(r: PickRow, q: string): boolean {
  const fahrerName = displayName(r.fahrer?.user ?? null).toLowerCase();
  const hay = [
    r.tour_id ?? '',
    r.start_stadt, r.ziel_stadt, r.rueckfuehrung_stadt ?? '',
    ...(r.kennzeichen ?? []),
    r.auftraggeber?.name ?? '',
    fahrerName,
  ].join(' ').toLowerCase();
  return hay.includes(q);
}

/**
 * Picker für eine bestehende Tour aus dem Posteingang. Filtert nach
 * Tour-ID, Stadt, Kennzeichen oder Fahrername.
 *
 * Ohne `zeitfenster`: die 150 Touren mit dem spätesten Startdatum,
 * gefiltert im Browser — so wie bisher.
 *
 * Mit `zeitfenster`: Diese 150 waren für Zusätze und Belege das Problem.
 * Geplante Zukunftstouren belegten die Plätze, und schon eine Fahrt von
 * vor zwei Tagen war weder in der Liste noch per Suche zu finden. Deshalb
 * filtert hier die Abfrage selbst nach dem Zeitfenster, und die Suche
 * läuft über die RPC `touren_picker_suche` (Migration 099) über alle
 * Touren.
 */
export function TourPickerDialog({ onClose, onPick, zeitfenster, titel, beschreibung }: Props) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<PickRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Suche lief im Rückfall (RPC fehlt) nur über die jüngsten Touren. */
  const [suchRueckfall, setSuchRueckfall] = useState(false);

  const fensterAktiv = !!zeitfenster;
  const tageZurueck = zeitfenster?.tageZurueck ?? 0;
  const tageVoraus = zeitfenster?.tageVoraus ?? 0;
  const suchbegriff = search.trim();
  // Ab 2 Zeichen sucht die Datenbank über ALLE Touren — auch bei „Tour
  // öffnen". Vorher wurde dort nur in den 150 jüngsten gesucht; ältere
  // Touren (z.B. für Bußgeldanfragen) waren nicht zu finden. Die
  // Standardliste ohne Suchbegriff bleibt je Modus unverändert.
  const serverSuche = suchbegriff.length >= 2 ? suchbegriff : '';

  useEffect(() => {
    let cancelled = false;
    // Beim Tippen kurz warten, damit nicht jeder Buchstabe eine Abfrage wird.
    const verzoegerung = serverSuche ? 300 : 0;
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        setError(null);
        let ergebnis: PickRow[] = [];
        let fehler: string | null = null;
        let rueckfall = false;

        if (!fensterAktiv && !serverSuche) {
          const { data, error: err } = await supabase
            .from('touren').select(SELECT)
            .order('startdatum', { ascending: false, nullsFirst: false })
            .limit(150);
          if (err) fehler = err.message;
          else ergebnis = (data as unknown as PickRow[]) ?? [];
        } else if (!serverSuche) {
          const { von, bis } = zeitfensterGrenzen(new Date(), { tageZurueck, tageVoraus });
          const { data, error: err } = await supabase
            .from('touren').select(SELECT)
            .or(zeitfensterOrFilter(von, bis))
            .order('enddatum', { ascending: false, nullsFirst: false })
            .order('id')
            .limit(500);
          if (err) fehler = err.message;
          else ergebnis = (data as unknown as PickRow[]) ?? [];
        } else {
          // Bevorzugt die tolerante Suche (Migration 103: „HHAB1234" findet
          // „HH-AB 1234", auch FIN/Rück-Kennzeichen); sonst die aus 099.
          let liste: string[] = [];
          let rpcErr: { message: string } | null = null;
          const neu = await supabase.rpc('touren_suche', { p_suche: serverSuche, p_fahrer_ids: null, p_limit: 200, p_offset: 0 });
          if (!neu.error) {
            liste = ((neu.data ?? []) as Array<{ id: string }>).map((x) => x.id);
          } else {
            const alt = await supabase.rpc('touren_picker_suche', { p_suche: serverSuche, p_limit: 200 });
            rpcErr = alt.error;
            liste = (alt.data as unknown as string[] | null) ?? [];
          }
          if (!rpcErr) {
            if (liste.length > 0) {
              const { data, error: err } = await supabase
                .from('touren').select(SELECT).in('id', liste);
              if (err) fehler = err.message;
              else ergebnis = (data as unknown as PickRow[]) ?? [];
            }
          } else {
            // Migration 099 noch nicht eingespielt: nicht scheitern, sondern
            // wie früher in den jüngsten Touren suchen — und das sagen.
            console.warn('[TourPickerDialog] Suche über RPC nicht verfügbar — Rückfall', rpcErr);
            rueckfall = true;
            const { data, error: err } = await supabase
              .from('touren').select(SELECT)
              .order('enddatum', { ascending: false, nullsFirst: false })
              .limit(500);
            if (err) fehler = err.message;
            else {
              const q = serverSuche.toLowerCase();
              ergebnis = ((data as unknown as PickRow[]) ?? []).filter((r) => passtZurSuche(r, q));
            }
          }
        }

        if (cancelled) return;
        if (fehler) setError(fehler);
        setRows(fensterAktiv ? naechstliegendZuerst(ergebnis, new Date()) : ergebnis);
        setSuchRueckfall(rueckfall);
        setLoading(false);
      })();
    }, verzoegerung);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [fensterAktiv, tageZurueck, tageVoraus, serverSuche]);

  const filtered = useMemo(() => {
    // Ab 2 Zeichen filtert der Server; ein einzelnes Zeichen filtert die
    // Standardliste noch im Browser.
    if (serverSuche && !suchRueckfall) return rows;
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => passtZurSuche(r, q));
  }, [rows, search, serverSuche, suchRueckfall]);

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-2xl p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-maja-navy">{titel ?? 'Tour öffnen'}</h2>
            <p className="text-xs text-maja-muted">
              {beschreibung ?? 'Suche eine bestehende Tour aus, um Daten aus der E-Mail '
                + 'einzutragen. Die Tour öffnet sich neben der Mail im Bearbeiten-Modus.'}
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
                        {' · '}{t.auf_eis && !t.startdatum ? 'ohne Termin' : formatDate(t.startdatum)}
                        {t.enddatum && t.startdatum && t.enddatum.slice(0, 10) !== t.startdatum.slice(0, 10)
                          && <> – {formatDate(t.enddatum)}</>}
                        {(t.kennzeichen ?? []).length > 0 && <> · {(t.kennzeichen ?? []).join(', ')}</>}
                        {t.auftraggeber?.name && <> · {t.auftraggeber.name}</>}
                      </div>
                    </div>
                    {t.auf_eis ? (
                      <span
                        className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:!bg-amber-900 dark:!text-amber-100"
                        title="Tour ohne festen Termin — erscheint unabhängig vom Zeitfenster"
                      >
                        Auf Eis
                      </span>
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        status === 'aktiv' ? 'bg-emerald-100 text-emerald-700'
                          : status === 'geplant' ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {status === 'aktiv' ? 'Aktiv' : status === 'geplant' ? 'Geplant' : 'Abgeschlossen'}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {fensterAktiv && !loading && (
          <p className="mt-3 text-xs text-maja-muted">
            {serverSuche
              ? (suchRueckfall
                  ? 'Gesucht wurde nur in den jüngsten 500 Touren (Suchfunktion der Datenbank fehlt noch — Migration 099).'
                  : 'Suche über alle Touren, unabhängig vom Datum.')
              : `Zeigt Touren der letzten ${tageZurueck} Tage und der nächsten ${tageVoraus} Tage. Für ältere Touren bitte suchen.`}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
        </div>
      </div>
    </div>
  );
}

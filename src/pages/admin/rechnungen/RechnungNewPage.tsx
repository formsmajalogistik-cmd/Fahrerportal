import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { Spinner } from '../../../components/Spinner';
import { formatDate, formatEuro } from '../../../lib/touren';
import {
  DEFAULT_RECHNUNGSFORMAT, berechneSummen, generatePositionenFromTouren,
  type Rechnungsformat, type TourForRechnung, type TourenartReal,
} from '../../../lib/rechnungsformat';
import { PositionsTable } from './PositionsTable';
import {
  emptyManuellePosition, newKey, type EditorPosition,
} from './positionUtils';
import type { Auftraggeber, Rechnungsadresse } from '../../../types/db';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoYearStart(y: number): string {
  return `${y}-01-01`;
}

function isoMonthEnd(): string {
  const d = new Date();
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return next.toISOString().slice(0, 10);
}

function parseRechnungsformat(raw: unknown): Rechnungsformat {
  if (raw && typeof raw === 'object') {
    return { ...DEFAULT_RECHNUNGSFORMAT, ...(raw as Partial<Rechnungsformat>) };
  }
  return DEFAULT_RECHNUNGSFORMAT;
}

interface AuftraggeberFull extends Auftraggeber {
  rechnungsadressen?: Rechnungsadresse[];
}

export function RechnungNewPage() {
  const navigate = useNavigate();
  const [auftraggeberList, setAuftraggeberList] = useState<AuftraggeberFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<null | 'entwurf' | 'erstellt'>(null);

  // Kopfdaten
  const [auftraggeberId, setAuftraggeberId] = useState<string>('');
  const [rechnungsadresseId, setRechnungsadresseId] = useState<string>('');
  const [anrede, setAnrede] = useState<string>('');
  const [datum, setDatum] = useState<string>(todayIso());
  const [zeitraumVon, setZeitraumVon] = useState<string>(isoYearStart(new Date().getFullYear()));
  const [zeitraumBis, setZeitraumBis] = useState<string>(isoMonthEnd());
  const [ustSatz, setUstSatz] = useState<number>(19);
  const [notizen, setNotizen] = useState<string>('');

  // Bei getrennten Auslagen-Rechnungen kann der Admin steuern, welche Teile
  // angelegt werden sollen.
  const [erstelleTouren, setErstelleTouren] = useState(true);
  const [erstelleAuslagen, setErstelleAuslagen] = useState(true);

  // Generierte Positionen (zwei Töpfe — für getrennte Rechnungen).
  const [haupt, setHaupt] = useState<EditorPosition[]>([]);
  const [auslagen, setAuslagen] = useState<EditorPosition[]>([]);
  const [touren, setTouren] = useState<TourForRechnung[]>([]);
  const [loadingTouren, setLoadingTouren] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: err } = await supabase
        .from('auftraggeber')
        .select(`
          *,
          rechnungsadressen (id, firma, ansprechpartner, strasse, plz_ort, land, ist_standard)
        `)
        .order('name');
      if (cancelled) return;
      if (err) setError(err.message);
      else setAuftraggeberList((data as unknown as AuftraggeberFull[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const auftraggeber = useMemo(
    () => auftraggeberList.find((a) => a.id === auftraggeberId) ?? null,
    [auftraggeberList, auftraggeberId],
  );

  const format = useMemo(
    () => parseRechnungsformat(auftraggeber?.rechnungsformat ?? null),
    [auftraggeber],
  );
  const getrennt = format.getrennte_auslagen_rechnung;

  // Bei Auftraggeber-Wechsel: Defaults nachziehen (Standardadresse, Anrede, USt).
  useEffect(() => {
    if (!auftraggeber) return;
    const std = (auftraggeber.rechnungsadressen ?? []).find((a) => a.ist_standard)
      ?? auftraggeber.rechnungsadressen?.[0]
      ?? null;
    setRechnungsadresseId(std?.id ?? '');
    setAnrede(format.anrede ?? '');
    setUstSatz(Number(format.ust_satz) || 19);
    // Bei Wechsel des Auftraggebers Positionen verwerfen — sonst wären
    // sie mit dem falschen Format gerendert.
    setHaupt([]);
    setAuslagen([]);
    setTouren([]);
    setErstelleTouren(true);
    setErstelleAuslagen(true);
  }, [auftraggeber, format.anrede, format.ust_satz]);

  const loadTouren = useCallback(async () => {
    if (!auftraggeber) return;
    setLoadingTouren(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('touren')
      .select(`
        id, tour_id, start_stadt, ziel_stadt, rueckfuehrung_stadt,
        startdatum, enddatum, tourenart, kennzeichen,
        kundenname, fin, sondervereinbarung, verguetung,
        zusaetze:tour_zusaetze (id, kategorie, anzahl, betrag, notiz)
      `)
      .eq('auftraggeber_id', auftraggeber.id)
      .gte('enddatum', zeitraumVon)
      .lte('enddatum', zeitraumBis)
      .eq('status', 'abgeschlossen')
      .order('enddatum', { ascending: true });
    setLoadingTouren(false);
    if (err) { setError(err.message); return; }
    type RawTour = {
      id: string; tour_id: string | null;
      start_stadt: string; ziel_stadt: string; rueckfuehrung_stadt: string | null;
      startdatum: string | null; enddatum: string | null;
      tourenart: TourenartReal; kennzeichen: string[] | null;
      kundenname: string | null; fin: string | null;
      sondervereinbarung: string | null; verguetung: number | null;
      zusaetze: Array<{ id: string; kategorie: string; anzahl: number; betrag: number; notiz: string | null }>;
    };
    const list: TourForRechnung[] = ((data as unknown as RawTour[]) ?? []).map((t) => ({
      id: t.id,
      tour_id: t.tour_id,
      start_stadt: t.start_stadt,
      ziel_stadt: t.ziel_stadt,
      rueckfuehrung_stadt: t.rueckfuehrung_stadt,
      startdatum: t.startdatum,
      enddatum: t.enddatum,
      tourenart: t.tourenart,
      kennzeichen: t.kennzeichen ?? [],
      kundenname: t.kundenname,
      fin: t.fin,
      sondervereinbarung: t.sondervereinbarung,
      verguetung: t.verguetung,
      zusaetze: t.zusaetze ?? [],
    }));
    setTouren(list);

    // Positionen rendern: bei getrennten Auslagen-Rechnungen in zwei Töpfe,
    // sonst alles in `haupt`.
    if (getrennt) {
      const teilTouren = generatePositionenFromTouren(list, format, { modus: 'touren' });
      const teilAuslagen = generatePositionenFromTouren(list, format, { modus: 'auslagen' });
      setHaupt(teilTouren.map((p) => ({ ...p, key: newKey('tour') })));
      setAuslagen(teilAuslagen.map((p) => ({ ...p, key: newKey('aus') })));
    } else {
      const alle = generatePositionenFromTouren(list, format, { modus: 'beides' });
      setHaupt(alle.map((p) => ({ ...p, key: newKey('p') })));
      setAuslagen([]);
    }
  }, [auftraggeber, zeitraumVon, zeitraumBis, format, getrennt]);

  const hauptSummen = useMemo(() => berechneSummen(haupt, ustSatz), [haupt, ustSatz]);
  const auslagenSummen = useMemo(() => berechneSummen(auslagen, ustSatz), [auslagen, ustSatz]);

  async function speichern(status: 'entwurf' | 'erstellt') {
    if (!auftraggeber) { setError('Bitte einen Auftraggeber wählen.'); return; }
    if (!zeitraumVon || !zeitraumBis) { setError('Bitte den Leistungszeitraum angeben.'); return; }
    setError(null);
    setSaving(status);

    /** Eine einzelne Rechnung (haupt ODER auslagen) anlegen. */
    async function insertOne(
      positionen: EditorPosition[],
      istAuslagen: boolean,
    ): Promise<{ ok: boolean; id?: string; error?: string }> {
      if (positionen.length === 0) return { ok: true };
      const sum = berechneSummen(positionen, ustSatz);
      const { data: rRow, error: rErr } = await supabase
        .from('rechnungen')
        .insert({
          auftraggeber_id: auftraggeber!.id,
          rechnungsadresse_id: rechnungsadresseId || null,
          datum,
          leistungszeitraum_von: zeitraumVon,
          leistungszeitraum_bis: zeitraumBis,
          anrede: anrede || null,
          netto_summe: sum.netto,
          ust_satz: ustSatz,
          ust_betrag: sum.ust,
          brutto_summe: sum.brutto,
          status,
          notizen: notizen || null,
          ist_auslagen_rechnung: istAuslagen,
        })
        .select('id')
        .single();
      if (rErr || !rRow) {
        return { ok: false, error: rErr?.message ?? 'Rechnung konnte nicht angelegt werden.' };
      }
      // Positionen mit der frischen Rechnungs-ID einfügen, mit
      // automatischer position_nr aus dem Index.
      const rows = positionen.map((p, idx) => ({
        rechnung_id: rRow.id,
        position_nr: idx + 1,
        bezeichnung: p.bezeichnung,
        unterzeilen: p.unterzeilen,
        menge: p.menge,
        einzelpreis: p.einzelpreis,
        gesamtpreis: p.gesamtpreis,
        tour_id: p.tour_id,
        zusatz_id: p.zusatz_id,
        ist_manuell: p.ist_manuell,
      }));
      const { error: pErr } = await supabase.from('rechnungspositionen').insert(rows);
      if (pErr) return { ok: false, error: pErr.message };
      return { ok: true, id: rRow.id };
    }

    try {
      let firstId: string | null = null;
      if (getrennt) {
        if (erstelleTouren) {
          const r = await insertOne(haupt, false);
          if (!r.ok) throw new Error(r.error);
          if (r.id) firstId = r.id;
        }
        if (erstelleAuslagen) {
          const r = await insertOne(auslagen, true);
          if (!r.ok) throw new Error(r.error);
          if (!firstId && r.id) firstId = r.id;
        }
      } else {
        const r = await insertOne(haupt, false);
        if (!r.ok) throw new Error(r.error);
        if (r.id) firstId = r.id;
      }

      // Hinweis zur PDF-Generierung (kommt im nächsten Schritt).
      if (status === 'erstellt') {
        alert('Rechnung erstellt. PDF-Generierung wird in Kürze verfügbar.');
      }
      if (firstId) navigate(`/rechnungen/${firstId}`);
      else navigate('/rechnungen');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <Spinner label="Auftraggeber werden geladen …" />;

  const hauptTitle = getrennt ? 'Touren-Positionen' : 'Positionen';
  const adressen = auftraggeber?.rechnungsadressen ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Neue Rechnung</h1>
          <p className="text-sm text-maja-muted">
            Auftraggeber wählen, Zeitraum festlegen, Touren laden — Positionen
            werden automatisch aus dem Rechnungsformat generiert und sind
            danach frei editierbar.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => navigate('/rechnungen')}>
          Zurück
        </button>
      </div>

      {/* Kopfdaten */}
      <section className="card space-y-3 p-5">
        <h2 className="text-base font-semibold text-maja-navy">Kopfdaten</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ag" className="label">Auftraggeber *</label>
            <select
              id="ag"
              className="input"
              value={auftraggeberId}
              onChange={(e) => setAuftraggeberId(e.target.value)}
            >
              <option value="">— wählen —</option>
              {auftraggeberList.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="adr" className="label">Rechnungsadresse</label>
            <select
              id="adr"
              className="input"
              value={rechnungsadresseId}
              onChange={(e) => setRechnungsadresseId(e.target.value)}
              disabled={adressen.length === 0}
            >
              <option value="">— keine —</option>
              {adressen.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.firma}{a.ist_standard ? ' (Standard)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="von" className="label">Zeitraum von *</label>
            <input
              id="von" type="date" className="input"
              value={zeitraumVon} onChange={(e) => setZeitraumVon(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="bis" className="label">Zeitraum bis *</label>
            <input
              id="bis" type="date" className="input"
              value={zeitraumBis} onChange={(e) => setZeitraumBis(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="datum" className="label">Rechnungsdatum</label>
            <input
              id="datum" type="date" className="input"
              value={datum} onChange={(e) => setDatum(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="ust" className="label">USt.-Satz (%)</label>
            <input
              id="ust" type="number" min={0} step={0.5} className="input"
              value={ustSatz}
              onChange={(e) => setUstSatz(Number(e.target.value) || 0)}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="anrede" className="label">Anrede</label>
            <input
              id="anrede" className="input"
              value={anrede} onChange={(e) => setAnrede(e.target.value)}
              placeholder="Sehr geehrte Damen und Herren,"
            />
          </div>
        </div>

        {getrennt && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Hinweis: Touren und Auslagen werden als separate Rechnungen erstellt.</p>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4"
                       checked={erstelleTouren}
                       onChange={(e) => setErstelleTouren(e.target.checked)} />
                Touren-Rechnung
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4"
                       checked={erstelleAuslagen}
                       onChange={(e) => setErstelleAuslagen(e.target.checked)} />
                Auslagen-Rechnung
              </label>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void loadTouren()}
            disabled={!auftraggeber || loadingTouren}
          >
            {loadingTouren ? 'Lade Touren …' : 'Touren laden'}
          </button>
          {touren.length > 0 && (
            <span className="text-xs text-maja-muted">
              {touren.length} Tour{touren.length === 1 ? '' : 'en'} im Zeitraum {formatDate(zeitraumVon)} – {formatDate(zeitraumBis)}.
            </span>
          )}
        </div>
      </section>

      {/* Haupt-Positionen */}
      {(haupt.length > 0 || auslagen.length > 0) && (
        <section className="card space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-maja-navy">{hauptTitle}</h2>
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => setHaupt((rows) => [...rows, emptyManuellePosition()])}
            >
              + Position hinzufügen
            </button>
          </div>
          <PositionsTable positionen={haupt} onChange={setHaupt} />
          <SummenLine label="Netto" value={hauptSummen.netto} />
          <SummenLine label={`${ustSatz}% USt.`} value={hauptSummen.ust} />
          <SummenLine label="Brutto" value={hauptSummen.brutto} bold />
        </section>
      )}

      {/* Getrennte Auslagen */}
      {getrennt && auslagen.length > 0 && (
        <section className="card space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-maja-navy">Auslagen-Positionen</h2>
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => setAuslagen((rows) => [...rows, emptyManuellePosition()])}
            >
              + Position hinzufügen
            </button>
          </div>
          <PositionsTable positionen={auslagen} onChange={setAuslagen} />
          <SummenLine label="Netto" value={auslagenSummen.netto} />
          <SummenLine label={`${ustSatz}% USt.`} value={auslagenSummen.ust} />
          <SummenLine label="Brutto" value={auslagenSummen.brutto} bold />
        </section>
      )}

      {/* Notizen */}
      <section className="card space-y-3 p-5">
        <h2 className="text-base font-semibold text-maja-navy">Interne Notizen</h2>
        <textarea
          className="input min-h-[5rem]"
          value={notizen}
          onChange={(e) => setNotizen(e.target.value)}
          placeholder="Nur intern sichtbar."
        />
      </section>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Aktionen */}
      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-maja-navy/10 bg-white/95 px-2 py-3 backdrop-blur">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void speichern('entwurf')}
          disabled={saving !== null}
        >
          {saving === 'entwurf' ? 'Speichert …' : 'Als Entwurf speichern'}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void speichern('erstellt')}
          disabled={saving !== null}
        >
          {saving === 'erstellt' ? 'Erstellt …' : 'Rechnung erstellen'}
        </button>
      </div>
    </div>
  );
}

function SummenLine({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between border-t border-maja-navy/10 py-2 text-sm ${bold ? 'font-semibold text-maja-navy' : 'text-maja-ink'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{formatEuro(value)}</span>
    </div>
  );
}

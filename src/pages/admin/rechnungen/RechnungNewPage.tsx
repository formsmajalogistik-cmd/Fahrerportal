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

function parseRechnungsformat(raw: unknown): Rechnungsformat {
  if (raw && typeof raw === 'object') {
    return { ...DEFAULT_RECHNUNGSFORMAT, ...(raw as Partial<Rechnungsformat>) };
  }
  return DEFAULT_RECHNUNGSFORMAT;
}

interface AuftraggeberFull extends Auftraggeber {
  rechnungsadressen?: Rechnungsadresse[];
}

/**
 * Snapshot der Rechnungsadresse + Kopfdaten. Diese Werte werden als
 * eigenständige Spalten auf der Rechnung gespeichert, NICHT als FK zu
 * den Auftraggeber-Stammdaten — damit eine einmal ausgestellte
 * Rechnung ein festes Dokument bleibt.
 */
interface AdressSnapshot {
  firma: string;
  ansprechpartner: string;
  strasse: string;
  plz_ort: string;
  land: string;
}

function emptySnapshot(): AdressSnapshot {
  return { firma: '', ansprechpartner: '', strasse: '', plz_ort: '', land: '' };
}

function snapshotFromAuftraggeber(a: Auftraggeber): AdressSnapshot {
  const plzOrt = [a.plz, a.ort].filter((x) => !!x && (x as string).trim() !== '').join(' ');
  return {
    firma: a.name ?? '',
    ansprechpartner: '',
    strasse: a.strasse ?? '',
    plz_ort: plzOrt,
    land: '',
  };
}

function snapshotFromRechnungsadresse(r: Rechnungsadresse): AdressSnapshot {
  return {
    firma: r.firma ?? '',
    ansprechpartner: r.ansprechpartner ?? '',
    strasse: r.strasse ?? '',
    plz_ort: r.plz_ort ?? '',
    land: r.land ?? '',
  };
}

export function RechnungNewPage() {
  const navigate = useNavigate();
  const [auftraggeberList, setAuftraggeberList] = useState<AuftraggeberFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<null | 'entwurf' | 'erstellt'>(null);

  // Kopfdaten
  const [auftraggeberId, setAuftraggeberId] = useState<string>('');
  const [rechnungsdatum, setRechnungsdatum] = useState<string>(todayIso());
  const [anrede, setAnrede] = useState<string>('');
  const [ustSatz, setUstSatz] = useState<number>(19);
  const [notizen, setNotizen] = useState<string>('');

  // Snapshot-Felder (Adresse + Kunden- / Sachbearbeiter-Stammdaten).
  // Werden initial aus dem Auftraggeber befüllt, bleiben aber pro
  // Rechnung frei editierbar.
  const [snapshot, setSnapshot] = useState<AdressSnapshot>(emptySnapshot());
  const [kundennummer, setKundennummer] = useState<string>('');
  const [sachbearbeiter, setSachbearbeiter] = useState<string>('');

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
          rechnungsadressen (id, firma, ansprechpartner, strasse, plz_ort, land, ist_standard, auftraggeber_id, created_at)
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

  // Bei Auftraggeber-Wechsel: Adress-Snapshot, Anrede, USt, Kundennummer,
  // Sachbearbeiter aus den Stammdaten ziehen. Wenn der Auftraggeber eine
  // hinterlegte Standard-Rechnungsadresse hat, hat die Vorrang.
  useEffect(() => {
    if (!auftraggeber) {
      setSnapshot(emptySnapshot());
      setKundennummer(''); setSachbearbeiter('');
      return;
    }
    const std = (auftraggeber.rechnungsadressen ?? []).find((a) => a.ist_standard);
    setSnapshot(std ? snapshotFromRechnungsadresse(std) : snapshotFromAuftraggeber(auftraggeber));
    setAnrede(format.anrede ?? '');
    setUstSatz(Number(format.ust_satz) || 19);
    setKundennummer(auftraggeber.kundennummer ?? '');
    setSachbearbeiter(auftraggeber.sachbearbeiter ?? '');
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
    // Effektives Rechnungsdatum einer Tour:
    //   abweichend=true UND rechnungsdatum gesetzt → rechnungsdatum
    //   sonst                                       → enddatum
    // PostgREST kann das nicht direkt — also drei Branches mit .or():
    //   (rechnungsdatum_abweichend = true  AND rechnungsdatum = X)
    //   OR (rechnungsdatum_abweichend = false AND enddatum = X)
    //   OR (rechnungsdatum_abweichend IS NULL  AND enddatum = X)
    //
    // Bewusst KEIN Filter auf status='abgeschlossen': eine Tour die heute
    // endet (enddatum = today) ist im UI noch "aktiv", soll aber bei
    // Rechnungsdatum=today direkt mit auftauchen. Das ist die explizite
    // Anforderung aus Fix 3. "geplante" Touren ohne tatsächliches Ende
    // werden in der Regel kein Enddatum heute haben — falls doch
    // (Sonderfall), darf sie ja auch berechnet werden.
    const orFilter =
      `and(rechnungsdatum_abweichend.eq.true,rechnungsdatum.eq.${rechnungsdatum}),`
      + `and(rechnungsdatum_abweichend.eq.false,enddatum.eq.${rechnungsdatum}),`
      + `and(rechnungsdatum_abweichend.is.null,enddatum.eq.${rechnungsdatum})`;
    console.info('[Rechnungen] Touren laden:', {
      auftraggeber_id: auftraggeber.id,
      rechnungsdatum,
      filter: orFilter,
    });
    const { data, error: err } = await supabase
      .from('touren')
      .select(`
        id, tour_id, start_stadt, ziel_stadt, rueckfuehrung_stadt,
        startdatum, enddatum, tourenart, kennzeichen,
        kundenname, fin, sondervereinbarung, verguetung,
        rechnungsdatum, rechnungsdatum_abweichend, status,
        zusaetze:tour_zusaetze (id, kategorie, anzahl, betrag, notiz)
      `)
      .eq('auftraggeber_id', auftraggeber.id)
      .or(orFilter)
      .order('enddatum', { ascending: true });
    setLoadingTouren(false);
    if (err) {
      console.error('[Rechnungen] Touren-Query Fehler', err);
      setError(err.message);
      return;
    }
    type RawTour = {
      id: string; tour_id: string | null;
      start_stadt: string; ziel_stadt: string; rueckfuehrung_stadt: string | null;
      startdatum: string | null; enddatum: string | null;
      tourenart: TourenartReal; kennzeichen: string[] | null;
      kundenname: string | null; fin: string | null;
      sondervereinbarung: string | null; verguetung: number | null;
      rechnungsdatum: string | null; rechnungsdatum_abweichend: boolean | null;
      status: string | null;
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
    console.info('[Rechnungen] Ergebnis:', {
      anzahl: list.length,
      tour_ids: list.map((t) => t.tour_id),
    });
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
  }, [auftraggeber, rechnungsdatum, format, getrennt]);

  const hauptSummen = useMemo(() => berechneSummen(haupt, ustSatz), [haupt, ustSatz]);
  const auslagenSummen = useMemo(() => berechneSummen(auslagen, ustSatz), [auslagen, ustSatz]);

  /**
   * Frühestes Startdatum und spätestes Enddatum der geladenen Touren —
   * wird für leistungszeitraum_von/_bis auf der Rechnung gespeichert.
   * Fällt auf das Rechnungsdatum zurück, wenn keine Touren geladen sind.
   */
  const leistungszeitraum = useMemo(() => {
    if (touren.length === 0) {
      return { von: rechnungsdatum, bis: rechnungsdatum };
    }
    let von: string | null = null;
    let bis: string | null = null;
    for (const t of touren) {
      const s = t.startdatum ?? t.enddatum;
      const e = t.enddatum ?? t.startdatum;
      if (s && (!von || s < von)) von = s;
      if (e && (!bis || e > bis)) bis = e;
    }
    return { von: von ?? rechnungsdatum, bis: bis ?? rechnungsdatum };
  }, [touren, rechnungsdatum]);

  async function speichern(status: 'entwurf' | 'erstellt') {
    if (!auftraggeber) { setError('Bitte einen Auftraggeber wählen.'); return; }
    if (!rechnungsdatum) { setError('Bitte das Rechnungsdatum angeben.'); return; }
    setError(null);
    setSaving(status);

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
          // FK auf rechnungsadressen wird nicht mehr genutzt — wir
          // speichern den Snapshot direkt auf der Rechnung.
          rechnungsadresse_id: null,
          datum: rechnungsdatum,
          leistungszeitraum_von: leistungszeitraum.von,
          leistungszeitraum_bis: leistungszeitraum.bis,
          anrede: anrede || null,
          netto_summe: sum.netto,
          ust_satz: ustSatz,
          ust_betrag: sum.ust,
          brutto_summe: sum.brutto,
          status,
          notizen: notizen || null,
          ist_auslagen_rechnung: istAuslagen,
          ansprechpartner: snapshot.ansprechpartner || null,
          sachbearbeiter: sachbearbeiter || null,
          kundennummer: kundennummer || null,
          rechnungsadresse_firma:   snapshot.firma   || null,
          rechnungsadresse_strasse: snapshot.strasse || null,
          rechnungsadresse_plz_ort: snapshot.plz_ort || null,
          rechnungsadresse_land:    snapshot.land    || null,
        })
        .select('id')
        .single();
      if (rErr || !rRow) {
        return { ok: false, error: rErr?.message ?? 'Rechnung konnte nicht angelegt werden.' };
      }
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
  const adressVorlagen = auftraggeber?.rechnungsadressen ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Neue Rechnung</h1>
          <p className="text-sm text-maja-muted">
            Auftraggeber wählen, Rechnungsdatum setzen, Touren laden — die
            Positionen werden automatisch aus dem Rechnungsformat generiert
            und sind danach frei editierbar.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => navigate('/rechnungen')}>
          Zurück
        </button>
      </div>

      {/* Kopfdaten */}
      <section className="card space-y-4 p-5">
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
            <label htmlFor="rdat" className="label">Rechnungsdatum *</label>
            <input
              id="rdat" type="date" className="input"
              value={rechnungsdatum} onChange={(e) => setRechnungsdatum(e.target.value)}
            />
            <p className="mt-1 text-xs text-maja-muted">
              "Touren laden" findet abgeschlossene Touren des Auftraggebers,
              deren effektives Rechnungsdatum (rechnungsdatum_abweichend
              bzw. enddatum) genau diesem Datum entspricht.
            </p>
          </div>
          <div>
            <label htmlFor="kdnr" className="label">Kundennummer</label>
            <input
              id="kdnr" className="input"
              value={kundennummer} onChange={(e) => setKundennummer(e.target.value)}
              placeholder={auftraggeber?.kundennummer ?? ''}
            />
          </div>
          <div>
            <label htmlFor="sb" className="label">Sachbearbeiter</label>
            <input
              id="sb" className="input"
              value={sachbearbeiter} onChange={(e) => setSachbearbeiter(e.target.value)}
              placeholder={auftraggeber?.sachbearbeiter ?? ''}
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
          <div>
            <label htmlFor="anrede" className="label">Anrede</label>
            <input
              id="anrede" className="input"
              value={anrede} onChange={(e) => setAnrede(e.target.value)}
              placeholder="Sehr geehrte Damen und Herren,"
            />
          </div>
        </div>

        {/* Rechnungsadresse — editierbare Snapshot-Felder */}
        <div className="space-y-3 rounded-lg bg-maja-light/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-maja-navy">Rechnungsadresse</h3>
            {adressVorlagen.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-maja-muted">
                <span>Adresse laden von …</span>
                <select
                  className="input py-1 text-xs"
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    if (id === '__stammdaten' && auftraggeber) {
                      setSnapshot(snapshotFromAuftraggeber(auftraggeber));
                    } else {
                      const adr = adressVorlagen.find((a) => a.id === id);
                      if (adr) setSnapshot(snapshotFromRechnungsadresse(adr));
                    }
                    e.currentTarget.selectedIndex = 0;
                  }}
                >
                  <option value="">— wählen —</option>
                  {auftraggeber && <option value="__stammdaten">Stammdaten</option>}
                  {adressVorlagen.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.firma}{a.ist_standard ? ' (Standard)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="adr-firma" className="label">Firma</label>
              <input id="adr-firma" className="input"
                     value={snapshot.firma}
                     onChange={(e) => setSnapshot((s) => ({ ...s, firma: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="adr-ap" className="label">Ansprechpartner</label>
              <input id="adr-ap" className="input"
                     value={snapshot.ansprechpartner}
                     onChange={(e) => setSnapshot((s) => ({ ...s, ansprechpartner: e.target.value }))}
                     placeholder="z. B. Herr Jens Dracker" />
            </div>
            <div>
              <label htmlFor="adr-str" className="label">Straße</label>
              <input id="adr-str" className="input"
                     value={snapshot.strasse}
                     onChange={(e) => setSnapshot((s) => ({ ...s, strasse: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="adr-plz" className="label">PLZ / Ort</label>
              <input id="adr-plz" className="input"
                     value={snapshot.plz_ort}
                     onChange={(e) => setSnapshot((s) => ({ ...s, plz_ort: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="adr-land" className="label">Land</label>
              <input id="adr-land" className="input"
                     value={snapshot.land}
                     onChange={(e) => setSnapshot((s) => ({ ...s, land: e.target.value }))}
                     placeholder="(leer = Deutschland)" />
            </div>
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
              {touren.length} Tour{touren.length === 1 ? '' : 'en'} mit Rechnungsdatum {formatDate(rechnungsdatum)} — Leistungszeitraum {formatDate(leistungszeitraum.von)} – {formatDate(leistungszeitraum.bis)}.
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

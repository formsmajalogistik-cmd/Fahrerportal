// Gutschrift anlegen — beide Wege in einer Maske.
//
//   Weg A: aus einer bestehenden Rechnung (?rechnung=<id> oder Auswahl
//          im Bezug-Feld). Auftraggeber, Empfänger, Adress-Snapshot und
//          Anrede werden übernommen; die Rechnungspositionen kommen als
//          Vorschlag mit Checkbox pro Zeile — Teilgutschrift möglich.
//   Weg B: freie Gutschrift. Auftraggeber wählen, Positionen manuell
//          anlegen. Ein Rechnungsbezug ist optional.
//
// Beträge werden POSITIV eingegeben; dass es sich um eine Gutschrift
// handelt, sagt das Dokument über Bezeichnung und Texte.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { Spinner } from '../../../components/Spinner';
import { formatDate, formatEuro } from '../../../lib/touren';
import {
  berechneSummenProUst, buildAnrede, parseRechnungsformat,
} from '../../../lib/rechnungsformat';
import { PositionsTable } from '../rechnungen/PositionsTable';
import { ManuellerEmpfaengerFeldsatz } from '../../../components/ManuellerEmpfaengerFeldsatz';
import {
  MANUELL_OPTION, leererEmpfaenger, merkeEmpfaenger, nameZeile,
  snapshotAusEmpfaenger, type ManuellerEmpfaengerEntwurf,
} from '../../../lib/manuelleEmpfaenger';
import { SummenBlock } from '../rechnungen/SummenBlock';
import {
  emptyManuellePosition, newKey, type EditorPosition,
} from '../rechnungen/positionUtils';
import {
  LEERER_SNAPSHOT, naechsteGutschriftNr, type AdressSnapshot,
} from '../../../lib/gutschriften';
import {
  DEFAULT_GUTSCHRIFT_SETTINGS, loadGutschriftSettings,
  type GutschriftSettings,
} from '../../../lib/gutschriftSettings';
import type { Json } from '../../../types/supabase';
import type { Auftraggeber, Rechnungsposition } from '../../../types/db';

function todayIso(): string { return new Date().toISOString().slice(0, 10); }

interface RechnungOption {
  id: string;
  rechnungsnummer: string;
  datum: string;
  auftraggeber_id: string | null;
}

/** Eine Rechnungsposition als an-/abwählbarer Vorschlag. */
interface Vorschlag {
  key: string;
  gewaehlt: boolean;
  position: EditorPosition;
}

export function GutschriftNewPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const vorgabeRechnung = params.get('rechnung');

  const [settings, setSettings] = useState<GutschriftSettings>(DEFAULT_GUTSCHRIFT_SETTINGS);
  const [auftraggeber, setAuftraggeber] = useState<Pick<Auftraggeber, 'id' | 'name'>[]>([]);
  const [rechnungen, setRechnungen] = useState<RechnungOption[]>([]);
  const [kontakte, setKontakte] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Kopfdaten
  const [auftraggeberId, setAuftraggeberId] = useState('');
  /**
   * Manueller Empfänger (Migration 088) — Gutschrift an jemanden ohne
   * Auftraggeber-Bezug. Gleiche Felder und Regeln wie bei Rechnungen.
   */
  const istManuell = auftraggeberId === MANUELL_OPTION;
  const [manuell, setManuell] = useState<ManuellerEmpfaengerEntwurf>(leererEmpfaenger());
  const [manuellMerken, setManuellMerken] = useState(false);
  const [rechnungId, setRechnungId] = useState(vorgabeRechnung ?? '');
  const [empfaengerId, setEmpfaengerId] = useState('');
  const [nummer, setNummer] = useState('');
  const [datum, setDatum] = useState(todayIso());
  const [zeitraumVon, setZeitraumVon] = useState('');
  const [zeitraumBis, setZeitraumBis] = useState('');
  const [anrede, setAnrede] = useState('');
  const [kundennummer, setKundennummer] = useState('');
  const [sachbearbeiter, setSachbearbeiter] = useState('');
  const [ustSatz, setUstSatz] = useState(19);
  const [snapshot, setSnapshot] = useState<AdressSnapshot>({ ...LEERER_SNAPSHOT });
  const [einleitung, setEinleitung] = useState('');
  const [schluss, setSchluss] = useState('');
  const [notizen, setNotizen] = useState('');

  // Positionen
  const [vorschlaege, setVorschlaege] = useState<Vorschlag[]>([]);
  const [positionen, setPositionen] = useState<EditorPosition[]>([]);
  const [ladeRechnung, setLadeRechnung] = useState(false);

  // ---- Stammdaten laden -------------------------------------------
  const init = useCallback(async () => {
    const [sCfg, aRes, rRes] = await Promise.all([
      loadGutschriftSettings(),
      supabase.from('auftraggeber').select('id, name').order('name'),
      supabase
        .from('rechnungen')
        .select('id, rechnungsnummer, datum, auftraggeber_id')
        .order('datum', { ascending: false })
        .limit(300),
    ]);
    setSettings(sCfg);
    setEinleitung(sCfg.einleitungstext);
    setSchluss(sCfg.schlusstext);
    setAuftraggeber(aRes.data ?? []);
    setRechnungen((rRes.data as unknown as RechnungOption[]) ?? []);
    const nr = await naechsteGutschriftNr(new Date().getFullYear());
    if (nr) setNummer(nr);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void init(); }, 0);
    return () => window.clearTimeout(t);
  }, [init]);

  /** Auftraggeber-Stammdaten in die Kopfdaten übernehmen. */
  const uebernehmeAuftraggeber = useCallback(async (agId: string) => {
    if (!agId) return;
    const { data } = await supabase
      .from('auftraggeber')
      .select('id, name, kundennummer, sachbearbeiter, rechnungsformat')
      .eq('id', agId)
      .maybeSingle();
    if (!data) return;
    const format = parseRechnungsformat(data.rechnungsformat ?? null);
    setUstSatz(Number(format.ust_satz) || 19);
    setAnrede((cur) => cur || format.anrede || 'Sehr geehrte Damen und Herren,');
    setKundennummer((cur) => cur || (data.kundennummer ?? ''));
    setSachbearbeiter((cur) => cur || (data.sachbearbeiter ?? ''));
    // Standard-Rechnungsadresse als Snapshot vorbelegen.
    const { data: adr } = await supabase
      .from('rechnungsadressen')
      .select('firma, ansprechpartner, strasse, plz_ort, land, ist_standard')
      .eq('auftraggeber_id', agId)
      .order('ist_standard', { ascending: false })
      .limit(1);
    const a = (adr ?? [])[0];
    if (a) {
      setSnapshot((cur) => (cur.firma || cur.strasse || cur.plz_ort ? cur : {
        firma: a.firma ?? data.name ?? null,
        ansprechpartner: a.ansprechpartner ?? null,
        strasse: a.strasse ?? null,
        plz_ort: a.plz_ort ?? null,
        land: a.land ?? null,
      }));
    } else {
      setSnapshot((cur) => (cur.firma ? cur : { ...cur, firma: data.name ?? null }));
    }
    // Kontakte für das Rechnungsempfänger-Feld.
    const { data: k } = await supabase
      .from('auftraggeber_kontakte')
      .select('id, name')
      .eq('auftraggeber_id', agId)
      .order('name');
    setKontakte((k as Array<{ id: string; name: string }>) ?? []);
  }, []);

  /**
   * Weg A: Rechnung als Bezug laden — Kopfdaten übernehmen und die
   * Positionen als abwählbare Vorschläge anbieten.
   */
  const uebernehmeRechnung = useCallback(async (reId: string) => {
    if (!reId) { setVorschlaege([]); return; }
    setLadeRechnung(true);
    setError(null);
    try {
      const [rRes, pRes] = await Promise.all([
        supabase.from('rechnungen').select('*').eq('id', reId).maybeSingle(),
        supabase.from('rechnungspositionen').select('*')
          .eq('rechnung_id', reId).order('position_nr', { ascending: true }),
      ]);
      if (rRes.error) throw new Error(rRes.error.message);
      if (pRes.error) throw new Error(pRes.error.message);
      const r = rRes.data;
      if (!r) throw new Error('Rechnung nicht gefunden.');

      setAuftraggeberId(r.auftraggeber_id ?? '');
      setEmpfaengerId(r.rechnungsempfaenger_id ?? '');
      setKundennummer(r.kundennummer ?? '');
      setSachbearbeiter(r.sachbearbeiter ?? '');
      setUstSatz(Number(r.ust_satz) || 19);
      setZeitraumVon(r.leistungszeitraum_von ?? '');
      setZeitraumBis(r.leistungszeitraum_bis ?? '');
      setAnrede(r.anrede || buildAnrede(r.ansprechpartner));
      setSnapshot({
        firma: r.rechnungsadresse_firma ?? null,
        ansprechpartner: r.ansprechpartner ?? null,
        strasse: r.rechnungsadresse_strasse ?? null,
        plz_ort: r.rechnungsadresse_plz_ort ?? null,
        land: r.rechnungsadresse_land ?? null,
      });
      if (r.auftraggeber_id) {
        const { data: k } = await supabase
          .from('auftraggeber_kontakte').select('id, name')
          .eq('auftraggeber_id', r.auftraggeber_id).order('name');
        setKontakte((k as Array<{ id: string; name: string }>) ?? []);
      }

      // Alle Positionen als Vorschlag, standardmäßig ausgewählt.
      const rows = (pRes.data ?? []) as Rechnungsposition[];
      setVorschlaege(rows.map((p) => ({
        key: p.id,
        gewaehlt: true,
        position: {
          key: newKey('gs'),
          bezeichnung: p.bezeichnung,
          unterzeilen: p.unterzeilen ?? [],
          menge: Number(p.menge),
          einzelpreis: Number(p.einzelpreis),
          gesamtpreis: Number(p.gesamtpreis),
          tour_id: p.tour_id,
          zusatz_id: null,
          ist_manuell: false,
          ust_satz: p.ust_satz == null ? null : Number(p.ust_satz),
        },
      })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rechnung konnte nicht geladen werden.');
    } finally {
      setLadeRechnung(false);
    }
  }, []);

  // Vorgabe aus der Rechnungs-Detailseite direkt auswerten.
  useEffect(() => {
    if (!vorgabeRechnung) return;
    const t = window.setTimeout(() => { void uebernehmeRechnung(vorgabeRechnung); }, 0);
    return () => window.clearTimeout(t);
  }, [vorgabeRechnung, uebernehmeRechnung]);

  /** Die aktuell angehakten Vorschläge in die Positionsliste übernehmen. */
  function uebernehmeAuswahl() {
    const neue = vorschlaege
      .filter((v) => v.gewaehlt)
      .map((v) => ({ ...v.position, key: newKey('gs') }));
    setPositionen((cur) => [...cur, ...neue]);
    setVorschlaege([]);
  }

  const rechnungOptionen = useMemo(() => (
    auftraggeberId
      ? rechnungen.filter((r) => r.auftraggeber_id === auftraggeberId)
      : rechnungen
  ), [rechnungen, auftraggeberId]);

  const gewaehlteSumme = useMemo(() => berechneSummenProUst(
    vorschlaege.filter((v) => v.gewaehlt).map((v) => v.position), ustSatz,
  ), [vorschlaege, ustSatz]);

  async function anlegen() {
    if (!istManuell && !auftraggeberId) {
      setError('Bitte einen Auftraggeber wählen.'); return;
    }
    if (istManuell && !manuell.firma.trim() && !manuell.nachname.trim()) {
      setError('Bitte für den manuellen Empfänger eine Firma oder einen Namen angeben.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const sum = berechneSummenProUst(positionen, ustSatz);
      // Bei "manuell" KEIN Auftraggeber-Bezug und kein Eintrag in der
      // auftraggeber-Tabelle — der Empfänger bleibt aus allen
      // Auftraggeber-Ansichten heraus.
      const effSnapshot = istManuell ? snapshotAusEmpfaenger(manuell) : snapshot;
      const insertPayload: Record<string, unknown> = {
        auftraggeber_id: istManuell ? null : auftraggeberId,
        empfaenger_typ: istManuell ? 'manuell' : 'auftraggeber',
        empfaenger_email:  istManuell ? (manuell.email.trim() || null) : null,
        empfaenger_ust_id: istManuell ? (manuell.ustId.trim() || null) : null,
        rechnungsempfaenger_id: empfaengerId || null,
        rechnung_id: rechnungId || null,
        datum,
        leistungszeitraum_von: zeitraumVon || null,
        leistungszeitraum_bis: zeitraumBis || null,
        anrede: anrede || null,
        einleitungstext: einleitung || null,
        schlusstext: schluss || null,
        interne_notizen: notizen || null,
        adress_snapshot: effSnapshot as unknown as Json,
        kundennummer: kundennummer || null,
        sachbearbeiter: sachbearbeiter || null,
        ust_satz: ustSatz,
        netto_summe: sum.netto,
        ust_summe: sum.ust,
        brutto_summe: sum.brutto,
        status: 'entwurf',
      };
      // Leeres Nummernfeld → der Trigger vergibt die nächste freie Nummer.
      if (nummer.trim()) insertPayload.gutschrift_nr = nummer.trim();

      const { data: row, error: err } = await supabase
        .from('gutschriften')
        .insert(insertPayload as never)
        .select('id')
        .single();
      if (err || !row) {
        const msg = err?.message ?? 'Anlegen fehlgeschlagen.';
        const isDup = /duplicate key|unique|23505/i.test(msg);
        throw new Error(isDup
          ? `Die Nummer „${nummer.trim()}" existiert bereits.`
          : msg);
      }

      if (positionen.length > 0) {
        const rows = positionen.map((p, idx) => ({
          gutschrift_id: row.id,
          position_nr: idx + 1,
          bezeichnung: p.bezeichnung,
          unterzeilen: p.unterzeilen as unknown as Json,
          menge: p.menge,
          einzelpreis: p.einzelpreis,
          gesamtpreis: p.gesamtpreis,
          ust_satz: p.ust_satz,
          tour_id: p.tour_id,
          ist_manuell: p.ist_manuell,
        }));
        const { error: pErr } = await supabase.from('gutschriftspositionen').insert(rows);
        if (pErr) throw new Error(pErr.message);
      }
      // Empfänger merken — reine Eingabehilfe; ein Fehler hier darf die
      // bereits angelegte Gutschrift nicht kippen.
      if (istManuell && manuellMerken) {
        const m = await merkeEmpfaenger(manuell);
        if (!m.ok) console.warn('[manueller Empfänger] Merken fehlgeschlagen', m.fehler);
      }

      navigate(`/gutschriften/${row.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen.');
      setSaving(false);
    }
  }

  if (loading) return <Spinner label="Wird geladen …" />;

  const bezeichnung = settings.dokumentbezeichnung;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Neue {bezeichnung}</h1>
          <p className="text-sm text-maja-muted">
            Aus einer Rechnung übernehmen oder frei zusammenstellen. Beträge
            positiv eingeben — das Dokument weist sie als {bezeichnung} aus.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => navigate('/gutschriften')}>
          Abbrechen
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Kopfdaten */}
      <section className="card space-y-3 p-5">
        <h2 className="text-base font-semibold text-maja-navy">Stammdaten</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="gs-ag" className="label">Auftraggeber *</label>
            <select
              id="gs-ag"
              className="input"
              value={auftraggeberId}
              onChange={(e) => {
                const v = e.target.value;
                setAuftraggeberId(v);
                setEmpfaengerId('');
                // Bezug zurücksetzen, wenn er nicht zum neuen AG gehört.
                const re = rechnungen.find((r) => r.id === rechnungId);
                if (re && re.auftraggeber_id !== v) setRechnungId('');
                void uebernehmeAuftraggeber(v);
              }}
            >
              <option value="">— wählen —</option>
              {auftraggeber.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              <option value={MANUELL_OPTION}>Manuell (kein Auftraggeber)</option>
            </select>
          </div>
          <div>
            <label htmlFor="gs-empf" className="label">Rechnungsempfänger (optional)</label>
            <select id="gs-empf" className="input" value={empfaengerId}
                    onChange={(e) => setEmpfaengerId(e.target.value)}
                    disabled={kontakte.length === 0}>
              <option value="">— keiner —</option>
              {kontakte.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="gs-bezug" className="label">Bezug zur Rechnung (optional)</label>
            <select
              id="gs-bezug"
              className="input"
              value={rechnungId}
              onChange={(e) => {
                const v = e.target.value;
                setRechnungId(v);
                if (v) void uebernehmeRechnung(v);
                else setVorschlaege([]);
              }}
            >
              <option value="">— ohne Bezug —</option>
              {rechnungOptionen.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.rechnungsnummer} · {formatDate(r.datum)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-maja-muted">
              Bei Auswahl werden Auftraggeber, Adresse und Positionen der
              Rechnung als Vorschlag übernommen.
            </p>
          </div>
          <Field label={`${bezeichnung}-Nummer`} value={nummer} onChange={setNummer}
                 hint="Leer lassen → nächste freie Nummer wird vergeben." />
          <Field label="Datum" type="date" value={datum} onChange={setDatum} />
          <Field label="Leistungszeitraum von" type="date" value={zeitraumVon} onChange={setZeitraumVon} />
          <Field label="Leistungszeitraum bis" type="date" value={zeitraumBis} onChange={setZeitraumBis} />
          <Field
            label="Anrede"
            value={anrede}
            onChange={setAnrede}
            hint={istManuell
              ? `Vorschlag: ${buildAnrede(nameZeile(manuell))}`
              : undefined}
          />
          <Field label="USt-Satz (%)" value={String(ustSatz)}
                 onChange={(v) => setUstSatz(Number(v.replace(',', '.')) || 0)} />
          <Field label="Kundennummer" value={kundennummer} onChange={setKundennummer} />
          <Field label="Sachbearbeiter" value={sachbearbeiter} onChange={setSachbearbeiter} />
        </div>

        {istManuell && (
          <ManuellerEmpfaengerFeldsatz
            idPrefix="gs-man"
            wert={manuell}
            onChange={setManuell}
            merken={manuellMerken}
            onMerken={setManuellMerken}
          />
        )}

        {!istManuell && (
        <div className="grid gap-3 rounded-lg bg-maja-light/40 p-3 sm:grid-cols-2">
          <h3 className="text-sm font-semibold text-maja-navy sm:col-span-2">Empfänger-Adresse</h3>
          <Field label="Firma" value={snapshot.firma ?? ''}
                 onChange={(v) => setSnapshot({ ...snapshot, firma: v || null })} />
          <Field label="Ansprechpartner" value={snapshot.ansprechpartner ?? ''}
                 onChange={(v) => setSnapshot({ ...snapshot, ansprechpartner: v || null })} />
          <Field label="Straße" value={snapshot.strasse ?? ''}
                 onChange={(v) => setSnapshot({ ...snapshot, strasse: v || null })} />
          <Field label="PLZ / Ort" value={snapshot.plz_ort ?? ''}
                 onChange={(v) => setSnapshot({ ...snapshot, plz_ort: v || null })} />
          <Field label="Land" value={snapshot.land ?? ''}
                 onChange={(v) => setSnapshot({ ...snapshot, land: v || null })} />
        </div>
        )}
      </section>

      {/* Weg A: Positionen aus der Rechnung auswählen */}
      {ladeRechnung && <Spinner label="Rechnung wird geladen …" />}
      {vorschlaege.length > 0 && (
        <section className="card space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-maja-navy">
                Positionen aus der Rechnung
              </h2>
              <p className="text-xs text-maja-muted">
                Nur die angehakten Positionen werden übernommen — für eine
                Teilgutschrift einfach abwählen. Mengen und Beträge lassen
                sich danach noch anpassen.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-secondary text-sm"
                      onClick={() => setVorschlaege((v) => v.map((x) => ({ ...x, gewaehlt: true })))}>
                Alle
              </button>
              <button type="button" className="btn-secondary text-sm"
                      onClick={() => setVorschlaege((v) => v.map((x) => ({ ...x, gewaehlt: false })))}>
                Keine
              </button>
              <button type="button" className="btn-primary text-sm"
                      disabled={!vorschlaege.some((v) => v.gewaehlt)}
                      onClick={uebernehmeAuswahl}>
                Auswahl übernehmen
              </button>
            </div>
          </div>
          <ul className="divide-y divide-maja-navy/10 rounded-lg border border-maja-navy/10">
            {vorschlaege.map((v) => (
              <li key={v.key} className="flex items-start gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                  checked={v.gewaehlt}
                  onChange={(e) => setVorschlaege((cur) => cur.map((x) => (
                    x.key === v.key ? { ...x, gewaehlt: e.target.checked } : x
                  )))}
                  aria-label={`${v.position.bezeichnung} übernehmen`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-maja-ink">{v.position.bezeichnung}</div>
                  {v.position.unterzeilen.filter(Boolean).map((u, i) => (
                    <div key={i} className="text-xs text-maja-muted">{u}</div>
                  ))}
                </div>
                <div className="shrink-0 text-right text-sm tabular-nums text-maja-ink">
                  {formatEuro(v.position.gesamtpreis)}
                  <span className="block text-xs text-maja-muted">
                    {v.position.menge} × {formatEuro(v.position.einzelpreis)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-right text-sm text-maja-ink">
            Auswahl: <strong className="tabular-nums">{formatEuro(gewaehlteSumme.brutto)}</strong> brutto
          </p>
        </section>
      )}

      {/* Positionen — jederzeit erweiterbar, auch ohne Rechnungsbezug */}
      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-maja-navy">Positionen</h2>
          <button type="button" className="btn-secondary text-sm"
                  onClick={() => setPositionen((rows) => [...rows, emptyManuellePosition()])}>
            + Leere Position
          </button>
        </div>
        <PositionsTable
          positionen={positionen}
          defaultUstSatz={ustSatz}
          onChange={setPositionen}
        />
        {positionen.length > 0 && (
          <SummenBlock positionen={positionen} defaultSatz={ustSatz} prominent />
        )}
      </section>

      {/* Texte + Notizen */}
      <section className="card space-y-3 p-5">
        <h2 className="text-base font-semibold text-maja-navy">Texte</h2>
        <div>
          <label htmlFor="gs-einleitung" className="label">Einleitungstext</label>
          <textarea id="gs-einleitung" className="input min-h-[4rem]" value={einleitung}
                    onChange={(e) => setEinleitung(e.target.value)} />
        </div>
        <div>
          <label htmlFor="gs-schluss" className="label">Schlusstext</label>
          <textarea id="gs-schluss" className="input min-h-[4rem]" value={schluss}
                    onChange={(e) => setSchluss(e.target.value)} />
        </div>
        <div>
          <label htmlFor="gs-notizen" className="label">Interne Notizen</label>
          <textarea id="gs-notizen" className="input min-h-[4rem]" value={notizen}
                    onChange={(e) => setNotizen(e.target.value)} />
          <p className="mt-1 text-xs text-maja-muted">Erscheinen nicht auf dem Dokument.</p>
        </div>
      </section>

      <div className="flex items-center gap-2">
        <button type="button" className="btn-primary" disabled={saving || !auftraggeberId}
                onClick={() => void anlegen()}>
          {saving ? 'Wird angelegt …' : `${bezeichnung} anlegen`}
        </button>
        <button type="button" className="btn-secondary" disabled={saving}
                onClick={() => navigate('/gutschriften')}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, type = 'text', hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  hint?: string;
}) {
  const id = `gsf-${label.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input id={id} type={type} className="input" value={value}
             onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="mt-1 text-xs text-maja-muted">{hint}</p>}
    </div>
  );
}

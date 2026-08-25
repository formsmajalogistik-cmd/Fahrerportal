// Brief anlegen und bearbeiten (Migration 091).
//
// Deckt ab: frei schreiben oder aus Vorlage, Empfänger manuell oder aus
// der Fahrerliste, PDF erzeugen, an den Fahrer senden und per E-Mail
// versenden.
//
// Wiederverwendet aus dem Rechnungsmodul: den manuellen Empfänger-Block
// samt gemerkter Empfänger, das PDF-Layout und den E-Mail-Dialog.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { Spinner } from '../../../components/Spinner';
import { formatDate, formatDateTime } from '../../../lib/touren';
import { useTestGuard } from '../../../auth/TestModeContext';
import { ManuellerEmpfaengerFeldsatz } from '../../../components/ManuellerEmpfaengerFeldsatz';
import { leererEmpfaenger, merkeEmpfaenger, type ManuellerEmpfaengerEntwurf } from '../../../lib/manuelleEmpfaenger';
import { uploadToOneDrive } from '../../../lib/onedrive';
import { previewFormPdf, downloadFormPdf } from '../../../lib/pdfGenerate';
import { generateBriefPdf, briefPdfFilename } from './briefPdf';
import { FahrerSelect, type FahrerOptionRaw } from '../../touren/FahrerSelect';
import { displayName, fahrerName } from '../../../lib/names';
import {
  ladeAbsenderBilder, ladeAbsenderSignatur, type AbsenderSignatur,
} from '../../../lib/absenderSignatur';
import { AbsenderSignaturSchalter } from '../../../components/AbsenderSignaturSchalter';
import { BriefEmailDialog } from './BriefEmailDialog';
import {
  BRIEF_STATUS_LABEL, adressZeilen, adresseAlsJson, empfaengerAnzeige,
  ladeVorlagen, loesePlatzhalter, naechsteBriefNr,
  parseBriefAdresse,
  type Brief, type BriefAdresse, type BriefVorlage, type Tankkarte,
} from '../../../lib/briefe';

/**
 * Fahrer für die Empfängerauswahl. Basis ist die geteilte Option der
 * FahrerSelect-Komponente (Namensbildung, Unterkonto-Gruppierung) —
 * ergänzt um die Adressfelder, mit denen der Brief vorbelegt wird.
 */
interface FahrerOption extends FahrerOptionRaw {
  user?: {
    email: string;
    vorname: string | null;
    nachname: string | null;
    strasse: string | null;
    plz: string | null;
    ort: string | null;
  } | null;
}

function heute(): string {
  return new Date().toISOString().slice(0, 10);
}

export function BriefDetailPage() {
  const { id } = useParams<{ id: string }>();
  const istNeu = !id || id === 'neu';
  const navigate = useNavigate();
  const guard = useTestGuard();
  // Aus der Tankkarten-Übersicht: Karte und Fahrer vorbelegen.
  const [params] = useSearchParams();

  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [mailOffen, setMailOffen] = useState(false);

  // Kopfdaten
  const [briefNr, setBriefNr] = useState('');
  const [datum, setDatum] = useState(heute());
  const [betreff, setBetreff] = useState('');
  const [inhalt, setInhalt] = useState('');
  const [vorlageId, setVorlageId] = useState('');

  // Empfänger
  const [empfTyp, setEmpfTyp] = useState<'manuell' | 'fahrer'>('manuell');
  const [manuell, setManuell] = useState<ManuellerEmpfaengerEntwurf>(leererEmpfaenger());
  const [manuellMerken, setManuellMerken] = useState(false);
  const [fahrerId, setFahrerId] = useState('');

  // Unterschrift/Stempel des Absenders (Migration 092). Die Schalter
  // stehen standardmäßig an; ist nichts hinterlegt, bleibt der Bereich
  // wie bisher leer — dann sind sie auch nicht bedienbar.
  const [absenderSig, setAbsenderSig] = useState<AbsenderSignatur | null>(null);
  const [mitUnterschrift, setMitUnterschrift] = useState(true);
  const [mitStempel, setMitStempel] = useState(true);

  // Stammdaten
  const [vorlagen, setVorlagen] = useState<BriefVorlage[]>([]);
  const [fahrer, setFahrer] = useState<FahrerOption[]>([]);
  const [karten, setKarten] = useState<Tankkarte[]>([]);
  const [karteId, setKarteId] = useState('');

  const laden = useCallback(async () => {
    setLoading(true);
    const [vRes, fRes, kRes, sigRes] = await Promise.all([
      ladeVorlagen(),
      // E-Mail bewusst mitladen: Haupt-Konten führen ihren Namen in
      // app_users, und wenn dort gar nichts steht, ist die E-Mail der
      // letzte brauchbare Anzeigename. Unterkonten kommen mit — die
      // FahrerSelect-Komponente gruppiert sie unter ihrem Haupt-Konto.
      supabase.from('fahrer')
        .select('id, vorname, nachname, ist_unterkonto, haupt_user_id, user:user_id (email, vorname, nachname, strasse, plz, ort)')
        .eq('aktiv', true),
      supabase.from('tankkarten').select('*').order('kartennummer'),
      ladeAbsenderSignatur(),
    ]);
    setVorlagen(vRes);
    setFahrer((fRes.data as unknown as FahrerOption[]) ?? []);
    setKarten((kRes.data as Tankkarte[]) ?? []);
    setAbsenderSig(sigRes);

    if (istNeu) {
      const nr = await naechsteBriefNr(new Date().getFullYear());
      setBriefNr(nr ?? '');
      // Aufruf aus der Tankkarten-Zuweisung: Karte, Fahrer und die
      // Tankkarten-Vorlage vorbelegen.
      const kId = params.get('tankkarte');
      const fId = params.get('fahrer');
      if (kId) setKarteId(kId);
      if (fId) { setEmpfTyp('fahrer'); setFahrerId(fId); }
      if (kId) {
        const tkVorlage = vRes.find((v) => v.typ === 'tankkarte');
        if (tkVorlage) setVorlageId(tkVorlage.id);
      }
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.from('briefe').select('*').eq('id', id!).single();
    if (error || !data) { setFehler(error?.message ?? 'Brief nicht gefunden.'); setLoading(false); return; }
    const b = data as Brief;
    setBrief(b);
    setBriefNr(b.brief_nr);
    setDatum(b.datum);
    setBetreff(b.betreff ?? '');
    setInhalt(b.inhalt ?? '');
    setVorlageId(b.vorlage_id ?? '');
    setEmpfTyp(b.empfaenger_typ === 'fahrer' ? 'fahrer' : 'manuell');
    setFahrerId(b.fahrer_id ?? '');
    setMitUnterschrift(b.mit_unterschrift ?? true);
    setMitStempel(b.mit_stempel ?? true);
    const a = parseBriefAdresse(b.adress_snapshot);
    setManuell({
      ...leererEmpfaenger(),
      firma: a.firma, anrede: a.anrede, vorname: a.vorname, nachname: a.nachname,
      strasse: a.strasse, plz: a.plz, ort: a.ort,
    });
    setLoading(false);
  }, [id, istNeu, params]);

  useEffect(() => {
    const t = window.setTimeout(() => { void laden(); }, 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  const gewaehlterFahrer = useMemo(
    () => fahrer.find((f) => f.id === fahrerId) ?? null, [fahrer, fahrerId],
  );

  /** Anzeigename — zentrale Hilfsfunktion, E-Mail als letzter Rückfall. */
  function fahrerLabel(f: FahrerOption): string {
    return fahrerName(f, f.user ?? null) || displayName(f.user ?? null) || '';
  }

  /**
   * Adresse des Briefs. Beim Empfänger-Typ "fahrer" kommen Name und
   * Adresse aus dem Profil — fehlt dort etwas, ergänzt der Admin es im
   * Manuell-Block, der dann als Übersteuerung dient.
   */
  const adresse: BriefAdresse = useMemo(() => {
    if (empfTyp === 'fahrer' && gewaehlterFahrer) {
      const u = gewaehlterFahrer.user;
      return {
        firma: manuell.firma.trim(),
        anrede: manuell.anrede.trim(),
        vorname: manuell.vorname.trim() || (gewaehlterFahrer.vorname ?? u?.vorname ?? ''),
        nachname: manuell.nachname.trim() || (gewaehlterFahrer.nachname ?? u?.nachname ?? ''),
        strasse: manuell.strasse.trim() || (u?.strasse ?? ''),
        plz: manuell.plz.trim() || (u?.plz ?? ''),
        ort: manuell.ort.trim() || (u?.ort ?? ''),
      };
    }
    return {
      firma: manuell.firma.trim(), anrede: manuell.anrede.trim(),
      vorname: manuell.vorname.trim(), nachname: manuell.nachname.trim(),
      strasse: manuell.strasse.trim(), plz: manuell.plz.trim(), ort: manuell.ort.trim(),
    };
  }, [empfTyp, gewaehlterFahrer, manuell]);

  const gewaehlteKarte = useMemo(
    () => karten.find((k) => k.id === karteId) ?? null, [karten, karteId],
  );

  /** Vorlage übernehmen — Platzhalter direkt auflösen, Text danach frei. */
  function vorlageUebernehmen(vid: string) {
    setVorlageId(vid);
    const v = vorlagen.find((x) => x.id === vid);
    if (!v) return;
    const ctx = {
      adresse, datum, briefNr,
      tankkarte: gewaehlteKarte,
      fahrerName: gewaehlterFahrer ? fahrerLabel(gewaehlterFahrer) : '',
    };
    setBetreff(loesePlatzhalter(v.betreff ?? '', ctx));
    setInhalt(loesePlatzhalter(v.inhalt ?? '', ctx));
    setHinweis('Vorlage übernommen — der Text ist jetzt frei bearbeitbar.');
  }

  async function speichern(): Promise<string | null> {
    if (guard()) return null;
    if (empfTyp === 'fahrer' && !fahrerId) {
      setFehler('Bitte einen Fahrer wählen.'); return null;
    }
    if (!adresse.firma && !adresse.nachname) {
      setFehler('Bitte eine Firma oder einen Namen für den Empfänger angeben.'); return null;
    }
    setBusy('Speichern …');
    setFehler(null);
    const payload = {
      vorlage_id: vorlageId || null,
      empfaenger_typ: empfTyp,
      fahrer_id: empfTyp === 'fahrer' ? fahrerId : null,
      adress_snapshot: adresseAlsJson(adresse),
      datum,
      betreff: betreff.trim() || null,
      inhalt: inhalt.trim() || null,
      mit_unterschrift: mitUnterschrift,
      mit_stempel: mitStempel,
    };
    let neueId = brief?.id ?? null;
    if (istNeu && !brief) {
      const { data, error } = await supabase.from('briefe')
        .insert({ ...payload, brief_nr: briefNr.trim() || undefined })
        .select('*').single();
      if (error || !data) { setBusy(null); setFehler(error?.message ?? 'Anlegen fehlgeschlagen.'); return null; }
      const b = data as Brief;
      setBrief(b); setBriefNr(b.brief_nr); neueId = b.id;
      navigate(`/briefe/${b.id}`, { replace: true });
    } else {
      const { error } = await supabase.from('briefe')
        .update({ ...payload, brief_nr: briefNr.trim() || brief!.brief_nr })
        .eq('id', brief!.id);
      if (error) { setBusy(null); setFehler(error.message); return null; }
      await laden();
    }
    if (empfTyp === 'manuell' && manuellMerken) {
      const m = await merkeEmpfaenger(manuell);
      if (!m.ok) console.warn('[Brief] Empfänger merken fehlgeschlagen', m.fehler);
    }
    setBusy(null);
    setHinweis('Gespeichert.');
    return neueId;
  }

  /** PDF erzeugen. `signiert` bettet die erfasste Unterschrift ein. */
  async function pdfErzeugen(signiert: boolean) {
    const bid = brief?.id ?? await speichern();
    if (!bid) return;
    if (guard()) return;
    setBusy('PDF wird erzeugt …');
    setFehler(null);
    try {
      // Frisch laden — die Unterschrift kann seit dem letzten Öffnen
      // dazugekommen sein (gleiche Lehre wie beim Rechnungs-PDF).
      const { data } = await supabase.from('briefe').select('*').eq('id', bid).single();
      const b = (data as Brief) ?? brief!;
      // Unterschrift/Stempel des Absenders — nur laden, was der Brief
      // auch einsetzen soll. Fehlt beides, kommt null zurück und das
      // PDF sieht aus wie vorher (Linie zum Unterschreiben).
      const absender = await ladeAbsenderBilder({
        mitUnterschrift: b.mit_unterschrift ?? true,
        mitStempel: b.mit_stempel ?? true,
      });
      const blob = await generateBriefPdf({
        briefNr: b.brief_nr,
        datum: b.datum,
        betreff: b.betreff ?? '',
        inhalt: b.inhalt ?? '',
        empfaengerZeilen: adressZeilen(parseBriefAdresse(b.adress_snapshot)),
        ort: parseBriefAdresse(b.adress_snapshot).ort,
        unterschrift: signiert ? b.unterschrift_bild : null,
        unterschriebenAm: signiert ? b.unterschrieben_am : null,
        absenderUnterschrift: absender.unterschrift,
        absenderStempel: absender.stempel,
      });
      const jahr = b.datum.slice(0, 4);
      const name = signiert
        ? briefPdfFilename(`${b.brief_nr}_unterschrieben`)
        : briefPdfFilename(b.brief_nr);
      const pfad = `Maja-Logistik/Briefe/${jahr}/${name}`;
      await uploadToOneDrive(pfad, blob);
      const patch = signiert ? { pdf_signiert_url: pfad } : { pdf_url: pfad, status: b.status === 'entwurf' ? 'final' : b.status };
      await supabase.from('briefe').update(patch).eq('id', bid);
      await laden();
      setHinweis(signiert ? 'Unterschriebene PDF erzeugt.' : 'PDF erzeugt.');
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'PDF-Erzeugung fehlgeschlagen.');
    } finally {
      setBusy(null);
    }
  }

  async function anFahrerSenden() {
    if (!brief || guard()) return;
    setBusy('Wird zugestellt …');
    const { error } = await supabase.from('briefe')
      .update({ an_fahrer_gesendet_am: new Date().toISOString(), status: 'versendet' })
      .eq('id', brief.id);
    setBusy(null);
    if (error) { setFehler(error.message); return; }
    await laden();
    setHinweis('Der Brief liegt jetzt im Konto des Fahrers.');
  }

  if (loading) return <Spinner label="Brief wird geladen …" />;

  const kannAnFahrer = !!brief && brief.empfaenger_typ === 'fahrer' && !!brief.fahrer_id;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">
            {brief ? `Brief ${brief.brief_nr}` : 'Neuer Brief'}
          </h1>
          {brief && (
            <p className="text-sm text-maja-muted">
              {empfaengerAnzeige(parseBriefAdresse(brief.adress_snapshot))} ·{' '}
              {formatDate(brief.datum)} ·{' '}
              {BRIEF_STATUS_LABEL[brief.status] ?? brief.status}
              {brief.unterschrieben_am && ` · unterschrieben ${formatDateTime(brief.unterschrieben_am)}`}
            </p>
          )}
        </div>
        <button type="button" className="btn-secondary" onClick={() => navigate('/briefe')}>
          Zurück
        </button>
      </div>

      {fehler && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>
      )}
      {hinweis && (
        <div role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{hinweis}</div>
      )}

      {/* Kopfdaten */}
      <section className="card space-y-4 p-5">
        <h2 className="text-base font-semibold text-maja-navy">Kopfdaten</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="b-nr" className="label">Brief-Nummer</label>
            <input id="b-nr" className="input" value={briefNr}
                   onChange={(e) => setBriefNr(e.target.value)} spellCheck={false} />
            <p className="mt-1 text-xs text-maja-muted">
              Eigene Serie, getrennt von Rechnungen und Gutschriften.
            </p>
          </div>
          <div>
            <label htmlFor="b-datum" className="label">Datum</label>
            <input id="b-datum" type="date" className="input" value={datum}
                   onChange={(e) => setDatum(e.target.value)} />
          </div>
          <div>
            <label htmlFor="b-vorlage" className="label">Vorlage</label>
            <select id="b-vorlage" className="input" value={vorlageId}
                    onChange={(e) => vorlageUebernehmen(e.target.value)}>
              <option value="">— frei schreiben —</option>
              {vorlagen.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          {karten.length > 0 && (
            <div>
              <label htmlFor="b-karte" className="label">Tankkarte (für Platzhalter)</label>
              <select id="b-karte" className="input" value={karteId}
                      onChange={(e) => setKarteId(e.target.value)}>
                <option value="">— keine —</option>
                {karten.filter((k) => k.status !== 'gesperrt').map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.anbieter ? `${k.anbieter} · ` : ''}{k.kartennummer}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </section>

      {/* Empfänger */}
      <section className="card space-y-4 p-5">
        <h2 className="text-base font-semibold text-maja-navy">Empfänger</h2>
        <div className="flex flex-wrap gap-4">
          {(['manuell', 'fahrer'] as const).map((typ) => (
            <label key={typ} className="inline-flex items-center gap-2 text-sm text-maja-ink">
              <input type="radio" name="empf-typ" className="h-4 w-4"
                     checked={empfTyp === typ}
                     onChange={() => setEmpfTyp(typ)} />
              {typ === 'manuell' ? 'Manuell eingeben' : 'Fahrer aus der App'}
            </label>
          ))}
        </div>

        {empfTyp === 'fahrer' && (
          <div>
            <label htmlFor="b-fahrer" className="label">Fahrer</label>
            <FahrerSelect
              id="b-fahrer"
              value={fahrerId}
              onChange={setFahrerId}
              fahrer={fahrer}
              placeholder="— wählen —"
            />
            <p className="mt-1 text-xs text-maja-muted">
              Adresse kommt aus dem Profil; fehlende Angaben unten ergänzen.
              Nur bei dieser Variante ist der Versand in die App möglich.
            </p>
          </div>
        )}

        <ManuellerEmpfaengerFeldsatz
          idPrefix="b-emp"
          wert={manuell}
          onChange={setManuell}
          merken={manuellMerken}
          onMerken={setManuellMerken}
        />

        {adressZeilen(adresse).length > 0 && (
          <div className="rounded-lg bg-maja-light/50 p-3 text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-maja-muted">
              So erscheint der Adressblock
            </div>
            {adressZeilen(adresse).map((z, i) => (
              <div key={z} className={i === 0 ? 'font-semibold text-maja-navy' : 'text-maja-ink'}>{z}</div>
            ))}
          </div>
        )}
      </section>

      {/* Text */}
      <section className="card space-y-3 p-5">
        <h2 className="text-base font-semibold text-maja-navy">Betreff und Text</h2>
        <div>
          <label htmlFor="b-betreff" className="label">Betreff</label>
          <input id="b-betreff" className="input" value={betreff}
                 onChange={(e) => setBetreff(e.target.value)} />
        </div>
        <div>
          <label htmlFor="b-inhalt" className="label">Brieftext</label>
          <textarea id="b-inhalt" className="input min-h-[16rem] font-sans" value={inhalt}
                    onChange={(e) => setInhalt(e.target.value)} />
          <p className="mt-1 text-xs text-maja-muted">
            Leerzeile trennt Absätze. Die Vorschau unten zeigt den Umbruch
            so, wie er in der PDF erscheint.
          </p>
        </div>
        {inhalt.trim() && (
          <div className="rounded-lg border border-maja-navy/15 bg-white p-4 dark:bg-surface-800">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-maja-muted">
              Vorschau
            </div>
            {betreff.trim() && (
              <div className="mb-2 font-semibold text-maja-navy">{betreff}</div>
            )}
            {inhalt.split(/\n{2,}/).map((abs) => (
              <p key={abs.slice(0, 40)} className="mb-2 whitespace-pre-wrap text-sm text-maja-ink">
                {abs}
              </p>
            ))}
          </div>
        )}
      </section>

      {/* Unterschrift des Absenders (Migration 092). Bewusst je Brief
          abwählbar — Schreiben, die von Hand unterschrieben werden
          sollen, brauchen die leere Linie. */}
      <section className="card space-y-3 p-5">
        <h2 className="text-base font-semibold text-maja-navy">Unterschrift des Absenders</h2>
        <AbsenderSignaturSchalter
          signatur={absenderSig}
          mitUnterschrift={mitUnterschrift}
          mitStempel={mitStempel}
          zielBeschreibung="in den Unterschriftsbereich rechts"
          onChange={(p) => {
            if (p.mitUnterschrift !== undefined) setMitUnterschrift(p.mitUnterschrift);
            if (p.mitStempel !== undefined) setMitStempel(p.mitStempel);
          }}
        />
      </section>

      {/* Aktionen */}
      <section className="card flex flex-wrap items-center gap-2 p-5">
        <button type="button" className="btn-primary" disabled={!!busy}
                onClick={() => void speichern()}>
          {busy === 'Speichern …' ? busy : 'Speichern'}
        </button>
        <button type="button" className="btn-secondary" disabled={!!busy}
                onClick={() => void pdfErzeugen(false)}>
          PDF erzeugen
        </button>
        {brief?.pdf_url && (
          <>
            <button type="button" className="btn-secondary"
                    onClick={() => void previewFormPdf(brief.pdf_url!, null)}>
              PDF anzeigen
            </button>
            <button type="button" className="btn-secondary"
                    onClick={() => void downloadFormPdf(brief.pdf_url!, briefPdfFilename(brief.brief_nr), null)}>
              Herunterladen
            </button>
          </>
        )}
        {brief?.unterschrieben_am && (
          <button type="button" className="btn-secondary" disabled={!!busy}
                  onClick={() => void pdfErzeugen(true)}>
            Unterschriebene PDF erzeugen
          </button>
        )}
        {brief?.pdf_signiert_url && (
          <button type="button" className="btn-secondary"
                  onClick={() => void previewFormPdf(brief.pdf_signiert_url!, null)}>
            Unterschriebene PDF anzeigen
          </button>
        )}
        {kannAnFahrer && (
          <button type="button" className="btn-accent" disabled={!!busy}
                  onClick={() => void anFahrerSenden()}>
            {brief!.an_fahrer_gesendet_am ? 'Erneut an Fahrer senden' : 'An Fahrer senden'}
          </button>
        )}
        {brief?.pdf_url && (
          <button type="button" className="btn-secondary" onClick={() => setMailOffen(true)}>
            Per E-Mail versenden
          </button>
        )}
        {busy && <span className="text-sm text-maja-muted">{busy}</span>}
      </section>

      {brief && (
        <p className="text-xs text-maja-muted">
          {brief.an_fahrer_gesendet_am && `In die App zugestellt: ${formatDateTime(brief.an_fahrer_gesendet_am)}. `}
          {brief.email_versendet_am && `Per E-Mail versendet: ${formatDateTime(brief.email_versendet_am)}.`}
        </p>
      )}

      {mailOffen && brief && (
        <BriefEmailDialog
          brief={brief}
          onClose={() => setMailOffen(false)}
          onSent={() => { setMailOffen(false); void laden(); }}
        />
      )}
    </div>
  );
}

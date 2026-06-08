import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { supabase } from '../../lib/supabase';
import { Spinner } from '../../components/Spinner';
import { XIcon } from '../../components/icons';
import { formatAnzahl, formatDate, formatEuro } from '../../lib/touren';
import { ZUSATZ_KATEGORIEN } from '../../lib/zusatzKategorien';
import { addBelege } from '../../lib/belegeStorage';
import { pdfjsLib } from '../../lib/pdfjs';
import { compressImage } from '../../lib/photo';
import {
  fetchAttachmentBlob, type MailDetail,
} from '../../lib/emails';
import { EmailMessageHeader, EmailMessageView } from './EmailMessageView';
import type { TourZusatz } from '../../types/db';

interface Props {
  mail: MailDetail;
  mailbox: string;
  tourId: string;
  /**
   * "zusaetze": rechts nur die Zusätze-Sektion.
   * "zusaetze-belege": zusätzlich werden beim Öffnen alle Mail-
   * Anhänge in den Belege-Reiter übernommen (Aufgabe 5).
   */
  mode: 'zusaetze' | 'zusaetze-belege';
  onClose: () => void;
}

interface TourHead {
  id: string;
  tour_id: string | null;
  tourenart: 'AB' | 'ABA' | 'ABC' | null;
  start_stadt: string;
  ziel_stadt: string;
  rueckfuehrung_stadt: string | null;
  startdatum: string;
  enddatum: string;
  kennzeichen: string[];
  barauslagen: number;
  fahrer_honorar: number;
}

function parseDecimal(input: string): number | null {
  const normalized = input.trim().replace(/\./g, '').replace(',', '.');
  if (!normalized) return 0;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function decimalToInput(value: number | null | undefined): string {
  if (value == null) return '';
  return Number(value).toFixed(2).replace('.', ',');
}

/**
 * Side-by-Side aus dem Protokollierungs-Postfach: links die E-Mail
 * mit Inline-Anhängen, rechts die Zusätze- und Auslagen-Eingabe der
 * gewählten Tour. Im Modus "zusaetze-belege" werden alle Mail-Anhänge
 * beim Mount in den Belege-Speicher übernommen (Aufgabe 5).
 */
export function ZusaetzeFromEmailPanel({ mail, mailbox, tourId, mode, onClose }: Props) {
  const [tab, setTab] = useState<'mail' | 'form'>('mail');
  const [tour, setTour] = useState<TourHead | null>(null);
  const [zusaetze, setZusaetze] = useState<TourZusatz[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [adding, setAdding] = useState(false);

  // Zusatz-Eingabe-State
  const [neueKategorie, setNeueKategorie] = useState('');
  const [neueAnzahl, setNeueAnzahl] = useState('1');
  const [neuerBetrag, setNeuerBetrag] = useState('');
  const [neueNotiz, setNeueNotiz] = useState('');
  const [neuesKennzeichen, setNeuesKennzeichen] = useState('');

  // Barauslagen + Honorar
  const [barauslagenInput, setBarauslagenInput] = useState('');
  const [honorarInput, setHonorarInput] = useState('');

  // Belege-Import (Aufgabe 5)
  const [belegeImportBusy, setBelegeImportBusy] = useState(false);
  const [belegeInfo, setBelegeInfo] = useState<{ files: number; pages: number } | null>(null);
  const belegeImportedRef = useRef(false);

  // ---- Tour + Zusätze laden ----
  const load = useCallback(async () => {
    setLoading(true);
    const [tRes, zRes] = await Promise.all([
      supabase.from('touren')
        .select('id, tour_id, tourenart, start_stadt, ziel_stadt, rueckfuehrung_stadt, startdatum, enddatum, kennzeichen, barauslagen, fahrer_honorar')
        .eq('id', tourId).single(),
      supabase.from('tour_zusaetze').select('*').eq('tour_id', tourId).order('created_at'),
    ]);
    if (tRes.error) {
      setStatusMsg({ kind: 'err', text: tRes.error.message });
      setLoading(false);
      return;
    }
    const t = tRes.data as TourHead;
    setTour(t);
    setBarauslagenInput(decimalToInput(t.barauslagen));
    setHonorarInput(decimalToInput(t.fahrer_honorar));
    setZusaetze(Array.isArray(zRes.data) ? (zRes.data as TourZusatz[]) : []);
    setLoading(false);
  }, [tourId]);

  useEffect(() => {
    // Async-Wrapper, damit setState nicht synchron im Effect-Body
    // landet (React-19 set-state-in-effect-Linter).
    void Promise.resolve().then(() => { void load(); });
  }, [load]);

  // ---- Belege automatisch aus Anhängen importieren (Modus 5) ----
  useEffect(() => {
    if (mode !== 'zusaetze-belege') return;
    if (belegeImportedRef.current) return;
    if (mail.attachments.length === 0) {
      belegeImportedRef.current = true;
      return;
    }
    belegeImportedRef.current = true;
    void (async () => {
      setBelegeImportBusy(true);
      let pages = 0;
      let files = 0;
      try {
        const records: Array<{ blob: Blob; source: 'pdf-seite' | 'email-anhang'; name: string }> = [];
        for (const att of mail.attachments) {
          const isImage = att.contentType.startsWith('image/');
          const isPdf = att.contentType === 'application/pdf';
          if (!isImage && !isPdf) continue;
          try {
            const blob = await fetchAttachmentBlob({
              mailbox, messageId: mail.id, attachmentId: att.id, disposition: 'attachment',
            });
            if (isImage) {
              const file = new File([blob], att.name, { type: att.contentType });
              const compressed = await compressImage(file);
              records.push({ blob: compressed, source: 'email-anhang', name: att.name });
              files += 1;
            } else if (isPdf) {
              const pageBlobs = await pdfBlobToPages(blob, att.name);
              for (const p of pageBlobs) {
                const compressed = await compressImage(p.file);
                records.push({ blob: compressed, source: 'pdf-seite', name: p.file.name });
              }
              pages += pageBlobs.length;
              files += 1;
            }
          } catch (err) {
            console.warn('[ZusaetzeFromEmailPanel] Anhang konnte nicht importiert werden', att.name, err);
          }
        }
        if (records.length > 0) await addBelege(records);
        setBelegeInfo({ files, pages });
      } finally {
        setBelegeImportBusy(false);
      }
    })();
  }, [mode, mail, mailbox]);

  // ---- Zusatz hinzufügen ----
  async function handleAddZusatz() {
    if (!tour) return;
    const kategorie = neueKategorie.trim();
    if (!kategorie) {
      setStatusMsg({ kind: 'err', text: 'Kategorie darf nicht leer sein.' });
      return;
    }
    const betrag = parseDecimal(neuerBetrag);
    if (betrag === null) {
      setStatusMsg({ kind: 'err', text: 'Betrag ist ungültig.' });
      return;
    }
    const anzahlVal = parseDecimal(neueAnzahl);
    const anzahl = anzahlVal !== null && anzahlVal >= 0.01 ? anzahlVal : 1;
    const twoSlots = tour.tourenart === 'ABA' || tour.tourenart === 'ABC';
    let kennzeichen: string | null = null;
    if (twoSlots) {
      const picked = neuesKennzeichen.trim();
      if (!picked) {
        setStatusMsg({ kind: 'err', text: 'Bitte das Kennzeichen wählen.' });
        return;
      }
      kennzeichen = picked;
    } else {
      kennzeichen = (tour.kennzeichen?.[0]?.trim() || null);
    }
    setAdding(true);
    const { data, error: err } = await supabase
      .from('tour_zusaetze')
      .insert({ tour_id: tour.id, kategorie, anzahl, betrag, notiz: neueNotiz.trim() || null, kennzeichen })
      .select('*')
      .single();
    setAdding(false);
    if (err) { setStatusMsg({ kind: 'err', text: err.message }); return; }
    setZusaetze((z) => [...z, data as TourZusatz]);
    setNeueKategorie('');
    setNeueAnzahl('1');
    setNeuerBetrag('');
    setNeueNotiz('');
    setNeuesKennzeichen('');
    setStatusMsg({ kind: 'ok', text: 'Zusatz hinzugefügt.' });
  }

  async function handleDelete(id: string) {
    const { error: err } = await supabase.from('tour_zusaetze').delete().eq('id', id);
    if (err) { setStatusMsg({ kind: 'err', text: err.message }); return; }
    setZusaetze((z) => z.filter((x) => x.id !== id));
  }

  async function commitBarauslagen() {
    if (!tour) return;
    const v = parseDecimal(barauslagenInput);
    if (v === null) { setBarauslagenInput(decimalToInput(tour.barauslagen)); return; }
    if (v === Number(tour.barauslagen)) return;
    const { error: err } = await supabase.from('touren').update({ barauslagen: v }).eq('id', tour.id);
    if (err) { setStatusMsg({ kind: 'err', text: err.message }); return; }
    setTour({ ...tour, barauslagen: v });
    setStatusMsg({ kind: 'ok', text: 'Barauslagen gespeichert.' });
  }

  async function commitHonorar() {
    if (!tour) return;
    const v = parseDecimal(honorarInput);
    if (v === null) { setHonorarInput(decimalToInput(tour.fahrer_honorar)); return; }
    if (v === Number(tour.fahrer_honorar)) return;
    const { error: err } = await supabase.from('touren').update({ fahrer_honorar: v }).eq('id', tour.id);
    if (err) { setStatusMsg({ kind: 'err', text: err.message }); return; }
    setTour({ ...tour, fahrer_honorar: v });
    setStatusMsg({ kind: 'ok', text: 'Fahrer-Honorar gespeichert.' });
  }

  const summe = useMemo(() => zusaetze.reduce(
    (acc, z) => acc + Number(z.betrag) * Math.max(0.01, Number(z.anzahl ?? 1)), 0,
  ), [zusaetze]);

  const twoSlots = tour?.tourenart === 'ABA' || tour?.tourenart === 'ABC';

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-maja-navy">
          {mode === 'zusaetze-belege' ? 'Zusätze hinzufügen + Belege übernehmen' : 'Zusätze hinzufügen'}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-maja-navy/15 bg-white p-0.5 md:hidden">
            <TabBtn active={tab === 'mail'} onClick={() => setTab('mail')}>E-Mail</TabBtn>
            <TabBtn active={tab === 'form'} onClick={() => setTab('form')}>Zusätze</TabBtn>
          </div>
          <button type="button" className="btn-secondary text-sm" onClick={onClose}>
            Fertig
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden md:grid-cols-2">
        <div className={`${tab === 'mail' ? '' : 'hidden'} min-h-0 md:block md:overflow-y-auto md:overscroll-contain`}>
          <div className="card flex flex-col p-5">
            <EmailMessageHeader mail={mail} />
            <EmailMessageView mail={mail} mailbox={mailbox} />
          </div>
        </div>
        <div className={`${tab === 'form' ? '' : 'hidden'} min-h-0 pb-12 md:block md:overflow-y-auto md:overscroll-contain`}>
          <div className="card space-y-4 p-5">
            {loading ? <Spinner label="Tour wird geladen …" /> : !tour ? (
              <p className="text-sm text-red-700">Tour nicht gefunden.</p>
            ) : (
              <>
                <TourHeader tour={tour} />
                {mode === 'zusaetze-belege' && (
                  <BelegeImportBanner busy={belegeImportBusy} info={belegeInfo} />
                )}

                {statusMsg && (
                  <p className={`rounded-md px-3 py-2 text-xs ${
                    statusMsg.kind === 'err'
                      ? 'bg-red-50 text-red-700'
                      : 'bg-emerald-50 text-emerald-700'
                  }`}>
                    {statusMsg.text}
                  </p>
                )}

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-maja-navy">Schnell-Hinzufügen</h3>
                  <div className="flex flex-wrap gap-1">
                    {ZUSATZ_KATEGORIEN.map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setNeueKategorie(k)}
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          neueKategorie === k
                            ? 'bg-maja-navy text-white'
                            : 'bg-white text-maja-navy border border-maja-navy/15 hover:bg-maja-light'
                        }`}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-maja-navy">Neuer Zusatz</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {twoSlots && (
                      <div>
                        <label htmlFor="z-kz" className="label">Kennzeichen *</label>
                        <select id="z-kz" className="input"
                                value={neuesKennzeichen}
                                onChange={(e) => setNeuesKennzeichen(e.target.value)}>
                          <option value="">— wählen —</option>
                          {(tour.kennzeichen ?? []).map((k) => (
                            <option key={k} value={k}>{k}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className={twoSlots ? '' : 'sm:col-span-2'}>
                      <label htmlFor="z-kat" className="label">Kategorie *</label>
                      <select id="z-kat" className="input"
                              value={neueKategorie}
                              onChange={(e) => setNeueKategorie(e.target.value)}>
                        <option value="">— wählen —</option>
                        {ZUSATZ_KATEGORIEN.map((k) => (
                          <option key={k} value={k}>{k}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="z-anzahl" className="label">Anzahl</label>
                      <input id="z-anzahl" className="input" type="text" inputMode="decimal"
                             value={neueAnzahl}
                             onChange={(e) => setNeueAnzahl(e.target.value)} />
                    </div>
                    <div>
                      <label htmlFor="z-betrag" className="label">Betrag (€) *</label>
                      <input id="z-betrag" className="input" type="text" inputMode="decimal"
                             value={neuerBetrag}
                             onChange={(e) => setNeuerBetrag(e.target.value)} />
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor="z-notiz" className="label">Notiz (optional)</label>
                      <input id="z-notiz" className="input"
                             value={neueNotiz}
                             onChange={(e) => setNeueNotiz(e.target.value)} />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-primary text-sm"
                    onClick={() => void handleAddZusatz()}
                    disabled={adding}
                  >
                    {adding ? 'Hinzufügen …' : '+ Hinzufügen'}
                  </button>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-maja-navy">
                    Eingetragene Zusätze ({zusaetze.length})
                  </h3>
                  {zusaetze.length === 0 ? (
                    <p className="text-xs text-maja-muted">Noch keine Zusätze.</p>
                  ) : (
                    <ul className="divide-y divide-maja-navy/10 rounded-lg border border-maja-navy/10">
                      {zusaetze.map((z) => {
                        const anzahl = Math.max(0.01, Number(z.anzahl ?? 1));
                        const betrag = Number(z.betrag);
                        const gesamt = Math.round(anzahl * betrag * 100) / 100;
                        return (
                          <li key={z.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                            <div className="min-w-0 flex-1">
                              {z.kennzeichen && (
                                <span className="mr-2 rounded-full bg-maja-light px-2 py-0.5 text-[10px] font-semibold text-maja-navy">
                                  {z.kennzeichen}
                                </span>
                              )}
                              <span className="font-medium">{z.kategorie}</span>
                              <span className="text-maja-muted">: </span>
                              {anzahl !== 1 ? (
                                <span>{formatAnzahl(anzahl)} × {formatEuro(betrag)} = <span className="font-semibold">{formatEuro(gesamt)}</span></span>
                              ) : (
                                <span className="font-semibold">{formatEuro(betrag)}</span>
                              )}
                              {z.notiz && <div className="text-xs text-maja-muted">{z.notiz}</div>}
                            </div>
                            <button type="button"
                                    onClick={() => void handleDelete(z.id)}
                                    className="rounded p-1 text-red-600 hover:bg-red-50"
                                    aria-label="Zusatz löschen">
                              <XIcon className="h-4 w-4" />
                            </button>
                          </li>
                        );
                      })}
                      <li className="flex items-center justify-between border-t border-maja-navy/10 bg-maja-light/40 px-3 py-2 text-sm">
                        <span className="font-medium text-maja-navy">Summe</span>
                        <span className="font-semibold text-maja-navy">{formatEuro(summe)}</span>
                      </li>
                    </ul>
                  )}
                </section>

                <section className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label htmlFor="z-bar" className="label">Barauslagen (€)</label>
                    <input id="z-bar" className="input" type="text" inputMode="decimal"
                           value={barauslagenInput}
                           onChange={(e) => setBarauslagenInput(e.target.value)}
                           onBlur={() => void commitBarauslagen()} />
                    <p className="mt-0.5 text-[11px] text-maja-muted">Speichert automatisch beim Verlassen des Feldes.</p>
                  </div>
                  <div>
                    <label htmlFor="z-honorar" className="label">Fahrer-Honorar (€)</label>
                    <input id="z-honorar" className="input" type="text" inputMode="decimal"
                           value={honorarInput}
                           onChange={(e) => setHonorarInput(e.target.value)}
                           onBlur={() => void commitHonorar()} />
                  </div>
                </section>

                <div className="flex justify-end">
                  <button type="button" className="btn-secondary text-sm" onClick={onClose}>
                    Fertig
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- kleine Subkomponenten ---------------------------------------------

function TabBtn({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
            className={`rounded-md px-3 py-1 text-xs font-medium ${
              active ? 'bg-maja-navy text-white' : 'text-maja-navy hover:bg-maja-light'
            }`}>
      {children}
    </button>
  );
}

function TourHeader({ tour }: { tour: TourHead }) {
  const dateRange = tour.startdatum === tour.enddatum
    ? formatDate(tour.startdatum)
    : `${formatDate(tour.startdatum)} – ${formatDate(tour.enddatum)}`;
  return (
    <header className="rounded-lg border border-maja-navy/15 bg-maja-light/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {tour.tour_id && (
          <span className="rounded-full bg-maja-navy/10 px-2 py-0.5 text-xs font-semibold text-maja-navy">
            {tour.tour_id}
          </span>
        )}
        {tour.tourenart && (
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-maja-navy">
            {tour.tourenart}
          </span>
        )}
        <span className="font-medium text-maja-ink">
          {tour.start_stadt} → {tour.ziel_stadt}
          {tour.rueckfuehrung_stadt ? ` → ${tour.rueckfuehrung_stadt}` : ''}
        </span>
      </div>
      <div className="mt-1 text-xs text-maja-muted">
        {dateRange}
        {(tour.kennzeichen ?? []).length > 0 && <> · {(tour.kennzeichen ?? []).join(', ')}</>}
      </div>
    </header>
  );
}

function BelegeImportBanner({
  busy, info,
}: { busy: boolean; info: { files: number; pages: number } | null }) {
  if (busy) {
    return (
      <div className="rounded-md border border-maja-accent/20 bg-maja-accent/10 px-3 py-2 text-xs text-maja-accent">
        Anhänge werden in den Belege-Reiter übernommen …
      </div>
    );
  }
  if (!info) return null;
  if (info.files === 0 && info.pages === 0) {
    return (
      <div className="rounded-md bg-maja-light/40 px-3 py-2 text-xs text-maja-muted">
        Keine geeigneten Anhänge in dieser Mail (nur Bilder und PDFs werden übernommen).
      </div>
    );
  }
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
      {info.files} Datei{info.files === 1 ? '' : 'en'}{info.pages > 0 ? ` (${info.pages} Seite${info.pages === 1 ? '' : 'n'} aus PDFs)` : ''} in den Belege-Reiter übernommen.{' '}
      <a href="/belege" className="font-semibold underline">Zum Belege-Reiter</a>
    </div>
  );
}

// ---- PDF zu Seiten-Files (für Belege-Import, Aufgabe 5) --------------

async function pdfBlobToPages(
  blob: Blob, baseName: string,
): Promise<Array<{ file: File }>> {
  const buf = await blob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const out: Array<{ file: File }> = [];
  const scale = 150 / 72; // 150 DPI — wie BelegeUploadTab
  const cleanName = baseName.replace(/\.pdf$/i, '') || 'pdf';
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) { page.cleanup(); throw new Error('Canvas-Kontext nicht verfügbar'); }
    await page.render({ canvasContext: ctx, viewport }).promise;
    const pageBlob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    page.cleanup();
    if (!pageBlob) continue;
    out.push({ file: new File([pageBlob], `${cleanName} - Seite ${i}.jpg`, { type: 'image/jpeg' }) });
  }
  return out;
}

// Formular auf ein anderes Template übertragen — Vergleichs- und
// Zuordnungsansicht für den Admin.
//
// Schritt 1: Ziel-Template wählen. Schritt 2: je Feld des alten Templates
// festlegen, wohin der eingetragene Wert wandert (oder verwerfen). Die
// Regeln (Vorschläge, Typprüfung, Optionen, Konflikte) stehen in
// lib/formularUebertragung; geschrieben wird atomar über die RPC
// `formular_uebertragen` (Migration 101). Das Original bleibt unverändert.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getPhotoUrl } from '../../lib/photo';
import { useTestGuard } from '../../auth/TestModeContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { XIcon } from '../../components/icons';
import {
  ergebnisBauen, passendeZiele, quellZeilen, vorgabenUmrechnen, vorschlagen,
  wertAnzeige, zuordnungKompakt,
  type OptionsErsatz, type QuellZeile, type Zuordnung,
} from '../../lib/formularUebertragung';
import type { FormField, FormSchema, PhotoValue } from '../../types/db';
import type { Json } from '../../types/supabase';

interface Props {
  formular: {
    id: string;
    template_id: string;
    status: string;
    daten: Record<string, unknown>;
  };
  quellTemplate: { id: string; name: string; schema: FormSchema };
  onClose: () => void;
  onDone: (neueId: string) => void;
}

interface ZielTemplate { id: string; name: string; sichtbar: boolean; schema?: FormSchema }

const SICHERHEIT_TEXT: Record<string, string> = {
  sicher: 'sicherer Treffer',
  gemerkt: 'aus gemerkter Zuordnung',
  unsicher: 'unsicherer Vorschlag — bitte prüfen',
  keiner: 'kein Treffer',
  manuell: '',
};

export function FormularUebertragenDialog({ formular, quellTemplate, onClose, onDone }: Props) {
  const guard = useTestGuard();
  const [templates, setTemplates] = useState<ZielTemplate[]>([]);
  const [zielId, setZielId] = useState('');
  const [ziel, setZiel] = useState<ZielTemplate | null>(null);
  const [gemerkt, setGemerkt] = useState<Record<string, string | null> | null>(null);
  const [vorgaben, setVorgaben] = useState<Record<string, unknown> | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const [zuordnung, setZuordnung] = useState<Zuordnung>({});
  const [ersatz, setErsatz] = useState<OptionsErsatz>({});
  const [zusammen, setZusammen] = useState<Record<string, boolean>>({});
  const [leereAusblenden, setLeereAusblenden] = useState(true);
  const [merken, setMerken] = useState(false);
  const [bestaetigen, setBestaetigen] = useState(false);

  const quellen = useMemo(
    () => quellZeilen(quellTemplate.schema, formular.daten ?? {}),
    [quellTemplate.schema, formular.daten],
  );

  // Aktive Templates (inkl. unsichtbare), ohne das bisherige.
  useEffect(() => {
    void supabase
      .from('formular_templates')
      .select('id, name, sichtbar')
      .eq('archiviert', false)
      .neq('id', formular.template_id)
      .order('name')
      .then(({ data, error }) => {
        if (error) setFehler(error.message);
        else setTemplates((data as ZielTemplate[]) ?? []);
      });
  }, [formular.template_id]);

  async function zielLaden(id: string) {
    setZielId(id);
    setZiel(null);
    if (!id) return;
    setLaedt(true);
    setFehler(null);
    const tourId = typeof formular.daten?._tour_id === 'string' ? formular.daten._tour_id : null;
    const [tpl, gem, zuw] = await Promise.all([
      supabase.from('formular_templates').select('id, name, sichtbar, schema').eq('id', id).single(),
      supabase.from('template_zuordnungen').select('zuordnung')
        .eq('quelle_template_id', formular.template_id).eq('ziel_template_id', id).maybeSingle(),
      tourId
        ? supabase.from('tour_protokoll_zuweisungen').select('vorgefuellte_daten')
            .eq('tour_id', tourId).eq('template_id', formular.template_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    setLaedt(false);
    if (tpl.error || !tpl.data) { setFehler(tpl.error?.message ?? 'Template nicht gefunden'); return; }
    const t = tpl.data as unknown as ZielTemplate;
    const g = (gem.data?.zuordnung ?? null) as Record<string, string | null> | null;
    setZiel(t);
    setGemerkt(g);
    setVorgaben((zuw.data as { vorgefuellte_daten?: Record<string, unknown> } | null)?.vorgefuellte_daten ?? null);
    setZuordnung(vorschlagen(quellen, t.schema ?? { sections: [] }, g));
    setErsatz({});
    setZusammen({});
  }

  const zielSchema = useMemo<FormSchema>(() => ziel?.schema ?? { sections: [] }, [ziel]);
  const ergebnis = useMemo(
    () => ergebnisBauen({ quellDaten: formular.daten ?? {}, quellen, zielSchema, zuordnung, ersatz, zusammenfuehren: zusammen }),
    [formular.daten, quellen, zielSchema, zuordnung, ersatz, zusammen],
  );
  const zielFelder = useMemo(() => (zielSchema.sections ?? []).flatMap((s) => s.fields ?? []), [zielSchema]);
  const zielById = useMemo(() => new Map(zielFelder.map((f) => [f.id, f])), [zielFelder]);

  function setzeZiel(qid: string, zid: string) {
    setZuordnung((z) => ({ ...z, [qid]: { ziel: zid || null, sicherheit: 'manuell' } }));
  }

  async function uebertragen() {
    if (guard('Übertragen')) return;
    if (!ziel) return;
    const vorgefuellt = vorgabenUmrechnen(vorgaben, quellTemplate.schema, zielSchema, zuordnung, ersatz);
    const protokoll = {
      anzahl_uebernommen: ergebnis.anzahlUebernommen,
      anzahl_verworfen: ergebnis.verworfen.length,
      verworfen: ergebnis.verworfen,
      unterschriften: ergebnis.unterschriften,
      hinweise: [
        ...ergebnis.leerePflicht.map((f) => `Pflichtfeld „${f.label}" bleibt leer`),
        ...(formular.status === 'draft' ? ['Entwurf übertragen — der Fahrer arbeitet im neuen Formular weiter'] : []),
      ],
      zuordnung: zuordnungKompakt(zuordnung),
    };
    const { data, error } = await supabase.rpc('formular_uebertragen', {
      p_quelle_id: formular.id,
      p_ziel_template_id: ziel.id,
      p_daten: ergebnis.daten as Json,
      p_protokoll: protokoll as unknown as Json,
      p_vorgefuellt: vorgefuellt as Json | null,
      p_merken: merken,
    });
    if (error) throw new Error(error.message);
    onDone(data as unknown as string);
  }

  const sichtbareQuellen = quellen.filter((q) => !(leereAusblenden && q.leer));
  const anzahlLeer = quellen.filter((q) => q.leer).length;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-maja-ink/40 px-3 py-6">
      <div className="card w-full max-w-5xl p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-maja-navy">Auf anderes Template übertragen</h2>
            <p className="text-xs text-maja-muted">
              Es entsteht ein neues Formular mit dem gewählten Template. Das
              Original „{quellTemplate.name}" bleibt unverändert erhalten und
              ist über das neue Formular einsehbar.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Schließen"
                  className="rounded-md p-1 text-maja-muted hover:bg-maja-light">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <label className="label" htmlFor="ueb-ziel">Ziel-Template</label>
            <select id="ueb-ziel" className="input" value={zielId} onChange={(e) => void zielLaden(e.target.value)}>
              <option value="">— Template wählen —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.sichtbar ? '' : ' (unsichtbar)'}</option>
              ))}
            </select>
          </div>
          {ziel && (
            <label className="flex items-center gap-2 pb-2 text-sm text-maja-ink">
              <input type="checkbox" className="h-4 w-4 rounded border-maja-navy/30"
                     checked={leereAusblenden} onChange={(e) => setLeereAusblenden(e.target.checked)} />
              leere Felder ausblenden{anzahlLeer > 0 ? ` (${anzahlLeer})` : ''}
            </label>
          )}
        </div>

        {fehler && <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>}
        {laedt && <p className="mt-4 text-sm text-maja-muted">Lade Ziel-Template …</p>}

        {ziel && !laedt && (
          <>
            {gemerkt && (
              <p className="mt-3 rounded-lg bg-maja-light px-3 py-2 text-xs text-maja-ink">
                Für „{quellTemplate.name}" → „{ziel.name}" gibt es eine gemerkte Zuordnung — sie ist vorausgewählt.
              </p>
            )}
            {formular.status === 'draft' && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Entwurf: Der Fahrer arbeitet danach im neuen Formular weiter. Änderungen,
                die nur auf seinem Gerät liegen und noch nicht gespeichert wurden, werden
                nicht übernommen.
              </p>
            )}

            <div className="mt-4 overflow-hidden rounded-lg border border-maja-navy/10">
              <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto_minmax(0,1.2fr)] gap-3 border-b border-maja-navy/10 bg-maja-light/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-maja-muted md:grid">
                <span>Quellfeld (alt)</span><span>Eingetragener Wert</span><span /><span>Zielfeld (neu)</span>
              </div>
              <ul>
                {sichtbareQuellen.map((q) => (
                  <ZuordnungsZeile
                    key={q.id}
                    q={q}
                    formularId={formular.id}
                    eintrag={zuordnung[q.id]}
                    ziele={passendeZiele(q, zielSchema)}
                    zielFeld={zuordnung[q.id]?.ziel ? zielById.get(zuordnung[q.id].ziel!) ?? null : null}
                    umwandlung={ergebnis.proZeile[q.id]}
                    ersatz={ersatz[q.id] ?? {}}
                    onZiel={(zid) => setzeZiel(q.id, zid)}
                    onErsatz={(quellWert, zielOption) =>
                      setErsatz((e) => ({ ...e, [q.id]: { ...(e[q.id] ?? {}), [quellWert]: zielOption } }))}
                  />
                ))}
              </ul>
            </div>

            {ergebnis.mehrfach.length > 0 && (
              <div className={`mt-4 space-y-2 rounded-lg border p-3 text-sm ${
                ergebnis.konflikte.length > 0 ? 'border-red-200 bg-red-50 text-red-800' : 'border-maja-navy/10 bg-maja-light/40 text-maja-ink'}`}>
                <div className="font-semibold">
                  {ergebnis.konflikte.length > 0 ? 'Mehrere Werte auf dasselbe Zielfeld' : 'Zusammengeführte Zielfelder'}
                </div>
                {ergebnis.mehrfach.map((k) => (
                  <div key={k.ziel.id} className="flex flex-wrap items-center gap-3">
                    <span>
                      „{k.ziel.label}" ← {k.quellen.map((x) => `„${x.label}"`).join(', ')}
                    </span>
                    {k.zusammenfuehrbar ? (
                      <label className="flex items-center gap-1.5 text-xs">
                        <input type="checkbox" className="h-4 w-4"
                               checked={k.zusammengefuehrt}
                               onChange={(e) => setZusammen((z) => ({ ...z, [k.ziel.id]: e.target.checked }))} />
                        {k.ziel.type === 'dynamic_photos' ? 'Fotos zusammenführen' : 'zusammenführen (mit Zeilenumbruch)'}
                      </label>
                    ) : (
                      <span className="text-xs">Bitte nur einen Wert diesem Feld zuordnen.</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <Zusammenfassung ergebnis={ergebnis} zielFelderAnzahl={zielFelder.length} />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-maja-navy/10 pt-4">
              <label className="flex items-center gap-2 text-sm text-maja-ink">
                <input type="checkbox" className="h-4 w-4 rounded border-maja-navy/30"
                       checked={merken} onChange={(e) => setMerken(e.target.checked)} />
                Zuordnung für „{quellTemplate.name}" → „{ziel.name}" merken
              </label>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
                <button type="button" className="btn-primary" disabled={ergebnis.blockiert}
                        title={ergebnis.blockiert ? 'Erst die Konflikte oben lösen' : undefined}
                        onClick={() => { if (!guard('Übertragen')) setBestaetigen(true); }}>
                  Übertragen
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {bestaetigen && ziel && (
        <ConfirmDialog
          title="Formular übertragen?"
          message={(
            <div className="space-y-2">
              <p>
                Es wird ein neues Formular mit „{ziel.name}" angelegt —{' '}
                {ergebnis.anzahlUebernommen} {ergebnis.anzahlUebernommen === 1 ? 'Feld' : 'Felder'} übernommen,{' '}
                {ergebnis.verworfen.length} verworfen.
              </p>
              <p className="text-xs text-maja-muted">
                Das Original bleibt erhalten. PDFs werden nicht automatisch erzeugt,
                E-Mails nicht erneut versendet.
              </p>
            </div>
          )}
          confirmLabel="Übertragen"
          onConfirm={uebertragen}
          onClose={() => setBestaetigen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------

function ZuordnungsZeile({
  q, formularId, eintrag, ziele, zielFeld, umwandlung, ersatz, onZiel, onErsatz,
}: {
  q: QuellZeile;
  formularId: string;
  eintrag: { ziel: string | null; sicherheit: string } | undefined;
  ziele: FormField[];
  zielFeld: FormField | null;
  umwandlung: ReturnType<typeof ergebnisBauen>['proZeile'][string] | undefined;
  ersatz: Record<string, string>;
  onZiel: (zid: string) => void;
  onErsatz: (quellWert: string, zielOption: string) => void;
}) {
  const unsicher = eintrag?.sicherheit === 'unsicher';
  const hinweis = eintrag ? SICHERHEIT_TEXT[eintrag.sicherheit] : '';
  return (
    <li className={`grid gap-2 border-b border-maja-navy/5 px-3 py-2.5 text-sm last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto_minmax(0,1.2fr)] md:items-start md:gap-3 ${
      q.leer ? 'opacity-50' : ''} ${unsicher ? 'bg-amber-50 dark:!bg-amber-950/40' : ''}`}>
      <div className="min-w-0">
        <div className="font-medium text-maja-ink">{q.label}</div>
        <div className="text-[11px] text-maja-muted">{typName(q.typ)}</div>
      </div>
      <div className="min-w-0 text-maja-ink">
        <WertVorschau q={q} formularId={formularId} />
      </div>
      <div className="hidden text-maja-muted md:block" aria-hidden="true">→</div>
      <div className="min-w-0 space-y-1">
        <select className="input" value={eintrag?.ziel ?? ''} onChange={(e) => onZiel(e.target.value)}
                aria-label={`Zielfeld für „${q.label}"`}>
          <option value="">— verwerfen —</option>
          {ziele.map((z) => (
            <option key={z.id} value={z.id}>{z.label}{z.required ? ' *' : ''} · {typName(z.type)}</option>
          ))}
        </select>
        {hinweis && !q.leer && (
          <div className={`text-[11px] ${unsicher ? 'font-semibold text-amber-800' : 'text-maja-muted'}`}>{hinweis}</div>
        )}
        {umwandlung?.warnung && (
          <div className={`rounded px-2 py-1 text-[11px] ${umwandlung.ok ? 'bg-amber-50 text-amber-900' : 'bg-red-50 text-red-700'}`}>
            {umwandlung.warnung}
          </div>
        )}
        {zielFeld && (umwandlung?.fehlendeOptionen ?? []).map((w) => (
          <div key={w} className="flex flex-wrap items-center gap-2 text-[11px] text-maja-ink">
            <span>{w === '__einer__' ? 'Einen Wert wählen:' : `„${w}" ersetzen durch:`}</span>
            <select className="input max-w-[12rem] py-1 text-xs" value={ersatz[w] ?? ''}
                    onChange={(e) => onErsatz(w, e.target.value)}>
              <option value="">— weglassen —</option>
              {(zielFeld.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        ))}
        {q.typ === 'signature' && zielFeld && !q.leer && (
          <div className="rounded bg-maja-light px-2 py-1 text-[11px] text-maja-ink">
            Die Unterschrift wurde auf dem ursprünglichen Protokoll geleistet.
          </div>
        )}
      </div>
    </li>
  );
}

function typName(t: string): string {
  return ({
    text: 'Text', textarea: 'Text (mehrzeilig)', number: 'Zahl', date: 'Datum', select: 'Auswahl',
    checkboxes: 'Mehrfachauswahl', checkboxes_with_text: 'Auswahl mit Text', photo: 'Foto',
    signature: 'Unterschrift', damage_diagram: 'Schadensdiagramm', dynamic_photos: 'Mehrere Fotos',
    address: 'Adresse', stamp: 'Stempel', unbekannt: 'ohne Feld',
  } as Record<string, string>)[t] ?? t;
}

function WertVorschau({ q, formularId }: { q: QuellZeile; formularId: string }) {
  if (q.leer) return <span className="text-maja-muted">— leer —</span>;
  if (q.typ === 'signature' && typeof q.wert === 'string' && q.wert.startsWith('data:image')) {
    return <img src={q.wert} alt="Unterschrift" className="h-10 max-w-[10rem] rounded border border-maja-navy/10 bg-white object-contain" />;
  }
  if (q.typ === 'photo' || q.typ === 'stamp') {
    return <FotoMini foto={q.wert as PhotoValue} formularId={formularId} />;
  }
  if (q.typ === 'dynamic_photos' && Array.isArray(q.wert)) {
    const fotos = q.wert as PhotoValue[];
    return (
      <div className="flex flex-wrap items-center gap-1">
        {fotos.slice(0, 3).map((f, i) => <FotoMini key={i} foto={f} formularId={formularId} />)}
        <span className="text-xs text-maja-muted">{wertAnzeige(q.typ, q.wert)}</span>
      </div>
    );
  }
  const text = wertAnzeige(q.typ, q.wert);
  return <span className="whitespace-pre-wrap break-words">{q.typ === 'textarea' ? `„${text}"` : text}</span>;
}

function FotoMini({ foto, formularId }: { foto: PhotoValue | null; formularId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const pfad = foto?.storage_path ?? null;
  useEffect(() => {
    if (!pfad) return;
    let aktiv = true;
    let erzeugt: string | null = null;
    void getPhotoUrl(pfad, formularId).then((u) => {
      if (!aktiv) { if (u) URL.revokeObjectURL(u); return; }
      erzeugt = u; setUrl(u);
    });
    return () => { aktiv = false; if (erzeugt) URL.revokeObjectURL(erzeugt); };
  }, [pfad, formularId]);
  if (!pfad) return <span className="text-xs text-maja-muted">Foto (wartet auf Upload)</span>;
  return url
    ? <img src={url} alt="" className="h-10 w-14 rounded border border-maja-navy/10 object-cover" />
    : <span className="inline-block h-10 w-14 rounded border border-maja-navy/10 bg-maja-light" />;
}

function Zusammenfassung({ ergebnis, zielFelderAnzahl }: {
  ergebnis: ReturnType<typeof ergebnisBauen>; zielFelderAnzahl: number;
}) {
  const leer = ergebnis.leereZiele.length;
  const pflicht = ergebnis.leerePflicht.length;
  return (
    <div className="mt-4 rounded-lg border border-maja-navy/10 bg-maja-light/40 p-3 text-sm">
      <div className="font-semibold text-maja-navy">
        {ergebnis.anzahlUebernommen} Felder übertragen · {ergebnis.verworfen.length} verworfen ·{' '}
        {leer} von {zielFelderAnzahl} Zielfeldern bleiben leer
        {pflicht > 0 && <span className="text-red-700"> (davon {pflicht} Pflichtfeld{pflicht === 1 ? '' : 'er'})</span>}
      </div>
      {ergebnis.verworfen.length > 0 && (
        <details className="mt-2" open>
          <summary className="cursor-pointer text-xs font-medium text-maja-ink">Verworfene Werte</summary>
          <ul className="mt-1 space-y-0.5 text-xs text-maja-ink">
            {ergebnis.verworfen.map((v, i) => (
              <li key={`${v.feld}-${i}`}>
                <span className="font-medium">{v.label}:</span> {v.wert || '—'}
                {v.grund && v.grund !== 'verworfen' && <span className="text-maja-muted"> — {v.grund}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {pflicht > 0 && (
        <p className="mt-2 text-xs text-red-700">
          Leere Pflichtfelder: {ergebnis.leerePflicht.map((f) => f.label).join(', ')}. Übertragen ist trotzdem möglich.
        </p>
      )}
    </div>
  );
}

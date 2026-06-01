import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { Spinner } from '../../../components/Spinner';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { formatDate, formatEuro } from '../../../lib/touren';
import { berechneSummen } from '../../../lib/rechnungsformat';
import { PositionsTable } from './PositionsTable';
import { RechnungStatusBadge } from './RechnungStatusBadge';
import { RECHNUNG_STATUS_LABEL } from './rechnungLabels';
import type { EditorPosition } from './positionUtils';
import { emptyManuellePosition } from './positionUtils';
import type {
  Auftraggeber, Rechnung, Rechnungsadresse, Rechnungsposition, RechnungStatus,
} from '../../../types/db';

interface RechnungFull extends Rechnung {
  auftraggeber: Pick<Auftraggeber, 'id' | 'name' | 'kontakt'> | null;
  rechnungsadresse: Rechnungsadresse | null;
}

function todayIso(): string { return new Date().toISOString().slice(0, 10); }

export function RechnungDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [rechnung, setRechnung] = useState<RechnungFull | null>(null);
  const [positionen, setPositionen] = useState<EditorPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [savingPositions, setSavingPositions] = useState(false);

  // Notizen wird unabhängig vom edit-Modus gespeichert (Auto-Save bei Blur).
  const [notizen, setNotizen] = useState('');
  const [savingNotizen, setSavingNotizen] = useState(false);

  // Status-Aktionen
  const [statusBusy, setStatusBusy] = useState(false);
  const [bezahltPicker, setBezahltPicker] = useState(false);
  const [bezahltAm, setBezahltAm] = useState<string>(todayIso());
  const [stornoConfirm, setStornoConfirm] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [rRes, pRes] = await Promise.all([
      supabase
        .from('rechnungen')
        .select(`
          *,
          auftraggeber:auftraggeber_id (id, name, kontakt),
          rechnungsadresse:rechnungsadresse_id (
            id, firma, ansprechpartner, strasse, plz_ort, land, ist_standard, auftraggeber_id, created_at
          )
        `)
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('rechnungspositionen')
        .select('*')
        .eq('rechnung_id', id)
        .order('position_nr', { ascending: true }),
    ]);
    if (rRes.error) { setError(rRes.error.message); setLoading(false); return; }
    if (!rRes.data) { setError('Rechnung nicht gefunden.'); setLoading(false); return; }
    if (pRes.error) { setError(pRes.error.message); setLoading(false); return; }
    const r = rRes.data as unknown as RechnungFull;
    setRechnung(r);
    setNotizen(r.notizen ?? '');
    const rows = (pRes.data ?? []) as Rechnungsposition[];
    setPositionen(rows.map((p) => ({
      key: p.id,
      bezeichnung: p.bezeichnung,
      unterzeilen: p.unterzeilen ?? [],
      menge: Number(p.menge),
      einzelpreis: Number(p.einzelpreis),
      gesamtpreis: Number(p.gesamtpreis),
      tour_id: p.tour_id,
      zusatz_id: p.zusatz_id,
      ist_manuell: p.ist_manuell,
    })));
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const summen = useMemo(
    () => rechnung ? berechneSummen(positionen, Number(rechnung.ust_satz) || 0) : null,
    [positionen, rechnung],
  );

  async function patchStatus(patch: Partial<Rechnung>) {
    if (!rechnung) return;
    setStatusBusy(true);
    const { error: err } = await supabase
      .from('rechnungen')
      .update(patch)
      .eq('id', rechnung.id);
    setStatusBusy(false);
    if (err) { setError(err.message); return; }
    await load();
  }

  async function speichereNotizen() {
    if (!rechnung) return;
    if (notizen === (rechnung.notizen ?? '')) return;
    setSavingNotizen(true);
    const { error: err } = await supabase
      .from('rechnungen')
      .update({ notizen: notizen || null })
      .eq('id', rechnung.id);
    setSavingNotizen(false);
    if (err) setError(err.message);
  }

  async function speicherePositionen() {
    if (!rechnung) return;
    setSavingPositions(true);
    setError(null);
    try {
      // Lösche alle bestehenden Positionen und schreibe neu (mit position_nr
      // aus dem Index). Bei einer einzelnen Rechnung ist das stabil genug und
      // einfacher als ein Diff (neue/aktualisierte/gelöschte UUIDs zu tracken).
      const { error: delErr } = await supabase
        .from('rechnungspositionen').delete().eq('rechnung_id', rechnung.id);
      if (delErr) throw delErr;
      const rows = positionen.map((p, idx) => ({
        rechnung_id: rechnung.id,
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
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from('rechnungspositionen').insert(rows);
        if (insErr) throw insErr;
      }
      // Summen auf der Rechnung mit aktualisieren.
      const sum = berechneSummen(positionen, Number(rechnung.ust_satz) || 0);
      const { error: uErr } = await supabase
        .from('rechnungen')
        .update({
          netto_summe: sum.netto,
          ust_betrag: sum.ust,
          brutto_summe: sum.brutto,
        })
        .eq('id', rechnung.id);
      if (uErr) throw uErr;
      setEditing(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSavingPositions(false);
    }
  }

  function startEditing() {
    if (!rechnung) return;
    if (rechnung.status === 'versendet' || rechnung.status === 'bezahlt') {
      setEditConfirmOpen(true);
      return;
    }
    setEditing(true);
  }

  if (loading) return <Spinner label="Rechnung wird geladen …" />;
  if (error && !rechnung) {
    return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }
  if (!rechnung || !summen) return null;

  const adr = rechnung.rechnungsadresse;
  const status: RechnungStatus = rechnung.status;
  const isStorniert = status === 'storniert';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-maja-navy">{rechnung.rechnungsnummer}</h1>
            <RechnungStatusBadge status={status} />
            {rechnung.ist_auslagen_rechnung && (
              <span className="inline-flex rounded-full bg-maja-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-maja-accent">
                Auslagen
              </span>
            )}
          </div>
          <p className="text-sm text-maja-muted">
            {rechnung.auftraggeber?.name ?? '—'} · Zeitraum {formatDate(rechnung.leistungszeitraum_von)} – {formatDate(rechnung.leistungszeitraum_bis)}
            {' · '}Rechnungsdatum {formatDate(rechnung.datum)}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => navigate('/rechnungen')}>
          Zurück
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Status-Aktionen */}
      {!isStorniert && (
        <section className="card flex flex-wrap items-center gap-2 p-4">
          {status === 'entwurf' && (
            <button
              type="button" className="btn-primary"
              disabled={statusBusy}
              onClick={() => void patchStatus({ status: 'erstellt' })}
            >Rechnung erstellen</button>
          )}
          {status === 'erstellt' && (
            <button
              type="button" className="btn-primary"
              disabled={statusBusy}
              onClick={() => void patchStatus({ status: 'versendet' })}
            >Als versendet markieren</button>
          )}
          {status === 'versendet' && (
            <button
              type="button" className="btn-primary"
              disabled={statusBusy}
              onClick={() => setBezahltPicker(true)}
            >Als bezahlt markieren</button>
          )}
          {status === 'bezahlt' && rechnung.bezahlt_am && (
            <span className="text-sm text-emerald-700">
              Bezahlt am {formatDate(rechnung.bezahlt_am)}.
            </span>
          )}
          <span className="flex-1" />
          <button
            type="button"
            className="text-sm font-medium text-red-600 hover:underline"
            disabled={statusBusy}
            onClick={() => setStornoConfirm(true)}
          >
            Stornieren
          </button>
        </section>
      )}

      {/* Adresse + Empfänger */}
      <section className="card grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-maja-navy">Rechnungsadresse</h3>
          {adr ? (
            <address className="mt-1 not-italic text-sm text-maja-ink">
              <div className="font-medium">{adr.firma}</div>
              {adr.ansprechpartner && <div>{adr.ansprechpartner}</div>}
              {adr.strasse && <div>{adr.strasse}</div>}
              {adr.plz_ort && <div>{adr.plz_ort}</div>}
              {adr.land && <div className="text-maja-muted">{adr.land}</div>}
            </address>
          ) : (
            <p className="mt-1 text-xs text-maja-muted">Keine Rechnungsadresse hinterlegt.</p>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-maja-navy">Anrede</h3>
          <p className="mt-1 text-sm text-maja-ink">{rechnung.anrede || '—'}</p>
          <h3 className="mt-4 text-sm font-semibold text-maja-navy">USt-Satz</h3>
          <p className="mt-1 text-sm text-maja-ink">{Number(rechnung.ust_satz).toFixed(2)} %</p>
        </div>
      </section>

      {/* Positionen */}
      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-maja-navy">Positionen</h2>
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <button
                  type="button" className="btn-secondary text-sm"
                  onClick={() => setPositionen((rows) => [...rows, emptyManuellePosition()])}
                >+ Position hinzufügen</button>
                <button
                  type="button" className="btn-primary text-sm"
                  onClick={() => void speicherePositionen()}
                  disabled={savingPositions}
                >{savingPositions ? 'Speichert …' : 'Speichern'}</button>
                <button
                  type="button" className="btn-secondary text-sm"
                  onClick={() => { setEditing(false); void load(); }}
                  disabled={savingPositions}
                >Abbrechen</button>
              </>
            ) : (
              !isStorniert && (
                <button
                  type="button" className="btn-secondary text-sm"
                  onClick={startEditing}
                >Bearbeiten</button>
              )
            )}
          </div>
        </div>
        <PositionsTable
          positionen={positionen}
          readOnly={!editing}
          onChange={setPositionen}
        />
        <div className="border-t border-maja-navy/10 pt-2">
          <SumLine label="Netto" value={summen.netto} />
          <SumLine label={`${Number(rechnung.ust_satz).toFixed(2)}% USt.`} value={summen.ust} />
          <SumLine label="Brutto" value={summen.brutto} bold />
        </div>
      </section>

      {/* Notizen */}
      <section className="card space-y-2 p-5">
        <h2 className="text-base font-semibold text-maja-navy">
          Interne Notizen
          {savingNotizen && <span className="ml-2 text-xs text-maja-muted">speichere …</span>}
        </h2>
        <textarea
          className="input min-h-[5rem]"
          value={notizen}
          onChange={(e) => setNotizen(e.target.value)}
          onBlur={() => void speichereNotizen()}
        />
      </section>

      {/* PDF-Bereich (Generierung folgt im nächsten Schritt) */}
      <section className="card space-y-2 p-5">
        <h2 className="text-base font-semibold text-maja-navy">PDF</h2>
        {rechnung.pdf_url ? (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/download?path=${encodeURIComponent(rechnung.pdf_url)}&inline=1`}
              target="_blank" rel="noopener noreferrer"
              className="btn-secondary text-sm"
            >PDF anzeigen</a>
            <a
              href={`/api/download?path=${encodeURIComponent(rechnung.pdf_url)}`}
              className="btn-secondary text-sm"
            >PDF herunterladen</a>
            <button
              type="button" className="btn-primary text-sm" disabled
              title="Wird im nächsten Schritt implementiert"
            >PDF neu generieren</button>
          </div>
        ) : (
          <p className="text-sm text-maja-muted">
            Noch keine PDF generiert. Die Generierung folgt im nächsten Schritt.
          </p>
        )}
      </section>

      {/* Confirm-Dialoge */}
      {editConfirmOpen && (
        <ConfirmDialog
          title="Rechnung bereits versendet"
          message={
            <>Diese Rechnung wurde bereits {RECHNUNG_STATUS_LABEL[status].toLowerCase()} —
              trotzdem bearbeiten? Änderungen an versendeten Rechnungen
              sollten nachvollziehbar bleiben.</>
          }
          confirmLabel="Trotzdem bearbeiten"
          onConfirm={async () => { setEditing(true); }}
          onClose={() => setEditConfirmOpen(false)}
        />
      )}
      {bezahltPicker && (
        <BezahltDialog
          initial={bezahltAm}
          onCancel={() => setBezahltPicker(false)}
          onConfirm={async (d) => {
            setBezahltAm(d);
            await patchStatus({ status: 'bezahlt', bezahlt_am: d });
            setBezahltPicker(false);
          }}
        />
      )}
      {stornoConfirm && (
        <ConfirmDialog
          title="Rechnung stornieren?"
          message={<>Die Rechnung wird als <strong>storniert</strong> markiert. Das ist nachträglich nicht ohne weiteres rückgängig.</>}
          confirmLabel="Stornieren"
          destructive
          onConfirm={async () => { await patchStatus({ status: 'storniert' }); }}
          onClose={() => setStornoConfirm(false)}
        />
      )}
    </div>
  );
}

function SumLine({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1 text-sm ${bold ? 'font-semibold text-maja-navy' : 'text-maja-ink'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{formatEuro(value)}</span>
    </div>
  );
}

function BezahltDialog({
  initial, onCancel, onConfirm,
}: {
  initial: string;
  onCancel: () => void;
  onConfirm: (datum: string) => Promise<void>;
}) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-maja-ink/40 px-4">
      <div className="card w-full max-w-sm p-5">
        <h3 className="text-base font-semibold text-maja-navy">Bezahlt am</h3>
        <p className="mt-1 text-xs text-maja-muted">
          Wann wurde die Rechnung beglichen?
        </p>
        <input
          type="date" className="input mt-3" value={d}
          onChange={(e) => setD(e.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Abbrechen
          </button>
          <button
            type="button" className="btn-primary"
            disabled={busy || !d}
            onClick={async () => { setBusy(true); await onConfirm(d); setBusy(false); }}
          >
            {busy ? 'Speichert …' : 'Bestätigen'}
          </button>
        </div>
      </div>
    </div>
  );
}

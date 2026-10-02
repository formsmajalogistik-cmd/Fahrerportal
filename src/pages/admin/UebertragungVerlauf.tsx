// Verlauf einer Übertragung am NEUEN Formular (Migration 101):
// „Übertragen von Template ‚X' am … durch … — N Felder übernommen, M
// verworfen", die verworfenen Werte, der Weg zum Original und — solange
// am neuen Formular nichts geändert wurde — „rückgängig machen".

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useTestGuard } from '../../auth/TestModeContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatDateTime } from '../../lib/touren';

interface Eintrag {
  id: number;
  quelle_id: string;
  quelle_template_name: string | null;
  ziel_template_name: string | null;
  von_name: string | null;
  am: string;
  anzahl_uebernommen: number;
  anzahl_verworfen: number;
  verworfen: Array<{ label: string; wert: string; grund?: string }>;
  unterschriften: string[];
  hinweise: string[];
}

interface Props {
  formular: { id: string; status: string; pdf_paths: unknown; uebertragen_von_id: string | null };
  onOriginal: (id: string) => void;
  /** Nach erfolgreichem Rückgängig — Liste neu laden. */
  onRueckgaengig: () => void;
}

export function UebertragungVerlauf({ formular, onOriginal, onRueckgaengig }: Props) {
  const guard = useTestGuard();
  const [eintrag, setEintrag] = useState<Eintrag | null>(null);
  const [fragen, setFragen] = useState(false);

  useEffect(() => {
    if (!formular.uebertragen_von_id) return;
    let aktiv = true;
    void supabase
      .from('formular_uebertragungen')
      .select('id, quelle_id, quelle_template_name, ziel_template_name, von_name, am, anzahl_uebernommen, anzahl_verworfen, verworfen, unterschriften, hinweise')
      .eq('ziel_id', formular.id)
      .is('rueckgaengig_am', null)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (aktiv) setEintrag(data as unknown as Eintrag | null); });
    return () => { aktiv = false; };
  }, [formular.id, formular.uebertragen_von_id]);

  if (!formular.uebertragen_von_id) return null;
  const pdfsDa = Array.isArray(formular.pdf_paths) && formular.pdf_paths.length > 0;

  async function rueckgaengig() {
    if (guard('Rückgängig')) return;
    const { error } = await supabase.rpc('formular_uebertragung_rueckgaengig', { p_ziel_id: formular.id });
    if (error) throw new Error(error.message);
    onRueckgaengig();
  }

  return (
    <div className="mt-3 rounded-lg border border-maja-accent/30 bg-maja-light/50 px-3 py-2 text-xs text-maja-ink">
      <div className="font-semibold text-maja-navy">
        {eintrag
          ? <>Übertragen von Template „{eintrag.quelle_template_name ?? '—'}" am {formatDateTime(eintrag.am)}
              {eintrag.von_name ? ` durch ${eintrag.von_name}` : ''} — {eintrag.anzahl_uebernommen} Felder übernommen,
              {' '}{eintrag.anzahl_verworfen} verworfen</>
          : 'Durch Übertragung aus einem anderen Template entstanden'}
      </div>
      {eintrag && eintrag.verworfen.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer">Verworfene Werte anzeigen</summary>
          <ul className="mt-1 space-y-0.5">
            {eintrag.verworfen.map((v, i) => (
              <li key={i}><span className="font-medium">{v.label}:</span> {v.wert || '—'}
                {v.grund && v.grund !== 'verworfen' && <span className="text-maja-muted"> — {v.grund}</span>}</li>
            ))}
          </ul>
        </details>
      )}
      {eintrag && eintrag.unterschriften.length > 0 && (
        <div className="mt-1 text-maja-muted">
          Unterschrift(en) übertragen — geleistet auf dem ursprünglichen Protokoll.
        </div>
      )}
      {formular.status === 'submitted' && !pdfsDa && (
        <div className="mt-1 font-medium text-amber-900">
          PDFs für das neue Template sind noch nicht erzeugt — rechts „PDFs neu erzeugen" nutzen.
          Die PDFs des Originals bleiben unverändert erhalten.
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap gap-3">
        <button type="button" className="font-medium text-maja-accent hover:underline"
                onClick={() => onOriginal(formular.uebertragen_von_id!)}>
          Ursprüngliches Formular anzeigen
        </button>
        {eintrag && !pdfsDa && (
          <button type="button" className="font-medium text-red-700 hover:underline"
                  onClick={() => { if (!guard('Rückgängig')) setFragen(true); }}>
            Übertragung rückgängig machen
          </button>
        )}
      </div>

      {fragen && (
        <ConfirmDialog
          title="Übertragung rückgängig machen?"
          message={(
            <p>
              Das neue Formular wird gelöscht, das Original „{eintrag?.quelle_template_name}" ist
              wieder aktiv. Das geht nur, solange am neuen Formular nichts geändert wurde.
            </p>
          )}
          confirmLabel="Rückgängig machen"
          destructive
          onConfirm={rueckgaengig}
          onClose={() => setFragen(false)}
        />
      )}
    </div>
  );
}

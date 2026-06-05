import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Spinner } from '../../components/Spinner';
import { XIcon } from '../../components/icons';
import { FormRenderer } from '../../components/forms/FormRenderer';
import { buildFormularFolder } from '../../lib/onedrivePaths';
import type {
  AusgefuelltesFormular, FormSchema, FormularTemplate,
} from '../../types/db';

interface Props {
  formularId: string;
  onClose: () => void;
}

function parseSchema(raw: unknown): FormSchema {
  let value: unknown = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  if (value && typeof value === 'object' && Array.isArray((value as { sections?: unknown[] }).sections)) {
    return value as FormSchema;
  }
  return { sections: [] } as FormSchema;
}

/**
 * Read-only Anzeige eines eingereichten Formulars für den Admin
 * (Aufgabe 2A). Nutzt denselben FormRenderer wie der Fahrer beim
 * Ausfüllen, aber mit disabled=true und einem No-Op-onChange. Photos,
 * Unterschriften und Schadendiagramm-Markierungen werden so dargestellt
 * wie der Fahrer sie beim Submit gesehen hat.
 */
export function EingangFormularViewDialog({ formularId, onClose }: Props) {
  const [formular, setFormular] = useState<AusgefuelltesFormular | null>(null);
  const [template, setTemplate] = useState<FormularTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const { data: af, error: afErr } = await supabase
          .from('ausgefuellte_formulare')
          .select('*')
          .eq('id', formularId)
          .maybeSingle();
        if (cancelled) return;
        if (afErr) { setError(`Formular konnte nicht geladen werden: ${afErr.message}`); return; }
        if (!af) { setError('Formular nicht gefunden oder kein Zugriff.'); return; }
        const { data: tpl, error: tplErr } = await supabase
          .from('formular_templates')
          .select('*')
          .eq('id', af.template_id)
          .maybeSingle();
        if (cancelled) return;
        if (tplErr) { setError(`Template konnte nicht geladen werden: ${tplErr.message}`); return; }
        if (!tpl) { setError('Verknüpftes Template nicht gefunden.'); return; }
        const schema = parseSchema(tpl.schema);
        setFormular(af as unknown as AusgefuelltesFormular);
        setTemplate({ ...tpl, schema } as unknown as FormularTemplate);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [formularId]);

  const data = useMemo(
    () => (formular?.daten as Record<string, unknown> | null) ?? {},
    [formular],
  );
  const oneDriveFolder = useMemo(() => {
    if (!formular || !template) return '';
    const isoDate = formular.created_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    const kennzeichen = (data.kennzeichen ?? data.Kennzeichen ?? '') as string;
    return buildFormularFolder({
      date: isoDate,
      kennzeichen: typeof kennzeichen === 'string' ? kennzeichen : null,
      templateName: template.name,
      formularId: formular.id,
    });
  }, [formular, template, data]);

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-3xl p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-maja-navy">
              {template?.name ?? 'Formular ansehen'}
            </h2>
            {formular && (
              <p className="text-xs text-maja-muted">
                Eingereicht am {formular.created_at?.slice(0, 10) ?? '—'} ·
                Status {formular.status === 'submitted' ? 'eingereicht' : 'Entwurf'}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose}
                  className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
                  aria-label="Schließen">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {loading && <Spinner label="Formular wird geladen …" />}
        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {!loading && !error && template && (
          <>
            <p className="mb-3 rounded-md bg-maja-light/40 px-3 py-2 text-xs text-maja-muted">
              Nur-Lesen-Ansicht — Eingaben können nicht verändert werden.
            </p>
            <FormRenderer
              schema={template.schema}
              data={data}
              onChange={() => { /* noop: read-only */ }}
              disabled
              oneDriveFolder={oneDriveFolder}
              formularId={formularId}
            />
          </>
        )}
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">Schließen</button>
        </div>
      </div>
    </div>
  );
}

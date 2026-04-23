import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/Spinner';
import { FormRenderer } from '../components/forms/FormRenderer';
import { validateForm } from '../lib/validateForm';
import type { AusgefuelltesFormular, FormularTemplate } from '../types/db';

export function FormularPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();

  const [formular, setFormular] = useState<AusgefuelltesFormular | null>(null);
  const [template, setTemplate] = useState<FormularTemplate | null>(null);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'idle' | 'draft' | 'submit'>('idle');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: af, error: err } = await supabase
        .from('ausgefuellte_formulare')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (err || !af) {
        setError(err?.message ?? 'Formular nicht gefunden');
        setLoading(false);
        return;
      }
      const { data: tpl, error: tplErr } = await supabase
        .from('formular_templates')
        .select('*')
        .eq('id', af.template_id)
        .maybeSingle();
      if (cancelled) return;
      if (tplErr || !tpl) {
        setError(tplErr?.message ?? 'Template nicht gefunden');
        setLoading(false);
        return;
      }
      setFormular(af);
      setTemplate(tpl as unknown as FormularTemplate);
      setData((af.daten as Record<string, unknown>) ?? {});
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  const readonly = formular?.status === 'submitted';

  const handleChange = useCallback((fieldId: string, value: unknown) => {
    setData((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  async function saveDraft() {
    if (!formular) return;
    setSaving('draft');
    setStatusMsg(null);
    const { error: err } = await supabase
      .from('ausgefuellte_formulare')
      .update({ daten: data })
      .eq('id', formular.id);
    setSaving('idle');
    if (err) { setError(err.message); return; }
    setStatusMsg('Entwurf gespeichert.');
  }

  async function submit() {
    if (!formular || !template) return;
    const { valid, missing } = validateForm(template.schema, data);
    if (!valid) {
      setError(`Bitte fülle die Pflichtfelder aus: ${missing.join(', ')}`);
      return;
    }
    setSaving('submit');
    setError(null);
    const { error: err } = await supabase
      .from('ausgefuellte_formulare')
      .update({ daten: data, status: 'submitted' })
      .eq('id', formular.id);
    setSaving('idle');
    if (err) { setError(err.message); return; }
    setStatusMsg('Protokoll eingereicht.');
    setFormular({ ...formular, daten: data, status: 'submitted' });
  }

  const userId = session?.user.id ?? '';
  const title = useMemo(() => template?.name ?? 'Formular', [template]);

  if (loading) return <Spinner label="Formular wird geladen …" />;
  if (error && !formular) {
    return (
      <div className="space-y-4">
        <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
        <button onClick={() => navigate('/')} className="btn-secondary">Zurück</button>
      </div>
    );
  }
  if (!formular || !template) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">{title}</h1>
          <p className="text-sm text-maja-muted">
            Status: {readonly ? 'eingereicht' : 'Entwurf'} · Erstellt am {new Date(formular.created_at).toLocaleString('de-DE')}
          </p>
        </div>
        <button onClick={() => navigate('/')} className="btn-secondary">Zurück</button>
      </div>

      <FormRenderer
        schema={template.schema}
        data={data}
        onChange={handleChange}
        disabled={readonly}
        userId={userId}
        formularId={formular.id}
      />

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {statusMsg && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {statusMsg}
        </div>
      )}

      {!readonly && (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-maja-navy/10 bg-white/90 px-4 py-3 backdrop-blur">
          <button onClick={saveDraft} className="btn-secondary" disabled={saving !== 'idle'}>
            {saving === 'draft' ? 'Speichern …' : 'Entwurf speichern'}
          </button>
          <button onClick={submit} className="btn-primary" disabled={saving !== 'idle'}>
            {saving === 'submit' ? 'Einreichen …' : 'Einreichen'}
          </button>
        </div>
      )}
    </div>
  );
}

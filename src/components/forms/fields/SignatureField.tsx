import { useEffect, useRef } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import type { FormField } from '../../../types/db';

interface Props {
  field: FormField;
  value: unknown;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}

export function SignatureField({ field, value, onChange, disabled }: Props) {
  const ref = useRef<SignatureCanvas | null>(null);
  const existing = typeof value === 'string' ? value : '';

  useEffect(() => {
    // fromDataURL kann werfen, wenn die DataURL kaputt ist oder das Canvas
    // noch nicht ready ist — fangen wir das ab, statt die App zu killen.
    try {
      if (existing && ref.current && ref.current.isEmpty()) {
        ref.current.fromDataURL(existing);
      }
    } catch (err) {
      console.warn('[SignatureField] fromDataURL fehlgeschlagen', err);
    }
  }, [existing]);

  function handleEnd() {
    try {
      const canvas = ref.current;
      if (!canvas) return;
      onChange(canvas.isEmpty() ? null : canvas.toDataURL('image/png'));
    } catch (err) {
      console.warn('[SignatureField] handleEnd fehlgeschlagen', err);
    }
  }

  function clear() {
    try {
      ref.current?.clear();
      onChange(null);
    } catch (err) {
      console.warn('[SignatureField] clear fehlgeschlagen', err);
    }
  }

  // ref-callback explizit mit void-return (React 19 ref-cleanup-Strenge)
  function setRef(c: SignatureCanvas | null): void {
    ref.current = c;
  }

  return (
    <div>
      <label className="label">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </label>
      <div className="overflow-hidden rounded-lg border border-maja-navy/20 bg-white">
        <SignatureCanvas
          ref={setRef}
          onEnd={handleEnd}
          penColor="#0F2439"
          canvasProps={{
            className: 'w-full touch-none',
            style: { width: '100%', height: 160, display: 'block' },
          }}
        />
      </div>
      {!disabled && (
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={clear} className="text-sm font-medium text-maja-accent hover:underline">
            Zurücksetzen
          </button>
        </div>
      )}
    </div>
  );
}

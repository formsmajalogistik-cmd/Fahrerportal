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
    if (existing && ref.current && ref.current.isEmpty()) {
      ref.current.fromDataURL(existing);
    }
  }, [existing]);

  function handleEnd() {
    const canvas = ref.current;
    if (!canvas) return;
    onChange(canvas.isEmpty() ? null : canvas.toDataURL('image/png'));
  }

  function clear() {
    ref.current?.clear();
    onChange(null);
  }

  return (
    <div>
      <label className="label">
        {field.label}{field.required && <span className="text-red-600"> *</span>}
      </label>
      <div className="overflow-hidden rounded-lg border border-maja-navy/20 bg-white">
        <SignatureCanvas
          ref={(c) => { ref.current = c; }}
          onEnd={handleEnd}
          penColor="#0F2439"
          canvasProps={{
            className: 'w-full touch-none',
            style: { width: '100%', height: 160, display: 'block' },
          }}
          clearOnResize={false}
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

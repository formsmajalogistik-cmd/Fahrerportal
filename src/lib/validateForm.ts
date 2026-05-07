import type { FormPage, FormSchema, FormSection } from '../types/db';

export interface ValidationResult {
  valid: boolean;
  missing: string[];
}

export type PageCompletion = 'empty' | 'started' | 'complete';

export function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') {
    if ('storage_path' in v) return !!(v as { storage_path?: unknown }).storage_path;
    // Adress-Wert: alle drei Sub-Felder müssen Inhalt haben.
    if ('strasse' in v || 'plz' in v || 'stadt' in v) {
      const a = v as { strasse?: unknown; plz?: unknown; stadt?: unknown };
      return hasValue(a.strasse) && hasValue(a.plz) && hasValue(a.stadt);
    }
    return Object.keys(v).length > 0;
  }
  return true;
}

/**
 * Vollständigkeits-Status einer Seite:
 *   - 'complete': alle Pflichtfelder gefüllt (oder keine Pflichtfelder + min. 1 Wert)
 *   - 'started':  irgendein Wert gesetzt, aber noch Pflichtfelder offen
 *   - 'empty':    nichts ausgefüllt
 */
export function pageCompletion(
  page: FormPage,
  sections: FormSection[],
  data: Record<string, unknown>,
): PageCompletion {
  const sectionMap = new Map(sections.map((s) => [s.id, s]));
  let hasRequired = false;
  let allRequiredFilled = true;
  let anyFilled = false;
  for (const sid of page.sectionIds ?? []) {
    const s = sectionMap.get(sid);
    if (!s) continue;
    for (const f of s.fields ?? []) {
      const filled = hasValue(data[f.id]);
      if (filled) anyFilled = true;
      if (f.required) {
        hasRequired = true;
        if (!filled) allRequiredFilled = false;
      }
    }
  }
  if (hasRequired) {
    if (allRequiredFilled) return 'complete';
    return anyFilled ? 'started' : 'empty';
  }
  // Keine Pflichtfelder: alles, was Werte hat, ist „complete"
  return anyFilled ? 'complete' : 'empty';
}

export function validateForm(
  schema: FormSchema,
  data: Record<string, unknown>,
): ValidationResult {
  const missing: string[] = [];
  for (const section of schema.sections ?? []) {
    for (const field of section.fields ?? []) {
      if (field.required && !hasValue(data[field.id])) {
        missing.push(field.label);
      }
    }
  }
  return { valid: missing.length === 0, missing };
}

import type { FormSchema } from '../types/db';

export interface ValidationResult {
  valid: boolean;
  missing: string[];
}

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') {
    if ('storage_path' in v) return !!(v as { storage_path?: unknown }).storage_path;
    return Object.keys(v).length > 0;
  }
  return true;
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

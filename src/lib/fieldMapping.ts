import type {
  BoxEntry, FieldMapping, FieldMappingEntry, FieldType, FormField, FormSchema,
  OptionPosition, OptionsEntry, TextEntry,
} from '../types/db';

export const PHOTO_DEFAULT_WIDTH  = 200;
export const PHOTO_DEFAULT_HEIGHT = 150;
export const OPTION_DEFAULT_SIZE  = 12;
export const TEXT_DEFAULT_FONT    = 10;

export type MappingMode = 'text' | 'box' | 'options';

export function modeFor(type: FieldType): MappingMode {
  switch (type) {
    case 'text':
    case 'number':
    case 'date':
    case 'textarea':
      return 'text';
    case 'photo':
    case 'signature':
    case 'damage_diagram':
      return 'box';
    case 'checkboxes':
    case 'select':
      return 'options';
  }
}

export function isTextEntry(e: FieldMappingEntry | undefined): e is TextEntry {
  return !!e && (e.type === 'text' || e.type === 'number' || e.type === 'date' || e.type === 'textarea');
}
export function isBoxEntry(e: FieldMappingEntry | undefined): e is BoxEntry {
  return !!e && (e.type === 'photo' || e.type === 'signature' || e.type === 'damage_diagram');
}
export function isOptionsEntry(e: FieldMappingEntry | undefined): e is OptionsEntry {
  return !!e && (e.type === 'checkboxes' || e.type === 'select');
}

/** Erstellt einen leeren Default-Eintrag passend zum Feldtyp. */
export function makeDefaultEntry(
  field: FormField,
  pos: { x: number; y: number; page: number },
): FieldMappingEntry {
  const mode = modeFor(field.type);
  if (mode === 'text') {
    return {
      type: field.type as TextEntry['type'],
      page: pos.page, x: pos.x, y: pos.y,
    };
  }
  if (mode === 'box') {
    return {
      type: field.type as BoxEntry['type'],
      page: pos.page, x: pos.x, y: pos.y,
      width: PHOTO_DEFAULT_WIDTH, height: PHOTO_DEFAULT_HEIGHT,
    };
  }
  // options-mode startet leer; einzelne Optionen werden via setOptionPosition gesetzt
  return { type: field.type as OptionsEntry['type'], options: {} };
}

/**
 * Setzt die Position für eine einzelne Option auf einem options-Mapping.
 * Wenn noch kein Eintrag existiert, wird einer mit leeren options angelegt.
 */
export function setOptionPosition(
  mapping: FieldMapping,
  field: FormField,
  optionName: string,
  pos: OptionPosition,
): FieldMapping {
  const existing = mapping[field.id];
  const base: OptionsEntry = isOptionsEntry(existing)
    ? existing
    : { type: field.type as OptionsEntry['type'], options: {} };
  return {
    ...mapping,
    [field.id]: { ...base, options: { ...base.options, [optionName]: pos } },
  };
}

/** Entfernt eine einzelne Option aus dem Mapping. */
export function removeOption(
  mapping: FieldMapping, fieldId: string, optionName: string,
): FieldMapping {
  const e = mapping[fieldId];
  if (!isOptionsEntry(e)) return mapping;
  const { [optionName]: _drop, ...rest } = e.options;
  void _drop;
  if (Object.keys(rest).length === 0) {
    const { [fieldId]: _gone, ...without } = mapping;
    void _gone;
    return without;
  }
  return { ...mapping, [fieldId]: { ...e, options: rest } };
}

/** Prüft, ob ein Feld auf einer bestimmten PDF-Seite gemappt ist. */
export function isFieldMappedOnPage(
  entry: FieldMappingEntry | undefined,
  page: number,
): boolean {
  if (!entry) return false;
  if (isOptionsEntry(entry)) {
    return Object.values(entry.options).some((o) => o.page === page);
  }
  return entry.page === page;
}

/** Map field-ID → FormField anlegen, basierend auf dem Schema. */
export function fieldsById(schema: FormSchema): Map<string, FormField> {
  const m = new Map<string, FormField>();
  for (const s of schema.sections ?? []) {
    for (const f of s.fields ?? []) m.set(f.id, f);
  }
  return m;
}

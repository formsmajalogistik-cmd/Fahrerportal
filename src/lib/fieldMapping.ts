import type {
  BoxEntry, CheckboxesWithTextEntry, DynamicPhotosEntry,
  FieldMapping, FieldMappingEntry, FieldType,
  FormField, FormSchema, OptionPosition, OptionsEntry, TextEntry,
} from '../types/db';

export const PHOTO_DEFAULT_WIDTH  = 200;
export const PHOTO_DEFAULT_HEIGHT = 150;
export const OPTION_DEFAULT_SIZE  = 12;
export const TEXT_DEFAULT_FONT    = 10;
export const DYNAMIC_DEFAULT_COLUMNS = 2;
export const DYNAMIC_DEFAULT_PER_PAGE = 4;
export const DYNAMIC_DEFAULT_GAP = 12;

export type MappingMode = 'text' | 'box' | 'options' | 'dynamic' | 'options_text' | 'composite';

// ---- Mehrfach-Platzierungen -----------------------------------------
// Ein Feld kann an MEHREREN Stellen der PDF stehen (z.B. Kennzeichen auf
// Seite 1 UND 3). Zusätzliche Platzierungen liegen unter den Schlüsseln
// "feldId#2", "feldId#3", … im selben Mapping-Record — jede mit eigener
// Position/Seite/Ausrichtung/Schriftgröße, einzeln editier- und löschbar.
// Die ERSTE Platzierung behält den nackten Feld-Schlüssel; Bestands-
// Mappings bleiben dadurch byte-identisch gültig (keine Migration nötig,
// PDF-Ausgabe unverändert).

/** Liefert die Schema-Feld-ID zu einem Mapping-Schlüssel (strippt das
 *  "#n"-Instanz-Suffix; Composite-Keys wie "adresse.strasse" bleiben). */
export function baseFieldId(key: string): string {
  const m = /^(.*)#\d+$/.exec(key);
  return m ? m[1] : key;
}

/** Nächster freier Schlüssel für eine weitere Platzierung des Feldes. */
export function nextInstanceKey(mapping: FieldMapping, fieldId: string): string {
  if (!mapping[fieldId]) return fieldId;
  let n = 2;
  while (mapping[`${fieldId}#${n}`]) n += 1;
  return `${fieldId}#${n}`;
}

/** Alle ZUSÄTZLICHEN Platzierungs-Schlüssel eines Feldes (ohne den
 *  Basis-Schlüssel), sortiert. */
export function extraInstanceKeys(mapping: FieldMapping, fieldId: string): string[] {
  return Object.keys(mapping)
    .filter((k) => k !== fieldId && baseFieldId(k) === fieldId)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Anzahl der Platzierungen eines Feldes (für den "N×"-Zähler). */
export function instanceCount(mapping: FieldMapping, fieldId: string): number {
  return Object.keys(mapping).filter((k) => baseFieldId(k) === fieldId).length;
}

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
    case 'stamp':
      return 'box';
    case 'checkboxes':
    case 'select':
      return 'options';
    case 'dynamic_photos':
      return 'dynamic';
    case 'checkboxes_with_text':
      return 'options_text';
    case 'address':
      // Adresse hat keine direkte 1:1-Mapping-Position; ihre Sub-Felder
      // werden im Mapping-Editor als separate Text-Einträge platziert.
      return 'composite';
  }
}

export function isTextEntry(e: FieldMappingEntry | undefined): e is TextEntry {
  return !!e && (e.type === 'text' || e.type === 'number' || e.type === 'date' || e.type === 'textarea');
}
export function isBoxEntry(e: FieldMappingEntry | undefined): e is BoxEntry {
  return !!e && (e.type === 'photo' || e.type === 'signature' || e.type === 'damage_diagram' || e.type === 'stamp');
}
export function isOptionsEntry(e: FieldMappingEntry | undefined): e is OptionsEntry {
  return !!e && (e.type === 'checkboxes' || e.type === 'select');
}
export function isDynamicEntry(e: FieldMappingEntry | undefined): e is DynamicPhotosEntry {
  return !!e && e.type === 'dynamic_photos';
}
export function isCheckboxesWithTextEntry(e: FieldMappingEntry | undefined): e is CheckboxesWithTextEntry {
  return !!e && e.type === 'checkboxes_with_text';
}

/** Erstellt einen Default-Eintrag passend zum Feldtyp. */
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
  if (mode === 'dynamic') {
    return {
      type: 'dynamic_photos',
      page: pos.page, x: pos.x, y: pos.y,
      width: PHOTO_DEFAULT_WIDTH, height: PHOTO_DEFAULT_HEIGHT,
      columns: DYNAMIC_DEFAULT_COLUMNS,
      perPage: DYNAMIC_DEFAULT_PER_PAGE,
      rowGap: DYNAMIC_DEFAULT_GAP,
      colGap: DYNAMIC_DEFAULT_GAP,
    };
  }
  if (mode === 'options_text') {
    return { type: 'checkboxes_with_text', options: {} };
  }
  if (mode === 'composite') {
    // Address: kein eigener Mapping-Eintrag — Sub-Felder werden separat
    // unter Schlüsseln "<id>.strasse|plz|stadt" als TextEntries gemappt.
    // Wir geben hier dennoch einen leeren TextEntry zurück, damit
    // makeDefaultEntry für unerwartete Calls sicher ist; im Mapping-Editor
    // wird dieser Pfad nicht aufgerufen.
    return { type: 'text', page: pos.page, x: pos.x, y: pos.y };
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
  if (isOptionsEntry(e)) {
    const { [optionName]: _drop, ...rest } = e.options;
    void _drop;
    if (Object.keys(rest).length === 0) {
      const { [fieldId]: _gone, ...without } = mapping;
      void _gone;
      return without;
    }
    return { ...mapping, [fieldId]: { ...e, options: rest } };
  }
  if (isCheckboxesWithTextEntry(e)) {
    const { [optionName]: _drop, ...rest } = e.options;
    void _drop;
    if (Object.keys(rest).length === 0) {
      const { [fieldId]: _gone, ...without } = mapping;
      void _gone;
      return without;
    }
    return { ...mapping, [fieldId]: { ...e, options: rest } };
  }
  return mapping;
}

/**
 * Setzt eine der beiden Positionen (Häkchen oder Text) bei einem
 * checkboxes_with_text-Feld.
 */
export function setOptionPart(
  mapping: FieldMapping,
  fieldId: string,
  optionName: string,
  part: 'checkbox' | 'text',
  pos: { page: number; x: number; y: number; size?: number; fontSize?: number },
): FieldMapping {
  const existing = mapping[fieldId];
  const base: CheckboxesWithTextEntry = isCheckboxesWithTextEntry(existing)
    ? existing
    : { type: 'checkboxes_with_text', options: {} };
  const opt = base.options[optionName] ?? {
    checkbox: { page: pos.page, x: 0, y: 0 },
    text:     { page: pos.page, x: 0, y: 0 },
  };
  const next: CheckboxesWithTextEntry = {
    ...base,
    options: {
      ...base.options,
      [optionName]: { ...opt, [part]: { ...pos } },
    },
  };
  return { ...mapping, [fieldId]: next };
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
  if (isCheckboxesWithTextEntry(entry)) {
    return Object.values(entry.options).some((o) => o.checkbox.page === page || o.text.page === page);
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

/**
 * Gibt für ein DynamicPhotos-Mapping die Slot-Positionen für N Fotos zurück.
 * Wenn N > perPage → weitere "virtuelle Seiten" mit Page-Offset.
 *
 * Slot-Positionen werden als PDF-Punkte zurückgegeben (x = links, y = oberer Rand).
 * Wenn eine neue Seite begonnen wird, ist `pageOffset` > 0 und die aufrufende
 * Stelle muss eine Kopie der Startseite einfügen.
 */
export function computeDynamicSlots(
  entry: DynamicPhotosEntry,
  count: number,
): Array<{ x: number; y: number; width: number; height: number; pageOffset: number }> {
  const cols = Math.max(1, entry.columns | 0);
  const perPage = Math.max(1, entry.perPage | 0);
  const rowsPerPage = Math.max(1, Math.ceil(perPage / cols));
  const rowGap = entry.rowGap ?? DYNAMIC_DEFAULT_GAP;
  const colGap = entry.colGap ?? DYNAMIC_DEFAULT_GAP;

  const slots: Array<{ x: number; y: number; width: number; height: number; pageOffset: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const pageOffset = Math.floor(i / perPage);
    const idxOnPage = i % perPage;
    const row = Math.floor(idxOnPage / cols);
    const col = idxOnPage % cols;
    if (row >= rowsPerPage) continue; // Sicherheits-Cap
    const x = entry.x + col * (entry.width + colGap);
    const y = entry.y - row * (entry.height + rowGap);
    slots.push({ x, y, width: entry.width, height: entry.height, pageOffset });
  }
  return slots;
}

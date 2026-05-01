import type { FormPage, FormSchema, FormSection } from '../types/db';

/**
 * Liefert die Seiten des Schemas. Falls keine Seiten definiert sind, wird
 * eine einzelne implizite Seite zurückgegeben, die alle Sections enthält.
 * Sections, die in keiner Seite zugeordnet sind, werden an die letzte
 * Seite angehängt — so geht beim Editieren keine Section verloren.
 */
export function effectivePages(schema: FormSchema): FormPage[] {
  const sections = schema.sections ?? [];
  const sectionIds = sections.map((s) => s.id);
  const pages = schema.pages ?? [];

  if (pages.length === 0) {
    return [{ id: 'default', title: 'Formular', sectionIds }];
  }

  const referenced = new Set<string>();
  for (const p of pages) for (const sid of p.sectionIds ?? []) referenced.add(sid);
  const orphans = sectionIds.filter((id) => !referenced.has(id));

  return pages.map((p, idx) => {
    if (orphans.length === 0 || idx !== pages.length - 1) {
      return { ...p, sectionIds: (p.sectionIds ?? []).filter((sid) => sectionIds.includes(sid)) };
    }
    return {
      ...p,
      sectionIds: [
        ...(p.sectionIds ?? []).filter((sid) => sectionIds.includes(sid)),
        ...orphans,
      ],
    };
  });
}

/** Sections für eine bestimmte Seite (in der gleichen Reihenfolge wie schema.sections). */
export function sectionsForPage(schema: FormSchema, page: FormPage): FormSection[] {
  const sections = schema.sections ?? [];
  const idMap = new Map(sections.map((s) => [s.id, s]));
  return page.sectionIds
    .map((id) => idMap.get(id))
    .filter((s): s is FormSection => !!s);
}

/** Erzeugt eine eindeutige Seiten-ID auf Basis eines Titels. */
export function makePageId(base: string, existing: string[]): string {
  const slug = base.toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c] ?? c))
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'seite';
  let id = slug;
  let i = 1;
  while (existing.includes(id)) { i += 1; id = `${slug}_${i}`; }
  return id;
}

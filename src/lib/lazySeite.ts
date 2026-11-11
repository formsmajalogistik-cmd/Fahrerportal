// Seiten nachladen (React.lazy) mit Schutz beim Versionswechsel.
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { mitVersionsschutz } from './neueVersion';

/**
 * Lädt eine benannt exportierte Seite (ohne Props) erst bei Bedarf:
 *   const RechnungDetailPage = lazySeite(() => import('./pages/…'), 'RechnungDetailPage');
 */
export function lazySeite<K extends string>(
  laden: () => Promise<Record<K, ComponentType>>, name: K,
): LazyExoticComponent<ComponentType> {
  return lazy(() => mitVersionsschutz(laden).then((m) => ({ default: m[name] })));
}

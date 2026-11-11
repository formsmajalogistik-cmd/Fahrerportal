// Zentraler pdfjs-Setup. Der Worker wird als asset-URL von Vite eingebunden.
//
// pdf.js wird erst bei Bedarf geladen (Vorschau, Seitenbilder) — es steckt
// nicht mehr im Haupt-Bundle, das jeder Nutzer beim Öffnen der App lädt.
// Der Service Worker legt den Programmteil trotzdem vorab in den Cache.
import { mitVersionsschutz } from './neueVersion';

type PdfjsLib = typeof import('pdfjs-dist');
let geladen: Promise<PdfjsLib> | null = null;

export function ladePdfjs(): Promise<PdfjsLib> {
  if (!geladen) {
    geladen = mitVersionsschutz(() => Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ])).then(([pdfjsLib, worker]) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjsLib;
    }).catch((err: unknown) => { geladen = null; throw err; });
  }
  return geladen;
}

import { BelegeUploadTab } from './belege/BelegeUploadTab';

export function BelegePage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">Belege</h1>
        <p className="text-sm text-maja-muted">
          Beleg-PDFs aus Smartphone-Fotos zusammenstellen.
        </p>
      </div>
      <BelegeUploadTab />
    </div>
  );
}

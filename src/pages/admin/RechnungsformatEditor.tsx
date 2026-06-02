import { useMemo, useState } from 'react';
import {
  DEFAULT_RECHNUNGSFORMAT, RECHNUNG_PLATZHALTER, RECHNUNGSFORMAT_VORLAGEN,
  formatEur, renderRechnungSections, summe,
  type DatumFormat, type Rechnungsformat, type ZusaetzeDarstellung,
} from '../../lib/rechnungsformat';
import { ZUSATZ_KATEGORIEN } from '../../lib/zusatzKategorien';

interface Props {
  value: Rechnungsformat | null;
  onChange: (next: Rechnungsformat | null) => void;
}

export function RechnungsformatEditor({ value, onChange }: Props) {
  const f = value ?? DEFAULT_RECHNUNGSFORMAT;
  const [showPreview, setShowPreview] = useState(false);

  const update = (patch: Partial<Rechnungsformat>) => onChange({ ...f, ...patch });

  function loadVorlage(id: string) {
    if (!id) return;
    const v = RECHNUNGSFORMAT_VORLAGEN.find((x) => x.id === id);
    if (v) onChange(v.format);
  }

  return (
    <div className="space-y-4 rounded-lg border border-maja-navy/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-maja-navy">Rechnungsformat</h3>
        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="rf-vorlage" className="text-maja-muted">Vorlage laden:</label>
          <select
            id="rf-vorlage"
            className="input py-1 text-xs"
            defaultValue=""
            onChange={(e) => { loadVorlage(e.target.value); e.currentTarget.selectedIndex = 0; }}
          >
            <option value="">— Vorlage wählen —</option>
            {RECHNUNGSFORMAT_VORLAGEN.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
            <option value="">Benutzerdefiniert (bestehende Werte behalten)</option>
          </select>
        </div>
      </div>

      {/* Anrede & Layout */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Anrede</label>
          <input
            className="input"
            value={f.anrede}
            onChange={(e) => update({ anrede: e.target.value })}
            placeholder="Sehr geehrte Damen und Herren,"
          />
        </div>
        <div>
          <label className="label">USt-Satz (%)</label>
          <input
            type="number" min={0} max={100} step={0.1}
            className="input"
            value={f.ust_satz}
            onChange={(e) => update({ ust_satz: Number(e.target.value) || 0 })}
          />
        </div>
        <div>
          <label className="label">Datum-Format</label>
          <select
            className="input"
            value={f.datum_format}
            onChange={(e) => update({ datum_format: e.target.value as DatumFormat })}
          >
            <option value="kurz">Kurz (13.5./15.5.26)</option>
            <option value="lang">Lang (13.05.2026 – 15.05.2026)</option>
            <option value="enddatum_kurz">Nur Enddatum kurz</option>
            <option value="enddatum_lang">Nur Enddatum lang</option>
          </select>
        </div>
      </div>

      {/* Tour-Darstellung */}
      <div className="space-y-3 rounded-md bg-maja-light/40 p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-maja-muted">Tour-Darstellung</h4>
        <PatternRow label="Bezeichnung AB-Tour"  value={f.tour_bezeichnung}
                    onChange={(v) => update({ tour_bezeichnung: v })} />
        <UnterzeilenRow label="Unterzeilen AB"   value={f.tour_unterzeilen}
                        onChange={(v) => update({ tour_unterzeilen: v })} />
        <PatternRow label="Bezeichnung ABA"      value={f.aba_bezeichnung}
                    onChange={(v) => update({ aba_bezeichnung: v })} />
        <UnterzeilenRow label="Unterzeilen ABA"  value={f.aba_unterzeilen}
                        onChange={(v) => update({ aba_unterzeilen: v })} />
        <PatternRow label="Bezeichnung ABC"      value={f.abc_bezeichnung}
                    onChange={(v) => update({ abc_bezeichnung: v })} />
        <UnterzeilenRow label="Unterzeilen ABC"  value={f.abc_unterzeilen}
                        onChange={(v) => update({ abc_unterzeilen: v })} />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
            checked={f.tourenart_anzeigen}
            onChange={(e) => update({ tourenart_anzeigen: e.target.checked })}
          />
          Tourenart (ABC/ABA) in den Unterzeilen anzeigen
        </label>
      </div>

      {/* Zusätze */}
      <div className="space-y-3 rounded-md bg-maja-light/40 p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-maja-muted">Zusätze</h4>
        <div>
          <label className="label">Darstellung</label>
          <select
            className="input"
            value={f.zusaetze_darstellung}
            onChange={(e) => update({ zusaetze_darstellung: e.target.value as ZusaetzeDarstellung })}
          >
            <option value="einzeln">Einzeln als eigene Positionen</option>
            <option value="zusammengefasst">Zusammengefasst pro Tour</option>
            <option value="keine">Nicht anzeigen</option>
          </select>
        </div>
        <PatternRow label="Zusatz-Bezeichnung" value={f.zusatz_bezeichnung}
                    onChange={(v) => update({ zusatz_bezeichnung: v })} />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
            checked={f.zusatz_notiz_als_unterzeile}
            onChange={(e) => update({ zusatz_notiz_als_unterzeile: e.target.checked })}
          />
          Zusatz-Notiz als Unterzeile mit ausgeben
        </label>
      </div>

      {/* Auslagen-Rechnung */}
      <div className="space-y-3 rounded-md bg-maja-light/40 p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-maja-muted">Getrennte Auslagen-Rechnung</h4>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
            checked={f.getrennte_auslagen_rechnung}
            onChange={(e) => update({ getrennte_auslagen_rechnung: e.target.checked })}
          />
          Auslagen als separate Rechnung ausgeben (CC-Fall)
        </label>
        {f.getrennte_auslagen_rechnung && (
          <>
            <PatternRow label="Auslagen-Bezeichnung" value={f.auslagen_bezeichnung}
                        onChange={(v) => update({ auslagen_bezeichnung: v })} />
            <UnterzeilenRow label="Auslagen-Unterzeilen" value={f.auslagen_unterzeilen}
                            onChange={(v) => update({ auslagen_unterzeilen: v })} />
            <KategorienMultiselect
              label="Zusätze auf Touren-Rechnung"
              hint='Diese Kategorien gehören trotz "getrennte Auslagen-Rechnung" auf die Touren-Rechnung (CC-Sonderfall, typisch: "Rote Kennzeichen", "Wartezeit").'
              value={f.zusaetze_auf_touren_rechnung ?? []}
              onChange={(v) => update({ zusaetze_auf_touren_rechnung: v })}
            />
          </>
        )}
      </div>

      {/* Vorschau */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-maja-navy/10 pt-3">
        <button
          type="button"
          className="btn-secondary text-sm"
          onClick={() => setShowPreview((v) => !v)}
        >
          {showPreview ? 'Vorschau ausblenden' : 'Vorschau anzeigen'}
        </button>
        <button
          type="button"
          className="text-xs font-medium text-red-600 hover:underline"
          onClick={() => onChange(null)}
        >
          Format zurücksetzen
        </button>
      </div>

      {showPreview && <Vorschau format={f} />}
    </div>
  );
}

// ---- Sub-Komponenten ----

function PatternRow({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
      <PlatzhalterChips onPick={(t) => onChange(value + t)} />
    </div>
  );
}

function UnterzeilenRow({
  label, value, onChange,
}: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <label className="label">{label} (eine Zeile pro Eintrag, leere Zeile = Leerzeile in der PDF)</label>
      <div className="space-y-1">
        {value.map((line, idx) => (
          <div key={idx} className="flex items-center gap-1">
            <input
              className="input flex-1"
              value={line}
              onChange={(e) => {
                const next = value.slice();
                next[idx] = e.target.value;
                onChange(next);
              }}
              placeholder="(leere Zeile)"
            />
            <button
              type="button"
              onClick={() => onChange(value.filter((_, i) => i !== idx))}
              className="rounded-md px-2 py-1 text-red-600 hover:bg-red-50"
              aria-label="Zeile entfernen"
            >×</button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...value, ''])}
          className="text-xs font-medium text-maja-accent hover:underline"
        >
          + Zeile hinzufügen
        </button>
      </div>
      <PlatzhalterChips onPick={(t) => onChange([...value.slice(0, -1), (value[value.length - 1] ?? '') + t])} />
    </div>
  );
}

function KategorienMultiselect({
  label, hint, value, onChange,
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const selected = new Set(value);
  function toggle(k: string) {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k); else next.add(k);
    // Reihenfolge stabil halten = Reihenfolge in ZUSATZ_KATEGORIEN.
    onChange(ZUSATZ_KATEGORIEN.filter((c) => next.has(c)));
  }
  return (
    <div>
      <label className="label">{label}</label>
      {hint && <p className="mb-1 text-xs text-maja-muted">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {ZUSATZ_KATEGORIEN.map((k) => {
          const active = selected.has(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggle(k)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                active
                  ? 'bg-maja-navy text-white'
                  : 'bg-white text-maja-navy border border-maja-navy/15 hover:bg-maja-light'
              }`}
            >
              {k}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlatzhalterChips({ onPick }: { onPick: (token: string) => void }) {
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-maja-accent hover:underline">
        Platzhalter einfügen ({RECHNUNG_PLATZHALTER.length})
      </summary>
      <div className="mt-1 flex flex-wrap gap-1">
        {RECHNUNG_PLATZHALTER.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(`{${p}}`)}
            className="rounded-full bg-maja-light px-2 py-0.5 text-[11px] text-maja-navy hover:bg-maja-accent/20"
          >
            {`{${p}}`}
          </button>
        ))}
      </div>
    </details>
  );
}

function Vorschau({ format }: { format: Rechnungsformat }) {
  const sections = useMemo(() => renderRechnungSections(format), [format]);
  if (sections.length === 0) {
    return <p className="text-xs text-maja-muted">Vorschau: keine Positionen.</p>;
  }
  return (
    <div className="space-y-4">
      {sections.map((s, si) => {
        const sum = summe(s.positionen);
        const ust = Math.round(sum * format.ust_satz) / 100;
        return (
          <div key={si} className="rounded-md border border-maja-navy/10 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <strong className="text-sm text-maja-navy">{s.titel}</strong>
              <span className="text-xs text-maja-muted">Vorschau — fiktive Daten</span>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-maja-light text-maja-navy">
                <tr>
                  <th className="px-2 py-1 text-left">Pos</th>
                  <th className="px-2 py-1 text-left">Bezeichnung</th>
                  <th className="px-2 py-1 text-right">Menge</th>
                  <th className="px-2 py-1 text-right">Einzelpreis</th>
                  <th className="px-2 py-1 text-right">Gesamtpreis</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-maja-navy/10">
                {s.positionen.map((p, pi) => (
                  <tr key={pi}>
                    <td className="px-2 py-1 align-top">{pi + 1}</td>
                    <td className="px-2 py-1">
                      <div>{p.bezeichnung}</div>
                      {p.unterzeilen.map((u, ui) => (
                        <div key={ui} className="text-maja-muted">{u || ' '}</div>
                      ))}
                    </td>
                    <td className="px-2 py-1 text-right align-top">{p.menge}x</td>
                    <td className="px-2 py-1 text-right align-top">{formatEur(p.einzelpreis)}</td>
                    <td className="px-2 py-1 text-right align-top">{formatEur(p.gesamtpreis)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="px-2 py-1 text-right font-medium">Zwischensumme:</td>
                  <td className="px-2 py-1 text-right font-medium">{formatEur(sum)}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="px-2 py-1 text-right text-maja-muted">USt {format.ust_satz}%:</td>
                  <td className="px-2 py-1 text-right text-maja-muted">{formatEur(ust)}</td>
                </tr>
                <tr className="bg-maja-light">
                  <td colSpan={4} className="px-2 py-1 text-right font-semibold text-maja-navy">Gesamt:</td>
                  <td className="px-2 py-1 text-right font-semibold text-maja-navy">{formatEur(sum + ust)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}
    </div>
  );
}

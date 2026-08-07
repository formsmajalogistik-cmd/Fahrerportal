// Umrandeter Block des kompakten Tour-Formulars (tf = tour form).
//
// Die Tour-Masken (Admin-Detail, „Neue Tour", Side-by-Side aus der
// E-Mail, Auftraggeber-Anlage/-Bearbeitung) sind in dieselben klar
// abgegrenzten Blöcke gegliedert: Auftragsdaten, Fahrzeug Hinfahrt,
// Abholort, Zielort, Fahrzeug Rückfahrt, Rückführungsort sowie
// Kilometer & Termine.
//
// `akzent` färbt den linken Rand und macht Hin- und Rückfahrzeug auf
// einen Blick unterscheidbar: blau = Hinfahrt, bernstein = Rückfahrt.

import type { ReactNode } from 'react';

interface Props {
  titel: string;
  akzent?: 'hin' | 'rueck';
  /** Optionale Aktion rechts in der Überschrift (z.B. „entfernen"). */
  aktion?: ReactNode;
  children: ReactNode;
}

export function TfBlock({ titel, akzent, aktion, children }: Props) {
  const akzentCls = akzent === 'hin' ? ' tf-hin' : akzent === 'rueck' ? ' tf-rueck' : '';
  return (
    <section className={`tf-block${akzentCls}`}>
      <h3 className="tf-block-title">
        <span>{titel}</span>
        {aktion}
      </h3>
      {children}
    </section>
  );
}

import { useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import type { TourenArt } from '../../types/db';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

/**
 * Vereinfachtes "Neue Tour"-Formular für Auftraggeber-Profile.
 *
 * Bewusst OHNE: Preisberechnung, km-Felder, Vergütung, Preisstufen,
 * Fahrer-Zuweisung, Sondervereinbarung, Greimel. Der Auftraggeber ist
 * fest das eigene Profil-Konto. Gespeichert wird mit bestaetigt=false —
 * die Tour erscheint beim Admin "Zur Bestätigung" und beim Auftraggeber
 * als "In Prüfung".
 */
export function AuftraggeberTourCreateDialog({ onClose, onCreated }: Props) {
  const { profile, session } = useAuth();

  const [tourenart, setTourenart] = useState<TourenArt | ''>('');
  const [startStadt, setStartStadt] = useState('');
  const [zielStadt, setZielStadt] = useState('');
  const [rueckStadt, setRueckStadt] = useState('');
  const [startdatum, setStartdatum] = useState('');
  const [enddatum, setEnddatum] = useState('');
  const [kennzeichenHin, setKennzeichenHin] = useState('');
  const [kennzeichenRueck, setKennzeichenRueck] = useState('');
  const [fin, setFin] = useState('');
  const [istEFahrzeug, setIstEFahrzeug] = useState(false);
  const [kundenname, setKundenname] = useState('');
  const [adresseStart, setAdresseStart] = useState('');
  const [adresseZiel, setAdresseZiel] = useState('');
  const [adresseRueck, setAdresseRueck] = useState('');
  const [kontaktStartName, setKontaktStartName] = useState('');
  const [kontaktStartTel, setKontaktStartTel] = useState('');
  const [kontaktStartMail, setKontaktStartMail] = useState('');
  const [kontaktZielName, setKontaktZielName] = useState('');
  const [kontaktZielTel, setKontaktZielTel] = useState('');
  const [kontaktZielMail, setKontaktZielMail] = useState('');
  const [info, setInfo] = useState('');

  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ABA/ABC haben eine Rückführung → Adresse Rückführung wird Pflicht.
  const hatRueckfuehrung = tourenart === 'ABA' || tourenart === 'ABC';

  function inputCls(key: string): string {
    return missing.has(key) ? 'input border-red-500' : 'input';
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Pflichtfelder prüfen — fehlende rot markieren.
    const miss = new Set<string>();
    if (!tourenart) miss.add('tourenart');
    if (!startStadt.trim()) miss.add('startStadt');
    if (!zielStadt.trim()) miss.add('zielStadt');
    if (!startdatum) miss.add('startdatum');
    if (!enddatum) miss.add('enddatum');
    if (!kennzeichenHin.trim()) miss.add('kennzeichen');
    if (!fin.trim()) miss.add('fin');
    if (!kundenname.trim()) miss.add('kundenname');
    if (!adresseStart.trim()) miss.add('adresseStart');
    if (!adresseZiel.trim()) miss.add('adresseZiel');
    if (!kontaktStartName.trim()) miss.add('kontaktStart');
    if (!kontaktZielName.trim()) miss.add('kontaktZiel');
    if (hatRueckfuehrung) {
      if (!rueckStadt.trim()) miss.add('rueckStadt');
      if (!adresseRueck.trim()) miss.add('adresseRueck');
    }
    setMissing(miss);
    if (miss.size > 0) {
      setError('Bitte alle Pflichtfelder ausfüllen (rot markiert).');
      return;
    }

    if (!profile?.auftraggeber_id || !session) {
      setError('Ihrem Konto ist kein Auftraggeber zugeordnet — bitte wenden Sie sich an Maja-Logistik.');
      return;
    }

    const kennzeichen = [kennzeichenHin.trim().toUpperCase()];
    if (hatRueckfuehrung && kennzeichenRueck.trim()) {
      kennzeichen.push(kennzeichenRueck.trim().toUpperCase());
    }

    setSaving(true);
    const { error: err } = await supabase.from('touren').insert({
      start_stadt: startStadt.trim(),
      ziel_stadt: zielStadt.trim(),
      rueckfuehrung_stadt: hatRueckfuehrung ? rueckStadt.trim() : null,
      startdatum,
      enddatum,
      tourenart: tourenart || null,
      kennzeichen,
      fin: fin.trim(),
      ist_e_fahrzeug: istEFahrzeug,
      kundenname: kundenname.trim(),
      adresse_start: adresseStart.trim(),
      adresse_ziel: adresseZiel.trim(),
      adresse_rueckfuehrung: hatRueckfuehrung ? adresseRueck.trim() : null,
      kontakt_start: {
        name: kontaktStartName.trim(),
        telefon: kontaktStartTel.trim(),
        email: kontaktStartMail.trim(),
      },
      kontakt_ziel: {
        name: kontaktZielName.trim(),
        telefon: kontaktZielTel.trim(),
        email: kontaktZielMail.trim(),
      },
      info: info.trim() || null,
      auftraggeber_id: profile.auftraggeber_id,
      bestaetigt: false,
      erstellt_von: session.user.id,
      erstellt_von_rolle: 'auftraggeber',
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-2xl p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-maja-navy">Neue Tour anlegen</h2>
          <p className="text-xs text-maja-muted">
            Die Tour wird nach dem Speichern von Maja-Logistik geprüft und
            bestätigt. Pflichtfelder sind mit * markiert.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="at-art" className="label">Tourenart *</label>
              <select id="at-art" className={inputCls('tourenart')}
                      value={tourenart}
                      onChange={(e) => setTourenart(e.target.value as TourenArt | '')}>
                <option value="">— wählen —</option>
                <option value="AB">AB (einfach)</option>
                <option value="ABA">ABA (hin + zurück)</option>
                <option value="ABC">ABC (Dreieck)</option>
              </select>
            </div>
            <div>
              <label htmlFor="at-von" className="label">Startdatum *</label>
              <input id="at-von" type="date" className={inputCls('startdatum')}
                     value={startdatum} onChange={(e) => setStartdatum(e.target.value)} />
            </div>
            <div>
              <label htmlFor="at-bis" className="label">Enddatum *</label>
              <input id="at-bis" type="date" className={inputCls('enddatum')}
                     value={enddatum} onChange={(e) => setEnddatum(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="at-start" className="label">Start-Stadt *</label>
              <input id="at-start" className={inputCls('startStadt')}
                     value={startStadt} onChange={(e) => setStartStadt(e.target.value)} />
            </div>
            <div>
              <label htmlFor="at-ziel" className="label">Ziel-Stadt *</label>
              <input id="at-ziel" className={inputCls('zielStadt')}
                     value={zielStadt} onChange={(e) => setZielStadt(e.target.value)} />
            </div>
          </div>

          {hatRueckfuehrung && (
            <div>
              <label htmlFor="at-rueck" className="label">Rückführung-Stadt *</label>
              <input id="at-rueck" className={inputCls('rueckStadt')}
                     value={rueckStadt} onChange={(e) => setRueckStadt(e.target.value)} />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="at-kz" className="label">Kennzeichen *</label>
              <input id="at-kz" className={inputCls('kennzeichen')}
                     value={kennzeichenHin} onChange={(e) => setKennzeichenHin(e.target.value)} />
            </div>
            {hatRueckfuehrung && (
              <div>
                <label htmlFor="at-kz2" className="label">Kennzeichen Rückführung</label>
                <input id="at-kz2" className="input"
                       value={kennzeichenRueck} onChange={(e) => setKennzeichenRueck(e.target.value)} />
              </div>
            )}
            <div>
              <label htmlFor="at-fin" className="label">FIN *</label>
              <input id="at-fin" className={inputCls('fin')}
                     value={fin} onChange={(e) => setFin(e.target.value)} />
            </div>
            <div>
              <label htmlFor="at-kunde" className="label">Kundenname *</label>
              <input id="at-kunde" className={inputCls('kundenname')}
                     value={kundenname} onChange={(e) => setKundenname(e.target.value)} />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-maja-ink">
            <input type="checkbox" className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                   checked={istEFahrzeug} onChange={(e) => setIstEFahrzeug(e.target.checked)} />
            E-Fahrzeug
          </label>

          <div className="space-y-3">
            <div>
              <label htmlFor="at-adr-start" className="label">Adresse Start *</label>
              <input id="at-adr-start" className={inputCls('adresseStart')}
                     placeholder="Straße Nr, PLZ Stadt"
                     value={adresseStart} onChange={(e) => setAdresseStart(e.target.value)} />
            </div>
            <div>
              <label htmlFor="at-adr-ziel" className="label">Adresse Ziel *</label>
              <input id="at-adr-ziel" className={inputCls('adresseZiel')}
                     placeholder="Straße Nr, PLZ Stadt"
                     value={adresseZiel} onChange={(e) => setAdresseZiel(e.target.value)} />
            </div>
            {hatRueckfuehrung && (
              <div>
                <label htmlFor="at-adr-rueck" className="label">Adresse Rückführung *</label>
                <input id="at-adr-rueck" className={inputCls('adresseRueck')}
                       placeholder="Straße Nr, PLZ Stadt"
                       value={adresseRueck} onChange={(e) => setAdresseRueck(e.target.value)} />
              </div>
            )}
          </div>

          <fieldset className="rounded-lg border border-maja-navy/15 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-maja-muted">
              Kontaktperson Start *
            </legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <input aria-label="Name Kontakt Start" className={inputCls('kontaktStart')} placeholder="Name *"
                     value={kontaktStartName} onChange={(e) => setKontaktStartName(e.target.value)} />
              <input aria-label="Telefon Kontakt Start" className="input" placeholder="Telefon"
                     value={kontaktStartTel} onChange={(e) => setKontaktStartTel(e.target.value)} />
              <input aria-label="E-Mail Kontakt Start" className="input" placeholder="E-Mail"
                     value={kontaktStartMail} onChange={(e) => setKontaktStartMail(e.target.value)} />
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-maja-navy/15 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-maja-muted">
              Kontaktperson Ziel *
            </legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <input aria-label="Name Kontakt Ziel" className={inputCls('kontaktZiel')} placeholder="Name *"
                     value={kontaktZielName} onChange={(e) => setKontaktZielName(e.target.value)} />
              <input aria-label="Telefon Kontakt Ziel" className="input" placeholder="Telefon"
                     value={kontaktZielTel} onChange={(e) => setKontaktZielTel(e.target.value)} />
              <input aria-label="E-Mail Kontakt Ziel" className="input" placeholder="E-Mail"
                     value={kontaktZielMail} onChange={(e) => setKontaktZielMail(e.target.value)} />
            </div>
          </fieldset>

          <div>
            <label htmlFor="at-info" className="label">Hinweise (optional)</label>
            <textarea id="at-info" className="input min-h-[72px]"
                      value={info} onChange={(e) => setInfo(e.target.value)} />
          </div>

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary" disabled={saving}>
              Abbrechen
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Speichert …' : 'Tour einreichen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

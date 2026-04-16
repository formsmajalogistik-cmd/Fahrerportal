import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchFormulare, createOffenesFormular } from '../services/api';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import { Icon } from '../components/Icon';
import type { Formular } from '../types/sharepoint';
import './TablePage.css';

export function FormularePage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [formulare, setFormulare] = useState<Formular[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Start-flow modal state (asks for Fahrzeug before creating the entry)
  const [starting, setStarting] = useState<Formular | null>(null);
  const [fahrzeug, setFahrzeug] = useState('');
  const [startError, setStartError] = useState<string | null>(null);
  const [startBusy, setStartBusy] = useState(false);

  const loadData = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setFormulare(await fetchFormulare(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der Formulare');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const filtered = formulare.filter(
    (f) =>
      f.formularname.toLowerCase().includes(search.toLowerCase()) ||
      f.art.toLowerCase().includes(search.toLowerCase())
  );

  const artClass = (art: string) => {
    switch (art) {
      case 'Wiederkehrend': return 'badge badge-info';
      case 'Einmalig': return 'badge badge-warning';
      default: return 'badge';
    }
  };

  const openStartDialog = (formular: Formular) => {
    setStarting(formular);
    setFahrzeug('');
    setStartError(null);
  };

  const cancelStart = () => {
    if (startBusy) return;
    setStarting(null);
    setFahrzeug('');
    setStartError(null);
  };

  const confirmStart = async () => {
    if (!starting || !token || startBusy) return;
    const trimmed = fahrzeug.trim();
    if (!trimmed) {
      setStartError('Bitte Fahrzeug angeben');
      return;
    }
    setStartBusy(true);
    setStartError(null);

    // Generate a unique submission ID for this form session.
    // Fillout uses ?id=<ID> to resume a saved session.
    const submissionId = crypto.randomUUID();

    // Build the Fillout URL with the id parameter
    const baseUrl = starting.filloutUrl;
    const separator = baseUrl.includes('?') ? '&' : '?';
    const filloutUrlWithSubmission = `${baseUrl}${separator}id=${encodeURIComponent(submissionId)}`;

    // Try to create an OffeneFormulare entry, but don't block the user
    // if the SharePoint list isn't set up yet.
    let offenesId: number | undefined;
    try {
      const offen = await createOffenesFormular(token, {
        formularname: starting.formularname,
        fahrzeug: trimmed,
        filloutSubmissionId: submissionId,
      });
      offenesId = offen.id || undefined;
    } catch {
      // SharePoint list may not exist — continue without tracking entry
      console.warn('OffeneFormulare konnte nicht erstellt werden, öffne Formular trotzdem');
    }

    navigate('/formular', {
      state: {
        filloutUrl: filloutUrlWithSubmission,
        formularname: starting.formularname,
        offenesId,
        fahrzeug: trimmed,
      },
    });
  };

  if (loading) return <LoadingSpinner text="Formulare werden geladen…" />;
  if (error) return <ErrorMessage message={error} onRetry={loadData} />;

  return (
    <div className="table-page">
      <div className="section-header">
        <h2>Meine Formulare</h2>
        <span className="section-sub">{formulare.length} Einträge</span>
      </div>

      <div className="toolbar">
        <div className="search-wrap">
          <Icon name="search" size={16} />
          <input
            type="search"
            className="search-input"
            placeholder="Formulare suchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Formular</th>
              <th>Art</th>
              <th>Aktion</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3} className="empty-row">
                  Keine Formulare gefunden
                </td>
              </tr>
            ) : (
              filtered.map((f) => (
                <tr key={f.id}>
                  <td className="font-medium">{f.formularname}</td>
                  <td>
                    <span className={artClass(f.art)}>{f.art}</span>
                  </td>
                  <td>
                    {f.filloutUrl ? (
                      <button
                        className="btn-primary"
                        onClick={() => openStartDialog(f)}
                      >
                        <span>Starten</span>
                        <Icon name="arrow-right" size={14} />
                      </button>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {starting && (
        <div className="modal-backdrop" onClick={cancelStart}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="section-header">
              <h2>Formular starten</h2>
            </div>
            <p className="modal-sub">{starting.formularname}</p>
            <label className="form-label" htmlFor="fahrzeug-input">
              Fahrzeug
            </label>
            <input
              id="fahrzeug-input"
              type="text"
              className="form-input"
              value={fahrzeug}
              onChange={(e) => setFahrzeug(e.target.value)}
              placeholder="z.B. HH-ML 123"
              autoFocus
              disabled={startBusy}
            />
            {startError && <p className="modal-error">{startError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={cancelStart}
                disabled={startBusy}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={confirmStart}
                disabled={startBusy}
              >
                {startBusy ? 'Starte…' : 'Formular öffnen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

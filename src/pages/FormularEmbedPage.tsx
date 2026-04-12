import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { updateOffenesFormularStatus } from '../services/api';
import { Icon } from '../components/Icon';
import './FormularEmbedPage.css';

/**
 * Fullscreen Fillout iframe wrapper.
 *
 * Reached via `navigate('/formular', { state: { ... } })` from
 * FormularePage or DashboardPage so the URL never leaks the Fillout
 * link itself (no deep link). If the user reloads this page the state
 * is gone and we redirect back to the form list.
 *
 * Expected location.state:
 *   filloutUrl   - absolute URL to the Fillout form
 *   formularname - display name for the header
 *   offenesId    - id of the related "Offene Formulare" entry (for Abschluss button)
 *   fahrzeug     - optional, shown under the title
 */
interface EmbedState {
  filloutUrl: string;
  formularname: string;
  offenesId?: number;
  fahrzeug?: string;
}

export function FormularEmbedPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as EmbedState | null) ?? null;
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  useEffect(() => {
    if (!state || !state.filloutUrl) {
      navigate('/formulare', { replace: true });
    }
  }, [state, navigate]);

  if (!state || !state.filloutUrl) return null;

  const handleBack = () => {
    navigate(-1);
  };

  const handleAbschliessen = async () => {
    if (!token || !state.offenesId || closing) return;
    setClosing(true);
    setCloseError(null);
    try {
      await updateOffenesFormularStatus(token, state.offenesId, 'Abgeschlossen');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setCloseError(
        err instanceof Error ? err.message : 'Abschluss konnte nicht gespeichert werden'
      );
      setClosing(false);
    }
  };

  return (
    <div className="embed-page">
      <div className="embed-toolbar">
        <button className="btn-ghost" onClick={handleBack} disabled={closing}>
          <Icon name="arrow-left" size={18} />
          <span>Zurück</span>
        </button>
        <div className="embed-meta">
          <h1 className="embed-title">{state.formularname}</h1>
          {state.fahrzeug && (
            <span className="embed-sub">Fahrzeug: {state.fahrzeug}</span>
          )}
        </div>
        {state.offenesId ? (
          <button
            className="btn-primary"
            onClick={handleAbschliessen}
            disabled={closing}
          >
            <Icon name="check" size={16} />
            <span>{closing ? 'Speichern…' : 'Abschließen'}</span>
          </button>
        ) : (
          <div />
        )}
      </div>

      {closeError && <p className="embed-error">{closeError}</p>}

      <div className="embed-frame-wrapper">
        <iframe
          key={state.filloutUrl}
          src={state.filloutUrl}
          className="embed-frame"
          title={state.formularname}
          allow="camera; microphone; geolocation; clipboard-write"
          allowFullScreen
        />
      </div>
    </div>
  );
}

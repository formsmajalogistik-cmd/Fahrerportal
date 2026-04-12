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
    if (!token || closing) return;
    setClosing(true);
    setCloseError(null);

    // Try to mark the entry as finished in SharePoint, but don't block
    // the user if the list doesn't exist or the update fails.
    if (state.offenesId && state.offenesId > 0) {
      try {
        await updateOffenesFormularStatus(token, state.offenesId, 'Abgeschlossen');
      } catch (err) {
        console.warn('Abschluss-Status konnte nicht gespeichert werden:', err);
      }
    }
    navigate('/dashboard', { replace: true });
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
        <button
          className="btn-primary"
          onClick={handleAbschliessen}
          disabled={closing}
        >
          <Icon name="check" size={16} />
          <span>{closing ? 'Speichern…' : 'Abschließen'}</span>
        </button>
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

import { useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionStatus, BrowserAuthError } from '@azure/msal-browser';
import { loginRequest } from '../auth/msalConfig';
import './LoginPage.css';

export function LoginPage() {
  const { instance, inProgress } = useMsal();
  const [error, setError] = useState<string | null>(null);

  const busy = inProgress !== InteractionStatus.None;

  const handleLogin = async () => {
    if (busy) return;
    setError(null);
    try {
      // loginPopup is more reliable on GitHub Pages than loginRedirect
      // (redirect flow has issues with SPA routing + BASE_URL path).
      await instance.loginPopup(loginRequest);
    } catch (err) {
      if (err instanceof BrowserAuthError && err.errorCode === 'user_cancelled') {
        return; // User closed popup, no error message needed
      }
      const msg = err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen';
      console.error('Login fehlgeschlagen:', err);
      setError(msg);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h1 className="login-title">Maja Logistik</h1>
          <p className="login-subtitle">Fahrerportal</p>
        </div>
        <div className="login-body">
          <p className="login-info">
            Melden Sie sich mit Ihrem Microsoft-Konto an, um auf das Fahrerportal zuzugreifen.
          </p>
          <button className="btn-microsoft" onClick={handleLogin} disabled={busy}>
            <svg viewBox="0 0 21 21" width="21" height="21">
              <rect x="1" y="1" width="9" height="9" fill="#f25022" />
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
              <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
              <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
            </svg>
            {busy ? 'Anmeldung läuft…' : 'Mit Microsoft anmelden'}
          </button>
          {error && <p className="login-error">{error}</p>}
        </div>
        <div className="login-footer">
          <p>Gesichert durch Microsoft 365</p>
        </div>
      </div>
    </div>
  );
}

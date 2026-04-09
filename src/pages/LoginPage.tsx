import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../auth/msalConfig';
import './LoginPage.css';

export function LoginPage() {
  const { instance } = useMsal();

  const handleLogin = async () => {
    try {
      await instance.loginPopup(loginRequest);
    } catch (error) {
      console.error('Login fehlgeschlagen:', error);
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
          <button className="btn-microsoft" onClick={handleLogin}>
            <svg viewBox="0 0 21 21" width="21" height="21">
              <rect x="1" y="1" width="9" height="9" fill="#f25022" />
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
              <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
              <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
            </svg>
            Mit Microsoft anmelden
          </button>
        </div>
        <div className="login-footer">
          <p>Gesichert durch Microsoft 365</p>
        </div>
      </div>
    </div>
  );
}

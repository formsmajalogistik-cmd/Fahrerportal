import { useState, useRef, useEffect } from 'react';
import type { FormEvent, KeyboardEvent, ChangeEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { login as apiLogin, ApiError } from '../services/api';
import { Logo } from '../components/Logo';
import './LoginPage.css';

const PIN_LENGTH = 4;

export function LoginPage() {
  const { login } = useAuth();
  const [benutzername, setBenutzername] = useState('');
  const [pin, setPin] = useState<string[]>(() => Array(PIN_LENGTH).fill(''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    // Autofocus username on mount
    const first = document.getElementById('benutzername-input');
    first?.focus();
  }, []);

  const handlePinChange = (index: number, value: string) => {
    // Only accept single digit
    if (!/^\d?$/.test(value)) return;
    const next = [...pin];
    next[index] = value;
    setPin(next);
    if (value && index < PIN_LENGTH - 1) {
      pinRefs.current[index + 1]?.focus();
    }
  };

  const handlePinKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      pinRefs.current[index - 1]?.focus();
    }
  };

  const handlePinPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, PIN_LENGTH);
    if (!text) return;
    const next = Array(PIN_LENGTH).fill('');
    for (let i = 0; i < text.length; i++) next[i] = text[i];
    setPin(next);
    const focusIndex = Math.min(text.length, PIN_LENGTH - 1);
    pinRefs.current[focusIndex]?.focus();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;

    const pinValue = pin.join('');
    if (!benutzername.trim()) {
      setError('Bitte Benutzername eingeben');
      return;
    }
    if (pinValue.length !== PIN_LENGTH) {
      setError(`Bitte ${PIN_LENGTH}-stelligen PIN eingeben`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await apiLogin(benutzername.trim(), pinValue);
      login(response.token, response.user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Benutzername oder PIN falsch');
      } else {
        setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen');
      }
      setPin(Array(PIN_LENGTH).fill(''));
      pinRefs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <Logo variant="light" size={80} showText={false} />
        </div>
        <form className="login-body" onSubmit={handleSubmit}>
          <p className="login-info">Anmeldung mit Benutzername und PIN</p>

          <div className="form-group">
            <label htmlFor="benutzername-input" className="form-label">
              Benutzername
            </label>
            <input
              id="benutzername-input"
              type="text"
              className="form-input"
              value={benutzername}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setBenutzername(e.target.value)}
              autoComplete="username"
              disabled={busy}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">PIN</label>
            <div className="pin-group" onPaste={handlePinPaste}>
              {pin.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { pinRefs.current[i] = el; }}
                  type="password"
                  inputMode="numeric"
                  maxLength={1}
                  className="pin-input"
                  value={digit}
                  onChange={(e) => handlePinChange(i, e.target.value)}
                  onKeyDown={(e) => handlePinKeyDown(i, e)}
                  disabled={busy}
                  aria-label={`PIN Ziffer ${i + 1}`}
                />
              ))}
            </div>
          </div>

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="btn-login" disabled={busy}>
            {busy ? 'Anmeldung läuft…' : 'Anmelden'}
          </button>
        </form>
        <div className="login-footer">
          <p>© Maja Logistik</p>
        </div>
      </div>
    </div>
  );
}

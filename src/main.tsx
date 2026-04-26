import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import App from './App';
import './index.css';

// Globale Error-Listener: zeigen unhandled JS-Fehler & abgelehnte Promises
// in der Browser-Konsole, damit sie diagnostizierbar sind, statt die App
// kommentarlos sterben zu lassen.
window.addEventListener('error', (e) => {
  console.error('[window.error]', e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[window.unhandledrejection]', e.reason);
});

function AppErrorFallback({
  error, reset,
}: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen bg-maja-light px-4 py-12">
      <div className="mx-auto max-w-lg rounded-xl bg-white p-6 shadow-card">
        <h1 className="mb-2 text-lg font-semibold text-red-700">
          Etwas ist schiefgelaufen
        </h1>
        <p className="mb-3 text-sm text-maja-ink">
          Die App konnte nicht weiterlaufen. Klicke unten auf „Neu laden" oder
          „Zur Startseite" — die Fehlerdetails findest du in der Browser-Konsole.
        </p>
        <pre className="mb-4 max-h-40 overflow-auto rounded bg-red-50 p-3 text-xs text-red-900">
          {error.message}
        </pre>
        <div className="flex gap-2">
          <button onClick={reset} className="btn-secondary">Erneut versuchen</button>
          <a href="/" className="btn-primary">Zur Startseite</a>
          <button onClick={() => location.reload()} className="btn-secondary">Neu laden</button>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallback={AppErrorFallback}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);

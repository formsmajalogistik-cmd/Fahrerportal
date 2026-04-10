import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, initializeMsal } from './auth/AuthProvider';
import App from './App';
import './index.css';

// Vite provides BASE_URL (e.g. "/Fahrerportal/"). Strip trailing slash for router.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

/**
 * Initialize MSAL (including handleRedirectPromise) BEFORE rendering React.
 * This ensures any pending auth redirect is fully processed before the app
 * checks `useIsAuthenticated()` - otherwise we'd render the LoginPage mid-flow
 * and bounce the user straight back into another login redirect (the loop).
 */
async function bootstrap() {
  try {
    await initializeMsal();
  } catch (error) {
    console.error('MSAL-Initialisierung fehlgeschlagen:', error);
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter basename={basename}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>
  );
}

bootstrap();

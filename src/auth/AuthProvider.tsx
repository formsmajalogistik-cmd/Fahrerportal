import type { ReactNode } from 'react';
import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication, EventType } from '@azure/msal-browser';
import type { EventMessage, AuthenticationResult } from '@azure/msal-browser';
import { msalConfig } from './msalConfig';

/**
 * Single MSAL instance for the whole application.
 * Must be initialized (and handleRedirectPromise awaited) before React renders -
 * see main.tsx where `initializeMsal()` is awaited on startup.
 */
export const msalInstance = new PublicClientApplication(msalConfig);

/**
 * Initialize MSAL and process any pending redirect response.
 * Call this once before rendering the React tree.
 *
 * This is essential for both redirect and popup flows:
 * - Redirect flow: completes the auth handshake after returning from Microsoft
 * - Popup flow: still required by MSAL v3+ to bootstrap the instance
 */
export async function initializeMsal(): Promise<void> {
  await msalInstance.initialize();

  // Process any pending redirect response BEFORE any other auth logic runs.
  // Returns the AuthenticationResult if we just came back from a redirect login,
  // or null otherwise.
  const response = await msalInstance.handleRedirectPromise();

  if (response?.account) {
    msalInstance.setActiveAccount(response.account);
  } else {
    // Restore active account from cache on page reload
    const accounts = msalInstance.getAllAccounts();
    if (accounts.length > 0 && !msalInstance.getActiveAccount()) {
      msalInstance.setActiveAccount(accounts[0]);
    }
  }

  // Keep active account in sync on subsequent login events
  msalInstance.addEventCallback((event: EventMessage) => {
    if (
      (event.eventType === EventType.LOGIN_SUCCESS ||
        event.eventType === EventType.ACQUIRE_TOKEN_SUCCESS) &&
      event.payload
    ) {
      const result = event.payload as AuthenticationResult;
      if (result.account) {
        msalInstance.setActiveAccount(result.account);
      }
    }
  });
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  return <MsalProvider instance={msalInstance}>{children}</MsalProvider>;
}

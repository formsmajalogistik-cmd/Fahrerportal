import type { ReactNode } from 'react';
import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication, EventType } from '@azure/msal-browser';
import type { EventMessage, AuthenticationResult } from '@azure/msal-browser';
import { msalConfig } from './msalConfig';

const msalInstance = new PublicClientApplication(msalConfig);

// Set active account after login
msalInstance.addEventCallback((event: EventMessage) => {
  if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
    const result = event.payload as AuthenticationResult;
    msalInstance.setActiveAccount(result.account);
  }
});

// Try to set active account on load
const accounts = msalInstance.getAllAccounts();
if (accounts.length > 0) {
  msalInstance.setActiveAccount(accounts[0]);
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  return <MsalProvider instance={msalInstance}>{children}</MsalProvider>;
}

export { msalInstance };
